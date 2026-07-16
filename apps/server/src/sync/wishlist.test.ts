/**
 * R10.5 — integration tests for wishlist persistence + the §8.1 guard,
 * driven through `POST /sync/actions`. Same harness as
 * `sync/routes.test.ts` (real Fastify + real Postgres, truncate per test).
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
    'TRUNCATE TABLE "TransactionLog", "CurrencyHolding", "ItemInstance", "Stash", "Character", "PartyMembership", "Party", "EmailAuthAttempt", "VerificationToken", "Session", "Account", "User" CASCADE',
  );
  await prisma.$executeRawUnsafe('DELETE FROM "ItemDefinition" WHERE source = \'homebrew\'');
});

async function seedUser(displayName = 'Test User'): Promise<{ userId: string }> {
  const userId = `u-${Math.random().toString(36).slice(2, 10)}`;
  await prisma.user.create({
    data: { id: userId, displayName, discordId: `discord-${userId}`, needsDisplayName: false },
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

async function bootstrap(
  app: Awaited<ReturnType<typeof buildServer>>,
  cookie: string,
): Promise<{ partyId: string; characterId: string; inviteCode: string }> {
  const ids = createCharacterIds();
  const res = await app.inject({
    method: 'POST',
    url: '/sync/actions',
    headers: { cookie },
    payload: {
      partyId: ids.newPartyId,
      actions: [
        {
          type: 'create-character',
          payload: {
            name: 'Thorin',
            species: 'Dwarf',
            size: 'medium',
            class: 'Fighter',
            level: 1,
            str: 16,
            ...ids,
          },
        },
      ],
    },
  });
  if (res.statusCode !== 200) throw new Error(`bootstrap failed: ${res.statusCode} ${res.body}`);
  const party = await prisma.party.findUniqueOrThrow({ where: { id: ids.newPartyId } });
  return { partyId: ids.newPartyId, characterId: ids.newCharacterId, inviteCode: party.inviteCode };
}

function addAction(partyId: string, characterId: string, entry: unknown) {
  return {
    partyId,
    actions: [{ type: 'wishlist-add', payload: { characterId, entry } }],
  };
}

describe('POST /sync/actions — wishlist persistence (R10.5)', () => {
  it('persists a free-text wishlist entry to the Json column + logs it', async () => {
    const { userId } = await seedUser();
    const token = await seedSession(userId);
    const app = await buildServer({ env, prisma });
    try {
      const { partyId, characterId } = await bootstrap(app, cookieHeader(token));
      const entryId = newUuidV7();
      const res = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieHeader(token) },
        payload: addAction(partyId, characterId, {
          id: entryId,
          kind: 'text',
          text: 'a flaming sword',
        }),
      });
      expect(res.statusCode).toBe(200);

      const ch = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
      expect(ch.wishlist).toEqual([{ id: entryId, kind: 'text', text: 'a flaming sword' }]);
      const log = await prisma.transactionLog.findMany({
        where: { partyId, type: 'wishlist-add' },
      });
      expect(log).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('removes a wishlist entry by id', async () => {
    const { userId } = await seedUser();
    const token = await seedSession(userId);
    const app = await buildServer({ env, prisma });
    try {
      const { partyId, characterId } = await bootstrap(app, cookieHeader(token));
      const entryId = newUuidV7();
      await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieHeader(token) },
        payload: addAction(partyId, characterId, { id: entryId, kind: 'text', text: 'x' }),
      });
      const res = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieHeader(token) },
        payload: {
          partyId,
          actions: [{ type: 'wishlist-remove', payload: { characterId, entryId } }],
        },
      });
      expect(res.statusCode).toBe(200);
      const ch = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
      expect(ch.wishlist).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("lets the DM edit another player's wishlist (owner-or-DM guard)", async () => {
    // A = DM/owner; B joins + creates a character; A adds to B's wishlist.
    const a = await seedUser('A');
    const tokenA = await seedSession(a.userId);
    const b = await seedUser('B');
    const tokenB = await seedSession(b.userId);
    const app = await buildServer({ env, prisma });
    try {
      const { partyId, inviteCode } = await bootstrap(app, cookieHeader(tokenA));
      await app.inject({
        method: 'POST',
        url: '/parties/join',
        headers: { cookie: cookieHeader(tokenB), 'content-type': 'application/json' },
        payload: { inviteCode },
      });
      // B creates a character in the party.
      const bCharId = newUuidV7();
      const bInvId = newUuidV7();
      const bCurId = newUuidV7();
      const createRes = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieHeader(tokenB) },
        payload: {
          partyId,
          actions: [
            {
              type: 'create-character',
              payload: {
                name: 'Bran',
                species: 'Human',
                size: 'medium',
                class: 'Rogue',
                level: 1,
                str: 12,
                newCharacterId: bCharId,
                newInventoryStashId: bInvId,
                newCurrencyHoldingId: bCurId,
              },
            },
          ],
        },
      });
      expect(createRes.statusCode).toBe(200);

      // A (DM) adds to B's wishlist — allowed.
      const entryId = newUuidV7();
      const res = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieHeader(tokenA) },
        payload: addAction(partyId, bCharId, { id: entryId, kind: 'text', text: 'DM suggestion' }),
      });
      expect(res.statusCode).toBe(200);
      const ch = await prisma.character.findUniqueOrThrow({ where: { id: bCharId } });
      expect(ch.wishlist).toEqual([{ id: entryId, kind: 'text', text: 'DM suggestion' }]);
    } finally {
      await app.close();
    }
  });

  it("rejects a player editing another player's wishlist", async () => {
    const a = await seedUser('A');
    const tokenA = await seedSession(a.userId);
    const b = await seedUser('B');
    const tokenB = await seedSession(b.userId);
    const app = await buildServer({ env, prisma });
    try {
      const {
        partyId,
        characterId: aCharId,
        inviteCode,
      } = await bootstrap(app, cookieHeader(tokenA));
      await app.inject({
        method: 'POST',
        url: '/parties/join',
        headers: { cookie: cookieHeader(tokenB), 'content-type': 'application/json' },
        payload: { inviteCode },
      });
      // B (a player, not DM) tries to edit A's character's wishlist — rejected.
      const res = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieHeader(tokenB) },
        payload: addAction(partyId, aCharId, { id: newUuidV7(), kind: 'text', text: 'nope' }),
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      const ch = await prisma.character.findUniqueOrThrow({ where: { id: aCharId } });
      expect(ch.wishlist).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('returns the wishlist on a subsequent /sync/state pull', async () => {
    const { userId } = await seedUser();
    const token = await seedSession(userId);
    const app = await buildServer({ env, prisma });
    try {
      const { partyId, characterId } = await bootstrap(app, cookieHeader(token));
      const entryId = newUuidV7();
      await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieHeader(token) },
        payload: addAction(partyId, characterId, { id: entryId, kind: 'text', text: 'shiny' }),
      });
      const res = await app.inject({
        method: 'GET',
        url: `/sync/state?partyId=${partyId}`,
        headers: { cookie: cookieHeader(token) },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ state: { characters: { id: string; wishlist: unknown[] }[] } }>();
      const ch = body.state.characters.find((c) => c.id === characterId)!;
      expect(ch.wishlist).toEqual([{ id: entryId, kind: 'text', text: 'shiny' }]);
    } finally {
      await app.close();
    }
  });
});
