import { describe, expect, it } from 'vitest';

import type { Action, AppState, Party, PartyMembership } from '../schemas';

import { deriveActorRole, isMember, isSolo } from './actor';
import { checkGuard, guards } from './map';
import type { Actor, GuardResult } from './index';

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
    // Party.bankerUserId is z.null() in the MVP schema. The structural
    // value is null; type-asserted here so the guard tests can still
    // exercise the banker path via a manual cast in the deriveActorRole
    // test below.
    bankerUserId: bankerUserId as null,
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

    // Simulate post-R4.2: bankerUserId set. The Zod schema doesn't allow
    // a non-null value today but the function is forward-compatible —
    // cast for the test.
    const bankerParty = { ...party, bankerUserId: 'u1' as unknown as null };
    expect(deriveActorRole(bankerParty, m)).toBe('banker');

    // Banker on a different user: membership role wins.
    const otherBankerParty = { ...party, bankerUserId: 'someone-else' as unknown as null };
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

// -------------------- §8.2 solo bypass --------------------

describe('checkGuard — §8.2 solo bypass', () => {
  it('bypasses the matrix for a solo party (one unique active member)', () => {
    const state = makeState();
    const actor = makeActor('u1', 'player');
    const soloMemberships = [makeMembership('u1', 'dm'), makeMembership('u1', 'player')];
    // create-homebrew is DM-only in 2+-member parties; solo bypass
    // returns ok for a player actor.
    const action: Action = { type: 'create-homebrew', payload: { name: 'X', category: 'magic' } };
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
      },
    };
    const result = checkGuard(state, action, otherActor, memberships);
    expect(result).toMatchObject({ ok: false, code: 'not_a_member' });
    expect((result as { ok: false; message: string }).message).toEqual(expect.any(String));
  });

  it('skips membership check when state is null (bootstrap create-character)', () => {
    const action: Action = {
      type: 'create-character',
      payload: { name: 'X', species: 'Human', size: 'medium', class: 'Fighter', level: 1, str: 16 },
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
        { type: 'create-homebrew', payload: { name: 'X', category: 'magic' } },
        makeActor('u1', 'player'),
      ),
    ).toMatchObject({ ok: false, code: 'dm_only' });
  });
  it('create-homebrew accepts a DM', () => {
    expect(
      runGuard(
        { type: 'create-homebrew', payload: { name: 'X', category: 'magic' } },
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
        { type: 'create-stash', payload: { ownerCharacterId: 'char-u1', name: 'Backpack' } },
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
  const newCharacterPayload = {
    name: 'Lyra',
    species: 'Elf',
    size: 'medium' as const,
    class: 'Rogue',
    level: 2,
    str: 12,
  };

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
      newCharacterPayload,
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
      newCharacterPayload,
      makeActor('dm-user', 'dm'),
    );
    expect(result).toEqual({ ok: true });
  });

  it('rejects when the actor already has an active player row with a non-null characterId', () => {
    const state = makePostBootstrapState('u1', 'char-u1');
    const result = guards['create-character'](
      state,
      newCharacterPayload,
      makeActor('u1', 'player'),
    );
    expect(result).toMatchObject({ ok: false, code: 'character_already_exists' });
  });

  it('rejects dmOnly: true on the post-bootstrap branch', () => {
    const state = makePostBootstrapState('u1', null);
    const result = guards['create-character'](
      state,
      { dmOnly: true, partyName: 'X' },
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
      newCharacterPayload,
      makeActor('outsider', 'player'),
    );
    expect(result).toMatchObject({ ok: false, code: 'not_a_member' });
  });
});
