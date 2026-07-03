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
import { newUuidV7 } from '@app/shared';

/**
 * RH1.2 — id-injection helpers for direct action-payload fixtures.
 * Fresh UUID v7 per call keeps the server's guard clock-skew window
 * happy and every id unique across calls.
 */
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
                ...createCharacterIds(),
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
                ...createCharacterIds(),
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
          ...createCharacterIds(),
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
      // RH1.3 — the client mints its own partyId (`newPartyId`) and
      // sends it as the URL partyId. No more `'will-be-minted'`
      // placeholder.
      const ids = createCharacterIds();
      const res = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieHeader(env, token) },
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
                ...createCharacterIds(),
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

  // RH1.2 — client-minted-id round trip. The client generates a UUID v7
  // for the new ItemInstance, sends it in the `acquire` payload, and the
  // server persists that exact id (no server-side mint). A subsequent
  // GET /sync/state returns the same id back.
  //
  // Locks in: (a) the persistor consumes `payload.newItemInstanceId`
  // rather than calling `ctx.newId`; (b) the guard's UUID v7 + clock-
  // skew validators accept a within-window id; (c) `TransactionLog`
  // records the same id.
  it('RH1.2 — acquire uses the client-minted newItemInstanceId end-to-end', async () => {
    const { userId } = await seedUser();
    const token = await seedSession(userId);
    const app = await buildServer({ env, prisma });
    try {
      // Bootstrap a party first — carries all 9 create-character ids.
      const bootstrapIds = createCharacterIds();
      const bootstrapRes = await app.inject({
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
                ...bootstrapIds,
              },
            },
          ],
        },
      });
      expect(bootstrapRes.statusCode).toBe(200);
      const partyId = bootstrapIds.newPartyId;
      const inventoryStashId = bootstrapIds.newInventoryStashId;

      // Client mints the id for the new ItemInstance.
      const clientMintedItemId = newUuidV7();

      const acquireRes = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieHeader(env, token) },
        payload: {
          partyId,
          actions: [
            {
              type: 'acquire',
              payload: {
                stashId: inventoryStashId,
                definitionId: 'phb-2024:torch',
                quantity: 2,
                source: 'catalog-add',
                newItemInstanceId: clientMintedItemId,
              },
            },
          ],
        },
      });
      expect(acquireRes.statusCode).toBe(200);

      // Direct DB check — the row's id matches the client-minted id.
      const dbRow = await prisma.itemInstance.findUnique({
        where: { id: clientMintedItemId },
      });
      expect(dbRow).not.toBeNull();
      expect(dbRow!.definitionId).toBe('phb-2024:torch');
      expect(dbRow!.quantity).toBe(2);

      // Round-trip via GET /sync/state — the same id surfaces.
      const stateRes = await app.inject({
        method: 'GET',
        url: `/sync/state?partyId=${partyId}`,
        headers: { cookie: cookieHeader(env, token) },
      });
      expect(stateRes.statusCode).toBe(200);
      const { state } = stateRes.json<{
        state: { items: { id: string; definitionId: string; quantity: number }[] };
      }>();
      const match = state.items.find((i) => i.id === clientMintedItemId);
      expect(match).toBeDefined();
      expect(match!.definitionId).toBe('phb-2024:torch');
      expect(match!.quantity).toBe(2);
    } finally {
      await app.close();
    }
  });

  // RH1.2 — collision path. A client-minted id that reuses an existing
  // primary key should surface as a 422 with `id_already_exists`
  // (Prisma P2002 → BatchRejected mapping in routes.ts).
  it('RH1.2 — duplicate client-minted id → 422 id_already_exists', async () => {
    const { userId } = await seedUser();
    const token = await seedSession(userId);
    const app = await buildServer({ env, prisma });
    try {
      // Bootstrap.
      const bootstrapIds = createCharacterIds();
      const bootstrapRes = await app.inject({
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
                ...bootstrapIds,
              },
            },
          ],
        },
      });
      expect(bootstrapRes.statusCode).toBe(200);
      const partyId = bootstrapIds.newPartyId;
      const inventoryStashId = bootstrapIds.newInventoryStashId;

      // First acquire — id is unused; succeeds.
      const dupeId = newUuidV7();
      const first = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieHeader(env, token) },
        payload: {
          partyId,
          actions: [
            {
              type: 'acquire',
              payload: {
                stashId: inventoryStashId,
                definitionId: 'phb-2024:torch',
                quantity: 1,
                // Note: distinct from `dupeId` so the collision test is
                // deterministic (the second acquire is the one that
                // reuses `dupeId`).
                notes: 'first-slot',
                source: 'catalog-add',
                newItemInstanceId: dupeId,
              },
            },
          ],
        },
      });
      expect(first.statusCode).toBe(200);

      // Second acquire — reuses `dupeId`. Distinct notes so the reducer
      // doesn't stack-merge into the existing row (which would discard
      // the incoming id at the reducer boundary). Distinct notes force
      // the persistor's insert path, where Prisma throws P2002.
      const second = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieHeader(env, token) },
        payload: {
          partyId,
          actions: [
            {
              type: 'acquire',
              payload: {
                stashId: inventoryStashId,
                definitionId: 'phb-2024:torch',
                quantity: 1,
                notes: 'second-slot',
                source: 'catalog-add',
                newItemInstanceId: dupeId,
              },
            },
          ],
        },
      });
      expect(second.statusCode).toBe(422);
      const body = second.json<{
        rejected: { index: number; code: string; message: string };
      }>();
      expect(body.rejected.code).toBe('id_already_exists');
      expect(body.rejected.index).toBe(0);
    } finally {
      await app.close();
    }
  });
});

// -------------------------------------------------------------------- //
// R4.4.b — Homebrew visibility is party-scoped
// -------------------------------------------------------------------- //

/**
 * Locks in the invariant from OUTLINE §3.7 + §4 `ItemDefinition.partyId`:
 * homebrew is scoped to the party that created it. Party A's homebrew
 * MUST NOT appear in party B's `GET /sync/state` even if the requesting
 * user is a member of both parties.
 *
 * The server-side filter lives at `state-loader.ts:151-155`
 * (`OR: [{ source: PHB | DMG }, { partyId }]`); these tests exercise
 * that filter through the real /sync/state route.
 */
describe('R4.4.b — homebrew party-scope filter', () => {
  async function seedPartyDirect(
    ownerUserId: string,
    partyName: string,
  ): Promise<{ partyId: string; inventoryStashId: string }> {
    const partyId = `p-${Math.random().toString(36).slice(2, 10)}`;
    const characterId = `c-${Math.random().toString(36).slice(2, 10)}`;
    const inventoryStashId = `s-${Math.random().toString(36).slice(2, 10)}`;
    const partyStashId = `s-${Math.random().toString(36).slice(2, 10)}`;
    const recoveredStashId = `s-${Math.random().toString(36).slice(2, 10)}`;
    // Transaction so the Character ↔ Stash INITIALLY DEFERRED FK cycle
    // resolves at commit (mirrors the real bootstrap in persistor.ts).
    await prisma.$transaction(async (tx) => {
      await tx.party.create({
        data: {
          id: partyId,
          name: partyName,
          ownerUserId,
          inviteCode: `inv-${Math.random().toString(36).slice(2, 18)}`,
          recoveredLootStashId: recoveredStashId,
        },
      });
      // Character references the Inventory stash; Stash references the
      // Character. Both writes go inside the same transaction so the
      // deferred FKs are satisfied at commit.
      await tx.character.create({
        data: {
          id: characterId,
          partyId,
          ownerUserId,
          name: 'Hero',
          species: 'Human',
          size: 'medium',
          class: 'Fighter',
          level: 1,
          strScore: 10,
          maxAttunement: 3,
          encumbranceRule: 'off',
          enforceEncumbrance: false,
          inventoryStashId,
        },
      });
      await tx.stash.createMany({
        data: [
          {
            id: inventoryStashId,
            scope: 'character',
            name: 'Inventory',
            ownerCharacterId: characterId,
            isCarried: true,
          },
          {
            id: partyStashId,
            scope: 'party',
            name: 'Party Stash',
            partyId,
            isCarried: false,
          },
          {
            id: recoveredStashId,
            scope: 'recovered_loot',
            name: 'Recovered Loot',
            partyId,
            isCarried: false,
          },
        ],
      });
      // dm + player rows for creator (mirrors bootstrap-create-character)
      await tx.partyMembership.createMany({
        data: [
          { userId: ownerUserId, partyId, role: 'dm', characterId: null },
          { userId: ownerUserId, partyId, role: 'player', characterId },
        ],
      });
      await tx.currencyHolding.createMany({
        data: [
          {
            id: `c-${inventoryStashId}`,
            stashId: inventoryStashId,
            cp: 0,
            sp: 0,
            ep: 0,
            gp: 0,
            pp: 0,
          },
          { id: `c-${partyStashId}`, stashId: partyStashId, cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
          {
            id: `c-${recoveredStashId}`,
            stashId: recoveredStashId,
            cp: 0,
            sp: 0,
            ep: 0,
            gp: 0,
            pp: 0,
          },
        ],
      });
    });
    return { partyId, inventoryStashId };
  }

  it('excludes party A homebrew from GET /sync/state?partyId=B when user is in both parties', async () => {
    const app = await buildServer({ env, prisma });
    try {
      const { userId } = await seedUser({ displayName: 'A' });
      const token = await seedSession(userId);

      // User creates two parties (both as DM).
      const { partyId: partyA } = await seedPartyDirect(userId, 'Party A');
      const { partyId: partyB } = await seedPartyDirect(userId, 'Party B');

      // Seed a homebrew ItemDefinition scoped to party A.
      await prisma.itemDefinition.create({
        data: {
          id: 'hb-vorpal-spork',
          name: 'Vorpal Spork',
          source: 'homebrew',
          category: 'gear',
          tags: [],
          createdBy: userId,
          partyId: partyA,
        },
      });

      // GET state for party B — must NOT include the Vorpal Spork.
      const resB = await app.inject({
        method: 'GET',
        url: `/sync/state?partyId=${partyB}`,
        headers: { cookie: cookieHeader(env, token) },
      });
      expect(resB.statusCode).toBe(200);
      const { state: stateB } = resB.json<{ state: { catalog: { id: string; name: string }[] } }>();
      expect(stateB.catalog.some((d) => d.id === 'hb-vorpal-spork')).toBe(false);
      expect(stateB.catalog.some((d) => d.name === 'Vorpal Spork')).toBe(false);

      // Sanity: party A DOES include it (rules out "no homebrew anywhere" bug).
      const resA = await app.inject({
        method: 'GET',
        url: `/sync/state?partyId=${partyA}`,
        headers: { cookie: cookieHeader(env, token) },
      });
      expect(resA.statusCode).toBe(200);
      const { state: stateA } = resA.json<{ state: { catalog: { id: string; name: string }[] } }>();
      expect(stateA.catalog.some((d) => d.id === 'hb-vorpal-spork')).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('exposes party A homebrew to a new joiner (party-scoped, not user-scoped)', async () => {
    const app = await buildServer({ env, prisma });
    try {
      const { userId: creatorId } = await seedUser({ displayName: 'A' });
      const { userId: joinerId } = await seedUser({ displayName: 'B' });
      const joinerToken = await seedSession(joinerId);

      const { partyId } = await seedPartyDirect(creatorId, 'Party A');

      // Creator makes a homebrew in party A.
      await prisma.itemDefinition.create({
        data: {
          id: 'hb-shared-item',
          name: 'Shared Item',
          source: 'homebrew',
          category: 'gear',
          tags: [],
          createdBy: creatorId,
          partyId,
        },
      });

      // Joiner joins party A (add a player membership row directly).
      await prisma.partyMembership.create({
        data: { userId: joinerId, partyId, role: 'player', characterId: null },
      });

      // Joiner GETs party A state — should see the homebrew.
      const res = await app.inject({
        method: 'GET',
        url: `/sync/state?partyId=${partyId}`,
        headers: { cookie: cookieHeader(env, joinerToken) },
      });
      expect(res.statusCode).toBe(200);
      const { state } = res.json<{ state: { catalog: { id: string }[] } }>();
      expect(state.catalog.some((d) => d.id === 'hb-shared-item')).toBe(true);
    } finally {
      await app.close();
    }
  });
});

// ------------------------------------------------------------------ //
// RH1.3 — Bootstrap collision behaviour.
//
// The roadmap's stated intent: "server rejects POST /sync/actions with
// a partyId that's already used by a different user (collision-on-
// bootstrap). Should surface as id_already_exists at the 422 layer."
//
// Actual architectural outcome (verified by this test): user B
// replaying user A's already-persisted `newPartyId` hits the resolve
// path FIRST — `partyExists` is non-null (A committed the row), so
// `isBootstrap = false` and `resolveActor` runs. B has no membership
// in the party → 403 `not_a_member`. The auth check is the more
// informative error and it fires before the persistor's P2002 could.
//
// The P2002 `id_already_exists` mapping only surfaces if two clients
// race to POST /sync/actions with the same `newPartyId` before either
// party row commits — hard to reproduce deterministically in a
// single-process test. The RH1.2 P2002 → BatchRejected route mapping
// itself is already covered by the existing acquire-collision test
// above (the create-stash / acquire / etc. paths share one persistor
// catch block).
// ------------------------------------------------------------------ //

describe('POST /sync/actions — RH1.3 bootstrap collision behaviour', () => {
  it('rejects a bootstrap replay of another user’s partyId with 403 not_a_member', async () => {
    const { userId: userA } = await seedUser({ displayName: 'A' });
    const tokenA = await seedSession(userA);
    const { userId: userB } = await seedUser({ displayName: 'B' });
    const tokenB = await seedSession(userB);
    const app = await buildServer({ env, prisma });
    try {
      // User A boots first — takes the partyId.
      const idsA = createCharacterIds();
      const resA = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieHeader(env, tokenA) },
        payload: {
          partyId: idsA.newPartyId,
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
                ...idsA,
              },
            },
          ],
        },
      });
      expect(resA.statusCode).toBe(200);

      // User B replays the SAME newPartyId. Route resolves partyExists
      // to A's row, falls into the non-bootstrap resolve branch, B
      // has no membership → 403 not_a_member.
      const idsB = { ...createCharacterIds(), newPartyId: idsA.newPartyId };
      const resB = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieHeader(env, tokenB) },
        payload: {
          partyId: idsB.newPartyId,
          actions: [
            {
              type: 'create-character',
              payload: {
                name: 'Bob',
                species: 'Elf',
                size: 'medium',
                class: 'Rogue',
                level: 2,
                str: 10,
                ...idsB,
              },
            },
          ],
        },
      });
      expect(resB.statusCode).toBe(403);
      expect(resB.json()).toEqual({ error: 'not_a_member' });
    } finally {
      await app.close();
    }
  });
});

describe('POST /sync/actions — RH2.3 applied[] count invariant', () => {
  /**
   * RH2.3 — per-action `applied[]` count assertion (server-side).
   *
   * The persistor iterates `reduced.logEntries` and pushes each entry
   * into an `out` array that becomes the response's `applied[]`. Any
   * silent slice drop (a future refactor bug, an errant `continue`,
   * etc.) would return 200 with a short array and diverge the RH2.1b
   * timestamp-patch flow. The routes handler now asserts
   * `out.length - preLen === reduced.logEntries.length` per action.
   *
   * This test exercises the assertion's happy-path counterpart under a
   * real cascade: create a Storage stash, acquire 3 distinct items,
   * then delete the stash. The reducer emits 3 `transfer` slices
   * (post-RH2.2 in stable id-sorted order) + 1 `delete-stash` slice
   * (currency is zero on a freshly-created stash, so no
   * `currency-change` slice). All 4 must appear in `applied[]`; if the
   * assertion were misconfigured (e.g. off-by-one), the test would 500.
   *
   * A red-path test — inducing a mid-loop persistor drop to prove the
   * assertion actually fires — would require intercepting the local
   * `out.push` inside the transaction closure, which isn't spyable
   * from the outside. Left as defence-in-depth; the error message
   * embedded in the throw is descriptive enough that a future
   * regression would surface with a clear diagnostic.
   */
  it('returns 200 with applied.length equal to the reducer-emitted slice count for a delete-stash cascade', async () => {
    const { userId } = await seedUser();
    const token = await seedSession(userId);
    const app = await buildServer({ env, prisma });
    try {
      // Bootstrap.
      const bootstrapIds = createCharacterIds();
      const bootstrapRes = await app.inject({
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
                ...bootstrapIds,
              },
            },
          ],
        },
      });
      expect(bootstrapRes.statusCode).toBe(200);
      const partyId = bootstrapIds.newPartyId;

      // Create a Storage stash owned by the character (Inventory /
      // Party Stash / Recovered Loot are guard-protected for
      // delete-stash; Storage is not).
      const storageStashId = newUuidV7();
      const storageCurrencyId = newUuidV7();
      const createStashRes = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieHeader(env, token) },
        payload: {
          partyId,
          actions: [
            {
              type: 'create-stash',
              payload: {
                ownerCharacterId: bootstrapIds.newCharacterId,
                name: 'Chest',
                newStashId: storageStashId,
                newCurrencyHoldingId: storageCurrencyId,
              },
            },
          ],
        },
      });
      expect(createStashRes.statusCode).toBe(200);

      // Acquire 3 distinct items into the Storage stash so
      // delete-stash's cascade emits 3 transfer slices.
      const itemIds = [newUuidV7(), newUuidV7(), newUuidV7()];
      const acquireRes = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieHeader(env, token) },
        payload: {
          partyId,
          actions: itemIds.map((id, idx) => ({
            type: 'acquire',
            payload: {
              stashId: storageStashId,
              definitionId:
                idx === 0
                  ? 'phb-2024:torch'
                  : idx === 1
                    ? 'phb-2024:rope-hempen-50ft'
                    : 'phb-2024:rations-1day',
              quantity: 1,
              source: 'catalog-add',
              newItemInstanceId: id,
            },
          })),
        },
      });
      expect(acquireRes.statusCode).toBe(200);

      // Delete the stash. Expect 3 transfer + 1 delete-stash = 4 slices
      // in applied[]. Currency is zero (freshly-created holding), so no
      // currency-change slice.
      const deleteRes = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieHeader(env, token) },
        payload: {
          partyId,
          actions: [
            {
              type: 'delete-stash',
              payload: { stashId: storageStashId },
            },
          ],
        },
      });
      expect(deleteRes.statusCode).toBe(200);
      const body = deleteRes.json<{
        applied: { type: string }[];
      }>();

      // Contract: 3 transfer + 1 delete-stash. If the persistor ever
      // silently drops a slice mid-loop, this length becomes 3 (or
      // fewer) and the route now 500s instead — either way the test
      // catches it.
      expect(body.applied).toHaveLength(4);
      expect(body.applied.filter((e) => e.type === 'transfer')).toHaveLength(3);
      expect(body.applied.filter((e) => e.type === 'delete-stash')).toHaveLength(1);
      expect(body.applied.filter((e) => e.type === 'currency-change')).toHaveLength(0);
    } finally {
      await app.close();
    }
  });
});

describe('POST /sync/actions — RH3.1 GameSession sessionId stamping', () => {
  it('start-game-session then acquire — both applied entries carry the new gameSessionId', async () => {
    const { userId } = await seedUser();
    const token = await seedSession(userId);
    const app = await buildServer({ env, prisma });
    try {
      // Bootstrap first (create-character owns the party creation).
      const bootstrapIds = createCharacterIds();
      const bootstrapRes = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieHeader(env, token) },
        payload: {
          partyId: 'irrelevant',
          actions: [
            {
              type: 'create-character',
              payload: {
                name: 'DM',
                species: 'Human',
                size: 'medium',
                class: 'Wizard',
                level: 1,
                str: 8,
                ...bootstrapIds,
              },
            },
          ],
        },
      });
      expect(bootstrapRes.statusCode).toBe(200);
      const partyId = bootstrapIds.newPartyId;
      const inventoryStashId = bootstrapIds.newInventoryStashId;

      // Now start a session + acquire in one batch. The server-side
      // middleware stamps sessionId from currentGameSessionId(state)
      // AFTER the reducer applies each action, so:
      //   - start-game-session sees the new session as isCurrent=true
      //     when it composes its own log entry (self-referential
      //     sessionId).
      //   - the subsequent acquire also sees isCurrent=true and
      //     inherits the same sessionId.
      const newGameSessionId = newUuidV7();
      const clientMintedItemId = newUuidV7();
      const batchRes = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieHeader(env, token) },
        payload: {
          partyId,
          actions: [
            {
              type: 'start-game-session',
              payload: { newGameSessionId },
            },
            {
              type: 'acquire',
              payload: {
                stashId: inventoryStashId,
                definitionId: 'phb-2024:torch',
                quantity: 1,
                source: 'catalog-add',
                newItemInstanceId: clientMintedItemId,
              },
            },
          ],
        },
      });
      expect(batchRes.statusCode).toBe(200);
      const body = batchRes.json<{
        applied: { type: string; sessionId: string | null; payload: unknown }[];
      }>();
      expect(body.applied).toHaveLength(2);
      const [startEntry, acquireEntry] = body.applied;
      // Middleware reads PRE-reduce state (same as partyId/actorRole).
      // start-game-session lands Untagged because the new session
      // doesn't yet exist in pre-state. Its payload still carries the
      // gameSessionId for audit.
      expect(startEntry!.type).toBe('start-game-session');
      expect(startEntry!.sessionId).toBeNull();
      // The follow-on acquire sees isCurrent=true in pre-state (the
      // previous action's reduce() already applied) and inherits the id.
      expect(acquireEntry!.type).toBe('acquire');
      expect(acquireEntry!.sessionId).toBe(newGameSessionId);

      // Direct DB check: the GameSession row exists with isCurrent=true.
      const dbSession = await prisma.gameSession.findUnique({
        where: { id: newGameSessionId },
      });
      expect(dbSession).not.toBeNull();
      expect(dbSession!.isCurrent).toBe(true);
      expect(dbSession!.number).toBe(1);
      // Only the acquire log FK's to this session; start-game-session
      // is Untagged.
      const dbLogsForSession = await prisma.transactionLog.findMany({
        where: { partyId, sessionId: newGameSessionId },
      });
      expect(dbLogsForSession).toHaveLength(1);
      expect(dbLogsForSession[0]!.type).toBe('acquire');
    } finally {
      await app.close();
    }
  });

  it('end-game-session and subsequent acquire → sessionId: null (Untagged bucket)', async () => {
    const { userId } = await seedUser();
    const token = await seedSession(userId);
    const app = await buildServer({ env, prisma });
    try {
      const bootstrapIds = createCharacterIds();
      await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieHeader(env, token) },
        payload: {
          partyId: 'irrelevant',
          actions: [
            {
              type: 'create-character',
              payload: {
                name: 'DM',
                species: 'Human',
                size: 'medium',
                class: 'Wizard',
                level: 1,
                str: 8,
                ...bootstrapIds,
              },
            },
          ],
        },
      });
      const partyId = bootstrapIds.newPartyId;
      const inventoryStashId = bootstrapIds.newInventoryStashId;

      const newGameSessionId = newUuidV7();
      const res = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieHeader(env, token) },
        payload: {
          partyId,
          actions: [
            { type: 'start-game-session', payload: { newGameSessionId } },
            { type: 'end-game-session', payload: {} },
            {
              type: 'acquire',
              payload: {
                stashId: inventoryStashId,
                definitionId: 'phb-2024:torch',
                quantity: 1,
                source: 'catalog-add',
                newItemInstanceId: newUuidV7(),
              },
            },
          ],
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ applied: { type: string; sessionId: string | null }[] }>();
      expect(body.applied).toHaveLength(3);
      // Middleware reads PRE-reduce state.
      //   - start-game-session pre-state has no current session → null.
      //   - end-game-session pre-state has isCurrent=true → carries the id.
      //   - post-end acquire pre-state has isCurrent=false → null.
      expect(body.applied[0]!.type).toBe('start-game-session');
      expect(body.applied[0]!.sessionId).toBeNull();
      expect(body.applied[1]!.type).toBe('end-game-session');
      expect(body.applied[1]!.sessionId).toBe(newGameSessionId);
      expect(body.applied[2]!.type).toBe('acquire');
      expect(body.applied[2]!.sessionId).toBeNull();
    } finally {
      await app.close();
    }
  });
});
