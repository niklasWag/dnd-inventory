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
                ...createCharacterIds(), },
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
                ...createCharacterIds(), },
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
          ...createCharacterIds(), },
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
                ...createCharacterIds(), },
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
                ...createCharacterIds(), },
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
          { id: `c-${inventoryStashId}`, stashId: inventoryStashId, cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
          { id: `c-${partyStashId}`, stashId: partyStashId, cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
          { id: `c-${recoveredStashId}`, stashId: recoveredStashId, cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
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
