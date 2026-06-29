/**
 * R4.1.e — integration tests for the party management routes.
 *
 * Same pattern as `sync/parties.test.ts`: real Fastify via `buildServer`,
 * real Postgres via the test DB, DB-truncate in `beforeEach`. Covers the
 * happy paths for each route; the §8.3 cascade invariants are tested
 * inside the reducer test suite (`apps/web/src/store/reducer.test.ts`).
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

async function seedUser(opts: { displayName?: string } = {}): Promise<{ userId: string }> {
  const userId = `u-${Math.random().toString(36).slice(2, 10)}`;
  await prisma.user.create({
    data: {
      id: userId,
      displayName: opts.displayName ?? 'Test User',
      discordId: `discord-${userId}`,
      needsDisplayName: false,
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
          },
        },
      ],
    },
  });
  if (res.statusCode !== 200) {
    throw new Error(`bootstrapParty failed: ${res.statusCode} ${res.body}`);
  }
  const parties = await prisma.party.findMany();
  const newest = parties[parties.length - 1]!;
  return { partyId: newest.id, inviteCode: newest.inviteCode };
}

describe('POST /parties/join (R4.1.e)', () => {
  it('redeems a valid invite code and creates a player membership', async () => {
    // User A creates a party (becomes its DM).
    const userA = await seedUser({ displayName: 'A' });
    const tokenA = await seedSession(userA.userId);
    const app = await buildServer({ env, prisma });
    try {
      const { partyId, inviteCode } = await bootstrapParty(app, cookieHeader(env, tokenA));

      // User B joins the party.
      const userB = await seedUser({ displayName: 'B' });
      const tokenB = await seedSession(userB.userId);
      const res = await app.inject({
        method: 'POST',
        url: '/parties/join',
        headers: { cookie: cookieHeader(env, tokenB), 'content-type': 'application/json' },
        payload: { inviteCode },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ partyId: string; partyName: string }>();
      expect(body.partyId).toBe(partyId);

      // User B now has an active player membership in the party.
      const newMembership = await prisma.partyMembership.findFirst({
        where: { userId: userB.userId, partyId, role: 'player' },
      });
      expect(newMembership).not.toBeNull();
      expect(newMembership!.characterId).toBeNull();
      expect(newMembership!.leftAt).toBeNull();
      // And a join-party log entry was written.
      const log = await prisma.transactionLog.findMany({
        where: { partyId, type: 'join-party' },
      });
      expect(log).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('returns 404 invalid_invite for an unknown code', async () => {
    const { userId } = await seedUser();
    const token = await seedSession(userId);
    const app = await buildServer({ env, prisma });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/parties/join',
        headers: { cookie: cookieHeader(env, token), 'content-type': 'application/json' },
        payload: { inviteCode: 'INV-DOES-NOT-EXIST' },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'invalid_invite' });
    } finally {
      await app.close();
    }
  });

  it('returns 409 already_member when the joiner is already in the party', async () => {
    const userA = await seedUser();
    const tokenA = await seedSession(userA.userId);
    const app = await buildServer({ env, prisma });
    try {
      const { inviteCode } = await bootstrapParty(app, cookieHeader(env, tokenA));
      const res = await app.inject({
        method: 'POST',
        url: '/parties/join',
        headers: { cookie: cookieHeader(env, tokenA), 'content-type': 'application/json' },
        payload: { inviteCode },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'already_member' });
    } finally {
      await app.close();
    }
  });
});

describe('POST /parties/:partyId/invite/rotate (R4.1.e)', () => {
  it('rotates the invite code (DM-only)', async () => {
    const userA = await seedUser();
    const tokenA = await seedSession(userA.userId);
    const app = await buildServer({ env, prisma });
    try {
      const { partyId, inviteCode } = await bootstrapParty(app, cookieHeader(env, tokenA));
      const res = await app.inject({
        method: 'POST',
        url: `/parties/${partyId}/invite/rotate`,
        headers: { cookie: cookieHeader(env, tokenA), 'content-type': 'application/json' },
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ inviteCode: string }>();
      expect(body.inviteCode).not.toBe(inviteCode);
      // DB has the new code; the old one no longer matches.
      const refreshed = await prisma.party.findUniqueOrThrow({ where: { id: partyId } });
      expect(refreshed.inviteCode).toBe(body.inviteCode);
    } finally {
      await app.close();
    }
  });

  it('returns 403 dm_only when a non-DM tries to rotate', async () => {
    const userA = await seedUser({ displayName: 'A' });
    const tokenA = await seedSession(userA.userId);
    const app = await buildServer({ env, prisma });
    try {
      const { partyId, inviteCode } = await bootstrapParty(app, cookieHeader(env, tokenA));
      // User B joins as a player.
      const userB = await seedUser({ displayName: 'B' });
      const tokenB = await seedSession(userB.userId);
      await app.inject({
        method: 'POST',
        url: '/parties/join',
        headers: { cookie: cookieHeader(env, tokenB), 'content-type': 'application/json' },
        payload: { inviteCode },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/parties/${partyId}/invite/rotate`,
        headers: { cookie: cookieHeader(env, tokenB), 'content-type': 'application/json' },
        payload: {},
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'dm_only' });
    } finally {
      await app.close();
    }
  });
});

describe('POST /parties/:partyId/leave (R4.1.e)', () => {
  it('archives the party when the leaver is the sole member', async () => {
    const { userId } = await seedUser();
    const token = await seedSession(userId);
    const app = await buildServer({ env, prisma });
    try {
      const { partyId } = await bootstrapParty(app, cookieHeader(env, token));
      const res = await app.inject({
        method: 'POST',
        url: `/parties/${partyId}/leave`,
        headers: { cookie: cookieHeader(env, token), 'content-type': 'application/json' },
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ archived: true });
      // Party row now has archivedAt set; membership rows soft-deleted.
      const party = await prisma.party.findUniqueOrThrow({ where: { id: partyId } });
      expect(party.archivedAt).not.toBeNull();
      const activeMembers = await prisma.partyMembership.count({
        where: { partyId, leftAt: null },
      });
      expect(activeMembers).toBe(0);
    } finally {
      await app.close();
    }
  });
});

describe('GET /parties/:partyId/members (R4.1.e)', () => {
  it('lists active members with role + character info', async () => {
    const { userId } = await seedUser({ displayName: 'Alice' });
    const token = await seedSession(userId);
    const app = await buildServer({ env, prisma });
    try {
      const { partyId, inviteCode } = await bootstrapParty(app, cookieHeader(env, token), 'A');
      const res = await app.inject({
        method: 'GET',
        url: `/parties/${partyId}/members`,
        headers: { cookie: cookieHeader(env, token) },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{
        partyId: string;
        inviteCode: string;
        members: { userId: string; role: string; characterName: string | null }[];
      }>();
      expect(body.inviteCode).toBe(inviteCode);
      // Solo creator surfaces as both dm + player rows.
      const roles = new Set(body.members.map((m) => m.role));
      expect(roles).toEqual(new Set(['dm', 'player']));
      const playerRow = body.members.find((m) => m.role === 'player');
      expect(playerRow!.characterName).toBe('A');
    } finally {
      await app.close();
    }
  });
});
