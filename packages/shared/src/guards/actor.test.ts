import { describe, expect, it } from 'vitest';

import type { AppState, TransactionLogEntry } from '../schemas';

import { canSeeLogEntry, isUntaggedLogEntry, matchesCharacter, matchesItemInstance } from './actor';

/**
 * R5.3 — `canSeeLogEntry` / `matchesItemInstance` / `matchesCharacter`
 * test suite.
 *
 * The permission gate implements OUTLINE §3.4 amendment (2026-06-24):
 *   - Party Stash / Recovered Loot → all party members
 *   - Character Inventory / Storage → owner + DM only
 *   - Banker-authored entries → all members (widening)
 *   - Non-item entries → all members
 *   - Item deleted / not found → DM only (safe fallback)
 */

// -------------------- fixtures --------------------

const BASE_TS = '2026-07-04T10:00:00.000Z';

function baseFields(overrides: Partial<TransactionLogEntry> = {}) {
  return {
    id: overrides.id ?? '01000000-0000-7000-8000-000000000001',
    partyId: overrides.partyId ?? 'p1',
    sessionId: overrides.sessionId ?? null,
    timestamp: overrides.timestamp ?? BASE_TS,
    actorUserId: overrides.actorUserId ?? 'u-player-a',
    actorRole: overrides.actorRole ?? 'player',
  } as const;
}

function makeAcquire(
  itemInstanceId: string,
  actorRole: 'dm' | 'player' | 'banker' = 'player',
): TransactionLogEntry {
  return {
    ...baseFields({ actorRole }),
    type: 'acquire',
    payload: {
      stashId: 'inv-a',
      itemInstanceId,
      definitionId: 'phb-2024:rope',
      quantity: 1,
      source: 'catalog-add',
    },
  };
}

function makeSplit(sourceInstanceId: string, newInstanceId: string): TransactionLogEntry {
  return {
    ...baseFields(),
    type: 'split',
    payload: { sourceInstanceId, newInstanceId, quantity: 1, stashId: 'inv-a' },
  };
}

function makeEquip(itemInstanceId: string, characterId: string): TransactionLogEntry {
  return {
    ...baseFields(),
    type: 'equip',
    payload: { itemInstanceId, characterId },
  };
}

function makeCurrencyChange(): TransactionLogEntry {
  return {
    ...baseFields(),
    type: 'currency-change',
    payload: { stashId: 'ps', delta: { cp: 100, sp: 0, ep: 0, gp: 0, pp: 0 } },
  };
}

function makeStartSession(): TransactionLogEntry {
  return {
    ...baseFields(),
    type: 'start-game-session',
    payload: { gameSessionId: 'gs1', number: 1, date: '2026-07-04' },
  };
}

function makeCreateStash(): TransactionLogEntry {
  return {
    ...baseFields(),
    type: 'create-stash',
    payload: { stashId: 'stor-a', scope: 'character', name: 'Bag of Holding' },
  };
}

function makeRenameCharacter(characterId: string): TransactionLogEntry {
  return {
    ...baseFields(),
    type: 'rename-character',
    payload: { characterId, oldName: 'Old', newName: 'New' },
  };
}

/** AppState with two characters (A owned by player-A, B owned by
 * player-B), each with an Inventory + one Storage stash, a shared
 * Party Stash and Recovered Loot. Items live in fixed stashes for
 * ownership tests. */
function makeState(): AppState {
  return {
    version: 1,
    seedVersion: 0,
    user: {
      id: 'u-dm',
      discordId: 'u-dm',
      displayName: 'DM',
      createdAt: BASE_TS,
    },
    party: {
      id: 'p1',
      name: 'Party',
      ownerUserId: 'u-dm',
      inviteCode: 'INV-ABCDEF',
      recoveredLootStashId: 'rl',
      bankerUserId: null,
      encumbranceRule: 'off',
      enforceEncumbrance: false,
      priceModifier: 1.0,
      baseCurrency: 'gp',
      createdAt: BASE_TS,
    },
    memberships: [
      {
        userId: 'u-dm',
        partyId: 'p1',
        role: 'dm',
        characterId: null,
        joinedAt: BASE_TS,
        leftAt: null,
      },
      {
        userId: 'u-player-a',
        partyId: 'p1',
        role: 'player',
        characterId: 'char-a',
        joinedAt: BASE_TS,
        leftAt: null,
      },
      {
        userId: 'u-player-b',
        partyId: 'p1',
        role: 'player',
        characterId: 'char-b',
        joinedAt: BASE_TS,
        leftAt: null,
      },
    ],
    characters: [
      {
        id: 'char-a',
        partyId: 'p1',
        ownerUserId: 'u-player-a',
        name: 'Aeryn',
        species: 'Human',
        size: 'medium',
        class: 'Fighter',
        level: 1,
        abilityScores: { STR: 16 },
        maxAttunement: 3,
        inventoryStashId: 'inv-a',
        wishlist: [],
      },
      {
        id: 'char-b',
        partyId: 'p1',
        ownerUserId: 'u-player-b',
        name: 'Baelor',
        species: 'Elf',
        size: 'medium',
        class: 'Wizard',
        level: 1,
        abilityScores: { STR: 10 },
        maxAttunement: 3,
        inventoryStashId: 'inv-b',
        wishlist: [],
      },
    ],
    gameSessions: [],
    stashes: [
      {
        id: 'inv-a',
        scope: 'character',
        name: 'Inventory',
        ownerCharacterId: 'char-a',
        partyId: null,
        isCarried: true,
        createdAt: BASE_TS,
      },
      {
        id: 'stor-a',
        scope: 'character',
        name: 'Bag of Holding',
        ownerCharacterId: 'char-a',
        partyId: null,
        isCarried: false,
        createdAt: BASE_TS,
      },
      {
        id: 'inv-b',
        scope: 'character',
        name: 'Inventory',
        ownerCharacterId: 'char-b',
        partyId: null,
        isCarried: true,
        createdAt: BASE_TS,
      },
      {
        id: 'ps',
        scope: 'party',
        name: 'Party Stash',
        ownerCharacterId: null,
        partyId: 'p1',
        isCarried: false,
        createdAt: BASE_TS,
      },
      {
        id: 'rl',
        scope: 'recovered-loot',
        name: 'Recovered Loot',
        ownerCharacterId: null,
        partyId: 'p1',
        isCarried: false,
        createdAt: BASE_TS,
      },
    ],
    shops: [],
    catalog: [],
    items: [
      // item in player-A's Inventory
      {
        id: 'item-inv-a',
        definitionId: 'phb-2024:rope',
        ownerType: 'stash',
        ownerId: 'inv-a',
        containerInstanceId: null,
        quantity: 1,
        equipped: false,
        attuned: false,
        identified: true,
        currentCharges: null,
      },
      // item in player-A's Storage
      {
        id: 'item-stor-a',
        definitionId: 'phb-2024:torch',
        ownerType: 'stash',
        ownerId: 'stor-a',
        containerInstanceId: null,
        quantity: 1,
        equipped: false,
        attuned: false,
        identified: true,
        currentCharges: null,
      },
      // item in player-B's Inventory
      {
        id: 'item-inv-b',
        definitionId: 'phb-2024:wand',
        ownerType: 'stash',
        ownerId: 'inv-b',
        containerInstanceId: null,
        quantity: 1,
        equipped: false,
        attuned: false,
        identified: true,
        currentCharges: null,
      },
      // item in Party Stash
      {
        id: 'item-ps',
        definitionId: 'phb-2024:potion',
        ownerType: 'stash',
        ownerId: 'ps',
        containerInstanceId: null,
        quantity: 1,
        equipped: false,
        attuned: false,
        identified: true,
        currentCharges: null,
      },
      // item in Recovered Loot
      {
        id: 'item-rl',
        definitionId: 'phb-2024:gem',
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
      { id: 'c-inv-a', stashId: 'inv-a', cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
      { id: 'c-stor-a', stashId: 'stor-a', cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
      { id: 'c-inv-b', stashId: 'inv-b', cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
      { id: 'c-ps', stashId: 'ps', cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
      { id: 'c-rl', stashId: 'rl', cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    ],
    log: [],
  };
}

const state = makeState();
const asDm = { currentUserId: 'u-dm', isDm: true, state };
const asPlayerA = { currentUserId: 'u-player-a', isDm: false, state };
const asPlayerB = { currentUserId: 'u-player-b', isDm: false, state };

// -------------------- isUntaggedLogEntry --------------------

describe('isUntaggedLogEntry', () => {
  it('returns true iff sessionId is null', () => {
    const untagged = makeAcquire('item-ps');
    expect(untagged.sessionId).toBe(null);
    expect(isUntaggedLogEntry(untagged)).toBe(true);

    const tagged: TransactionLogEntry = { ...untagged, sessionId: 'gs1' };
    expect(isUntaggedLogEntry(tagged)).toBe(false);
  });
});

// -------------------- canSeeLogEntry — solo bypass --------------------

describe('canSeeLogEntry — solo bypass', () => {
  it('sole active member sees everything even in an "item deleted" fallback', () => {
    const soloState: AppState = {
      ...state,
      memberships: [
        {
          userId: 'u-solo',
          partyId: 'p1',
          role: 'dm',
          characterId: null,
          joinedAt: BASE_TS,
          leftAt: null,
        },
        {
          userId: 'u-solo',
          partyId: 'p1',
          role: 'player',
          characterId: 'char-a',
          joinedAt: BASE_TS,
          leftAt: null,
        },
      ],
    };
    const entry = makeAcquire('missing-item');
    const asSolo = { currentUserId: 'u-solo', isDm: false, state: soloState };
    expect(canSeeLogEntry(entry, asSolo)).toBe(true);
  });
});

// -------------------- canSeeLogEntry — item entries --------------------

describe('canSeeLogEntry — item in Party Stash', () => {
  const entry = makeAcquire('item-ps');
  it('visible to DM', () => expect(canSeeLogEntry(entry, asDm)).toBe(true));
  it('visible to Player A', () => expect(canSeeLogEntry(entry, asPlayerA)).toBe(true));
  it('visible to Player B', () => expect(canSeeLogEntry(entry, asPlayerB)).toBe(true));
});

describe('canSeeLogEntry — item in Recovered Loot', () => {
  const entry = makeAcquire('item-rl');
  it('visible to DM', () => expect(canSeeLogEntry(entry, asDm)).toBe(true));
  it('visible to Player A', () => expect(canSeeLogEntry(entry, asPlayerA)).toBe(true));
  it('visible to Player B', () => expect(canSeeLogEntry(entry, asPlayerB)).toBe(true));
});

describe('canSeeLogEntry — item in own Inventory (Player A)', () => {
  const entry = makeAcquire('item-inv-a');
  it('visible to DM', () => expect(canSeeLogEntry(entry, asDm)).toBe(true));
  it('visible to owner Player A', () => expect(canSeeLogEntry(entry, asPlayerA)).toBe(true));
  it('HIDDEN from other Player B', () => expect(canSeeLogEntry(entry, asPlayerB)).toBe(false));
});

describe('canSeeLogEntry — item in own Storage (Player A)', () => {
  const entry = makeAcquire('item-stor-a');
  it('visible to DM', () => expect(canSeeLogEntry(entry, asDm)).toBe(true));
  it('visible to owner Player A', () => expect(canSeeLogEntry(entry, asPlayerA)).toBe(true));
  it('HIDDEN from other Player B', () => expect(canSeeLogEntry(entry, asPlayerB)).toBe(false));
});

describe('canSeeLogEntry — item in other player Inventory', () => {
  const entry = makeAcquire('item-inv-b');
  it('visible to DM', () => expect(canSeeLogEntry(entry, asDm)).toBe(true));
  it('visible to owner Player B', () => expect(canSeeLogEntry(entry, asPlayerB)).toBe(true));
  it('HIDDEN from other Player A', () => expect(canSeeLogEntry(entry, asPlayerA)).toBe(false));
});

// -------------------- canSeeLogEntry — banker widening --------------------

describe('canSeeLogEntry — banker widening', () => {
  it('banker-authored entry on other-player Inventory is visible to non-owner', () => {
    const bankerEntry: TransactionLogEntry = {
      ...makeAcquire('item-inv-b', 'banker'),
    };
    expect(canSeeLogEntry(bankerEntry, asPlayerA)).toBe(true);
    expect(canSeeLogEntry(bankerEntry, asPlayerB)).toBe(true);
    expect(canSeeLogEntry(bankerEntry, asDm)).toBe(true);
  });

  it('banker-authored entry on missing item is still visible to everyone', () => {
    const bankerEntry: TransactionLogEntry = makeAcquire('missing-item', 'banker');
    expect(canSeeLogEntry(bankerEntry, asPlayerA)).toBe(true);
    expect(canSeeLogEntry(bankerEntry, asPlayerB)).toBe(true);
  });
});

// -------------------- canSeeLogEntry — non-item entries --------------------

describe('canSeeLogEntry — non-item entries visible to all', () => {
  it('currency-change (Party Stash)', () => {
    const entry = makeCurrencyChange();
    expect(canSeeLogEntry(entry, asPlayerA)).toBe(true);
    expect(canSeeLogEntry(entry, asPlayerB)).toBe(true);
    expect(canSeeLogEntry(entry, asDm)).toBe(true);
  });

  it('start-game-session', () => {
    const entry = makeStartSession();
    expect(canSeeLogEntry(entry, asPlayerA)).toBe(true);
    expect(canSeeLogEntry(entry, asPlayerB)).toBe(true);
  });

  it('create-stash (a character-scope Storage stash) is visible to all members', () => {
    const entry = makeCreateStash();
    expect(canSeeLogEntry(entry, asPlayerA)).toBe(true);
    expect(canSeeLogEntry(entry, asPlayerB)).toBe(true);
  });

  it('rename-character (someone else\u2019s character)', () => {
    const entry = makeRenameCharacter('char-b');
    expect(canSeeLogEntry(entry, asPlayerA)).toBe(true);
  });
});

// -------------------- canSeeLogEntry — missing item fallback --------------------

describe('canSeeLogEntry — missing item fallback (DM only)', () => {
  const entry = makeAcquire('missing-item-id');
  it('visible to DM', () => expect(canSeeLogEntry(entry, asDm)).toBe(true));
  it('HIDDEN from Player A', () => expect(canSeeLogEntry(entry, asPlayerA)).toBe(false));
  it('HIDDEN from Player B', () => expect(canSeeLogEntry(entry, asPlayerB)).toBe(false));
});

// -------------------- canSeeLogEntry — split refs source id --------------------

describe('canSeeLogEntry — split uses sourceInstanceId for gate', () => {
  it('split of a Party-Stash item is visible to all', () => {
    const entry = makeSplit('item-ps', 'missing-new');
    expect(canSeeLogEntry(entry, asPlayerA)).toBe(true);
    expect(canSeeLogEntry(entry, asPlayerB)).toBe(true);
  });

  it('split of another player\u2019s Inventory item is hidden from non-owner', () => {
    const entry = makeSplit('item-inv-b', 'missing-new');
    expect(canSeeLogEntry(entry, asPlayerA)).toBe(false);
    expect(canSeeLogEntry(entry, asPlayerB)).toBe(true);
    expect(canSeeLogEntry(entry, asDm)).toBe(true);
  });
});

// -------------------- matchesItemInstance --------------------

describe('matchesItemInstance', () => {
  it('matches direct itemInstanceId payload', () => {
    const entry = makeAcquire('item-inv-a');
    expect(matchesItemInstance(entry, 'item-inv-a')).toBe(true);
    expect(matchesItemInstance(entry, 'other-item')).toBe(false);
  });

  it('matches both source AND new id for split', () => {
    const entry = makeSplit('src-id', 'new-id');
    expect(matchesItemInstance(entry, 'src-id')).toBe(true);
    expect(matchesItemInstance(entry, 'new-id')).toBe(true);
    expect(matchesItemInstance(entry, 'other')).toBe(false);
  });

  it('returns false for non-item entries', () => {
    expect(matchesItemInstance(makeCurrencyChange(), 'anything')).toBe(false);
    expect(matchesItemInstance(makeStartSession(), 'anything')).toBe(false);
    expect(matchesItemInstance(makeCreateStash(), 'anything')).toBe(false);
  });
});

// -------------------- matchesCharacter --------------------

describe('matchesCharacter', () => {
  it('matches by actor when the actor is the character owner', () => {
    const entry: TransactionLogEntry = {
      ...baseFields({ actorUserId: 'u-player-a' }),
      type: 'currency-change',
      payload: { stashId: 'inv-a', delta: { cp: 100, sp: 0, ep: 0, gp: 0, pp: 0 } },
    };
    expect(matchesCharacter(entry, 'char-a', 'u-player-a')).toBe(true);
    expect(matchesCharacter(entry, 'char-b', 'u-player-b')).toBe(false);
  });

  it('matches by characterId on equip/unequip/attune/unattune', () => {
    const entry = makeEquip('item-x', 'char-a');
    expect(matchesCharacter(entry, 'char-a', 'u-player-a')).toBe(true);
    expect(matchesCharacter(entry, 'char-b', 'u-player-b')).toBe(false);
  });

  it('matches by characterId on rename-character', () => {
    const entry = makeRenameCharacter('char-a');
    expect(matchesCharacter(entry, 'char-a', 'u-player-a')).toBe(true);
    expect(matchesCharacter(entry, 'char-b', 'u-player-b')).toBe(false);
  });

  it('returns false for entries without character link (start-session) authored by another user', () => {
    const entry: TransactionLogEntry = {
      ...makeStartSession(),
      actorUserId: 'u-dm',
    };
    expect(matchesCharacter(entry, 'char-a', 'u-player-a')).toBe(false);
  });
});
