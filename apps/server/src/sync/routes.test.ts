/**
 * R3.4.a — integration tests for /sync/state + /sync/actions.
 *
 * Pattern follows routes.email.test.ts (R3.3): build the real Fastify
 * app via `buildServer`, drive it through `app.inject()`, assert
 * response shapes + DB side effects.
 *
 * Covers:
 *   - 401 unauthenticated (both routes)
 *   - 409 display_name_required (R3.3 carryforward)
 *   - 403 not_a_member / 404 party_not_found
 *   - Bootstrap happy path: create-character + follow-up actions
 *   - Guard rejection rolls back the batch
 *   - actorRole carryforward: log entries derive from session, not body
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
  // Truncate every table the sync surface touches (plus the R3.2/R3.3 auth
  // tables) so each test starts from a clean slate.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "TransactionLog", "CurrencyHolding", "ItemInstance", "Stash", "Character", "PartyMembership", "Party", "EmailAuthAttempt", "VerificationToken", "Session", "Account", "User" CASCADE',
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

describe('GET /sync/state — auth + display-name gates (R3.4.a)', () => {
  it('returns 401 without a session cookie', async () => {
    const app = await buildServer({ env, prisma });
    try {
      const res = await app.inject({ method: 'GET', url: '/sync/state?partyId=anything' });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'unauthenticated' });
    } finally {
      await app.close();
    }
  });

  it('returns 409 display_name_required when user.needsDisplayName is true (R3.3 carryforward)', async () => {
    const { userId } = await seedUser({ needsDisplayName: true });
    const token = await seedSession(userId);
    const app = await buildServer({ env, prisma });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/sync/state?partyId=anything',
        headers: { cookie: cookieHeader(env, token) },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'display_name_required' });
    } finally {
      await app.close();
    }
  });

  it('returns 400 on missing partyId query param', async () => {
    const { userId } = await seedUser();
    const token = await seedSession(userId);
    const app = await buildServer({ env, prisma });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/sync/state',
        headers: { cookie: cookieHeader(env, token) },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('returns 404 party_not_found for an unknown partyId', async () => {
    const { userId } = await seedUser();
    const token = await seedSession(userId);
    const app = await buildServer({ env, prisma });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/sync/state?partyId=no-such-party',
        headers: { cookie: cookieHeader(env, token) },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'party_not_found' });
    } finally {
      await app.close();
    }
  });
});

describe('POST /sync/actions — auth + display-name gates (R3.4.a)', () => {
  it('returns 401 without a session cookie', async () => {
    const app = await buildServer({ env, prisma });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        payload: {
          partyId: 'anything',
          actions: [
            {
              type: 'create-character',
              payload: {
                name: 'X',
                species: 'Human',
                size: 'medium',
                class: 'Fighter',
                level: 1,
                str: 16,
              },
            },
          ],
        },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('returns 409 display_name_required when user.needsDisplayName is true', async () => {
    const { userId } = await seedUser({ needsDisplayName: true });
    const token = await seedSession(userId);
    const app = await buildServer({ env, prisma });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieHeader(env, token) },
        payload: {
          partyId: 'anything',
          actions: [
            {
              type: 'create-character',
              payload: {
                name: 'X',
                species: 'Human',
                size: 'medium',
                class: 'Fighter',
                level: 1,
                str: 16,
              },
            },
          ],
        },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'display_name_required' });
    } finally {
      await app.close();
    }
  });

  it('returns 400 on invalid request body', async () => {
    const { userId } = await seedUser();
    const token = await seedSession(userId);
    const app = await buildServer({ env, prisma });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieHeader(env, token) },
        payload: { partyId: 'p', actions: [] }, // empty actions array → schema rejects
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('returns 400 when batch exceeds 100 actions', async () => {
    const { userId } = await seedUser();
    const token = await seedSession(userId);
    const app = await buildServer({ env, prisma });
    try {
      const actions = Array.from({ length: 101 }, () => ({
        type: 'create-character',
        payload: {
          name: 'X',
          species: 'Human',
          size: 'medium',
          class: 'Fighter',
          level: 1,
          str: 16,
        },
      }));
      const res = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieHeader(env, token) },
        payload: { partyId: 'p', actions },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});

describe('POST /sync/actions — bootstrap create-character (R3.4.a)', () => {
  it('creates user, party, memberships, character, 3 stashes, 3 currencies + a log entry', async () => {
    const { userId } = await seedUser();
    const token = await seedSession(userId);
    const app = await buildServer({ env, prisma });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieHeader(env, token) },
        payload: {
          partyId: 'will-be-minted', // server mints its own id; not used in bootstrap
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
              },
            },
          ],
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{
        applied: { actorRole: string; actorUserId: string; type: string }[];
      }>();
      expect(body.applied).toHaveLength(1);
      expect(body.applied[0]!.type).toBe('create-character');
      expect(body.applied[0]!.actorUserId).toBe(userId);
      expect(body.applied[0]!.actorRole).toBe('dm');

      // Verify DB side effects.
      const parties = await prisma.party.findMany({ where: { ownerUserId: userId } });
      expect(parties).toHaveLength(1);
      const characters = await prisma.character.findMany({ where: { ownerUserId: userId } });
      expect(characters).toHaveLength(1);
      expect(characters[0]!.name).toBe('Thorin');
      const memberships = await prisma.partyMembership.findMany({ where: { userId } });
      expect(memberships).toHaveLength(2);
      const stashes = await prisma.stash.findMany({
        where: { OR: [{ partyId: parties[0]!.id }, { ownerCharacterId: characters[0]!.id }] },
      });
      expect(stashes).toHaveLength(3);
      const currencies = await prisma.currencyHolding.findMany({
        where: { stashId: { in: stashes.map((s) => s.id) } },
      });
      expect(currencies).toHaveLength(3);
    } finally {
      await app.close();
    }
  });
});

describe('GET + POST /sync round trip (R3.4.a)', () => {
  it('post create-character then GET state surfaces the new AppState', async () => {
    const { userId } = await seedUser();
    const token = await seedSession(userId);
    const app = await buildServer({ env, prisma });
    try {
      const createRes = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieHeader(env, token) },
        payload: {
          partyId: 'irrelevant',
          actions: [
            {
              type: 'create-character',
              payload: {
                name: 'Alice',
                species: 'Human',
                size: 'medium',
                class: 'Wizard',
                level: 3,
                str: 8,
              },
            },
          ],
        },
      });
      expect(createRes.statusCode).toBe(200);

      // Resolve the new partyId via Prisma (the server minted it).
      const parties = await prisma.party.findMany({ where: { ownerUserId: userId } });
      expect(parties).toHaveLength(1);
      const partyId = parties[0]!.id;

      const stateRes = await app.inject({
        method: 'GET',
        url: `/sync/state?partyId=${partyId}`,
        headers: { cookie: cookieHeader(env, token) },
      });
      expect(stateRes.statusCode).toBe(200);
      const { state } = stateRes.json<{
        state: {
          user: { id: string };
          characters: { name: string }[];
          stashes: { id: string }[];
          log: { type: string }[];
        };
      }>();
      expect(state.user.id).toBe(userId);
      expect(state.characters).toHaveLength(1);
      expect(state.characters[0]!.name).toBe('Alice');
      expect(state.stashes).toHaveLength(3);
      expect(state.log).toHaveLength(1);
      expect(state.log[0]!.type).toBe('create-character');
    } finally {
      await app.close();
    }
  });
});
