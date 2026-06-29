/**
 * R3.5 — integration tests for `GET /sync/parties`.
 *
 * Same patterns as `routes.test.ts`: real Fastify via `buildServer`, real
 * Postgres via the test DB, DB-truncate in `beforeEach`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../prisma/generated/prisma/client.js';
import type { Env } from '../config/env.js';
import { sessionCookieName } from '../auth/config.js';
import { createSessionForUser } from '../auth/session.js';
import { buildServer } from '../server.js';

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
  SESSION_COOKIE_INSECURE: false,
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
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "TransactionLog", "CurrencyHolding", "ItemInstance", "Stash", "Character", "PartyMembership", "Party", "PendingDiscordLink", "EmailAuthAttempt", "VerificationToken", "Session", "Account", "User" CASCADE',
  );
  await prisma.$executeRawUnsafe('DELETE FROM "ItemDefinition" WHERE source = \'homebrew\'');
});

async function seedUser(
  opts: { needsDisplayName?: boolean; displayName?: string } = {},
): Promise<{ userId: string }> {
  const userId = `u-${Math.random().toString(36).slice(2, 10)}`;
  await prisma.user.create({
    data: {
      id: userId,
      displayName: opts.displayName ?? 'Test User',
      discordId: `discord-${userId}`,
      needsDisplayName: opts.needsDisplayName ?? false,
    },
  });
  return { userId };
}

async function seedSession(userId: string): Promise<string> {
  const { sessionToken } = await createSessionForUser(prisma, userId);
  return sessionToken;
}

function cookieHeader(env: Env, token: string): string {
  return `${sessionCookieName(env)}=${token}`;
}

/**
 * Drive a bootstrap create-character through the sync routes to give
 * the user a party + memberships + character + stashes. Lets the
 * parties-listing tests use realistic data without manually wiring 8
 * Prisma inserts.
 */
async function bootstrapParty(
  app: Awaited<ReturnType<typeof buildServer>>,
  userCookie: string,
): Promise<{ partyId: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/sync/actions',
    headers: { cookie: userCookie },
    payload: {
      partyId: 'irrelevant',
      actions: [
        {
          type: 'create-character',
          payload: {
            name: 'PartyTest',
            species: 'Human',
            size: 'medium',
            class: 'Wizard',
            level: 1,
            str: 10,
          },
        },
      ],
    },
  });
  if (res.statusCode !== 200) {
    throw new Error(`bootstrapParty failed: ${res.statusCode} ${res.body}`);
  }
  // Find the partyId by querying — bootstrap doesn't include partyId in
  // the response.
  const parties = await prisma.party.findMany();
  const newest = parties[parties.length - 1]!;
  return { partyId: newest.id };
}

describe('GET /sync/parties — auth + display-name gates (R3.5)', () => {
  it('returns 401 without a session cookie', async () => {
    const app = await buildServer({ env, prisma });
    try {
      const res = await app.inject({ method: 'GET', url: '/sync/parties' });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('returns 409 display_name_required when needsDisplayName is true', async () => {
    const { userId } = await seedUser({ needsDisplayName: true });
    const token = await seedSession(userId);
    const app = await buildServer({ env, prisma });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/sync/parties',
        headers: { cookie: cookieHeader(env, token) },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'display_name_required' });
    } finally {
      await app.close();
    }
  });
});

describe('GET /sync/parties — happy paths (R3.5)', () => {
  it('returns an empty list when the user has no parties', async () => {
    const { userId } = await seedUser();
    const token = await seedSession(userId);
    const app = await buildServer({ env, prisma });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/sync/parties',
        headers: { cookie: cookieHeader(env, token) },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ parties: [] });
    } finally {
      await app.close();
    }
  });

  it('returns a party-of-one with both dm + player roles collapsed', async () => {
    const { userId } = await seedUser();
    const token = await seedSession(userId);
    const app = await buildServer({ env, prisma });
    try {
      const { partyId } = await bootstrapParty(app, cookieHeader(env, token));
      const res = await app.inject({
        method: 'GET',
        url: '/sync/parties',
        headers: { cookie: cookieHeader(env, token) },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{
        parties: {
          id: string;
          name: string;
          roles: ('dm' | 'player')[];
          memberCount: number;
          isSoloShortcut: boolean;
          lastActivityAt: string | null;
        }[];
      }>();
      expect(body.parties).toHaveLength(1);
      expect(body.parties[0]!.id).toBe(partyId);
      expect(new Set(body.parties[0]!.roles)).toEqual(new Set(['dm', 'player']));
      expect(body.parties[0]!.memberCount).toBe(1);
      expect(body.parties[0]!.isSoloShortcut).toBe(true);
      expect(body.parties[0]!.lastActivityAt).not.toBeNull();
    } finally {
      await app.close();
    }
  });

  it('does not leak parties from other users', async () => {
    const userA = await seedUser({ displayName: 'A' });
    const userB = await seedUser({ displayName: 'B' });
    const tokenA = await seedSession(userA.userId);
    const tokenB = await seedSession(userB.userId);
    const app = await buildServer({ env, prisma });
    try {
      await bootstrapParty(app, cookieHeader(env, tokenA));
      await bootstrapParty(app, cookieHeader(env, tokenB));
      const res = await app.inject({
        method: 'GET',
        url: '/sync/parties',
        headers: { cookie: cookieHeader(env, tokenA) },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ parties: { id: string }[] }>();
      expect(body.parties).toHaveLength(1);
      // Confirm A only sees A's party.
      const aParties = await prisma.party.findMany({ where: { ownerUserId: userA.userId } });
      expect(body.parties[0]!.id).toBe(aParties[0]!.id);
    } finally {
      await app.close();
    }
  });
});
