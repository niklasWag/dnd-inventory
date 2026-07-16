/**
 * R10.4 — integration tests for the self-service account routes
 * (`/users/me/*`). Same harness as `sync/parties.test.ts` /
 * `parties/routes.test.ts`: real Fastify via `buildServer`, real Postgres
 * via the test DB, DB-truncate in `beforeEach`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../prisma/generated/prisma/client.js';
import type { Env } from '../config/env.js';
import { sessionCookieName } from '../auth/config.js';
import { createSessionForUser } from '../auth/session.js';
import { buildServer } from '../server.js';
import { newUuidV7 } from '@app/shared';

function createCharacterIds() {
  return {
    newCharacterId: newUuidV7(),
    newInventoryStashId: newUuidV7(),
    newCurrencyHoldingId: newUuidV7(),
    newUserId: newUuidV7(),
    newPartyId: newUuidV7(),
    newPartyStashId: newUuidV7(),
    newRecoveredLootStashId: newUuidV7(),
    newPartyStashCurrencyId: newUuidV7(),
    newRecoveredLootCurrencyId: newUuidV7(),
  };
}

const TEST_DB_URL =
  process.env['DATABASE_URL_TEST'] ?? 'postgresql://dnd:dnd@localhost:5434/dnd_inv_test';

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
  EMAIL_ATTEMPT_SWEEP_ENABLED: false,
  EMAIL_ATTEMPT_SWEEP_RETENTION_HOURS: 24,
  PENDING_LINK_SWEEP_ENABLED: false,
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
    'TRUNCATE TABLE "TransactionLog", "CurrencyHolding", "ItemInstance", "Stash", "Character", "PartyMembership", "Party", "PendingEmailChange", "PendingDiscordLink", "EmailAuthAttempt", "VerificationToken", "Session", "Account", "User" CASCADE',
  );
  await prisma.$executeRawUnsafe('DELETE FROM "ItemDefinition" WHERE source = \'homebrew\'');
});

async function seedUser(
  opts: { needsDisplayName?: boolean; displayName?: string; email?: string } = {},
): Promise<{ userId: string }> {
  const userId = `u-${Math.random().toString(36).slice(2, 10)}`;
  await prisma.user.create({
    data: {
      id: userId,
      displayName: opts.displayName ?? 'Test User',
      ...(opts.email !== undefined
        ? { email: opts.email, emailVerified: new Date() }
        : { discordId: `discord-${userId}` }),
      needsDisplayName: opts.needsDisplayName ?? false,
    },
  });
  return { userId };
}

async function seedSession(userId: string): Promise<string> {
  const { sessionToken } = await createSessionForUser(prisma, userId);
  return sessionToken;
}

function cookieHeader(token: string): string {
  return `${sessionCookieName(env)}=${token}`;
}

async function bootstrapParty(
  app: Awaited<ReturnType<typeof buildServer>>,
  cookie: string,
  name = 'PartyTest',
): Promise<{ partyId: string; inviteCode: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/sync/actions',
    headers: { cookie },
    payload: {
      partyId: 'irrelevant',
      actions: [
        {
          type: 'create-character',
          payload: {
            name,
            species: 'Human',
            size: 'medium',
            class: 'Wizard',
            level: 1,
            str: 10,
            ...createCharacterIds(),
          },
        },
      ],
    },
  });
  if (res.statusCode !== 200) {
    throw new Error(`bootstrapParty failed: ${res.statusCode} ${res.body}`);
  }
  const parties = await prisma.party.findMany({ orderBy: { createdAt: 'asc' } });
  const newest = parties[parties.length - 1]!;
  return { partyId: newest.id, inviteCode: newest.inviteCode };
}

// ===================== display-name =====================

describe('POST /users/me/display-name (R10.4)', () => {
  it('renames an onboarded user and returns the patched session user', async () => {
    const { userId } = await seedUser({ displayName: 'Old' });
    const token = await seedSession(userId);
    const app = await buildServer({ env, prisma });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/users/me/display-name',
        headers: { cookie: cookieHeader(token), 'content-type': 'application/json' },
        payload: { displayName: 'New Name' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ user: { displayName: string } }>().user.displayName).toBe('New Name');
      const row = await prisma.user.findUnique({ where: { id: userId } });
      expect(row!.displayName).toBe('New Name');
    } finally {
      await app.close();
    }
  });

  it('401 without a session', async () => {
    const app = await buildServer({ env, prisma });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/users/me/display-name',
        headers: { 'content-type': 'application/json' },
        payload: { displayName: 'X' },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('400 on empty or too-long name', async () => {
    const { userId } = await seedUser();
    const token = await seedSession(userId);
    const app = await buildServer({ env, prisma });
    try {
      for (const displayName of ['', 'x'.repeat(81)]) {
        const res = await app.inject({
          method: 'POST',
          url: '/users/me/display-name',
          headers: { cookie: cookieHeader(token), 'content-type': 'application/json' },
          payload: { displayName },
        });
        expect(res.statusCode).toBe(400);
      }
    } finally {
      await app.close();
    }
  });

  it('409 when needsDisplayName is true', async () => {
    const { userId } = await seedUser({ needsDisplayName: true });
    const token = await seedSession(userId);
    const app = await buildServer({ env, prisma });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/users/me/display-name',
        headers: { cookie: cookieHeader(token), 'content-type': 'application/json' },
        payload: { displayName: 'X' },
      });
      expect(res.statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });
});

// ===================== device sessions =====================

describe('GET /users/me/sessions + revoke (R10.4)', () => {
  it('lists sessions and flags the current one', async () => {
    const { userId } = await seedUser();
    const current = await seedSession(userId);
    await seedSession(userId); // a second device
    const app = await buildServer({ env, prisma });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/users/me/sessions',
        headers: { cookie: cookieHeader(current) },
      });
      expect(res.statusCode).toBe(200);
      const { sessions } = res.json<{
        sessions: { id: string; current: boolean }[];
      }>();
      expect(sessions).toHaveLength(2);
      expect(sessions.filter((s) => s.current)).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('revokes a single non-current session', async () => {
    const { userId } = await seedUser();
    const current = await seedSession(userId);
    const other = await seedSession(userId);
    const otherRow = await prisma.session.findUniqueOrThrow({ where: { sessionToken: other } });
    const app = await buildServer({ env, prisma });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/users/me/sessions/revoke',
        headers: { cookie: cookieHeader(current), 'content-type': 'application/json' },
        payload: { sessionId: otherRow.id },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ revoked: number }>().revoked).toBe(1);
      expect(await prisma.session.findUnique({ where: { id: otherRow.id } })).toBeNull();
      // Current still alive.
      expect(await prisma.session.findUnique({ where: { sessionToken: current } })).not.toBeNull();
    } finally {
      await app.close();
    }
  });

  it('cannot revoke the current session via this route', async () => {
    const { userId } = await seedUser();
    const current = await seedSession(userId);
    const currentRow = await prisma.session.findUniqueOrThrow({
      where: { sessionToken: current },
    });
    const app = await buildServer({ env, prisma });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/users/me/sessions/revoke',
        headers: { cookie: cookieHeader(current), 'content-type': 'application/json' },
        payload: { sessionId: currentRow.id },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: string }>().error).toBe('cannot_revoke_current');
    } finally {
      await app.close();
    }
  });

  it('cannot revoke another user session (404)', async () => {
    const a = await seedUser({ displayName: 'A' });
    const tokenA = await seedSession(a.userId);
    const b = await seedUser({ displayName: 'B' });
    const tokenB = await seedSession(b.userId);
    const bRow = await prisma.session.findUniqueOrThrow({ where: { sessionToken: tokenB } });
    const app = await buildServer({ env, prisma });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/users/me/sessions/revoke',
        headers: { cookie: cookieHeader(tokenA), 'content-type': 'application/json' },
        payload: { sessionId: bRow.id },
      });
      expect(res.statusCode).toBe(404);
      // B's session untouched.
      expect(await prisma.session.findUnique({ where: { id: bRow.id } })).not.toBeNull();
    } finally {
      await app.close();
    }
  });

  it('allOthers revokes every session except the current', async () => {
    const { userId } = await seedUser();
    const current = await seedSession(userId);
    await seedSession(userId);
    await seedSession(userId);
    const app = await buildServer({ env, prisma });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/users/me/sessions/revoke',
        headers: { cookie: cookieHeader(current), 'content-type': 'application/json' },
        payload: { allOthers: true },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ revoked: number }>().revoked).toBe(2);
      const remaining = await prisma.session.findMany({ where: { userId } });
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.sessionToken).toBe(current);
    } finally {
      await app.close();
    }
  });
});

// ===================== account export =====================

describe('GET /users/me/export (R10.4)', () => {
  it('bundles one envelope per active party', async () => {
    const { userId } = await seedUser();
    const token = await seedSession(userId);
    const app = await buildServer({ env, prisma });
    try {
      await bootstrapParty(app, cookieHeader(token), 'Alpha');
      const res = await app.inject({
        method: 'GET',
        url: '/users/me/export',
        headers: { cookie: cookieHeader(token) },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ schemaVersion: number; parties: unknown[] }>();
      expect(body.schemaVersion).toBe(1);
      expect(body.parties).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('401 without a session', async () => {
    const app = await buildServer({ env, prisma });
    try {
      const res = await app.inject({ method: 'GET', url: '/users/me/export' });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});

// ===================== soft-delete account =====================

describe('POST /users/me/delete — soft-delete (R10.4)', () => {
  it('solo user: party archived, User soft-deleted, sessions + accounts gone, cookie cleared', async () => {
    const { userId } = await seedUser({ displayName: 'Solo', email: 'solo@example.com' });
    const token = await seedSession(userId);
    const app = await buildServer({ env, prisma });
    try {
      const { partyId } = await bootstrapParty(app, cookieHeader(token));

      const res = await app.inject({
        method: 'POST',
        url: '/users/me/delete',
        headers: { cookie: cookieHeader(token), 'content-type': 'application/json' },
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<{ deleted: boolean }>().deleted).toBe(true);
      // Cookie cleared on the reply.
      expect(res.headers['set-cookie']).toBeDefined();

      // Party archived (sole-member).
      const party = await prisma.party.findUniqueOrThrow({ where: { id: partyId } });
      expect(party.archivedAt).not.toBeNull();

      // User row preserved but anonymized + credentials released + stamped.
      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(user.displayName).toBe('[deleted user]');
      expect(user.email).toBeNull();
      expect(user.emailVerified).toBeNull();
      expect(user.discordId).toBeNull();
      expect(user.deactivatedAt).not.toBeNull();

      // Login state gone.
      expect(await prisma.session.findMany({ where: { userId } })).toHaveLength(0);
      expect(await prisma.account.findMany({ where: { userId } })).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('multi-member player: leaves, User soft-deleted, and their TransactionLog actor still resolves', async () => {
    // A is DM/owner; B joins as player, acts (bootstrap wrote A's log; we
    // need a B-authored entry). B leaving then deleting must NOT break the
    // FK from B's log entries → B's (preserved) User row.
    const a = await seedUser({ displayName: 'A' });
    const tokenA = await seedSession(a.userId);
    const b = await seedUser({ displayName: 'B', email: 'b@example.com' });
    const tokenB = await seedSession(b.userId);
    const app = await buildServer({ env, prisma });
    try {
      const { partyId, inviteCode } = await bootstrapParty(app, cookieHeader(tokenA));
      // B joins → writes a join-party log entry with actorUserId = B.
      const joinRes = await app.inject({
        method: 'POST',
        url: '/parties/join',
        headers: { cookie: cookieHeader(tokenB), 'content-type': 'application/json' },
        payload: { inviteCode },
      });
      expect(joinRes.statusCode).toBe(200);
      const bLogBefore = await prisma.transactionLog.count({
        where: { partyId, actorUserId: b.userId },
      });
      expect(bLogBefore).toBeGreaterThan(0);

      // B deletes their account.
      const res = await app.inject({
        method: 'POST',
        url: '/users/me/delete',
        headers: { cookie: cookieHeader(tokenB), 'content-type': 'application/json' },
        payload: {},
      });
      expect(res.statusCode).toBe(200);

      // Party still live (A remains).
      const party = await prisma.party.findUniqueOrThrow({ where: { id: partyId } });
      expect(party.archivedAt).toBeNull();

      // B soft-deleted.
      const bUser = await prisma.user.findUniqueOrThrow({ where: { id: b.userId } });
      expect(bUser.displayName).toBe('[deleted user]');
      expect(bUser.deactivatedAt).not.toBeNull();

      // B's membership soft-deleted.
      const bMembership = await prisma.partyMembership.findFirst({
        where: { userId: b.userId, partyId, role: 'player' },
      });
      expect(bMembership!.leftAt).not.toBeNull();

      // THE KEY INVARIANT: B's log entries survive and their actor FK still
      // resolves (join with actor include succeeds, User row present). The
      // leave-party cascade adds a further B-authored entry, so the count
      // grows rather than shrinks — the point is that NONE are orphaned.
      const bLogAfter = await prisma.transactionLog.findMany({
        where: { partyId, actorUserId: b.userId },
        include: { actor: true },
      });
      expect(bLogAfter.length).toBeGreaterThanOrEqual(bLogBefore);
      expect(bLogAfter.every((e) => e.actor.id === b.userId)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('sole DM of a multi-member party: 422 sole_dm_must_transfer_first, no mutation', async () => {
    const a = await seedUser({ displayName: 'A' });
    const tokenA = await seedSession(a.userId);
    const b = await seedUser({ displayName: 'B' });
    const tokenB = await seedSession(b.userId);
    const app = await buildServer({ env, prisma });
    try {
      const { partyId, inviteCode } = await bootstrapParty(app, cookieHeader(tokenA));
      await app.inject({
        method: 'POST',
        url: '/parties/join',
        headers: { cookie: cookieHeader(tokenB), 'content-type': 'application/json' },
        payload: { inviteCode },
      });

      // A (sole DM) tries to delete → blocked.
      const res = await app.inject({
        method: 'POST',
        url: '/users/me/delete',
        headers: { cookie: cookieHeader(tokenA), 'content-type': 'application/json' },
        payload: {},
      });
      expect(res.statusCode).toBe(422);
      const body = res.json<{ error: string; partyId: string }>();
      expect(body.error).toBe('sole_dm_must_transfer_first');
      expect(body.partyId).toBe(partyId);

      // No mutation — A intact, session alive.
      const aUser = await prisma.user.findUniqueOrThrow({ where: { id: a.userId } });
      expect(aUser.displayName).toBe('A');
      expect(aUser.deactivatedAt).toBeNull();
      expect(await prisma.session.findMany({ where: { userId: a.userId } })).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('releases the email so a fresh signup gets a NEW user id (not resurrected)', async () => {
    const { userId } = await seedUser({ displayName: 'Solo', email: 'reuse@example.com' });
    const token = await seedSession(userId);
    const app = await buildServer({ env, prisma });
    try {
      await bootstrapParty(app, cookieHeader(token));
      await app.inject({
        method: 'POST',
        url: '/users/me/delete',
        headers: { cookie: cookieHeader(token), 'content-type': 'application/json' },
        payload: {},
      });

      // The released email is now free — a new User can claim it (the UNIQUE
      // index released it on the swap-to-null). Simulate the signup upsert.
      const fresh = await prisma.user.create({
        data: {
          id: 'u-fresh',
          displayName: '',
          email: 'reuse@example.com',
          emailVerified: new Date(),
          needsDisplayName: true,
        },
      });
      expect(fresh.id).not.toBe(userId);
      // Old row still exists, just without the email.
      const old = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(old.email).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('401 without a session', async () => {
    const app = await buildServer({ env, prisma });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/users/me/delete',
        headers: { 'content-type': 'application/json' },
        payload: {},
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
