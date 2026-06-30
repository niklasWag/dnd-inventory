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

// -------------------------------------------------------------------- //
// R4.1.f — post-bootstrap create-character (joiner adds their character)
// -------------------------------------------------------------------- //

describe('POST /sync/actions — post-bootstrap create-character (R4.1.f)', () => {
  it('joiner creates their character in an existing party', async () => {
    const app = await buildServer({ env, prisma });
    try {
      // User A bootstraps the party (becomes DM + player with character 'A').
      const userA = await seedUser({ displayName: 'A' });
      const tokenA = await seedSession(userA.userId);
      const { partyId, inviteCode } = await bootstrapParty(app, cookieHeader(env, tokenA));

      // User B joins via invite code.
      const userB = await seedUser({ displayName: 'B' });
      const tokenB = await seedSession(userB.userId);
      const joinRes = await app.inject({
        method: 'POST',
        url: '/parties/join',
        headers: { cookie: cookieHeader(env, tokenB), 'content-type': 'application/json' },
        payload: { inviteCode },
      });
      expect(joinRes.statusCode).toBe(200);

      // User B's membership row currently has characterId: null.
      const preMembership = await prisma.partyMembership.findFirst({
        where: { userId: userB.userId, partyId, role: 'player' },
      });
      expect(preMembership!.characterId).toBeNull();

      // User B dispatches create-character against the existing party.
      const createRes = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieHeader(env, tokenB), 'content-type': 'application/json' },
        payload: {
          partyId,
          actions: [
            {
              type: 'create-character',
              payload: {
                name: 'B-Char',
                species: 'Elf',
                size: 'medium',
                class: 'Rogue',
                level: 2,
                str: 12,
              },
            },
          ],
        },
      });
      expect(createRes.statusCode).toBe(200);

      // The membership now points at B's new character.
      const postMembership = await prisma.partyMembership.findFirst({
        where: { userId: userB.userId, partyId, role: 'player' },
      });
      expect(postMembership!.characterId).not.toBeNull();

      // The character row exists and is owned by B.
      const bChar = await prisma.character.findUnique({
        where: { id: postMembership!.characterId! },
      });
      expect(bChar).not.toBeNull();
      expect(bChar!.ownerUserId).toBe(userB.userId);
      expect(bChar!.partyId).toBe(partyId);
      expect(bChar!.name).toBe('B-Char');

      // B got their own Inventory stash + CurrencyHolding.
      const bInv = await prisma.stash.findUnique({
        where: { id: bChar!.inventoryStashId },
      });
      expect(bInv).not.toBeNull();
      expect(bInv!.scope).toBe('character');
      expect(bInv!.isCarried).toBe(true);
      expect(bInv!.ownerCharacterId).toBe(bChar!.id);
      const bHolding = await prisma.currencyHolding.findUnique({
        where: { stashId: bInv!.id },
      });
      expect(bHolding).not.toBeNull();
      expect(bHolding!.cp).toBe(0);

      // A still has THEIR own character + inventory; not mutated.
      const aCharacters = await prisma.character.findMany({
        where: { partyId, ownerUserId: userA.userId },
      });
      expect(aCharacters).toHaveLength(1);
      expect(aCharacters[0]!.name).toBe('PartyTest');

      // The TransactionLog has one create-character entry per character.
      const createLog = await prisma.transactionLog.findMany({
        where: { partyId, type: 'create-character' },
      });
      expect(createLog).toHaveLength(2);
      // B's entry was authored by B.
      const bLog = createLog.find((e) => e.actorUserId === userB.userId);
      expect(bLog).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it('DM-only DM adds their character later', async () => {
    const app = await buildServer({ env, prisma });
    try {
      // DM bootstraps a DM-only party.
      const userDm = await seedUser({ displayName: 'DM' });
      const tokenDm = await seedSession(userDm.userId);
      const bootstrapRes = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieHeader(env, tokenDm), 'content-type': 'application/json' },
        payload: {
          partyId: 'irrelevant',
          actions: [
            {
              type: 'create-character',
              payload: { dmOnly: true, partyName: 'DM Sandbox' },
            },
          ],
        },
      });
      expect(bootstrapRes.statusCode).toBe(200);
      const parties = await prisma.party.findMany();
      const partyId = parties[parties.length - 1]!.id;

      // Initially there's no player row.
      const preMembership = await prisma.partyMembership.findFirst({
        where: { userId: userDm.userId, partyId, role: 'player' },
      });
      expect(preMembership).toBeNull();

      // DM dispatches create-character to add their character.
      const createRes = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieHeader(env, tokenDm), 'content-type': 'application/json' },
        payload: {
          partyId,
          actions: [
            {
              type: 'create-character',
              payload: {
                name: 'DM Char',
                species: 'Human',
                size: 'medium',
                class: 'Bard',
                level: 1,
                str: 10,
              },
            },
          ],
        },
      });
      expect(createRes.statusCode).toBe(200);

      // A fresh player row was created pointing at the new character.
      const postMembership = await prisma.partyMembership.findFirst({
        where: { userId: userDm.userId, partyId, role: 'player' },
      });
      expect(postMembership).not.toBeNull();
      expect(postMembership!.characterId).not.toBeNull();

      const dmChar = await prisma.character.findUnique({
        where: { id: postMembership!.characterId! },
      });
      expect(dmChar!.ownerUserId).toBe(userDm.userId);
      expect(dmChar!.name).toBe('DM Char');
    } finally {
      await app.close();
    }
  });
});

// -------------------------------------------------------------------- //
// BUG-001 regression — kick + leave with a character must succeed
// -------------------------------------------------------------------- //

describe('BUG-001 — character cascade on departure (kick + leave)', () => {
  /**
   * Both `POST /parties/:partyId/kick` and `POST /parties/:partyId/leave`
   * funnel into `cascadeCharacterToRecoveredLootDb` when the departing
   * user has a character. Pre-fix, the cascade deleted the owned-stash
   * rows before deleting the Character row, triggering the
   * `Character_inventoryStashId_fkey` ON DELETE RESTRICT constraint.
   *
   * These two tests reproduce the failure for both surface paths and
   * lock the fix in.
   */

  it('DM can kick a player whose character has an Inventory stash', async () => {
    const app = await buildServer({ env, prisma });
    try {
      // User A bootstraps the party as DM + player.
      const userA = await seedUser({ displayName: 'A' });
      const tokenA = await seedSession(userA.userId);
      const { partyId, inviteCode } = await bootstrapParty(app, cookieHeader(env, tokenA));

      // User B joins + creates their character (so B has an Inventory stash).
      const userB = await seedUser({ displayName: 'B' });
      const tokenB = await seedSession(userB.userId);
      const joinRes = await app.inject({
        method: 'POST',
        url: '/parties/join',
        headers: { cookie: cookieHeader(env, tokenB), 'content-type': 'application/json' },
        payload: { inviteCode },
      });
      expect(joinRes.statusCode).toBe(200);
      const createRes = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieHeader(env, tokenB), 'content-type': 'application/json' },
        payload: {
          partyId,
          actions: [
            {
              type: 'create-character',
              payload: {
                name: 'B-Char',
                species: 'Elf',
                size: 'medium',
                class: 'Rogue',
                level: 1,
                str: 10,
              },
            },
          ],
        },
      });
      expect(createRes.statusCode).toBe(200);

      // DM kicks user B. Pre-fix this returns 500 with the
      // `Character_inventoryStashId_fkey` RESTRICT violation.
      const kickRes = await app.inject({
        method: 'POST',
        url: `/parties/${partyId}/kick`,
        headers: { cookie: cookieHeader(env, tokenA), 'content-type': 'application/json' },
        payload: { kickedUserId: userB.userId },
      });
      expect(kickRes.statusCode).toBe(200);

      // Side effects: B's character + stashes are gone; B's membership rows soft-deleted.
      const bChars = await prisma.character.findMany({ where: { ownerUserId: userB.userId } });
      expect(bChars).toHaveLength(0);
      const bStashes = await prisma.stash.findMany({
        where: { ownerCharacterId: { in: [] }, partyId },
      });
      expect(bStashes).toHaveLength(0);
      const activeBMemberships = await prisma.partyMembership.count({
        where: { userId: userB.userId, partyId, leftAt: null },
      });
      expect(activeBMemberships).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('player can leave a party when their character has an Inventory stash', async () => {
    const app = await buildServer({ env, prisma });
    try {
      // User A bootstraps the party as DM + player.
      const userA = await seedUser({ displayName: 'A' });
      const tokenA = await seedSession(userA.userId);
      const { partyId, inviteCode } = await bootstrapParty(app, cookieHeader(env, tokenA));

      // User B joins + creates their character.
      const userB = await seedUser({ displayName: 'B' });
      const tokenB = await seedSession(userB.userId);
      const joinRes = await app.inject({
        method: 'POST',
        url: '/parties/join',
        headers: { cookie: cookieHeader(env, tokenB), 'content-type': 'application/json' },
        payload: { inviteCode },
      });
      expect(joinRes.statusCode).toBe(200);
      const createRes = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieHeader(env, tokenB), 'content-type': 'application/json' },
        payload: {
          partyId,
          actions: [
            {
              type: 'create-character',
              payload: {
                name: 'B-Char',
                species: 'Elf',
                size: 'medium',
                class: 'Rogue',
                level: 1,
                str: 10,
              },
            },
          ],
        },
      });
      expect(createRes.statusCode).toBe(200);

      // User B leaves. Pre-fix this returns 500 with the same FK violation.
      const leaveRes = await app.inject({
        method: 'POST',
        url: `/parties/${partyId}/leave`,
        headers: { cookie: cookieHeader(env, tokenB), 'content-type': 'application/json' },
        payload: {},
      });
      expect(leaveRes.statusCode).toBe(200);

      // Side effects: B's character is gone; B's membership rows soft-deleted;
      // party is NOT archived (A is still an active member).
      const bChars = await prisma.character.findMany({ where: { ownerUserId: userB.userId } });
      expect(bChars).toHaveLength(0);
      const activeBMemberships = await prisma.partyMembership.count({
        where: { userId: userB.userId, partyId, leftAt: null },
      });
      expect(activeBMemberships).toBe(0);
      const party = await prisma.party.findUniqueOrThrow({ where: { id: partyId } });
      expect(party.archivedAt).toBeNull();
    } finally {
      await app.close();
    }
  });
});
