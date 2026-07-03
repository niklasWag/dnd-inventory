import { describe, expect, it } from 'vitest';

import { newUuidV7 } from '../ids';
import type { Action, AppState, Party, PartyMembership } from '../schemas';

import { deriveActorRole, deriveActorRoleForSlice, isMember, isSolo } from './actor';
import { checkGuard, guards } from './map';
import type { Actor, GuardResult } from './index';

/**
 * RH1.2 — helpers that stamp the required `new<EntityName>Id` fields
 * onto minting-action payloads with a fresh UUID v7 per call. Guards
 * don't care about the specific id value (only its shape + clock-skew
 * window), so a fresh mint per invocation is safe and keeps tests
 * hermetic. Callers that need to assert against the id can capture it
 * post-construction.
 */
const acquireIds = () => ({ newItemInstanceId: newUuidV7() });
const createStashIds = () => ({
  newStashId: newUuidV7(),
  newCurrencyHoldingId: newUuidV7(),
});
const transferIds = () => ({ newItemInstanceId: newUuidV7() });
const splitIds = () => ({ newItemInstanceId: newUuidV7() });
const createHomebrewIds = () => ({ newDefinitionId: newUuidV7() });
const createCharacterWithCharIds = () => ({
  newCharacterId: newUuidV7(),
  newInventoryStashId: newUuidV7(),
  newCurrencyHoldingId: newUuidV7(),
  newUserId: newUuidV7(),
  newPartyId: newUuidV7(),
  newPartyStashId: newUuidV7(),
  newRecoveredLootStashId: newUuidV7(),
  newPartyStashCurrencyId: newUuidV7(),
  newRecoveredLootCurrencyId: newUuidV7(),
});
const createCharacterDmOnlyIds = () => ({
  newUserId: newUuidV7(),
  newPartyId: newUuidV7(),
  newPartyStashId: newUuidV7(),
  newRecoveredLootStashId: newUuidV7(),
  newPartyStashCurrencyId: newUuidV7(),
  newRecoveredLootCurrencyId: newUuidV7(),
});

/**
 * R3.4.a — §8.1 guard layer test suite.
 *
 * Two passes per guard:
 *   - positive case: the action's expected actor + state combination
 *     returns `{ ok: true }`.
 *   - negative case: a forbidden combination returns
 *     `{ ok: false, code: '...' }`.
 *
 * The §8.2 solo-bypass is exercised once at the top of the suite (any
 * action by a solo actor passes `checkGuard`); per-guard tests below
 * exercise the guard directly via `guards[type]` to bypass the
 * solo-bypass short-circuit so the multi-member matrix is tested.
 */

function makeParty(id = 'p1', bankerUserId: string | null = null): Party {
  return {
    id,
    name: 'P',
    ownerUserId: 'dm-user',
    inviteCode: 'INV-XXXXXX',
    recoveredLootStashId: 'rl',
    bankerUserId,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeMembership(
  userId: string,
  role: 'dm' | 'player' = 'player',
  partyId = 'p1',
  leftAt: null = null,
): PartyMembership {
  return {
    userId,
    partyId,
    role,
    characterId: role === 'player' ? `char-${userId}` : null,
    joinedAt: '2026-01-01T00:00:00.000Z',
    leftAt,
  };
}

function makeActor(userId = 'u1', role: Actor['role'] = 'player', partyId = 'p1'): Actor {
  return { userId, partyId, role };
}

/** Minimal AppState with one character, one inventory stash, one item,
 * one currency. Used by guards that consult ownership. */
function makeState(opts?: { ownerUserId?: string; ownerCharacterId?: string }): AppState {
  const ownerUserId = opts?.ownerUserId ?? 'u1';
  const ownerCharacterId = opts?.ownerCharacterId ?? 'char-u1';
  return {
    version: 1,
    seedVersion: 0,
    user: {
      id: ownerUserId,
      discordId: ownerUserId,
      displayName: 'X',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    party: makeParty(),
    memberships: [makeMembership(ownerUserId, 'dm'), makeMembership(ownerUserId, 'player')],
    characters: [
      {
        id: ownerCharacterId,
        partyId: 'p1',
        ownerUserId,
        name: 'X',
        species: 'Human',
        size: 'medium',
        class: 'Fighter',
        level: 1,
        abilityScores: { STR: 16 },
        maxAttunement: 3,
        encumbranceRule: 'off',
        enforceEncumbrance: false,
        inventoryStashId: 'inv',
      },
    ],
    gameSessions: [],
    stashes: [
      {
        id: 'inv',
        scope: 'character',
        name: 'Inventory',
        ownerCharacterId,
        partyId: null,
        isCarried: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'ps',
        scope: 'party',
        name: 'Party Stash',
        ownerCharacterId: null,
        partyId: 'p1',
        isCarried: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'rl',
        scope: 'recovered-loot',
        name: 'Recovered Loot',
        ownerCharacterId: null,
        partyId: 'p1',
        isCarried: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    catalog: [],
    items: [
      {
        id: 'i1',
        definitionId: 'phb-2024:rope',
        ownerType: 'stash',
        ownerId: 'inv',
        containerInstanceId: null,
        quantity: 1,
        equipped: false,
        attuned: false,
        identified: true,
        currentCharges: null,
      },
    ],
    currencies: [
      { id: 'c1', stashId: 'inv', cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
      { id: 'c2', stashId: 'ps', cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
      { id: 'c3', stashId: 'rl', cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    ],
    log: [],
  };
}

// -------------------- actor helpers --------------------

describe('actor helpers', () => {
  it('deriveActorRole returns banker iff bankerUserId === membership.userId', () => {
    const party = makeParty('p1', null);
    const m = makeMembership('u1', 'player');
    expect(deriveActorRole(party, m)).toBe('player');

    // Banker set to this membership's user — banker role wins over the
    // membership's `player` role. R4.2.a widened `Party.bankerUserId` to
    // `string | null`, so no cast is needed.
    const bankerParty = { ...party, bankerUserId: 'u1' };
    expect(deriveActorRole(bankerParty, m)).toBe('banker');

    // Banker on a different user: membership role wins.
    const otherBankerParty = { ...party, bankerUserId: 'someone-else' };
    expect(deriveActorRole(otherBankerParty, m)).toBe('player');
  });

  it('isSolo returns true when one unique active member', () => {
    expect(isSolo([makeMembership('u1', 'dm'), makeMembership('u1', 'player')])).toBe(true);
    expect(
      isSolo([
        makeMembership('u1', 'dm'),
        makeMembership('u1', 'player'),
        makeMembership('u2', 'player'),
      ]),
    ).toBe(false);
    expect(isSolo([])).toBe(false);
  });

  it("isMember requires an active membership in the actor's party", () => {
    const memberships = [makeMembership('u1', 'dm'), makeMembership('u1', 'player')];
    expect(isMember(makeActor('u1'), memberships)).toBe(true);
    expect(isMember(makeActor('u2'), memberships)).toBe(false);
    expect(isMember(makeActor('u1', 'player', 'other-party'), memberships)).toBe(false);
  });
});

// -------------------- RH2.1a: deriveActorRoleForSlice --------------------

/**
 * RH2.1a — action-aware `actorRole` derivation shared by the web store
 * dispatcher and the server log builder. Consolidates the per-action-type
 * table previously inlined in `apps/web/src/store/index.ts::resolveActor`.
 *
 * The three role classes:
 *   - `'dm'` — DM-authored actions (§8.1 DM-only rows) + bootstrap
 *              `create-character` (no banker exists yet) + `seed-catalog`
 *              (system-driven; DM by convention per §3.7).
 *   - `'banker'` — Banker-only actions (`split-evenly`) + player-driven
 *                  actions where the actor IS the party's banker per §3.14.
 *   - `'player'` — everything else, when the actor is not the banker.
 *
 * The reducer + guards already reject wrong-role dispatches upstream of
 * log-composition, so in practice the DM-only / Banker-only branches
 * below are just recording the correct hat rather than defensively
 * overriding it. The shared function encodes the intent so web + server
 * cannot drift.
 */
describe('deriveActorRoleForSlice — RH2.1a', () => {
  // Every action.type from the schema, mapped to its expected role class.
  // "player-or-banker" means: banker iff state.party.bankerUserId ===
  // state.user.id, else player.
  const alwaysDm = [
    'seed-catalog',
    'identify',
    'kick-player',
    'appoint-banker',
    'revoke-banker',
    'dm-transfer',
  ] as const;
  const alwaysBanker = ['split-evenly'] as const;
  const playerOrBanker = [
    'acquire',
    'consume',
    'edit-item-instance',
    'transfer',
    'split',
    'create-stash',
    'rename-stash',
    'delete-stash',
    'currency-change',
    'currency-transfer',
    'create-homebrew',
    'edit-homebrew',
    'delete-homebrew',
    'rename-character',
    'rename-party',
    'set-encumbrance',
    'equip',
    'unequip',
    'attune',
    'unattune',
    'use-charge',
    'recharge',
    'edit-character',
    'delete-character',
    'leave-party',
    'join-party',
  ] as const;

  // A minimal slice for a given type. The shared function only reads the
  // discriminant; payload shape doesn't matter beyond parseability of
  // `create-character` (which needs userId/partyId on the payload).
  function slice(type: string, payload: Record<string, unknown> = {}) {
    return { type, payload } as unknown as Parameters<typeof deriveActorRoleForSlice>[1];
  }

  it('bootstrap create-character (state=null) → dm; reads actorUserId from slice payload', () => {
    const bootstrapSlice = slice('create-character', {
      userId: 'u1',
      partyId: 'p1',
      partyStashId: 'ps',
      recoveredLootStashId: 'rl',
    });
    expect(deriveActorRoleForSlice(null, bootstrapSlice)).toBe('dm');
  });

  it('server-synthesised join-party (state=null) → player', () => {
    // The `POST /parties/join` route synthesises a join-party slice
    // BEFORE the user has an AppState (they can't yet load one — they
    // just became a member). A brand-new joiner cannot be the banker
    // per §3.14, so 'player' is always correct with null state.
    expect(deriveActorRoleForSlice(null, slice('join-party'))).toBe('player');
  });

  it.each(alwaysDm)('%s → dm regardless of banker state', (type) => {
    const state = makeState();
    expect(deriveActorRoleForSlice(state, slice(type))).toBe('dm');

    // Even when the actor is the banker, DM-only actions log as 'dm'.
    // §3.14 forbids DM === banker, so this branch is defensive.
    const bankerState = {
      ...state,
      party: { ...state.party, bankerUserId: state.user.id },
    };
    expect(deriveActorRoleForSlice(bankerState, slice(type))).toBe('dm');
  });

  it.each(alwaysBanker)('%s → banker regardless of banker state on party', (type) => {
    // split-evenly is Banker-only per §8.1; guards reject non-banker
    // actors upstream so by the time the log is composed the actor is
    // the banker. The shared function doesn't re-check — it stamps
    // 'banker' unconditionally.
    const state = makeState();
    expect(deriveActorRoleForSlice(state, slice(type))).toBe('banker');
  });

  it.each(playerOrBanker)('%s → player when actor is not the banker', (type) => {
    const state = makeState();
    expect(state.party.bankerUserId).toBeNull();
    expect(deriveActorRoleForSlice(state, slice(type))).toBe('player');
  });

  it.each(playerOrBanker)('%s → banker when actor IS the party banker', (type) => {
    const state = makeState();
    const bankerState = {
      ...state,
      party: { ...state.party, bankerUserId: state.user.id },
    };
    expect(deriveActorRoleForSlice(bankerState, slice(type))).toBe('banker');
  });

  it.each(playerOrBanker)('%s → player when party has a different banker', (type) => {
    const state = makeState();
    const otherBankerState = {
      ...state,
      party: { ...state.party, bankerUserId: 'some-other-user' },
    };
    expect(deriveActorRoleForSlice(otherBankerState, slice(type))).toBe('player');
  });

  it('post-bootstrap create-character (state!==null) is treated as player-or-banker', () => {
    // The post-bootstrap create-character variant (a joiner or DM-only
    // DM minting their character) runs against a populated state. The
    // actor is a player (freshly-joined member), never the DM by
    // definition of that flow. Stamp 'player' — or 'banker' if that
    // player happens to be the party's banker (edge case, tested).
    const state = makeState();
    const postBootstrap = slice('create-character', {
      userId: state.user.id,
      partyId: state.party.id,
      partyStashId: 'ps',
      recoveredLootStashId: 'rl',
      characterId: 'c1',
      name: 'X',
      inventoryStashId: 'inv',
    });
    expect(deriveActorRoleForSlice(state, postBootstrap)).toBe('player');

    const bankerState = {
      ...state,
      party: { ...state.party, bankerUserId: state.user.id },
    };
    expect(deriveActorRoleForSlice(bankerState, postBootstrap)).toBe('banker');
  });

  it('throws for a non-bootstrap slice when state is null', () => {
    // Every other slice type requires state to derive actor identity —
    // matches the web store's current invariants (line 87 / 100 / 165 /
    // 179 / 196 / 208 all throw in this shape).
    expect(() => deriveActorRoleForSlice(null, slice('acquire'))).toThrow(
      /requires populated AppState/,
    );
  });
});

// -------------------- §8.2 solo bypass --------------------

describe('checkGuard — §8.2 solo bypass', () => {
  it('bypasses the matrix for a solo party (one unique active member)', () => {
    const state = makeState();
    const actor = makeActor('u1', 'player');
    const soloMemberships = [makeMembership('u1', 'dm'), makeMembership('u1', 'player')];
    // create-homebrew is DM-only in 2+-member parties; solo bypass
    // returns ok for a player actor.
    const action: Action = {
      type: 'create-homebrew',
      payload: { name: 'X', category: 'magic', ...createHomebrewIds() },
    };
    expect(checkGuard(state, action, actor, soloMemberships)).toEqual({ ok: true });
  });

  it('rejects with not_a_member when actor is not in the party', () => {
    const state = makeState();
    const memberships = [makeMembership('u1', 'dm'), makeMembership('u1', 'player')];
    const otherActor = makeActor('intruder', 'player');
    const action: Action = {
      type: 'acquire',
      payload: {
        stashId: 'inv',
        definitionId: 'phb-2024:rope',
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    };
    const result = checkGuard(state, action, otherActor, memberships);
    expect(result).toMatchObject({ ok: false, code: 'not_a_member' });
    expect((result as { ok: false; message: string }).message).toEqual(expect.any(String));
  });

  it('skips membership check when state is null (bootstrap create-character)', () => {
    const action: Action = {
      type: 'create-character',
      payload: {
        name: 'X',
        species: 'Human',
        size: 'medium',
        class: 'Fighter',
        level: 1,
        str: 16,
        ...createCharacterWithCharIds(),
      },
    };
    // No memberships exist yet because state is null; the guard is the
    // structural check (state must BE null) — and there are no party
    // memberships to check actor membership against.
    expect(checkGuard(null, action, makeActor(), [])).toEqual({ ok: true });
  });
});

// -------------------- per-guard positive + negative --------------------

const TWO_MEMBERS: readonly PartyMembership[] = [
  makeMembership('u1', 'dm'),
  makeMembership('u1', 'player'),
  makeMembership('u2', 'player'),
];

/** A two-member party with a separate DM user (rather than u1 wearing
 * both hats). Used by tests that exercise DM-only actions with a
 * dedicated DM actor. */
const TWO_MEMBERS_WITH_DEDICATED_DM: readonly PartyMembership[] = [
  makeMembership('dm-user', 'dm'),
  makeMembership('u1', 'player'),
  makeMembership('u2', 'player'),
];

function runGuard(
  action: Action,
  actor: Actor,
  state: AppState = makeState(),
  memberships: readonly PartyMembership[] = TWO_MEMBERS,
): GuardResult {
  return checkGuard(state, action, actor, memberships);
}

describe('guards — DM-only actions', () => {
  it('create-homebrew rejects a player', () => {
    expect(
      runGuard(
        {
          type: 'create-homebrew',
          payload: { name: 'X', category: 'magic', ...createHomebrewIds() },
        },
        makeActor('u1', 'player'),
      ),
    ).toMatchObject({ ok: false, code: 'dm_only' });
  });
  it('create-homebrew accepts a DM', () => {
    expect(
      runGuard(
        {
          type: 'create-homebrew',
          payload: { name: 'X', category: 'magic', ...createHomebrewIds() },
        },
        makeActor('u1', 'dm'),
      ),
    ).toEqual({ ok: true });
  });
  it('edit-homebrew rejects a player', () => {
    expect(
      runGuard(
        { type: 'edit-homebrew', payload: { definitionId: 'd', patch: { name: 'X' } } },
        makeActor('u1', 'player'),
      ),
    ).toMatchObject({ ok: false, code: 'dm_only' });
  });
  it('delete-homebrew rejects a player', () => {
    expect(
      runGuard(
        { type: 'delete-homebrew', payload: { definitionId: 'd' } },
        makeActor('u1', 'player'),
      ),
    ).toMatchObject({ ok: false, code: 'dm_only' });
  });
  it('identify rejects a player', () => {
    expect(
      runGuard(
        { type: 'identify', payload: { itemInstanceId: 'i1', identified: true } },
        makeActor('u1', 'player'),
      ),
    ).toMatchObject({ ok: false, code: 'dm_only' });
  });
  it('rename-party rejects a player', () => {
    expect(
      runGuard(
        { type: 'rename-party', payload: { partyId: 'p1', newName: 'X' } },
        makeActor('u1', 'player'),
      ),
    ).toMatchObject({ ok: false, code: 'dm_only' });
  });
  it('set-encumbrance rejects a player', () => {
    expect(
      runGuard(
        {
          type: 'set-encumbrance',
          payload: { characterId: 'char-u1', rule: 'phb', enforce: true },
        },
        makeActor('u1', 'player'),
      ),
    ).toMatchObject({ ok: false, code: 'dm_only' });
  });
  it('seed-catalog rejects a player', () => {
    expect(
      runGuard(
        { type: 'seed-catalog', payload: { seedVersion: 1, entries: [] } },
        makeActor('u1', 'player'),
      ),
    ).toMatchObject({ ok: false, code: 'dm_only' });
  });
});

describe('guards — ownership checks', () => {
  const state = makeState({ ownerUserId: 'u1', ownerCharacterId: 'char-u1' });

  it('acquire rejects when stash is owned by another character', () => {
    expect(
      runGuard(
        {
          type: 'acquire',
          payload: {
            stashId: 'inv',
            definitionId: 'phb-2024:rope',
            quantity: 1,
            source: 'catalog-add',
            ...acquireIds(),
          },
        },
        makeActor('u2', 'player'),
        state,
      ),
    ).toMatchObject({ ok: false, code: 'not_own_stash' });
  });
  it('acquire accepts owner', () => {
    expect(
      runGuard(
        {
          type: 'acquire',
          payload: {
            stashId: 'inv',
            definitionId: 'phb-2024:rope',
            quantity: 1,
            source: 'catalog-add',
            ...acquireIds(),
          },
        },
        makeActor('u1', 'player'),
        state,
      ),
    ).toEqual({ ok: true });
  });
  it('acquire to a party stash is ok for any member', () => {
    expect(
      runGuard(
        {
          type: 'acquire',
          payload: {
            stashId: 'ps',
            definitionId: 'phb-2024:rope',
            quantity: 1,
            source: 'catalog-add',
            ...acquireIds(),
          },
        },
        makeActor('u2', 'player'),
        state,
      ),
    ).toEqual({ ok: true });
  });

  it('equip rejects when item is not in inventory', () => {
    // Put item in party stash, equip should fail with equip_only_in_inventory.
    const s = makeState();
    if (s) s.items[0] = { ...s.items[0]!, ownerId: 'ps' };
    expect(
      runGuard(
        { type: 'equip', payload: { itemInstanceId: 'i1', characterId: 'char-u1' } },
        makeActor('u1', 'player'),
        s,
      ),
    ).toMatchObject({ ok: false, code: 'equip_only_in_inventory' });
  });
  it('equip rejects when character is owned by another user', () => {
    expect(
      runGuard(
        { type: 'equip', payload: { itemInstanceId: 'i1', characterId: 'char-u1' } },
        makeActor('u2', 'player'),
        state,
      ),
    ).toMatchObject({ ok: false, code: 'not_own_character' });
  });
  it('equip accepts owner with item in inventory', () => {
    expect(
      runGuard(
        { type: 'equip', payload: { itemInstanceId: 'i1', characterId: 'char-u1' } },
        makeActor('u1', 'player'),
        state,
      ),
    ).toEqual({ ok: true });
  });

  it('attune rejects when item is not in inventory', () => {
    const s = makeState();
    if (s) s.items[0] = { ...s.items[0]!, ownerId: 'ps' };
    expect(
      runGuard(
        { type: 'attune', payload: { itemInstanceId: 'i1', characterId: 'char-u1' } },
        makeActor('u1', 'player'),
        s,
      ),
    ).toMatchObject({ ok: false, code: 'attune_only_in_inventory' });
  });

  it('use-charge rejects when item not found', () => {
    expect(
      runGuard(
        { type: 'use-charge', payload: { itemInstanceId: 'missing', characterId: 'char-u1' } },
        makeActor('u1', 'player'),
        state,
      ),
    ).toMatchObject({ ok: false, code: 'item_not_found' });
  });

  it("rename-character rejects another player's character", () => {
    expect(
      runGuard(
        { type: 'rename-character', payload: { characterId: 'char-u1', newName: 'New' } },
        makeActor('u2', 'player'),
        state,
      ),
    ).toMatchObject({ ok: false, code: 'not_own_character' });
  });
  it('rename-character accepts owner', () => {
    expect(
      runGuard(
        { type: 'rename-character', payload: { characterId: 'char-u1', newName: 'New' } },
        makeActor('u1', 'player'),
        state,
      ),
    ).toEqual({ ok: true });
  });

  it("create-stash rejects another player's character", () => {
    expect(
      runGuard(
        {
          type: 'create-stash',
          payload: { ownerCharacterId: 'char-u1', name: 'Backpack', ...createStashIds() },
        },
        makeActor('u2', 'player'),
        state,
      ),
    ).toMatchObject({ ok: false, code: 'not_own_character' });
  });

  it('edit-character allows owner to change non-maxAttunement fields', () => {
    expect(
      runGuard(
        { type: 'edit-character', payload: { characterId: 'char-u1', patch: { level: 5 } } },
        makeActor('u1', 'player'),
        state,
      ),
    ).toEqual({ ok: true });
  });
  it('edit-character rejects player setting maxAttunement', () => {
    expect(
      runGuard(
        {
          type: 'edit-character',
          payload: { characterId: 'char-u1', patch: { maxAttunement: 4 } },
        },
        makeActor('u1', 'player'),
        state,
      ),
    ).toMatchObject({ ok: false, code: 'dm_only' });
  });
  it('edit-character allows DM to set maxAttunement on anyone', () => {
    expect(
      runGuard(
        {
          type: 'edit-character',
          payload: { characterId: 'char-u1', patch: { maxAttunement: 4 } },
        },
        makeActor('dm-user', 'dm'),
        state,
        TWO_MEMBERS_WITH_DEDICATED_DM,
      ),
    ).toEqual({ ok: true });
  });

  it('delete-character allows the owning player', () => {
    expect(
      runGuard(
        { type: 'delete-character', payload: { characterId: 'char-u1' } },
        makeActor('u1', 'player'),
        state,
        TWO_MEMBERS_WITH_DEDICATED_DM,
      ),
    ).toEqual({ ok: true });
  });

  it("delete-character rejects another player attempting to delete someone else's character", () => {
    expect(
      runGuard(
        { type: 'delete-character', payload: { characterId: 'char-u1' } },
        makeActor('u2', 'player'),
        state,
        TWO_MEMBERS_WITH_DEDICATED_DM,
      ),
    ).toMatchObject({ ok: false, code: 'not_own_character' });
  });

  it('delete-character allows the DM to delete any character', () => {
    expect(
      runGuard(
        { type: 'delete-character', payload: { characterId: 'char-u1' } },
        makeActor('dm-user', 'dm'),
        state,
        TWO_MEMBERS_WITH_DEDICATED_DM,
      ),
    ).toEqual({ ok: true });
  });

  it('delete-character rejects unknown characterId with character_not_found', () => {
    expect(
      runGuard(
        { type: 'delete-character', payload: { characterId: 'no-such-char' } },
        makeActor('u1', 'player'),
        state,
        TWO_MEMBERS_WITH_DEDICATED_DM,
      ),
    ).toMatchObject({ ok: false, code: 'character_not_found' });
  });

  it('leave-party allows an active member', () => {
    expect(
      runGuard(
        { type: 'leave-party', payload: {} },
        makeActor('u1', 'player'),
        state,
        TWO_MEMBERS_WITH_DEDICATED_DM,
      ),
    ).toEqual({ ok: true });
  });

  it('leave-party rejects an actor with no active membership in this party', () => {
    expect(
      runGuard(
        { type: 'leave-party', payload: {} },
        makeActor('stranger', 'player'),
        state,
        TWO_MEMBERS_WITH_DEDICATED_DM,
      ),
    ).toMatchObject({ ok: false, code: 'not_a_member' });
  });

  it('kick-player rejects non-DM actor', () => {
    // The dedicated-DM state still has u1 + u1 memberships baked in
    // (makeState defaults), which is enough for the role-only check —
    // the guard short-circuits on actor.role !== 'dm' before looking at
    // memberships.
    expect(
      runGuard(
        { type: 'kick-player', payload: { kickedUserId: 'u2' } },
        makeActor('u1', 'player'),
        state,
        TWO_MEMBERS_WITH_DEDICATED_DM,
      ),
    ).toMatchObject({ ok: false, code: 'dm_only' });
  });

  it('kick-player allows DM to kick an active member', () => {
    // Need state.memberships to contain the kicked user. Build a state
    // whose memberships array matches the 3-row TWO_MEMBERS_WITH_DEDICATED_DM
    // fixture so the guard's `state.memberships.some(...)` finds u2.
    const richState: AppState = {
      ...makeState(),
      memberships: [...TWO_MEMBERS_WITH_DEDICATED_DM],
    };
    expect(
      runGuard(
        { type: 'kick-player', payload: { kickedUserId: 'u2' } },
        makeActor('dm-user', 'dm', 'p1'),
        richState,
        TWO_MEMBERS_WITH_DEDICATED_DM,
      ),
    ).toEqual({ ok: true });
  });

  it('kick-player rejects when target is not an active member of this party', () => {
    const richState: AppState = {
      ...makeState(),
      memberships: [...TWO_MEMBERS_WITH_DEDICATED_DM],
    };
    expect(
      runGuard(
        { type: 'kick-player', payload: { kickedUserId: 'no-such-user' } },
        makeActor('dm-user', 'dm', 'p1'),
        richState,
        TWO_MEMBERS_WITH_DEDICATED_DM,
      ),
    ).toMatchObject({ ok: false, code: 'not_a_member' });
  });
});

// -------------------- R4.2.c — Banker-mediated shared-pool gate --------------------

/** Full CurrencyDelta helper — the payload schema requires all five
 * denominations. Callers pass a partial and get zeros for the rest. */
function delta(partial: Partial<{ cp: number; sp: number; ep: number; gp: number; pp: number }>): {
  cp: number;
  sp: number;
  ep: number;
  gp: number;
  pp: number;
} {
  return {
    cp: partial.cp ?? 0,
    sp: partial.sp ?? 0,
    ep: partial.ep ?? 0,
    gp: partial.gp ?? 0,
    pp: partial.pp ?? 0,
  };
}

/**
 * R4.2.c — when `party.bankerUserId !== null`, any action whose SOURCE
 * stash is a party-scope or recovered-loot-scope stash must be driven
 * by the Banker. Non-Banker actors (including the DM) get
 * `banker_required_for_claim`. When `bankerUserId === null`, behaviour
 * is unchanged from R3.4.a — players/DM self-claim freely.
 *
 * Applies to:
 *   - `currency-change` with `reason ∈ {'withdraw','convert'}` and
 *     `stashId` = shared pool. `reason: 'deposit'` is un-gated (adds
 *     value INTO the pool, not out of it — §8.1 deposit row).
 *   - `currency-transfer` with `fromStashId` = shared pool.
 *   - `transfer` with `item.ownerId` = shared pool.
 *
 * Not gated in this slice: `split` (in-place stack reshape; no value
 * leaves the pool) — reflected below with an explicit positive test.
 * The DM "gameplay drain" bypass lands in R4.2.d.
 */

/** Two-member party fixture where u1 is the DM, u2 is a player, u3 is a
 * player-Banker. Mirrors the shape expected by the R4.2.a+b banker
 * derivation path. */
const BANKER_MEMBERS: readonly PartyMembership[] = [
  makeMembership('dm-user', 'dm'),
  makeMembership('u2', 'player'),
  makeMembership('banker-user', 'player'),
];

/** State with `party.bankerUserId = 'banker-user'` and a Party Stash +
 * Recovered Loot + one item in each. Two characters (one per player)
 * so the ownership helpers behave. */
function makeBankerState(bankerUserId: string | null = 'banker-user'): AppState {
  const base = makeState({ ownerUserId: 'u2', ownerCharacterId: 'char-u2' });
  return {
    ...base,
    party: makeParty('p1', bankerUserId),
    memberships: [...BANKER_MEMBERS],
    characters: [
      { ...base.characters[0]! },
      {
        ...base.characters[0]!,
        id: 'char-banker-user',
        ownerUserId: 'banker-user',
        inventoryStashId: 'inv-b',
      },
    ],
    stashes: [
      ...base.stashes,
      {
        id: 'inv-b',
        scope: 'character',
        name: 'Banker Inventory',
        ownerCharacterId: 'char-banker-user',
        partyId: null,
        isCarried: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    items: [
      ...base.items,
      {
        id: 'i-ps',
        definitionId: 'phb-2024:rope',
        ownerType: 'stash',
        ownerId: 'ps',
        containerInstanceId: null,
        quantity: 1,
        equipped: false,
        attuned: false,
        identified: true,
        currentCharges: null,
      },
      {
        id: 'i-rl',
        definitionId: 'phb-2024:rope',
        ownerType: 'stash',
        ownerId: 'rl',
        containerInstanceId: null,
        quantity: 1,
        equipped: false,
        attuned: false,
        identified: true,
        currentCharges: null,
      },
    ],
    currencies: [
      ...base.currencies,
      { id: 'c-invb', stashId: 'inv-b', cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    ],
  };
}

describe('guards — R4.2.c Banker-mediated shared-pool gate', () => {
  // -------------------- currency-change --------------------

  describe('currency-change', () => {
    it('rejects a player withdrawing from Party Stash when Banker active', () => {
      const state = makeBankerState();
      const result = guards['currency-change'](
        state,
        { stashId: 'ps', delta: delta({ gp: -1 }), reason: 'withdraw' },
        makeActor('u2', 'player'),
      );
      expect(result).toMatchObject({ ok: false, code: 'banker_required_for_claim' });
    });

    it('rejects the DM withdrawing from Party Stash when Banker active', () => {
      const state = makeBankerState();
      const result = guards['currency-change'](
        state,
        { stashId: 'ps', delta: delta({ gp: -1 }), reason: 'withdraw' },
        makeActor('dm-user', 'dm'),
      );
      expect(result).toMatchObject({ ok: false, code: 'banker_required_for_claim' });
    });

    it('rejects a player withdrawing from Recovered Loot when Banker active', () => {
      const state = makeBankerState();
      const result = guards['currency-change'](
        state,
        { stashId: 'rl', delta: delta({ gp: -1 }), reason: 'withdraw' },
        makeActor('u2', 'player'),
      );
      expect(result).toMatchObject({ ok: false, code: 'banker_required_for_claim' });
    });

    it('rejects a player converting Party Stash currency when Banker active', () => {
      const state = makeBankerState();
      const result = guards['currency-change'](
        state,
        { stashId: 'ps', delta: delta({ gp: -1, sp: 10 }), reason: 'convert' },
        makeActor('u2', 'player'),
      );
      expect(result).toMatchObject({ ok: false, code: 'banker_required_for_claim' });
    });

    it('accepts the Banker withdrawing from Party Stash', () => {
      const state = makeBankerState();
      const result = guards['currency-change'](
        state,
        { stashId: 'ps', delta: delta({ gp: -1 }), reason: 'withdraw' },
        makeActor('banker-user', 'banker'),
      );
      expect(result).toEqual({ ok: true });
    });

    it('accepts the Banker withdrawing from Recovered Loot', () => {
      const state = makeBankerState();
      const result = guards['currency-change'](
        state,
        { stashId: 'rl', delta: delta({ gp: -1 }), reason: 'withdraw' },
        makeActor('banker-user', 'banker'),
      );
      expect(result).toEqual({ ok: true });
    });

    it('accepts a player DEPOSITING into Party Stash when Banker active (deposit is un-gated)', () => {
      const state = makeBankerState();
      const result = guards['currency-change'](
        state,
        { stashId: 'ps', delta: delta({ gp: 1 }), reason: 'deposit' },
        makeActor('u2', 'player'),
      );
      expect(result).toEqual({ ok: true });
    });

    it('accepts a player DEPOSITING into Recovered Loot when Banker active (deposit is un-gated)', () => {
      const state = makeBankerState();
      const result = guards['currency-change'](
        state,
        { stashId: 'rl', delta: delta({ gp: 1 }), reason: 'deposit' },
        makeActor('u2', 'player'),
      );
      expect(result).toEqual({ ok: true });
    });

    it('accepts a player withdrawing from Party Stash when NO Banker is active', () => {
      const state = makeBankerState(null);
      const result = guards['currency-change'](
        state,
        { stashId: 'ps', delta: delta({ gp: -1 }), reason: 'withdraw' },
        makeActor('u2', 'player'),
      );
      expect(result).toEqual({ ok: true });
    });

    it('accepts a player editing their own Inventory currency even when Banker active', () => {
      const state = makeBankerState();
      const result = guards['currency-change'](
        state,
        { stashId: 'inv', delta: delta({ gp: -1 }), reason: 'withdraw' },
        makeActor('u2', 'player'),
      );
      expect(result).toEqual({ ok: true });
    });
  });

  // -------------------- currency-transfer --------------------

  describe('currency-transfer', () => {
    it('rejects a player moving currency FROM Party Stash when Banker active', () => {
      const state = makeBankerState();
      const result = guards['currency-transfer'](
        state,
        { fromStashId: 'ps', toStashId: 'inv', delta: delta({ gp: 1 }) },
        makeActor('u2', 'player'),
      );
      expect(result).toMatchObject({ ok: false, code: 'banker_required_for_claim' });
    });

    it('rejects a player moving currency FROM Recovered Loot when Banker active', () => {
      const state = makeBankerState();
      const result = guards['currency-transfer'](
        state,
        { fromStashId: 'rl', toStashId: 'inv', delta: delta({ gp: 1 }) },
        makeActor('u2', 'player'),
      );
      expect(result).toMatchObject({ ok: false, code: 'banker_required_for_claim' });
    });

    it('accepts the Banker moving currency FROM Party Stash to a player', () => {
      const state = makeBankerState();
      const result = guards['currency-transfer'](
        state,
        { fromStashId: 'ps', toStashId: 'inv', delta: delta({ gp: 1 }) },
        makeActor('banker-user', 'banker'),
      );
      expect(result).toEqual({ ok: true });
    });

    it('accepts a player moving currency FROM their own Inventory even when Banker active (destination is shared pool = deposit)', () => {
      const state = makeBankerState();
      const result = guards['currency-transfer'](
        state,
        { fromStashId: 'inv', toStashId: 'ps', delta: delta({ gp: 1 }) },
        makeActor('u2', 'player'),
      );
      expect(result).toEqual({ ok: true });
    });

    it('accepts a player moving currency FROM Party Stash when NO Banker is active', () => {
      const state = makeBankerState(null);
      const result = guards['currency-transfer'](
        state,
        { fromStashId: 'ps', toStashId: 'inv', delta: delta({ gp: 1 }) },
        makeActor('u2', 'player'),
      );
      expect(result).toEqual({ ok: true });
    });

    // -------------------- R4.4.a: cross-character currency-transfer --------------------

    it('R4.4.a — accepts player→player push even when Banker is active (§3.14 amendment)', () => {
      // Player u2 pushes 1gp from their own Inventory to another player's
      // Inventory (banker-user's). Banker mediates SHARED POOLS, not
      // character-to-character moves — this must always be allowed.
      const state = makeBankerState();
      const result = guards['currency-transfer'](
        state,
        { fromStashId: 'inv', toStashId: 'inv-b', delta: delta({ gp: 1 }) },
        makeActor('u2', 'player'),
      );
      expect(result).toEqual({ ok: true });
    });

    it('R4.4.a — accepts player→player push when no Banker is active', () => {
      const state = makeBankerState(null);
      const result = guards['currency-transfer'](
        state,
        { fromStashId: 'inv', toStashId: 'inv-b', delta: delta({ gp: 1 }) },
        makeActor('u2', 'player'),
      );
      expect(result).toEqual({ ok: true });
    });

    it('R4.4.a — rejects DM distributing from Party Stash to a player while Banker active (§8.1)', () => {
      // With a Banker active, the DM cannot distribute from shared pools
      // to specific players — that's the Banker's role. DM must revoke
      // the Banker first if they want to distribute.
      const state = makeBankerState();
      const result = guards['currency-transfer'](
        state,
        { fromStashId: 'ps', toStashId: 'inv', delta: delta({ gp: 1 }) },
        makeActor('dm-user', 'dm'),
      );
      expect(result).toMatchObject({ ok: false, code: 'banker_required_for_claim' });
    });

    it('R4.4.a — rejects DM distributing from Recovered Loot while Banker active (§8.1)', () => {
      const state = makeBankerState();
      const result = guards['currency-transfer'](
        state,
        { fromStashId: 'rl', toStashId: 'inv', delta: delta({ gp: 1 }) },
        makeActor('dm-user', 'dm'),
      );
      expect(result).toMatchObject({ ok: false, code: 'banker_required_for_claim' });
    });

    it('R4.4.a — accepts DM distributing from Party Stash to a player when no Banker (§3.14)', () => {
      const state = makeBankerState(null);
      const result = guards['currency-transfer'](
        state,
        { fromStashId: 'ps', toStashId: 'inv', delta: delta({ gp: 1 }) },
        makeActor('dm-user', 'dm'),
      );
      expect(result).toEqual({ ok: true });
    });

    it('R4.4.a — accepts a player self-claim from Recovered Loot when no Banker is active', () => {
      // Symmetric coverage: the existing test at line 867 covers Party
      // Stash; this locks in the same rule for Recovered Loot per §3.14.
      const state = makeBankerState(null);
      const result = guards['currency-transfer'](
        state,
        { fromStashId: 'rl', toStashId: 'inv', delta: delta({ gp: 1 }) },
        makeActor('u2', 'player'),
      );
      expect(result).toEqual({ ok: true });
    });
  });

  // -------------------- transfer (item) --------------------

  describe('transfer', () => {
    it('rejects a player transferring an item OUT of Party Stash when Banker active', () => {
      const state = makeBankerState();
      const result = guards['transfer'](
        state,
        { itemInstanceId: 'i-ps', toStashId: 'inv', quantity: 1, ...transferIds() },
        makeActor('u2', 'player'),
      );
      expect(result).toMatchObject({ ok: false, code: 'banker_required_for_claim' });
    });

    it('rejects a player transferring an item OUT of Recovered Loot when Banker active', () => {
      const state = makeBankerState();
      const result = guards['transfer'](
        state,
        { itemInstanceId: 'i-rl', toStashId: 'inv', quantity: 1, ...transferIds() },
        makeActor('u2', 'player'),
      );
      expect(result).toMatchObject({ ok: false, code: 'banker_required_for_claim' });
    });

    it('accepts the Banker transferring an item OUT of Party Stash', () => {
      const state = makeBankerState();
      const result = guards['transfer'](
        state,
        { itemInstanceId: 'i-ps', toStashId: 'inv', quantity: 1, ...transferIds() },
        makeActor('banker-user', 'banker'),
      );
      expect(result).toEqual({ ok: true });
    });

    it('accepts a player depositing (transferring INTO Party Stash) when Banker active — source is their own Inventory', () => {
      const state = makeBankerState();
      const result = guards['transfer'](
        state,
        { itemInstanceId: 'i1', toStashId: 'ps', quantity: 1, ...transferIds() },
        makeActor('u2', 'player'),
      );
      expect(result).toEqual({ ok: true });
    });

    it('accepts a player transferring OUT of Party Stash when NO Banker is active', () => {
      const state = makeBankerState(null);
      const result = guards['transfer'](
        state,
        { itemInstanceId: 'i-ps', toStashId: 'inv', quantity: 1, ...transferIds() },
        makeActor('u2', 'player'),
      );
      expect(result).toEqual({ ok: true });
    });
  });

  // -------------------- split (NOT gated in R4.2.c) --------------------

  describe('split (not gated)', () => {
    it('allows a player to split a stack in Party Stash even when Banker active (split does not move value out)', () => {
      const state = makeBankerState();
      const result = guards['split'](
        state,
        { itemInstanceId: 'i-ps', quantity: 1, ...splitIds() },
        makeActor('u2', 'player'),
      );
      expect(result).toEqual({ ok: true });
    });
  });

  // -------------------- §8.2 solo bypass still applies --------------------

  it('§8.2 solo bypass overrides the Banker gate — solo party allows any of these', () => {
    const state = makeBankerState();
    const soloMemberships = [makeMembership('u1', 'dm'), makeMembership('u1', 'player')];
    const action: Action = {
      type: 'currency-change',
      payload: { stashId: 'ps', delta: delta({ gp: -1 }), reason: 'withdraw' },
    };
    expect(checkGuard(state, action, makeActor('u1', 'player'), soloMemberships)).toEqual({
      ok: true,
    });
  });
});

// -------------------- R4.2.d — DM gameplay-drain bypass + split-evenly --------------------

/**
 * R4.2.d — DM `gameplay-drain` bypasses the R4.2.c Banker gate. Any
 * non-DM using `gameplay-drain` is rejected outright — the reason is
 * DM-only regardless of Banker state.
 *
 * R4.2.d also adds the `split-evenly` action: Banker-only, source must
 * be Party Stash, non-empty recipient list, every recipient must be an
 * active player's character in this party.
 */

describe('guards — R4.2.d DM gameplay-drain bypass', () => {
  it('allows the DM to `gameplay-drain` Party Stash currency when Banker active', () => {
    const state = makeBankerState();
    const result = guards['currency-change'](
      state,
      { stashId: 'ps', delta: delta({ gp: -1 }), reason: 'gameplay-drain' },
      makeActor('dm-user', 'dm'),
    );
    expect(result).toEqual({ ok: true });
  });

  it('allows the DM to `gameplay-drain` Recovered Loot currency when Banker active', () => {
    const state = makeBankerState();
    const result = guards['currency-change'](
      state,
      { stashId: 'rl', delta: delta({ gp: -1 }), reason: 'gameplay-drain' },
      makeActor('dm-user', 'dm'),
    );
    expect(result).toEqual({ ok: true });
  });

  it('allows the DM to `gameplay-drain` even when NO Banker is active', () => {
    const state = makeBankerState(null);
    const result = guards['currency-change'](
      state,
      { stashId: 'ps', delta: delta({ gp: -1 }), reason: 'gameplay-drain' },
      makeActor('dm-user', 'dm'),
    );
    expect(result).toEqual({ ok: true });
  });

  it('rejects a player using `gameplay-drain` (DM-only reason)', () => {
    const state = makeBankerState(null);
    const result = guards['currency-change'](
      state,
      { stashId: 'ps', delta: delta({ gp: -1 }), reason: 'gameplay-drain' },
      makeActor('u2', 'player'),
    );
    expect(result).toMatchObject({ ok: false, code: 'dm_only' });
  });

  it('rejects the Banker using `gameplay-drain` (still DM-only, even for Banker)', () => {
    const state = makeBankerState();
    const result = guards['currency-change'](
      state,
      { stashId: 'ps', delta: delta({ gp: -1 }), reason: 'gameplay-drain' },
      makeActor('banker-user', 'banker'),
    );
    expect(result).toMatchObject({ ok: false, code: 'dm_only' });
  });

  it('R4.2.c behaviour preserved: DM `withdraw` from Party Stash still rejected when Banker active', () => {
    const state = makeBankerState();
    const result = guards['currency-change'](
      state,
      { stashId: 'ps', delta: delta({ gp: -1 }), reason: 'withdraw' },
      makeActor('dm-user', 'dm'),
    );
    expect(result).toMatchObject({ ok: false, code: 'banker_required_for_claim' });
  });
});

describe('guards — R4.2.d split-evenly', () => {
  it('accepts a Banker splitting Party Stash across active player characters', () => {
    const state = makeBankerState();
    const result = guards['split-evenly'](
      state,
      { fromStashId: 'ps', recipientCharacterIds: ['char-u2', 'char-banker-user'] },
      makeActor('banker-user', 'banker'),
    );
    expect(result).toEqual({ ok: true });
  });

  it('rejects a non-Banker player from split-evenly', () => {
    const state = makeBankerState();
    const result = guards['split-evenly'](
      state,
      { fromStashId: 'ps', recipientCharacterIds: ['char-u2'] },
      makeActor('u2', 'player'),
    );
    expect(result).toMatchObject({ ok: false, code: 'banker_required_for_claim' });
  });

  it('rejects the DM from split-evenly (Banker-only per §8.1)', () => {
    const state = makeBankerState();
    const result = guards['split-evenly'](
      state,
      { fromStashId: 'ps', recipientCharacterIds: ['char-u2'] },
      makeActor('dm-user', 'dm'),
    );
    expect(result).toMatchObject({ ok: false, code: 'banker_required_for_claim' });
  });

  it('rejects when fromStashId is Recovered Loot (out of scope for R4.2.d)', () => {
    const state = makeBankerState();
    const result = guards['split-evenly'](
      state,
      { fromStashId: 'rl', recipientCharacterIds: ['char-u2', 'char-banker-user'] },
      makeActor('banker-user', 'banker'),
    );
    expect(result).toMatchObject({ ok: false, code: 'stash_not_found' });
  });

  it('rejects when fromStashId is a character Inventory', () => {
    const state = makeBankerState();
    const result = guards['split-evenly'](
      state,
      { fromStashId: 'inv', recipientCharacterIds: ['char-u2', 'char-banker-user'] },
      makeActor('banker-user', 'banker'),
    );
    expect(result).toMatchObject({ ok: false, code: 'stash_not_found' });
  });

  it('rejects when a recipient character is not in this party', () => {
    const state = makeBankerState();
    const result = guards['split-evenly'](
      state,
      { fromStashId: 'ps', recipientCharacterIds: ['char-u2', 'char-nonexistent'] },
      makeActor('banker-user', 'banker'),
    );
    expect(result).toMatchObject({ ok: false, code: 'character_not_found' });
  });

  it('accepts when the Banker includes their own character', () => {
    const state = makeBankerState();
    const result = guards['split-evenly'](
      state,
      { fromStashId: 'ps', recipientCharacterIds: ['char-banker-user'] },
      makeActor('banker-user', 'banker'),
    );
    expect(result).toEqual({ ok: true });
  });
});

describe('guards — R4.3.a dm-transfer', () => {
  // makeBankerState memberships: dm-user (dm), u2 (player), banker-user (player).
  // The party's ownerUserId is u2 per makeState defaults, but that's
  // irrelevant to the guard — actor.role tells the guard the DM is who
  // dispatched it, and actor.userId is where the guard reads.

  it('accepts a DM transferring to an active player', () => {
    const state = makeBankerState(null);
    const result = guards['dm-transfer'](
      state,
      { newDmUserId: 'banker-user' },
      makeActor('dm-user', 'dm'),
    );
    expect(result).toEqual({ ok: true });
  });

  it('rejects a non-DM actor', () => {
    const state = makeBankerState(null);
    const result = guards['dm-transfer'](
      state,
      { newDmUserId: 'banker-user' },
      makeActor('u2', 'player'),
    );
    expect(result).toMatchObject({ ok: false, code: 'dm_only' });
  });

  it('rejects a Banker actor (still dm-only, even for Banker)', () => {
    const state = makeBankerState();
    const result = guards['dm-transfer'](
      state,
      { newDmUserId: 'u2' },
      makeActor('banker-user', 'banker'),
    );
    expect(result).toMatchObject({ ok: false, code: 'dm_only' });
  });

  it('rejects self-transfer', () => {
    const state = makeBankerState(null);
    const result = guards['dm-transfer'](
      state,
      { newDmUserId: 'dm-user' },
      makeActor('dm-user', 'dm'),
    );
    expect(result).toMatchObject({ ok: false, code: 'dm_transfer_self' });
  });

  it('rejects when target lacks an active player membership in this party', () => {
    const state = makeBankerState(null);
    const result = guards['dm-transfer'](
      state,
      { newDmUserId: 'stranger-not-in-party' },
      makeActor('dm-user', 'dm'),
    );
    expect(result).toMatchObject({ ok: false, code: 'dm_transfer_target_not_member' });
  });

  it('rejects when target is a soft-deleted (left) player', () => {
    // Widen state.memberships to include a soft-deleted player row.
    const base = makeBankerState(null);
    const state: AppState = {
      ...base,
      memberships: [
        ...base.memberships,
        {
          userId: 'former-player',
          partyId: 'p1',
          role: 'player',
          characterId: null,
          joinedAt: '2026-01-01T00:00:00.000Z',
          leftAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    };
    const result = guards['dm-transfer'](
      state,
      { newDmUserId: 'former-player' },
      makeActor('dm-user', 'dm'),
    );
    expect(result).toMatchObject({ ok: false, code: 'dm_transfer_target_not_member' });
  });

  it('rejects when state is null', () => {
    const result = guards['dm-transfer'](
      null,
      { newDmUserId: 'banker-user' },
      makeActor('dm-user', 'dm'),
    );
    expect(result).toMatchObject({ ok: false, code: 'state_not_initialized' });
  });
});

describe('guards — R4.3.c DM cross-character acquire/consume/transfer', () => {
  // makeBankerState fixture:
  //   - Party ownerUserId: 'dm-user' (via makeParty)
  //   - Characters: 'char-u2' (owned by u2, inv='inv'), 'char-banker-user'
  //     (owned by banker-user, inv='inv-b')
  //   - Stashes: 'inv' (u2's Inventory), 'inv-b' (banker's Inventory),
  //     'ps' (Party Stash), 'rl' (Recovered Loot)
  //   - Memberships: dm-user (dm), u2 (player), banker-user (player)
  //
  // Pre-R4.3.c: `ownsOrShares` returned false when actor.userId didn't
  // own the character. R4.3.c widens to allow actor.role === 'dm' to
  // access any character stash in their party per OUTLINE §8.1.
  //
  // NOTE: uses makeBankerState with bankerUserId=null to avoid the
  // R4.2.c Banker gate short-circuiting on the shared-pool tests.

  it("DM can acquire into another player's Inventory", () => {
    const state = makeBankerState(null);
    const result = guards.acquire(
      state,
      {
        stashId: 'inv',
        definitionId: 'phb-2024:rope',
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
      makeActor('dm-user', 'dm'),
    );
    expect(result).toEqual({ ok: true });
  });

  it("DM can consume an item from another player's Inventory", () => {
    // Base state's items include 'i1' at ownerId: 'inv' (u2's).
    const state = makeBankerState(null);
    const result = guards.consume(
      state,
      { itemInstanceId: 'i1', quantity: 1 },
      makeActor('dm-user', 'dm'),
    );
    expect(result).toEqual({ ok: true });
  });

  it("DM can transfer an item from another player's Inventory to Party Stash", () => {
    const state = makeBankerState(null);
    const result = guards.transfer(
      state,
      { itemInstanceId: 'i1', toStashId: 'ps', quantity: 1, ...transferIds() },
      makeActor('dm-user', 'dm'),
    );
    expect(result).toEqual({ ok: true });
  });

  it("DM can transfer an item from Party Stash to another player's Inventory (deposit unaffected)", () => {
    const state = makeBankerState(null);
    // Add an item to Party Stash for the transfer OUT.
    const s = {
      ...state,
      items: [
        ...state.items,
        {
          id: 'i-ps-item',
          definitionId: 'phb-2024:rope',
          ownerType: 'stash' as const,
          ownerId: 'ps',
          containerInstanceId: null,
          quantity: 1,
          equipped: false,
          attuned: false,
          identified: true,
          currentCharges: null,
        },
      ],
    };
    const result = guards.transfer(
      s,
      { itemInstanceId: 'i-ps-item', toStashId: 'inv-b', quantity: 1, ...transferIds() },
      makeActor('dm-user', 'dm'),
    );
    expect(result).toEqual({ ok: true });
  });

  it("Player still cannot acquire into another player's Inventory (§8.1 preserved)", () => {
    const state = makeBankerState(null);
    const result = guards.acquire(
      state,
      {
        stashId: 'inv',
        definitionId: 'phb-2024:rope',
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
      // u2 acting as player, targeting their own inventory is allowed;
      // banker-user acting as player, targeting u2's inventory is NOT.
      makeActor('banker-user', 'player'),
    );
    expect(result).toMatchObject({ ok: false, code: 'not_own_stash' });
  });

  it("Player still cannot consume from another player's Inventory (§8.1 preserved)", () => {
    const state = makeBankerState(null);
    const result = guards.consume(
      state,
      { itemInstanceId: 'i1', quantity: 1 },
      makeActor('banker-user', 'player'),
    );
    expect(result).toMatchObject({ ok: false, code: 'not_own_stash' });
  });

  it('DM cannot access a character stash outside their party (partyId mismatch)', () => {
    const state = makeBankerState(null);
    // Simulate a foreign character whose inventory stash is in a
    // different party (partyId mismatch on the character).
    const s = {
      ...state,
      characters: [
        ...state.characters,
        {
          ...state.characters[0]!,
          id: 'char-foreign',
          partyId: 'p2', // different party
          ownerUserId: 'other-user',
          inventoryStashId: 'inv-foreign',
        },
      ],
      stashes: [
        ...state.stashes,
        {
          id: 'inv-foreign',
          scope: 'character' as const,
          name: 'Foreign Inventory',
          ownerCharacterId: 'char-foreign',
          partyId: null,
          isCarried: true,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    const result = guards.acquire(
      s,
      {
        stashId: 'inv-foreign',
        definitionId: 'phb-2024:rope',
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
      makeActor('dm-user', 'dm'),
    );
    expect(result).toMatchObject({ ok: false, code: 'not_own_stash' });
  });
});

describe('guards — R4.3.d DM cross-character equip/attune/use-charge/recharge/rename', () => {
  // makeBankerState fixture: dm-user (dm), u2 (player, owns char-u2, inv='inv'
  // with item 'i1'), banker-user (player, owns char-banker-user, inv='inv-b').
  //
  // Pre-R4.3.d: guards using `ownsCharacter` returned false for DM
  // targeting another player's character (`not_own_character`).
  // R4.3.d widens `ownsCharacter` to allow actor.role === 'dm' when
  // character.partyId === actor.partyId per OUTLINE §8.1.

  it("DM can equip an item on another player's character", () => {
    const state = makeBankerState(null);
    const result = guards.equip(
      state,
      { itemInstanceId: 'i1', characterId: 'char-u2' },
      makeActor('dm-user', 'dm'),
    );
    expect(result).toEqual({ ok: true });
  });

  it("DM can unequip an item on another player's character", () => {
    const state = makeBankerState(null);
    const result = guards.unequip(
      state,
      { itemInstanceId: 'i1', characterId: 'char-u2' },
      makeActor('dm-user', 'dm'),
    );
    expect(result).toEqual({ ok: true });
  });

  it("DM can attune an item on another player's character", () => {
    const state = makeBankerState(null);
    const result = guards.attune(
      state,
      { itemInstanceId: 'i1', characterId: 'char-u2' },
      makeActor('dm-user', 'dm'),
    );
    expect(result).toEqual({ ok: true });
  });

  it("DM can unattune an item on another player's character", () => {
    const state = makeBankerState(null);
    const result = guards.unattune(
      state,
      { itemInstanceId: 'i1', characterId: 'char-u2' },
      makeActor('dm-user', 'dm'),
    );
    expect(result).toEqual({ ok: true });
  });

  it("DM can use-charge on an item in another player's Inventory", () => {
    const state = makeBankerState(null);
    const result = guards['use-charge'](
      state,
      { itemInstanceId: 'i1', characterId: 'char-u2' },
      makeActor('dm-user', 'dm'),
    );
    expect(result).toEqual({ ok: true });
  });

  it('DM cannot use-charge on an item in a Party Stash (§3.8 Inventory-only invariant preserved)', () => {
    // Move i1 to Party Stash and try DM use-charge. Rejects because
    // the item is not in char-u2's Inventory stash.
    const state = makeBankerState(null);
    const s = {
      ...state,
      items: state.items.map((i) => (i.id === 'i1' ? { ...i, ownerId: 'ps' } : i)),
    };
    const result = guards['use-charge'](
      s,
      { itemInstanceId: 'i1', characterId: 'char-u2' },
      makeActor('dm-user', 'dm'),
    );
    expect(result).toMatchObject({ ok: false, code: 'use_charge_only_in_inventory' });
  });

  it("DM can recharge (single-mode) an item in another player's Inventory", () => {
    const state = makeBankerState(null);
    const result = guards.recharge(
      state,
      { itemInstanceId: 'i1', characterId: 'char-u2', mode: 'single' as const, amount: 1 },
      makeActor('dm-user', 'dm'),
    );
    expect(result).toEqual({ ok: true });
  });

  it("DM can recharge (batch-mode) another player's character", () => {
    const state = makeBankerState(null);
    const result = guards.recharge(
      state,
      { characterId: 'char-u2', mode: 'batch' as const, trigger: 'long-rest' as const },
      makeActor('dm-user', 'dm'),
    );
    expect(result).toEqual({ ok: true });
  });

  it("DM can rename another player's character", () => {
    const state = makeBankerState(null);
    const result = guards['rename-character'](
      state,
      { characterId: 'char-u2', newName: 'Renamed by DM' },
      makeActor('dm-user', 'dm'),
    );
    expect(result).toEqual({ ok: true });
  });

  it("Player still cannot equip on another player's character (§8.1 preserved)", () => {
    const state = makeBankerState(null);
    const result = guards.equip(
      state,
      { itemInstanceId: 'i1', characterId: 'char-u2' },
      makeActor('banker-user', 'player'),
    );
    expect(result).toMatchObject({ ok: false, code: 'not_own_character' });
  });

  it("Player still cannot rename another player's character (§8.1 preserved)", () => {
    const state = makeBankerState(null);
    const result = guards['rename-character'](
      state,
      { characterId: 'char-u2', newName: 'By player' },
      makeActor('banker-user', 'player'),
    );
    expect(result).toMatchObject({ ok: false, code: 'not_own_character' });
  });

  it('DM cannot equip on a character outside their party (partyId mismatch)', () => {
    const state = makeBankerState(null);
    const s = {
      ...state,
      characters: [
        ...state.characters,
        {
          ...state.characters[0]!,
          id: 'char-foreign',
          partyId: 'p2',
          ownerUserId: 'other-user',
          inventoryStashId: 'inv-foreign',
        },
      ],
      stashes: [
        ...state.stashes,
        {
          id: 'inv-foreign',
          scope: 'character' as const,
          name: 'Foreign Inventory',
          ownerCharacterId: 'char-foreign',
          partyId: null,
          isCarried: true,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      items: [
        ...state.items,
        {
          id: 'i-foreign',
          definitionId: 'phb-2024:rope',
          ownerType: 'stash' as const,
          ownerId: 'inv-foreign',
          containerInstanceId: null,
          quantity: 1,
          equipped: false,
          attuned: false,
          identified: true,
          currentCharges: null,
        },
      ],
    };
    const result = guards.equip(
      s,
      { itemInstanceId: 'i-foreign', characterId: 'char-foreign' },
      makeActor('dm-user', 'dm'),
    );
    expect(result).toMatchObject({ ok: false, code: 'not_own_character' });
  });

  it('DM can attune with overrideCap: true (cap-override allowed)', () => {
    const state = makeBankerState(null);
    const result = guards.attune(
      state,
      { itemInstanceId: 'i1', characterId: 'char-u2', overrideCap: true },
      makeActor('dm-user', 'dm'),
    );
    expect(result).toEqual({ ok: true });
  });

  it('Player cannot attune with overrideCap: true (§3.8 DM-only)', () => {
    const state = makeBankerState(null);
    // Player attunes on their own character with overrideCap — rejected
    // because cap-override is DM-only per OUTLINE §3.8.
    const result = guards.attune(
      state,
      { itemInstanceId: 'i1', characterId: 'char-u2', overrideCap: true },
      makeActor('u2', 'player'),
    );
    expect(result).toMatchObject({ ok: false, code: 'dm_only' });
  });

  it('Banker cannot attune with overrideCap: true (§3.8 DM-only, not Banker)', () => {
    const state = makeBankerState();
    const result = guards.attune(
      state,
      { itemInstanceId: 'i1', characterId: 'char-u2', overrideCap: true },
      makeActor('banker-user', 'banker'),
    );
    expect(result).toMatchObject({ ok: false, code: 'dm_only' });
  });
});

describe('guards — every action has an entry', () => {
  it('the map exposes one guard per Action type', () => {
    const expected: ReadonlyArray<Action['type']> = [
      'create-character',
      'acquire',
      'consume',
      'seed-catalog',
      'edit-item-instance',
      'create-stash',
      'rename-stash',
      'delete-stash',
      'currency-change',
      'transfer',
      'split',
      'currency-transfer',
      'create-homebrew',
      'edit-homebrew',
      'delete-homebrew',
      'rename-character',
      'rename-party',
      'set-encumbrance',
      'equip',
      'unequip',
      'attune',
      'unattune',
      'use-charge',
      'recharge',
      'identify',
      'edit-character',
      'delete-character',
      'leave-party',
      'kick-player',
      'join-party',
      'appoint-banker',
      'revoke-banker',
      'dm-transfer',
      'split-evenly',
      'start-game-session',
      'end-game-session',
    ];
    for (const t of expected) {
      expect(typeof guards[t]).toBe('function');
    }
    // And no extras (the keys === the union)
    expect(new Set(Object.keys(guards))).toEqual(new Set(expected));
  });
});

// -------------------------------------------------------------------- //
// R4.1.f: create-character post-bootstrap branch
// -------------------------------------------------------------------- //

describe('createCharacterGuard — post-bootstrap (R4.1.f)', () => {
  // RH1.2 — fresh ids per call so guard-under-test always sees a within-
  // tolerance UUID v7 timestamp. Payload-only (guards receive payload,
  // not the wrapping action).
  const newCharacterPayload = () => ({
    name: 'Lyra',
    species: 'Elf',
    size: 'medium' as const,
    class: 'Rogue',
    level: 2,
    str: 12,
    ...createCharacterWithCharIds(),
  });
  const newCharacterDmOnlyPayload = () => ({
    dmOnly: true as const,
    partyName: 'X',
    ...createCharacterDmOnlyIds(),
  });

  function makePostBootstrapState(actorUserId: string, characterId: string | null): AppState {
    // Build a populated AppState where the actor has a player row whose
    // characterId is `characterId` (null = joiner / post-delete, non-null =
    // already-has-character invariant violation).
    const base = makeState({ ownerUserId: actorUserId, ownerCharacterId: 'char-existing' });
    if (base === null) throw new Error('makeState returned null unexpectedly');
    return {
      ...base,
      memberships: [
        makeMembership('dm-user', 'dm'),
        {
          userId: actorUserId,
          partyId: 'p1',
          role: 'player' as const,
          characterId,
          joinedAt: '2026-01-01T00:00:00.000Z',
          leftAt: null,
        },
      ],
      // If the actor has no character yet (characterId: null), drop the
      // characters[] entry too so the state is internally consistent.
      characters: characterId === null ? [] : base.characters,
    };
  }

  it('accepts the joiner case (actor has player row with characterId: null)', () => {
    const state = makePostBootstrapState('u1', null);
    const result = guards['create-character'](
      state,
      newCharacterPayload(),
      makeActor('u1', 'player'),
    );
    expect(result).toEqual({ ok: true });
  });

  it('accepts the DM-only DM case (actor has only a dm row)', () => {
    const base = makeState({ ownerUserId: 'dm-user' });
    if (base === null) throw new Error('expected state');
    const state: AppState = {
      ...base,
      memberships: [makeMembership('dm-user', 'dm')],
      characters: [],
    };
    const result = guards['create-character'](
      state,
      newCharacterPayload(),
      makeActor('dm-user', 'dm'),
    );
    expect(result).toEqual({ ok: true });
  });

  it('rejects when the actor already has an active player row with a non-null characterId', () => {
    const state = makePostBootstrapState('u1', 'char-u1');
    const result = guards['create-character'](
      state,
      newCharacterPayload(),
      makeActor('u1', 'player'),
    );
    expect(result).toMatchObject({ ok: false, code: 'character_already_exists' });
  });

  it('rejects dmOnly: true on the post-bootstrap branch', () => {
    const state = makePostBootstrapState('u1', null);
    const result = guards['create-character'](
      state,
      newCharacterDmOnlyPayload(),
      makeActor('u1', 'player'),
    );
    expect(result).toMatchObject({ ok: false, code: 'state_already_initialized' });
  });

  it('rejects when the actor is not an active member of the party', () => {
    const base = makeState({ ownerUserId: 'someone-else' });
    if (base === null) throw new Error('expected state');
    const state: AppState = {
      ...base,
      memberships: [makeMembership('dm-user', 'dm')],
      characters: [],
    };
    const result = guards['create-character'](
      state,
      newCharacterPayload(),
      makeActor('outsider', 'player'),
    );
    expect(result).toMatchObject({ ok: false, code: 'not_a_member' });
  });
});

// -------------------------------------------------------------------- //
// RH1.2 — client-minted id validation (`id_malformed`, `id_clock_skew`)
// runs upstream of every per-action guard. Rejects payloads carrying
// a non-UUID-v7 id or an id whose embedded timestamp lies outside
// `CLOCK_SKEW_TOLERANCE_MS` (±5 min). The `id_already_exists` code is
// not tested here — it's persistor-layer (Prisma unique-constraint).
// -------------------------------------------------------------------- //

describe('checkGuard — RH1.2 id-shape + clock-skew validation', () => {
  const state = makeState({ ownerUserId: 'u1', ownerCharacterId: 'char-u1' });
  const memberships = [
    makeMembership('dm-user', 'dm'),
    makeMembership('u1', 'player'),
    makeMembership('u2', 'player'),
  ];
  const actor = makeActor('u1', 'player');

  it('rejects an acquire with a malformed newItemInstanceId', () => {
    const action: Action = {
      type: 'acquire',
      payload: {
        stashId: 'inv',
        definitionId: 'phb-2024:rope',
        quantity: 1,
        source: 'catalog-add',
        newItemInstanceId: 'not-a-uuid',
      },
    };
    expect(checkGuard(state, action, actor, memberships)).toMatchObject({
      ok: false,
      code: 'id_malformed',
    });
  });

  it('rejects an acquire with a UUID v7 id whose timestamp is far in the future (clock skew)', () => {
    // Construct a UUID v7 whose embedded 48-bit ms timestamp is 10
    // minutes in the future — well outside the ±5-min tolerance. The
    // remaining 80 bits are the version nibble (7), the variant, and
    // random. We reuse `newUuidV7()` and then rewrite the leading 12
    // hex chars with the future timestamp.
    const futureMs = Date.now() + 10 * 60 * 1000; // +10 minutes
    const template = newUuidV7();
    const futureHex = futureMs.toString(16).padStart(12, '0');
    const futureId =
      futureHex.slice(0, 8) + '-' + futureHex.slice(8, 12) + '-' + template.slice(14);
    // Sanity: still a structurally valid v7 (version nibble '7' at pos 14).
    expect(futureId[14]).toBe('7');

    const action: Action = {
      type: 'acquire',
      payload: {
        stashId: 'inv',
        definitionId: 'phb-2024:rope',
        quantity: 1,
        source: 'catalog-add',
        newItemInstanceId: futureId,
      },
    };
    expect(checkGuard(state, action, actor, memberships)).toMatchObject({
      ok: false,
      code: 'id_clock_skew',
    });
  });

  it('rejects a create-stash with a malformed newCurrencyHoldingId', () => {
    const action: Action = {
      type: 'create-stash',
      payload: {
        ownerCharacterId: 'char-u1',
        name: 'Backpack',
        newStashId: newUuidV7(),
        newCurrencyHoldingId: 'malformed-cur-id',
      },
    };
    expect(checkGuard(state, action, actor, memberships)).toMatchObject({
      ok: false,
      code: 'id_malformed',
    });
  });

  it('rejects create-character (bootstrap) with a malformed newPartyId', () => {
    const action: Action = {
      type: 'create-character',
      payload: {
        name: 'Lyra',
        species: 'Elf',
        size: 'medium' as const,
        class: 'Rogue',
        level: 2,
        str: 12,
        newCharacterId: newUuidV7(),
        newInventoryStashId: newUuidV7(),
        newCurrencyHoldingId: newUuidV7(),
        newUserId: newUuidV7(),
        newPartyId: 'not-v7',
        newPartyStashId: newUuidV7(),
        newRecoveredLootStashId: newUuidV7(),
        newPartyStashCurrencyId: newUuidV7(),
        newRecoveredLootCurrencyId: newUuidV7(),
      },
    };
    expect(checkGuard(null, action, makeActor(), [])).toMatchObject({
      ok: false,
      code: 'id_malformed',
    });
  });

  it('accepts a well-formed minting action (positive control)', () => {
    const action: Action = {
      type: 'acquire',
      payload: {
        stashId: 'inv',
        definitionId: 'phb-2024:rope',
        quantity: 1,
        source: 'catalog-add',
        newItemInstanceId: newUuidV7(),
      },
    };
    expect(checkGuard(state, action, actor, memberships)).toEqual({ ok: true });
  });
});

describe('currentGameSessionId + isUntaggedLogEntry — RH3.1', () => {
  it('currentGameSessionId returns null when state is null', async () => {
    const { currentGameSessionId } = await import('./actor');
    expect(currentGameSessionId(null)).toBeNull();
  });

  it('currentGameSessionId returns null when no session is current', async () => {
    const { currentGameSessionId } = await import('./actor');
    const state = makeState();
    expect(currentGameSessionId(state)).toBeNull();
  });

  it('currentGameSessionId returns the isCurrent session id', async () => {
    const { currentGameSessionId } = await import('./actor');
    const state = makeState();
    const stateWithSession = {
      ...state,
      gameSessions: [
        {
          id: 'gs-1',
          partyId: state.party.id,
          number: 1,
          date: '2026-07-03',
          isCurrent: true,
          createdAt: '2026-07-03T00:00:00.000Z',
        },
        {
          id: 'gs-2',
          partyId: state.party.id,
          number: 2,
          date: '2026-07-02',
          isCurrent: false,
          createdAt: '2026-07-02T00:00:00.000Z',
        },
      ],
    };
    expect(currentGameSessionId(stateWithSession)).toBe('gs-1');
  });

  it('isUntaggedLogEntry — true when sessionId is null', async () => {
    const { isUntaggedLogEntry } = await import('./actor');
    // Cast avoids re-building a full log entry fixture; only the
    // sessionId field is under test.
    expect(isUntaggedLogEntry({ sessionId: null } as never)).toBe(true);
    expect(isUntaggedLogEntry({ sessionId: 'gs-1' } as never)).toBe(false);
  });
});
