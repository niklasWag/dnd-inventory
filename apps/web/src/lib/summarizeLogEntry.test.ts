import { describe, expect, it } from 'vitest';

import type { AppState, ItemDefinition, TransactionLogEntry } from '@app/shared';

import { summarizeLogEntry } from './summarizeLogEntry';

/**
 * R5.3 — summarize helper tests. One assertion per log-entry variant
 * covering the string format. Exhaustiveness is enforced by
 * TypeScript's discriminated-union switch in `summarizeLogEntry`.
 */

const BASE_TS = '2026-07-04T10:00:00.000Z';

function baseFields(overrides: Partial<TransactionLogEntry> = {}) {
  return {
    id: overrides.id ?? '01000000-0000-7000-8000-000000000001',
    partyId: overrides.partyId ?? 'p1',
    sessionId: overrides.sessionId ?? null,
    timestamp: overrides.timestamp ?? BASE_TS,
    actorUserId: overrides.actorUserId ?? 'u1',
    actorRole: overrides.actorRole ?? 'player',
  } as const;
}

const rope: ItemDefinition = {
  id: 'phb-2024:rope',
  name: 'Rope',
  category: 'gear',
  weight: 5,
  cost: { amount: 2, currency: 'gp' },
  description: '',
  tags: [],
  source: 'PHB',
};

function makeState(): AppState {
  return {
    version: 1,
    seedVersion: 0,
    user: {
      id: 'u1',
      discordId: 'u1',
      displayName: 'DM',
      createdAt: BASE_TS,
    },
    party: {
      id: 'p1',
      name: 'Party',
      ownerUserId: 'u1',
      inviteCode: 'INV-ABCDEF',
      recoveredLootStashId: 'rl',
      bankerUserId: null,
      encumbranceRule: 'off',
      enforceEncumbrance: false,
      createdAt: BASE_TS,
    },
    memberships: [
      {
        userId: 'u1',
        partyId: 'p1',
        role: 'dm',
        characterId: null,
        joinedAt: BASE_TS,
        leftAt: null,
      },
      {
        userId: 'u1',
        partyId: 'p1',
        role: 'player',
        characterId: 'char-a',
        joinedAt: BASE_TS,
        leftAt: null,
      },
    ],
    characters: [
      {
        id: 'char-a',
        partyId: 'p1',
        ownerUserId: 'u1',
        name: 'Aeryn',
        species: 'Human',
        size: 'medium',
        class: 'Fighter',
        level: 1,
        abilityScores: { STR: 16 },
        maxAttunement: 3,
        inventoryStashId: 'inv-a',
      },
    ],
    gameSessions: [
      {
        id: 'gs1',
        partyId: 'p1',
        number: 3,
        date: '2026-07-04',
        isCurrent: true,
        createdAt: BASE_TS,
      },
    ],
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
    catalog: [rope],
    items: [
      {
        id: 'item-1',
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
    ],
    currencies: [
      { id: 'c-inv-a', stashId: 'inv-a', cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
      { id: 'c-ps', stashId: 'ps', cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
      { id: 'c-rl', stashId: 'rl', cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    ],
    log: [],
  };
}

const state = makeState();

describe('summarizeLogEntry — item variants', () => {
  it('acquire', () => {
    const entry: TransactionLogEntry = {
      ...baseFields(),
      type: 'acquire',
      payload: {
        stashId: 'inv-a',
        itemInstanceId: 'item-1',
        definitionId: 'phb-2024:rope',
        quantity: 2,
        source: 'catalog-add',
      },
    };
    expect(summarizeLogEntry(entry, state)).toBe(
      'Acquired Rope \u00d72 into Aeryn \u2014 Inventory (source: catalog-add)',
    );
  });

  it('consume (removed=false)', () => {
    const entry: TransactionLogEntry = {
      ...baseFields(),
      type: 'consume',
      payload: { stashId: 'inv-a', itemInstanceId: 'item-1', quantity: 1, removed: false },
    };
    expect(summarizeLogEntry(entry, state)).toBe('Consumed Rope \u00d71');
  });

  it('consume (removed=true)', () => {
    const entry: TransactionLogEntry = {
      ...baseFields(),
      type: 'consume',
      payload: { stashId: 'inv-a', itemInstanceId: 'item-1', quantity: 1, removed: true },
    };
    expect(summarizeLogEntry(entry, state)).toBe('Removed Rope (consumed last 1)');
  });

  it('edit-item-instance', () => {
    const entry: TransactionLogEntry = {
      ...baseFields(),
      type: 'edit-item-instance',
      payload: { itemInstanceId: 'item-1', changedFields: ['customName', 'notes'] },
    };
    expect(summarizeLogEntry(entry, state)).toBe('Edited Rope \u2014 customName + notes');
  });

  it('transfer cross-stash', () => {
    const entry: TransactionLogEntry = {
      ...baseFields(),
      type: 'transfer',
      payload: { itemInstanceId: 'item-1', quantity: 1, fromStashId: 'inv-a', toStashId: 'ps' },
    };
    expect(summarizeLogEntry(entry, state)).toBe(
      'Transferred Rope \u00d71 from Aeryn \u2014 Inventory to Party Stash',
    );
  });

  it('split (no viewingItemId)', () => {
    const entry: TransactionLogEntry = {
      ...baseFields(),
      type: 'split',
      payload: {
        sourceInstanceId: 'item-1',
        newInstanceId: 'item-2',
        quantity: 1,
        stashId: 'inv-a',
      },
    };
    expect(summarizeLogEntry(entry, state)).toBe(
      'Split Rope \u00d71 into a new row (in Aeryn \u2014 Inventory)',
    );
  });

  it('split (viewingItemId = source)', () => {
    const entry: TransactionLogEntry = {
      ...baseFields(),
      type: 'split',
      payload: {
        sourceInstanceId: 'item-1',
        newInstanceId: 'item-2',
        quantity: 1,
        stashId: 'inv-a',
      },
    };
    expect(summarizeLogEntry(entry, state, 'item-1')).toBe('Split \u00d71 into a new row');
  });

  it('split (viewingItemId = new)', () => {
    const entry: TransactionLogEntry = {
      ...baseFields(),
      type: 'split',
      payload: {
        sourceInstanceId: 'item-1',
        newInstanceId: 'item-2',
        quantity: 1,
        stashId: 'inv-a',
      },
    };
    expect(summarizeLogEntry(entry, state, 'item-2')).toBe(
      'Split off from another stack (\u00d71)',
    );
  });

  it('equip / unequip / attune / unattune', () => {
    const equip: TransactionLogEntry = {
      ...baseFields(),
      type: 'equip',
      payload: { itemInstanceId: 'item-1', characterId: 'char-a' },
    };
    expect(summarizeLogEntry(equip, state)).toBe('Equipped Rope on Aeryn');

    const unequip: TransactionLogEntry = {
      ...baseFields(),
      type: 'unequip',
      payload: { itemInstanceId: 'item-1', characterId: 'char-a' },
    };
    expect(summarizeLogEntry(unequip, state)).toBe('Unequipped Rope on Aeryn');

    const attune: TransactionLogEntry = {
      ...baseFields(),
      type: 'attune',
      payload: { itemInstanceId: 'item-1', characterId: 'char-a', overrideCap: true },
    };
    expect(summarizeLogEntry(attune, state)).toBe('Attuned Rope to Aeryn (DM cap override)');

    const unattune: TransactionLogEntry = {
      ...baseFields(),
      type: 'unattune',
      payload: { itemInstanceId: 'item-1', characterId: 'char-a' },
    };
    expect(summarizeLogEntry(unattune, state)).toBe('Unattuned Rope from Aeryn');
  });

  it('use-charge (single vs plural)', () => {
    const one: TransactionLogEntry = {
      ...baseFields(),
      type: 'use-charge',
      payload: { itemInstanceId: 'item-1', characterId: 'char-a', amount: 1 },
    };
    expect(summarizeLogEntry(one, state)).toBe('Used \u00d71 charge on Rope');

    const three: TransactionLogEntry = { ...one, payload: { ...one.payload, amount: 3 } };
    expect(summarizeLogEntry(three, state)).toBe('Used \u00d73 charges on Rope');
  });

  it('recharge', () => {
    const entry: TransactionLogEntry = {
      ...baseFields(),
      type: 'recharge',
      payload: {
        itemInstanceId: 'item-1',
        characterId: 'char-a',
        from: 2,
        to: 5,
        trigger: 'long-rest',
      },
    };
    expect(summarizeLogEntry(entry, state)).toBe('Recharged Rope +3 (2 \u2192 5, long rest)');
  });

  it('identify flips', () => {
    const identified: TransactionLogEntry = {
      ...baseFields(),
      type: 'identify',
      payload: { itemInstanceId: 'item-1', previousIdentified: false, newIdentified: true },
    };
    expect(summarizeLogEntry(identified, state)).toBe('Identified Rope');

    const unident: TransactionLogEntry = {
      ...identified,
      payload: { itemInstanceId: 'item-1', previousIdentified: true, newIdentified: false },
    };
    expect(summarizeLogEntry(unident, state)).toBe('Marked Rope unidentified');

    const hintSet: TransactionLogEntry = {
      ...identified,
      payload: {
        itemInstanceId: 'item-1',
        previousIdentified: true,
        newIdentified: true,
        newHint: 'smells like lavender',
      },
    };
    expect(summarizeLogEntry(hintSet, state)).toBe(
      'Set unidentified hint on Rope to "smells like lavender"',
    );
  });
});

describe('summarizeLogEntry — character/party variants', () => {
  it('create-character (player)', () => {
    const entry: TransactionLogEntry = {
      ...baseFields(),
      type: 'create-character',
      payload: {
        userId: 'u1',
        partyId: 'p1',
        partyStashId: 'ps',
        recoveredLootStashId: 'rl',
        characterId: 'char-a',
        name: 'Aeryn',
        inventoryStashId: 'inv-a',
      },
    };
    expect(summarizeLogEntry(entry, state)).toBe('Created character Aeryn');
  });

  it('create-character (DM-only)', () => {
    const entry: TransactionLogEntry = {
      ...baseFields(),
      type: 'create-character',
      payload: {
        userId: 'u1',
        partyId: 'p1',
        partyStashId: 'ps',
        recoveredLootStashId: 'rl',
        dmOnly: true,
      },
    };
    expect(summarizeLogEntry(entry, state)).toBe('Created party (DM only)');
  });

  it('delete-character', () => {
    const entry: TransactionLogEntry = {
      ...baseFields(),
      type: 'delete-character',
      payload: { characterId: 'char-a', name: 'Aeryn', itemCount: 4, currencyTotalCp: 200 },
    };
    expect(summarizeLogEntry(entry, state)).toBe(
      'Deleted character Aeryn (4 items to Recovered Loot)',
    );
  });

  it('rename-character / edit-character / set-encumbrance', () => {
    const rename: TransactionLogEntry = {
      ...baseFields(),
      type: 'rename-character',
      payload: { characterId: 'char-a', oldName: 'Old', newName: 'New' },
    };
    expect(summarizeLogEntry(rename, state)).toBe('Renamed character "Old" \u2192 "New"');

    const edit: TransactionLogEntry = {
      ...baseFields(),
      type: 'edit-character',
      payload: { characterId: 'char-a', changedFields: ['level', 'str'] },
    };
    expect(summarizeLogEntry(edit, state)).toBe('Edited Aeryn \u2014 level + str');

    const enc: TransactionLogEntry = {
      ...baseFields(),
      type: 'set-encumbrance',
      payload: {
        partyId: 'p1',
        oldRule: 'off',
        newRule: 'phb',
        oldEnforce: false,
        newEnforce: true,
      },
    };
    expect(summarizeLogEntry(enc, state)).toBe('Party encumbrance: off\u2192phb, enforce=true');
  });

  it('rename-party', () => {
    const entry: TransactionLogEntry = {
      ...baseFields(),
      type: 'rename-party',
      payload: { partyId: 'p1', oldName: 'Old', newName: 'New' },
    };
    expect(summarizeLogEntry(entry, state)).toBe('Renamed party "Old" \u2192 "New"');
  });
});

describe('summarizeLogEntry — stash + currency + homebrew + membership', () => {
  it('create-stash / rename-stash / delete-stash', () => {
    const create: TransactionLogEntry = {
      ...baseFields(),
      type: 'create-stash',
      payload: { stashId: 's1', scope: 'character', name: 'Bag of Holding' },
    };
    expect(summarizeLogEntry(create, state)).toBe('Created stash "Bag of Holding" (character)');

    const rename: TransactionLogEntry = {
      ...baseFields(),
      type: 'rename-stash',
      payload: { stashId: 's1', oldName: 'Old', newName: 'New' },
    };
    expect(summarizeLogEntry(rename, state)).toBe('Renamed stash "Old" \u2192 "New"');

    const del: TransactionLogEntry = {
      ...baseFields(),
      type: 'delete-stash',
      payload: { stashId: 's1', name: 'Bag of Holding', itemCount: 4, currencyTotalCp: 0 },
    };
    expect(summarizeLogEntry(del, state)).toBe(
      'Deleted stash "Bag of Holding" (4 items to Recovered Loot)',
    );
  });

  it('currency-change', () => {
    const entry: TransactionLogEntry = {
      ...baseFields(),
      type: 'currency-change',
      payload: {
        stashId: 'ps',
        delta: { cp: 0, sp: 0, ep: 0, gp: 50, pp: 0 },
        reason: 'deposit',
      },
    };
    expect(summarizeLogEntry(entry, state)).toBe('Currency +50gp on Party Stash (deposit)');
  });

  it('currency-transfer', () => {
    const entry: TransactionLogEntry = {
      ...baseFields(),
      type: 'currency-transfer',
      payload: {
        fromStashId: 'inv-a',
        toStashId: 'ps',
        delta: { cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 },
      },
    };
    expect(summarizeLogEntry(entry, state)).toBe(
      'Transferred 10gp from Aeryn \u2014 Inventory to Party Stash',
    );
  });

  it('create-homebrew / edit-homebrew / delete-homebrew', () => {
    const create: TransactionLogEntry = {
      ...baseFields(),
      type: 'create-homebrew',
      payload: { definitionId: 'hb1', name: 'Amulet of X' },
    };
    expect(summarizeLogEntry(create, state)).toBe('Created homebrew item "Amulet of X"');

    const edit: TransactionLogEntry = {
      ...baseFields(),
      type: 'edit-homebrew',
      payload: { definitionId: 'hb1', changedFields: ['name'] },
    };
    expect(summarizeLogEntry(edit, state)).toBe('Edited homebrew \u2014 name');

    const del: TransactionLogEntry = {
      ...baseFields(),
      type: 'delete-homebrew',
      payload: { definitionId: 'hb1', name: 'Amulet of X' },
    };
    expect(summarizeLogEntry(del, state)).toBe('Deleted homebrew item "Amulet of X"');
  });

  it('seed-catalog', () => {
    const entry: TransactionLogEntry = {
      ...baseFields(),
      type: 'seed-catalog',
      payload: {
        seedVersion: 3,
        addedDefinitionIds: ['a', 'b'],
        updatedDefinitionIds: ['c'],
      },
    };
    expect(summarizeLogEntry(entry, state)).toBe('Catalog seeded (v3: +2, ~1)');
  });

  it('leave-party / join-party / kick-player', () => {
    const leave: TransactionLogEntry = {
      ...baseFields(),
      type: 'leave-party',
      payload: { partyId: 'p1' },
    };
    expect(summarizeLogEntry(leave, state)).toBe('Left party');

    const join: TransactionLogEntry = {
      ...baseFields(),
      type: 'join-party',
      payload: { partyId: 'p1' },
    };
    expect(summarizeLogEntry(join, state)).toBe('Joined party');

    const kick: TransactionLogEntry = {
      ...baseFields(),
      type: 'kick-player',
      payload: { kickedUserId: 'u2' },
    };
    expect(summarizeLogEntry(kick, state)).toBe('Kicked player');
  });

  it('appoint-banker / revoke-banker / dm-transfer', () => {
    const appoint: TransactionLogEntry = {
      ...baseFields(),
      type: 'appoint-banker',
      payload: { bankerUserId: 'u1' },
    };
    expect(summarizeLogEntry(appoint, state)).toBe('Appointed banker');

    const revoke: TransactionLogEntry = {
      ...baseFields(),
      type: 'revoke-banker',
      payload: { reason: 'manual' },
    };
    expect(summarizeLogEntry(revoke, state)).toBe('Revoked banker (manual)');

    const dm: TransactionLogEntry = {
      ...baseFields(),
      type: 'dm-transfer',
      payload: { oldDmUserId: 'u1', newDmUserId: 'u2' },
    };
    expect(summarizeLogEntry(dm, state)).toBe('DM role transferred');
  });

  it('split-evenly', () => {
    const entry: TransactionLogEntry = {
      ...baseFields(),
      type: 'split-evenly',
      payload: {
        fromStashId: 'ps',
        recipientCharacterIds: ['char-a', 'char-b'],
        sharePerRecipient: { cp: 0, sp: 0, ep: 0, gp: 5, pp: 0 },
        remainderInPool: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
      },
    };
    expect(summarizeLogEntry(entry, state)).toBe('Split currency evenly among 2 recipients');
  });
});

describe('summarizeLogEntry — session variants', () => {
  it('start-game-session (resolves number from state.gameSessions)', () => {
    const entry: TransactionLogEntry = {
      ...baseFields(),
      type: 'start-game-session',
      payload: { gameSessionId: 'gs1', number: 3, date: '2026-07-04' },
    };
    expect(summarizeLogEntry(entry, state)).toBe('Started Session 3 (2026-07-04)');
  });

  it('end-game-session', () => {
    const entry: TransactionLogEntry = {
      ...baseFields(),
      type: 'end-game-session',
      payload: { gameSessionId: 'gs1', number: 3 },
    };
    expect(summarizeLogEntry(entry, state)).toBe('Ended Session 3');
  });

  it('edit-game-session-notes', () => {
    const entry: TransactionLogEntry = {
      ...baseFields(),
      type: 'edit-game-session-notes',
      payload: {
        gameSessionId: 'gs1',
        number: 3,
        oldNotes: 'Old',
        newNotes: 'New',
      },
    };
    expect(summarizeLogEntry(entry, state)).toBe('Updated Session 3 notes');
  });
});
