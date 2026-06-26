import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaPg } from '@prisma/adapter-pg';
import type { FastifyRequest } from 'fastify';

import { PrismaClient } from '../../prisma/generated/prisma/client.js';
import type { Env } from '../config/env.js';

import { getSession, sessionCookieName, createSessionForUser } from './session.js';

/**
 * R3.2 — integration tests for `getSession()` against the local test DB.
 *
 * Verifies the four state transitions per SECURITY §1.1:
 *   1. Missing cookie → null.
 *   2. Fresh session (within updateAge) → returns user; row unchanged.
 *   3. Old-but-not-expired session → returns user; `expires` slid forward.
 *   4. Expired session → returns null; row deleted.
 */
const TEST_DB_URL =
  process.env['DATABASE_URL_TEST'] ?? 'postgresql://dnd:dnd@localhost:5433/dnd_inv_test';

const env: Env = {
  NODE_ENV: 'test',
  PORT: 0,
  HOST: '127.0.0.1',
  LOG_LEVEL: 'silent',
  DATABASE_URL: TEST_DB_URL,
  WEB_ORIGIN: 'http://localhost:5173',
  AUTH_SECRET: 'test-secret-padding-to-meet-32-char-min-XXXXXX',
  SNAPSHOTS_ENABLED: false,
  SNAPSHOT_DIR: './snapshots',
  SNAPSHOT_RETENTION_DAYS: 30,
};

let prisma: PrismaClient;

beforeAll(() => {
  const adapter = new PrismaPg({ connectionString: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  // Sessions cascade-delete with the User; clear both for a clean slate.
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Session", "Account", "User" CASCADE');
});

function fakeRequest(cookies: Record<string, string>): FastifyRequest {
  return { cookies } as unknown as FastifyRequest;
}

async function createUserAndSession(opts: {
  sessionToken: string;
  expires: Date;
  userId?: string;
}): Promise<void> {
  const userId = opts.userId ?? 'user-' + crypto.randomUUID();
  await prisma.user.create({
    data: {
      id: userId,
      displayName: 'Test User',
      discordId: 'discord-' + userId,
    },
  });
  await prisma.session.create({
    data: {
      sessionToken: opts.sessionToken,
      userId,
      expires: opts.expires,
    },
  });
}

describe('getSession (R3.2)', () => {
  it('returns null when no cookie is present', async () => {
    const result = await getSession(fakeRequest({}), prisma, env);
    expect(result).toBeNull();
  });

  it('returns null when the cookie value does not match any row', async () => {
    const result = await getSession(
      fakeRequest({ [sessionCookieName(env)]: 'no-such-token' }),
      prisma,
      env,
    );
    expect(result).toBeNull();
  });

  it('returns user + session when the cookie matches a non-expired row', async () => {
    const token = 'token-fresh';
    const expires = new Date(Date.now() + 60 * 60 * 24 * 30 * 1000);
    await createUserAndSession({ sessionToken: token, expires });

    const result = await getSession(fakeRequest({ [sessionCookieName(env)]: token }), prisma, env);
    expect(result).not.toBeNull();
    expect(result!.user.displayName).toBe('Test User');
    expect(result!.session.sessionToken).toBe(token);
  });

  it('does NOT slide expiry when the session is fresh (>1 day remaining beyond updateAge)', async () => {
    const token = 'token-fresh-no-bump';
    // Full 30 days remaining — comfortably within the "not yet due for
    // update" window. Using 30d (not 29d) gives a safety margin against
    // millisecond drift between createUserAndSession and getSession.
    const expires = new Date(Date.now() + 60 * 60 * 24 * 30 * 1000);
    await createUserAndSession({ sessionToken: token, expires });

    const before = await prisma.session.findUniqueOrThrow({ where: { sessionToken: token } });
    await getSession(fakeRequest({ [sessionCookieName(env)]: token }), prisma, env);
    const after = await prisma.session.findUniqueOrThrow({ where: { sessionToken: token } });
    expect(after.expires.getTime()).toBe(before.expires.getTime());
  });

  it('slides expiry forward when the remaining lifetime drops below maxAge - updateAge', async () => {
    const token = 'token-due-for-bump';
    // 1 hour remaining — far below the 29-day threshold; should bump.
    const expires = new Date(Date.now() + 60 * 60 * 1000);
    await createUserAndSession({ sessionToken: token, expires });

    const before = await prisma.session.findUniqueOrThrow({ where: { sessionToken: token } });
    const result = await getSession(fakeRequest({ [sessionCookieName(env)]: token }), prisma, env);
    expect(result).not.toBeNull();
    const after = await prisma.session.findUniqueOrThrow({ where: { sessionToken: token } });
    expect(after.expires.getTime()).toBeGreaterThan(before.expires.getTime());
    // New expiry is roughly now + 30 days.
    const expected = Date.now() + 60 * 60 * 24 * 30 * 1000;
    expect(Math.abs(after.expires.getTime() - expected)).toBeLessThan(5000);
  });

  it('deletes the row and returns null when the session is expired', async () => {
    const token = 'token-expired';
    const expires = new Date(Date.now() - 60 * 1000); // 1 minute ago
    await createUserAndSession({ sessionToken: token, expires });

    const result = await getSession(fakeRequest({ [sessionCookieName(env)]: token }), prisma, env);
    expect(result).toBeNull();
    const orphan = await prisma.session.findUnique({ where: { sessionToken: token } });
    expect(orphan).toBeNull();
  });

  it('uses the prod cookie name when NODE_ENV=production', () => {
    expect(sessionCookieName({ ...env, NODE_ENV: 'production' })).toBe('__Host-auth-session-token');
    expect(sessionCookieName({ ...env, NODE_ENV: 'development' })).toBe('auth-session-token');
  });
});

describe('createSessionForUser (R3.3)', () => {
  it('creates a Session row with a 30-day expiry and returns the token', async () => {
    const userId = 'user-' + crypto.randomUUID();
    await prisma.user.create({
      data: { id: userId, displayName: 'Created For', discordId: 'discord-' + userId },
    });

    const before = Date.now();
    const { sessionToken, expires } = await createSessionForUser(prisma, userId);

    // Token shape: two UUIDs joined with '-'. UUID v4 is 36 chars
    // (including hyphens); joined with a separator hyphen gives 73.
    expect(sessionToken).toHaveLength(73);
    expect(sessionToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    const row = await prisma.session.findUniqueOrThrow({ where: { sessionToken } });
    expect(row.userId).toBe(userId);
    expect(row.expires.getTime()).toBe(expires.getTime());

    // Within ~5s of (before + 30 days).
    const expected = before + 60 * 60 * 24 * 30 * 1000;
    expect(Math.abs(expires.getTime() - expected)).toBeLessThan(5000);
  });

  it('issues a unique token on every call', async () => {
    const userId = 'user-' + crypto.randomUUID();
    await prisma.user.create({
      data: { id: userId, displayName: 'Many Sessions', discordId: 'discord-' + userId },
    });

    const a = await createSessionForUser(prisma, userId);
    const b = await createSessionForUser(prisma, userId);
    expect(a.sessionToken).not.toBe(b.sessionToken);
  });
});
