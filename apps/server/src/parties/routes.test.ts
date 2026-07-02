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

// -------------------------------------------------------------------- //
// R4.2.a — appoint-banker / revoke-banker + kick/leave cascade
// -------------------------------------------------------------------- //

describe('R4.2.a — Banker lifecycle (appoint / revoke + kick/leave cascade)', () => {
  /**
   * Helper: bootstrap a party as user A, have user B join it, then
   * return their cookies and ids. Both helpers below need this shape.
   */
  async function setupTwoMemberParty(app: Awaited<ReturnType<typeof buildServer>>): Promise<{
    partyId: string;
    inviteCode: string;
    userA: { userId: string; cookie: string };
    userB: { userId: string; cookie: string };
  }> {
    const userA = await seedUser({ displayName: 'A' });
    const tokenA = await seedSession(userA.userId);
    const cookieA = cookieHeader(env, tokenA);
    const { partyId, inviteCode } = await bootstrapParty(app, cookieA);

    const userB = await seedUser({ displayName: 'B' });
    const tokenB = await seedSession(userB.userId);
    const cookieB = cookieHeader(env, tokenB);
    const joinRes = await app.inject({
      method: 'POST',
      url: '/parties/join',
      headers: { cookie: cookieB, 'content-type': 'application/json' },
      payload: { inviteCode },
    });
    expect(joinRes.statusCode).toBe(200);

    return {
      partyId,
      inviteCode,
      userA: { userId: userA.userId, cookie: cookieA },
      userB: { userId: userB.userId, cookie: cookieB },
    };
  }

  it('DM can appoint and revoke a Banker (Party.bankerUserId round-trip)', async () => {
    const app = await buildServer({ env, prisma });
    try {
      const { partyId, userA, userB } = await setupTwoMemberParty(app);

      // Appoint user B.
      const appointRes = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: userA.cookie, 'content-type': 'application/json' },
        payload: {
          partyId,
          actions: [{ type: 'appoint-banker', payload: { bankerUserId: userB.userId } }],
        },
      });
      expect(appointRes.statusCode).toBe(200);
      const afterAppoint = await prisma.party.findUniqueOrThrow({ where: { id: partyId } });
      expect(afterAppoint.bankerUserId).toBe(userB.userId);

      // Revoke.
      const revokeRes = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: userA.cookie, 'content-type': 'application/json' },
        payload: {
          partyId,
          actions: [{ type: 'revoke-banker', payload: { reason: 'manual' } }],
        },
      });
      expect(revokeRes.statusCode).toBe(200);
      const afterRevoke = await prisma.party.findUniqueOrThrow({ where: { id: partyId } });
      expect(afterRevoke.bankerUserId).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('rejects appoint-banker when DM tries to self-appoint', async () => {
    const app = await buildServer({ env, prisma });
    try {
      const { partyId, userA } = await setupTwoMemberParty(app);

      const res = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: userA.cookie, 'content-type': 'application/json' },
        payload: {
          partyId,
          actions: [{ type: 'appoint-banker', payload: { bankerUserId: userA.userId } }],
        },
      });
      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.body) as { rejected?: { code?: string } };
      expect(body.rejected?.code).toBe('banker_membership_forbidden');
      const party = await prisma.party.findUniqueOrThrow({ where: { id: partyId } });
      expect(party.bankerUserId).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('rejects appoint-banker from a non-DM actor', async () => {
    const app = await buildServer({ env, prisma });
    try {
      const { partyId, userB } = await setupTwoMemberParty(app);

      const res = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: userB.cookie, 'content-type': 'application/json' },
        payload: {
          partyId,
          actions: [{ type: 'appoint-banker', payload: { bankerUserId: userB.userId } }],
        },
      });
      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.body) as { rejected?: { code?: string } };
      expect(body.rejected?.code).toBe('dm_only');
    } finally {
      await app.close();
    }
  });

  it('kick-player auto-clears Party.bankerUserId when the kicked user is the Banker', async () => {
    const app = await buildServer({ env, prisma });
    try {
      const { partyId, userA, userB } = await setupTwoMemberParty(app);

      const appoint = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: userA.cookie, 'content-type': 'application/json' },
        payload: {
          partyId,
          actions: [{ type: 'appoint-banker', payload: { bankerUserId: userB.userId } }],
        },
      });
      expect(appoint.statusCode).toBe(200);

      const kickRes = await app.inject({
        method: 'POST',
        url: `/parties/${partyId}/kick`,
        headers: { cookie: userA.cookie, 'content-type': 'application/json' },
        payload: { kickedUserId: userB.userId },
      });
      expect(kickRes.statusCode).toBe(200);

      const after = await prisma.party.findUniqueOrThrow({ where: { id: partyId } });
      expect(after.bankerUserId).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('leave-party auto-clears Party.bankerUserId when the leaver is the Banker', async () => {
    const app = await buildServer({ env, prisma });
    try {
      const { partyId, userA, userB } = await setupTwoMemberParty(app);

      const appoint = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: userA.cookie, 'content-type': 'application/json' },
        payload: {
          partyId,
          actions: [{ type: 'appoint-banker', payload: { bankerUserId: userB.userId } }],
        },
      });
      expect(appoint.statusCode).toBe(200);

      const leaveRes = await app.inject({
        method: 'POST',
        url: `/parties/${partyId}/leave`,
        headers: { cookie: userB.cookie, 'content-type': 'application/json' },
        payload: {},
      });
      expect(leaveRes.statusCode).toBe(200);

      const after = await prisma.party.findUniqueOrThrow({ where: { id: partyId } });
      expect(after.bankerUserId).toBeNull();
    } finally {
      await app.close();
    }
  });
});

// -------------------------------------------------------------------- //
// BUG-002 regression — POST /parties/join reactivates a soft-deleted row
// -------------------------------------------------------------------- //
//
// PartyMembership PK is composite (userId, partyId, role) + R4.1.c/d use
// soft delete (leftAt: <timestamp>, row preserved). Pre-fix,
// `persistJoinParty` called `partyMembership.create()` against the same
// tuple, raising P2002 unique-constraint violation.

describe('BUG-002 — POST /parties/join reactivates a soft-deleted membership', () => {
  it('a user who left a party can rejoin via the same invite code', async () => {
    const app = await buildServer({ env, prisma });
    try {
      // Bootstrap a 2-member party (user A is DM+player, user B is player).
      const userA = await seedUser({ displayName: 'A' });
      const tokenA = await seedSession(userA.userId);
      const cookieA = cookieHeader(env, tokenA);
      const { partyId, inviteCode } = await bootstrapParty(app, cookieA);

      const userB = await seedUser({ displayName: 'B' });
      const tokenB = await seedSession(userB.userId);
      const cookieB = cookieHeader(env, tokenB);
      const join1 = await app.inject({
        method: 'POST',
        url: '/parties/join',
        headers: { cookie: cookieB, 'content-type': 'application/json' },
        payload: { inviteCode },
      });
      expect(join1.statusCode).toBe(200);

      // User B leaves. Row is soft-deleted (leftAt non-null).
      const leaveRes = await app.inject({
        method: 'POST',
        url: `/parties/${partyId}/leave`,
        headers: { cookie: cookieB, 'content-type': 'application/json' },
        payload: {},
      });
      expect(leaveRes.statusCode).toBe(200);
      const softDeletedRows = await prisma.partyMembership.findMany({
        where: { userId: userB.userId, partyId, role: 'player' },
      });
      expect(softDeletedRows).toHaveLength(1);
      expect(softDeletedRows[0]!.leftAt).not.toBeNull();

      // User B rejoins via the same invite code. Pre-fix returns 500 P2002.
      const join2 = await app.inject({
        method: 'POST',
        url: '/parties/join',
        headers: { cookie: cookieB, 'content-type': 'application/json' },
        payload: { inviteCode },
      });
      expect(join2.statusCode).toBe(200);

      // DB invariant: exactly one player membership row, leftAt null,
      // joinedAt advanced past the soft-delete window, characterId null.
      const afterRows = await prisma.partyMembership.findMany({
        where: { userId: userB.userId, partyId, role: 'player' },
      });
      expect(afterRows).toHaveLength(1);
      const row = afterRows[0]!;
      expect(row.leftAt).toBeNull();
      expect(row.characterId).toBeNull();
      expect(row.joinedAt.getTime()).toBeGreaterThan(softDeletedRows[0]!.joinedAt.getTime());
    } finally {
      await app.close();
    }
  });

  it('still rejects rejoin when the user has an ACTIVE membership (409 already_member)', async () => {
    const app = await buildServer({ env, prisma });
    try {
      const userA = await seedUser({ displayName: 'A' });
      const tokenA = await seedSession(userA.userId);
      const cookieA = cookieHeader(env, tokenA);
      const { inviteCode } = await bootstrapParty(app, cookieA);

      const userB = await seedUser({ displayName: 'B' });
      const tokenB = await seedSession(userB.userId);
      const cookieB = cookieHeader(env, tokenB);
      const join1 = await app.inject({
        method: 'POST',
        url: '/parties/join',
        headers: { cookie: cookieB, 'content-type': 'application/json' },
        payload: { inviteCode },
      });
      expect(join1.statusCode).toBe(200);

      // Second join while still active: 409 already_member.
      const join2 = await app.inject({
        method: 'POST',
        url: '/parties/join',
        headers: { cookie: cookieB, 'content-type': 'application/json' },
        payload: { inviteCode },
      });
      expect(join2.statusCode).toBe(409);
      const body = JSON.parse(join2.body) as { error?: string };
      expect(body.error).toBe('already_member');
    } finally {
      await app.close();
    }
  });
});

// -------------------------------------------------------------------- //
// R4.2.c — Banker-mediated shared-pool gate
// -------------------------------------------------------------------- //

describe('R4.2.c — Banker-mediated shared-pool gate on /sync/actions', () => {
  /**
   * Two-member party where user A is the DM+player who bootstrapped, user
   * B is a joined player. Optionally appoint user B as Banker so tests
   * can compare Banker-active vs Banker-inactive rejection.
   */
  async function setupTwoMemberPartyWithBanker(
    app: Awaited<ReturnType<typeof buildServer>>,
    { appointBanker }: { appointBanker: boolean },
  ): Promise<{
    partyId: string;
    partyStashId: string;
    recoveredLootStashId: string;
    userA: { userId: string; cookie: string };
    userB: { userId: string; cookie: string };
  }> {
    const userA = await seedUser({ displayName: 'A' });
    const tokenA = await seedSession(userA.userId);
    const cookieA = cookieHeader(env, tokenA);
    const { partyId, inviteCode } = await bootstrapParty(app, cookieA);

    const userB = await seedUser({ displayName: 'B' });
    const tokenB = await seedSession(userB.userId);
    const cookieB = cookieHeader(env, tokenB);
    const joinRes = await app.inject({
      method: 'POST',
      url: '/parties/join',
      headers: { cookie: cookieB, 'content-type': 'application/json' },
      payload: { inviteCode },
    });
    expect(joinRes.statusCode).toBe(200);

    // B needs a character (and therefore an Inventory stash) so
    // ownsOrShares passes when B is the actor of the gated action.
    const createBChar = await app.inject({
      method: 'POST',
      url: '/sync/actions',
      headers: { cookie: cookieB, 'content-type': 'application/json' },
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
    expect(createBChar.statusCode).toBe(200);

    if (appointBanker) {
      const appointRes = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieA, 'content-type': 'application/json' },
        payload: {
          partyId,
          actions: [{ type: 'appoint-banker', payload: { bankerUserId: userB.userId } }],
        },
      });
      expect(appointRes.statusCode).toBe(200);
    }

    const partyStash = await prisma.stash.findFirstOrThrow({
      where: { partyId, scope: 'party' },
    });
    const party = await prisma.party.findUniqueOrThrow({ where: { id: partyId } });

    return {
      partyId,
      partyStashId: partyStash.id,
      recoveredLootStashId: party.recoveredLootStashId,
      userA: { userId: userA.userId, cookie: cookieA },
      userB: { userId: userB.userId, cookie: cookieB },
    };
  }

  it('rejects a non-Banker player withdrawing currency from Party Stash when Banker is active', async () => {
    const app = await buildServer({ env, prisma });
    try {
      const { partyId, partyStashId, userA } = await setupTwoMemberPartyWithBanker(app, {
        appointBanker: true,
      });

      // Seed the Party Stash with some currency so withdraw could apply
      // (the guard runs BEFORE the reducer's invariant check, but seeding
      // avoids a false negative if guard order ever changes).
      await prisma.currencyHolding.update({
        where: { stashId: partyStashId },
        data: { gp: 10 },
      });

      // User A (DM+player, NOT the Banker) tries to withdraw.
      const res = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: userA.cookie, 'content-type': 'application/json' },
        payload: {
          partyId,
          actions: [
            {
              type: 'currency-change',
              payload: { stashId: partyStashId, delta: { cp: 0, sp: 0, ep: 0, gp: -1, pp: 0 }, reason: 'withdraw' },
            },
          ],
        },
      });
      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.body) as { rejected?: { code?: string } };
      expect(body.rejected?.code).toBe('banker_required_for_claim');

      // Balance unchanged (whole batch rolled back).
      const cur = await prisma.currencyHolding.findUniqueOrThrow({
        where: { stashId: partyStashId },
      });
      expect(cur.gp).toBe(10);
    } finally {
      await app.close();
    }
  });

  it('accepts the Banker withdrawing currency from Party Stash', async () => {
    const app = await buildServer({ env, prisma });
    try {
      const { partyId, partyStashId, userB } = await setupTwoMemberPartyWithBanker(app, {
        appointBanker: true,
      });
      await prisma.currencyHolding.update({
        where: { stashId: partyStashId },
        data: { gp: 10 },
      });

      // User B IS the Banker.
      const res = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: userB.cookie, 'content-type': 'application/json' },
        payload: {
          partyId,
          actions: [
            {
              type: 'currency-change',
              payload: { stashId: partyStashId, delta: { cp: 0, sp: 0, ep: 0, gp: -1, pp: 0 }, reason: 'withdraw' },
            },
          ],
        },
      });
      expect(res.statusCode).toBe(200);
      const cur = await prisma.currencyHolding.findUniqueOrThrow({
        where: { stashId: partyStashId },
      });
      expect(cur.gp).toBe(9);
    } finally {
      await app.close();
    }
  });

  it('accepts a non-Banker player withdrawing when NO Banker is appointed', async () => {
    const app = await buildServer({ env, prisma });
    try {
      const { partyId, partyStashId, userA } = await setupTwoMemberPartyWithBanker(app, {
        appointBanker: false,
      });
      await prisma.currencyHolding.update({
        where: { stashId: partyStashId },
        data: { gp: 10 },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: userA.cookie, 'content-type': 'application/json' },
        payload: {
          partyId,
          actions: [
            {
              type: 'currency-change',
              payload: { stashId: partyStashId, delta: { cp: 0, sp: 0, ep: 0, gp: -1, pp: 0 }, reason: 'withdraw' },
            },
          ],
        },
      });
      expect(res.statusCode).toBe(200);
      const cur = await prisma.currencyHolding.findUniqueOrThrow({
        where: { stashId: partyStashId },
      });
      expect(cur.gp).toBe(9);
    } finally {
      await app.close();
    }
  });

  it('rejects a non-Banker moving currency FROM Recovered Loot when Banker is active', async () => {
    const app = await buildServer({ env, prisma });
    try {
      const { partyId, recoveredLootStashId, userA } = await setupTwoMemberPartyWithBanker(app, {
        appointBanker: true,
      });
      await prisma.currencyHolding.update({
        where: { stashId: recoveredLootStashId },
        data: { gp: 5 },
      });

      // A's Inventory stash id as the destination.
      const aChar = await prisma.character.findFirstOrThrow({
        where: { partyId, ownerUserId: userA.userId },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: userA.cookie, 'content-type': 'application/json' },
        payload: {
          partyId,
          actions: [
            {
              type: 'currency-transfer',
              payload: {
                fromStashId: recoveredLootStashId,
                toStashId: aChar.inventoryStashId,
                delta: { cp: 0, sp: 0, ep: 0, gp: 1, pp: 0 },
              },
            },
          ],
        },
      });
      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.body) as { rejected?: { code?: string } };
      expect(body.rejected?.code).toBe('banker_required_for_claim');
    } finally {
      await app.close();
    }
  });

  it('accepts DEPOSITING currency into Party Stash even when Banker is active (deposit is un-gated)', async () => {
    const app = await buildServer({ env, prisma });
    try {
      const { partyId, partyStashId, userA } = await setupTwoMemberPartyWithBanker(app, {
        appointBanker: true,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: userA.cookie, 'content-type': 'application/json' },
        payload: {
          partyId,
          actions: [
            {
              type: 'currency-change',
              payload: { stashId: partyStashId, delta: { cp: 0, sp: 0, ep: 0, gp: 1, pp: 0 }, reason: 'deposit' },
            },
          ],
        },
      });
      expect(res.statusCode).toBe(200);
      const cur = await prisma.currencyHolding.findUniqueOrThrow({
        where: { stashId: partyStashId },
      });
      expect(cur.gp).toBe(1);
    } finally {
      await app.close();
    }
  });
});

// -------------------------------------------------------------------- //
// R4.2.d — split-evenly (Banker distribution toolkit)
// -------------------------------------------------------------------- //

describe('R4.2.d — split-evenly on /sync/actions', () => {
  /**
   * Two-member party with a Banker + both members having characters
   * (so each has an Inventory stash to receive their share). Returns
   * ids the tests need.
   */
  async function setupSplitReady(app: Awaited<ReturnType<typeof buildServer>>): Promise<{
    partyId: string;
    partyStashId: string;
    userA: { userId: string; cookie: string; characterId: string; inventoryStashId: string };
    userB: { userId: string; cookie: string; characterId: string; inventoryStashId: string };
  }> {
    const userA = await seedUser({ displayName: 'A' });
    const tokenA = await seedSession(userA.userId);
    const cookieA = cookieHeader(env, tokenA);
    const { partyId, inviteCode } = await bootstrapParty(app, cookieA);

    const userB = await seedUser({ displayName: 'B' });
    const tokenB = await seedSession(userB.userId);
    const cookieB = cookieHeader(env, tokenB);
    const joinRes = await app.inject({
      method: 'POST',
      url: '/parties/join',
      headers: { cookie: cookieB, 'content-type': 'application/json' },
      payload: { inviteCode },
    });
    expect(joinRes.statusCode).toBe(200);
    await app.inject({
      method: 'POST',
      url: '/sync/actions',
      headers: { cookie: cookieB, 'content-type': 'application/json' },
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

    // Appoint B as Banker.
    const appointRes = await app.inject({
      method: 'POST',
      url: '/sync/actions',
      headers: { cookie: cookieA, 'content-type': 'application/json' },
      payload: {
        partyId,
        actions: [{ type: 'appoint-banker', payload: { bankerUserId: userB.userId } }],
      },
    });
    expect(appointRes.statusCode).toBe(200);

    const partyStash = await prisma.stash.findFirstOrThrow({
      where: { partyId, scope: 'party' },
    });
    const aChar = await prisma.character.findFirstOrThrow({
      where: { partyId, ownerUserId: userA.userId },
    });
    const bChar = await prisma.character.findFirstOrThrow({
      where: { partyId, ownerUserId: userB.userId },
    });

    return {
      partyId,
      partyStashId: partyStash.id,
      userA: {
        userId: userA.userId,
        cookie: cookieA,
        characterId: aChar.id,
        inventoryStashId: aChar.inventoryStashId,
      },
      userB: {
        userId: userB.userId,
        cookie: cookieB,
        characterId: bChar.id,
        inventoryStashId: bChar.inventoryStashId,
      },
    };
  }

  it('splits 100 gp across 2 recipients — Banker triggers, both Inventories credited 50 gp, pool empty', async () => {
    const app = await buildServer({ env, prisma });
    try {
      const { partyId, partyStashId, userA, userB } = await setupSplitReady(app);
      await prisma.currencyHolding.update({
        where: { stashId: partyStashId },
        data: { gp: 100 },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: userB.cookie, 'content-type': 'application/json' },
        payload: {
          partyId,
          actions: [
            {
              type: 'split-evenly',
              payload: {
                fromStashId: partyStashId,
                recipientCharacterIds: [userA.characterId, userB.characterId],
              },
            },
          ],
        },
      });
      expect(res.statusCode).toBe(200);

      const pool = await prisma.currencyHolding.findUniqueOrThrow({
        where: { stashId: partyStashId },
      });
      expect(pool.gp).toBe(0);
      expect(pool.cp).toBe(0);

      const aInv = await prisma.currencyHolding.findUniqueOrThrow({
        where: { stashId: userA.inventoryStashId },
      });
      expect(aInv.gp).toBe(50);

      const bInv = await prisma.currencyHolding.findUniqueOrThrow({
        where: { stashId: userB.inventoryStashId },
      });
      expect(bInv.gp).toBe(50);
    } finally {
      await app.close();
    }
  });

  it('rejects a non-Banker player triggering split-evenly with banker_required_for_claim', async () => {
    const app = await buildServer({ env, prisma });
    try {
      const { partyId, partyStashId, userA, userB } = await setupSplitReady(app);
      await prisma.currencyHolding.update({
        where: { stashId: partyStashId },
        data: { gp: 100 },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: userA.cookie, 'content-type': 'application/json' },
        payload: {
          partyId,
          actions: [
            {
              type: 'split-evenly',
              payload: {
                fromStashId: partyStashId,
                recipientCharacterIds: [userA.characterId, userB.characterId],
              },
            },
          ],
        },
      });
      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.body) as { rejected?: { code?: string } };
      expect(body.rejected?.code).toBe('banker_required_for_claim');

      const pool = await prisma.currencyHolding.findUniqueOrThrow({
        where: { stashId: partyStashId },
      });
      expect(pool.gp).toBe(100);
    } finally {
      await app.close();
    }
  });

  it('cascade split: 100 gp / 3 recipients → each 33 gp 3 sp 3 cp, pool retains 1 cp', async () => {
    const app = await buildServer({ env, prisma });
    try {
      const { partyId, partyStashId, userA, userB } = await setupSplitReady(app);
      await prisma.currencyHolding.update({
        where: { stashId: partyStashId },
        data: { gp: 100 },
      });
      // Add user C so we have 3 recipients.
      const userC = await seedUser({ displayName: 'C' });
      const tokenC = await seedSession(userC.userId);
      const cookieC = cookieHeader(env, tokenC);
      const invite = await prisma.party.findUniqueOrThrow({ where: { id: partyId } });
      await app.inject({
        method: 'POST',
        url: '/parties/join',
        headers: { cookie: cookieC, 'content-type': 'application/json' },
        payload: { inviteCode: invite.inviteCode },
      });
      await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieC, 'content-type': 'application/json' },
        payload: {
          partyId,
          actions: [
            {
              type: 'create-character',
              payload: {
                name: 'C-Char',
                species: 'Human',
                size: 'medium',
                class: 'Cleric',
                level: 1,
                str: 10,
              },
            },
          ],
        },
      });
      const cChar = await prisma.character.findFirstOrThrow({
        where: { partyId, ownerUserId: userC.userId },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: userB.cookie, 'content-type': 'application/json' },
        payload: {
          partyId,
          actions: [
            {
              type: 'split-evenly',
              payload: {
                fromStashId: partyStashId,
                recipientCharacterIds: [userA.characterId, userB.characterId, cChar.id],
              },
            },
          ],
        },
      });
      expect(res.statusCode).toBe(200);

      const pool = await prisma.currencyHolding.findUniqueOrThrow({
        where: { stashId: partyStashId },
      });
      expect({ cp: pool.cp, sp: pool.sp, ep: pool.ep, gp: pool.gp, pp: pool.pp }).toEqual({
        cp: 1, sp: 0, ep: 0, gp: 0, pp: 0,
      });

      for (const invId of [userA.inventoryStashId, userB.inventoryStashId, cChar.inventoryStashId]) {
        const inv = await prisma.currencyHolding.findUniqueOrThrow({
          where: { stashId: invId },
        });
        expect({ cp: inv.cp, sp: inv.sp, ep: inv.ep, gp: inv.gp, pp: inv.pp }).toEqual({
          cp: 3, sp: 3, ep: 0, gp: 33, pp: 0,
        });
      }
    } finally {
      await app.close();
    }
  });

  it('DM can `gameplay-drain` Party Stash even when Banker is active (R4.2.d bypass)', async () => {
    const app = await buildServer({ env, prisma });
    try {
      const { partyId, partyStashId, userA } = await setupSplitReady(app);
      await prisma.currencyHolding.update({
        where: { stashId: partyStashId },
        data: { gp: 10 },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: userA.cookie, 'content-type': 'application/json' },
        payload: {
          partyId,
          actions: [
            {
              type: 'currency-change',
              payload: {
                stashId: partyStashId,
                delta: { cp: 0, sp: 0, ep: 0, gp: -3, pp: 0 },
                reason: 'gameplay-drain',
              },
            },
          ],
        },
      });
      expect(res.statusCode).toBe(200);
      const pool = await prisma.currencyHolding.findUniqueOrThrow({
        where: { stashId: partyStashId },
      });
      expect(pool.gp).toBe(7);
    } finally {
      await app.close();
    }
  });

  it('rejects a player (even the Banker) using `gameplay-drain` (DM-only reason)', async () => {
    const app = await buildServer({ env, prisma });
    try {
      const { partyId, partyStashId, userB } = await setupSplitReady(app);
      await prisma.currencyHolding.update({
        where: { stashId: partyStashId },
        data: { gp: 10 },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: userB.cookie, 'content-type': 'application/json' },
        payload: {
          partyId,
          actions: [
            {
              type: 'currency-change',
              payload: {
                stashId: partyStashId,
                delta: { cp: 0, sp: 0, ep: 0, gp: -3, pp: 0 },
                reason: 'gameplay-drain',
              },
            },
          ],
        },
      });
      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.body) as { rejected?: { code?: string } };
      expect(body.rejected?.code).toBe('dm_only');
    } finally {
      await app.close();
    }
  });
});

// -------------------------------------------------------------------- //
// R4.3.a — dm-transfer via /sync/actions
// -------------------------------------------------------------------- //

describe('R4.3.a — dm-transfer on /sync/actions', () => {
  /**
   * Setup: bootstrap party as user A (DM), user B joins as player.
   * `dm-transfer` is dispatched via /sync/actions (same route pattern
   * as appoint-banker / revoke-banker per R4.2.a precedent).
   */
  async function setupTwoMemberParty(app: Awaited<ReturnType<typeof buildServer>>): Promise<{
    partyId: string;
    userA: { userId: string; cookie: string };
    userB: { userId: string; cookie: string };
  }> {
    const userA = await seedUser({ displayName: 'A' });
    const tokenA = await seedSession(userA.userId);
    const cookieA = cookieHeader(env, tokenA);
    const { partyId, inviteCode } = await bootstrapParty(app, cookieA);

    const userB = await seedUser({ displayName: 'B' });
    const tokenB = await seedSession(userB.userId);
    const cookieB = cookieHeader(env, tokenB);
    const joinRes = await app.inject({
      method: 'POST',
      url: '/parties/join',
      headers: { cookie: cookieB, 'content-type': 'application/json' },
      payload: { inviteCode },
    });
    expect(joinRes.statusCode).toBe(200);

    return {
      partyId,
      userA: { userId: userA.userId, cookie: cookieA },
      userB: { userId: userB.userId, cookie: cookieB },
    };
  }

  it('DM can transfer the DM role to another active player (Party.ownerUserId + memberships persisted)', async () => {
    const app = await buildServer({ env, prisma });
    try {
      const { partyId, userA, userB } = await setupTwoMemberParty(app);

      const res = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: userA.cookie, 'content-type': 'application/json' },
        payload: {
          partyId,
          actions: [{ type: 'dm-transfer', payload: { newDmUserId: userB.userId } }],
        },
      });
      expect(res.statusCode).toBe(200);

      // Party.ownerUserId updated.
      const party = await prisma.party.findUniqueOrThrow({ where: { id: partyId } });
      expect(party.ownerUserId).toBe(userB.userId);

      // Outgoing DM's dm row → soft-deleted.
      const oldDmRow = await prisma.partyMembership.findUnique({
        where: {
          userId_partyId_role: {
            userId: userA.userId,
            partyId,
            role: 'dm',
          },
        },
      });
      expect(oldDmRow).not.toBeNull();
      expect(oldDmRow!.leftAt).not.toBeNull();

      // Outgoing DM's player row → active (bootstrap left it in place).
      const oldDmPlayerRow = await prisma.partyMembership.findUnique({
        where: {
          userId_partyId_role: {
            userId: userA.userId,
            partyId,
            role: 'player',
          },
        },
      });
      expect(oldDmPlayerRow).not.toBeNull();
      expect(oldDmPlayerRow!.leftAt).toBeNull();

      // Incoming DM's dm row → active.
      const newDmRow = await prisma.partyMembership.findUnique({
        where: {
          userId_partyId_role: {
            userId: userB.userId,
            partyId,
            role: 'dm',
          },
        },
      });
      expect(newDmRow).not.toBeNull();
      expect(newDmRow!.leftAt).toBeNull();

      // Incoming DM's player row → active (untouched by the transfer).
      const newDmPlayerRow = await prisma.partyMembership.findUnique({
        where: {
          userId_partyId_role: {
            userId: userB.userId,
            partyId,
            role: 'player',
          },
        },
      });
      expect(newDmPlayerRow).not.toBeNull();
      expect(newDmPlayerRow!.leftAt).toBeNull();

      // TransactionLog entry.
      const entries = await prisma.transactionLog.findMany({
        where: { partyId },
        orderBy: { timestamp: 'asc' },
      });
      const last = entries[entries.length - 1]!;
      expect(last.type).toBe('dm-transfer');
      expect(last.actorUserId).toBe(userA.userId);
      expect(last.actorRole).toBe('dm');
      const payload = last.payload as { oldDmUserId: string; newDmUserId: string };
      expect(payload.oldDmUserId).toBe(userA.userId);
      expect(payload.newDmUserId).toBe(userB.userId);
    } finally {
      await app.close();
    }
  });

  it('rejects self-transfer with dm_transfer_self (422)', async () => {
    const app = await buildServer({ env, prisma });
    try {
      const { partyId, userA } = await setupTwoMemberParty(app);

      const res = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: userA.cookie, 'content-type': 'application/json' },
        payload: {
          partyId,
          actions: [{ type: 'dm-transfer', payload: { newDmUserId: userA.userId } }],
        },
      });
      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.body) as { rejected?: { code?: string } };
      expect(body.rejected?.code).toBe('dm_transfer_self');
    } finally {
      await app.close();
    }
  });

  it('rejects a non-DM actor with dm_only (422)', async () => {
    const app = await buildServer({ env, prisma });
    try {
      const { partyId, userA, userB } = await setupTwoMemberParty(app);

      // User B (player) tries to transfer DM to themselves.
      const res = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: userB.cookie, 'content-type': 'application/json' },
        payload: {
          partyId,
          actions: [{ type: 'dm-transfer', payload: { newDmUserId: userA.userId } }],
        },
      });
      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.body) as { rejected?: { code?: string } };
      expect(body.rejected?.code).toBe('dm_only');
    } finally {
      await app.close();
    }
  });

  it('rejects target not in party with dm_transfer_target_not_member (422)', async () => {
    const app = await buildServer({ env, prisma });
    try {
      const { partyId, userA } = await setupTwoMemberParty(app);

      const res = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: userA.cookie, 'content-type': 'application/json' },
        payload: {
          partyId,
          actions: [{ type: 'dm-transfer', payload: { newDmUserId: 'stranger-not-in-party' } }],
        },
      });
      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.body) as { rejected?: { code?: string } };
      expect(body.rejected?.code).toBe('dm_transfer_target_not_member');
    } finally {
      await app.close();
    }
  });

  it('auto-clears Party.bankerUserId when the incoming DM is the current Banker', async () => {
    const app = await buildServer({ env, prisma });
    try {
      const { partyId, userA, userB } = await setupTwoMemberParty(app);

      // Appoint user B as Banker.
      const appoint = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: userA.cookie, 'content-type': 'application/json' },
        payload: {
          partyId,
          actions: [{ type: 'appoint-banker', payload: { bankerUserId: userB.userId } }],
        },
      });
      expect(appoint.statusCode).toBe(200);

      // Transfer DM to userB (the current Banker).
      const transfer = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: userA.cookie, 'content-type': 'application/json' },
        payload: {
          partyId,
          actions: [{ type: 'dm-transfer', payload: { newDmUserId: userB.userId } }],
        },
      });
      expect(transfer.statusCode).toBe(200);

      // Party.bankerUserId cleared, ownerUserId = userB.
      const party = await prisma.party.findUniqueOrThrow({ where: { id: partyId } });
      expect(party.ownerUserId).toBe(userB.userId);
      expect(party.bankerUserId).toBeNull();

      // Cascade emitted a `revoke-banker { reason: 'dm-transfer' }`
      // BEFORE the terminal `dm-transfer` entry.
      const entries = await prisma.transactionLog.findMany({
        where: { partyId },
        orderBy: { timestamp: 'asc' },
      });
      const cascaded = entries.slice(-2);
      expect(cascaded[0]!.type).toBe('revoke-banker');
      const revokePayload = cascaded[0]!.payload as { reason: string };
      expect(revokePayload.reason).toBe('dm-transfer');
      expect(cascaded[1]!.type).toBe('dm-transfer');
    } finally {
      await app.close();
    }
  });

  it('BUG-002 shape: reactivates a historical soft-deleted dm row on transfer (via a two-step round-trip)', async () => {
    const app = await buildServer({ env, prisma });
    try {
      const { partyId, userA, userB } = await setupTwoMemberParty(app);

      // First transfer: A → B. Soft-deletes A's dm row; creates B's dm row.
      const first = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: userA.cookie, 'content-type': 'application/json' },
        payload: {
          partyId,
          actions: [{ type: 'dm-transfer', payload: { newDmUserId: userB.userId } }],
        },
      });
      expect(first.statusCode).toBe(200);

      // Second transfer: B → A. Reactivates A's historical dm row
      // (would P2002 without upsert semantics per BUG-002).
      const second = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: userB.cookie, 'content-type': 'application/json' },
        payload: {
          partyId,
          actions: [{ type: 'dm-transfer', payload: { newDmUserId: userA.userId } }],
        },
      });
      expect(second.statusCode).toBe(200);

      // A's dm row is active again; B's dm row soft-deleted.
      const rowA = await prisma.partyMembership.findUnique({
        where: { userId_partyId_role: { userId: userA.userId, partyId, role: 'dm' } },
      });
      expect(rowA!.leftAt).toBeNull();

      const rowB = await prisma.partyMembership.findUnique({
        where: { userId_partyId_role: { userId: userB.userId, partyId, role: 'dm' } },
      });
      expect(rowB!.leftAt).not.toBeNull();

      // Party.ownerUserId back to A.
      const party = await prisma.party.findUniqueOrThrow({ where: { id: partyId } });
      expect(party.ownerUserId).toBe(userA.userId);
    } finally {
      await app.close();
    }
  });
});
