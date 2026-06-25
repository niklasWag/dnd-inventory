import { describe, expect, it } from 'vitest';

import { appStateSchema, type AppState } from './appState';

/**
 * Round-trip test (per roadmap M1 schemas checklist): parse → serialize →
 * parse equals input. Confirms every schema in the bundle round-trips JSON
 * cleanly, which is the load-bearing assumption for M7's export/import.
 *
 * The fixture is the smallest plausible AppState — exactly what a fresh
 * `create-character` action will produce in M1 (one user, one solo party,
 * dm + player memberships, one character, three stashes, three currency
 * holdings, one log entry).
 */
describe('appStateSchema round-trip', () => {
  const fixture: AppState = {
    version: 1,
    seedVersion: 0,
    user: {
      id: 'user-1',
      displayName: 'You',
      createdAt: '2026-06-23T10:00:00.000Z',
    },
    party: {
      id: 'party-1',
      name: 'My Campaign',
      ownerUserId: 'user-1',
      inviteCode: 'INV-ABCDEF',
      recoveredLootStashId: 'stash-loot',
      bankerUserId: null,
      isSoloShortcut: true,
      createdAt: '2026-06-23T10:00:00.000Z',
    },
    memberships: [
      {
        userId: 'user-1',
        partyId: 'party-1',
        role: 'dm',
        characterId: null,
        joinedAt: '2026-06-23T10:00:00.000Z',
        leftAt: null,
      },
      {
        userId: 'user-1',
        partyId: 'party-1',
        role: 'player',
        characterId: 'char-1',
        joinedAt: '2026-06-23T10:00:00.000Z',
        leftAt: null,
      },
    ],
    characters: [
      {
        id: 'char-1',
        partyId: 'party-1',
        ownerUserId: 'user-1',
        name: 'Thorin',
        species: 'Dwarf',
        size: 'medium',
        class: 'Fighter',
        level: 1,
        abilityScores: { STR: 16 },
        maxAttunement: 3,
        encumbranceRule: 'off',
        enforceEncumbrance: false,
        inventoryStashId: 'stash-inv',
      },
    ],
    stashes: [
      {
        id: 'stash-inv',
        scope: 'character',
        name: 'Inventory',
        ownerCharacterId: 'char-1',
        partyId: null,
        isCarried: true,
        createdAt: '2026-06-23T10:00:00.000Z',
      },
      {
        id: 'stash-party',
        scope: 'party',
        name: 'Party Stash',
        ownerCharacterId: null,
        partyId: 'party-1',
        isCarried: false,
        createdAt: '2026-06-23T10:00:00.000Z',
      },
      {
        id: 'stash-loot',
        scope: 'recovered-loot',
        name: 'Recovered Loot',
        ownerCharacterId: null,
        partyId: 'party-1',
        isCarried: false,
        createdAt: '2026-06-23T10:00:00.000Z',
      },
    ],
    catalog: [],
    items: [],
    currencies: [
      { id: 'cur-inv', stashId: 'stash-inv', cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
      { id: 'cur-party', stashId: 'stash-party', cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
      { id: 'cur-loot', stashId: 'stash-loot', cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    ],
    log: [
      {
        id: 'log-1',
        partyId: 'party-1',
        sessionId: null,
        timestamp: '2026-06-23T10:00:00.000Z',
        actorUserId: 'user-1',
        actorRole: 'dm',
        type: 'create-character',
        payload: {
          characterId: 'char-1',
          userId: 'user-1',
          partyId: 'party-1',
          name: 'Thorin',
          inventoryStashId: 'stash-inv',
          partyStashId: 'stash-party',
          recoveredLootStashId: 'stash-loot',
        },
      },
      {
        // M5: split entry round-trip. Confirms the new variant parses
        // alongside the existing M0–M4 union members.
        id: 'log-2',
        partyId: 'party-1',
        sessionId: null,
        timestamp: '2026-06-23T10:01:00.000Z',
        actorUserId: 'user-1',
        actorRole: 'player',
        type: 'split',
        payload: {
          sourceInstanceId: 'item-1',
          newInstanceId: 'item-2',
          quantity: 1,
          stashId: 'stash-inv',
        },
      },
      {
        // M5.5: currency-transfer round-trip. Atomic paired debit/credit
        // between two stashes; delta is the positive amount moved.
        id: 'log-3',
        partyId: 'party-1',
        sessionId: null,
        timestamp: '2026-06-24T10:00:00.000Z',
        actorUserId: 'user-1',
        actorRole: 'player',
        type: 'currency-transfer',
        payload: {
          fromStashId: 'stash-inv',
          toStashId: 'stash-party',
          delta: { cp: 0, sp: 0, ep: 0, gp: 5, pp: 0 },
        },
      },
      {
        // M6: create-homebrew round-trip. New homebrew definition added
        // to the catalog. `name` is snapshot at write time so future
        // readers don't have to lookup the (possibly renamed) row.
        id: 'log-4',
        partyId: 'party-1',
        sessionId: null,
        timestamp: '2026-06-24T11:00:00.000Z',
        actorUserId: 'user-1',
        actorRole: 'player',
        type: 'create-homebrew',
        payload: {
          definitionId: 'def-homebrew-1',
          name: 'Glowing Mushroom',
        },
      },
      {
        // M6: edit-homebrew round-trip. Mirrors edit-item-instance —
        // only changed field names are logged.
        id: 'log-5',
        partyId: 'party-1',
        sessionId: null,
        timestamp: '2026-06-24T11:01:00.000Z',
        actorUserId: 'user-1',
        actorRole: 'player',
        type: 'edit-homebrew',
        payload: {
          definitionId: 'def-homebrew-1',
          changedFields: ['name', 'description'],
        },
      },
      {
        // M6: delete-homebrew round-trip. Name snapshot lets history
        // render after the row is gone from the catalog.
        id: 'log-6',
        partyId: 'party-1',
        sessionId: null,
        timestamp: '2026-06-24T11:02:00.000Z',
        actorUserId: 'user-1',
        actorRole: 'player',
        type: 'delete-homebrew',
        payload: {
          definitionId: 'def-homebrew-1',
          name: 'Glowing Mushroom',
        },
      },
      {
        // M7: rename-character round-trip. Same payload shape as
        // rename-stash — oldName + newName recorded for history.
        id: 'log-7',
        partyId: 'party-1',
        sessionId: null,
        timestamp: '2026-06-24T11:03:00.000Z',
        actorUserId: 'user-1',
        actorRole: 'player',
        type: 'rename-character',
        payload: {
          characterId: 'char-1',
          oldName: 'Bara',
          newName: 'Bara of Waterdeep',
        },
      },
      {
        // M7: rename-party round-trip.
        id: 'log-8',
        partyId: 'party-1',
        sessionId: null,
        timestamp: '2026-06-24T11:04:00.000Z',
        actorUserId: 'user-1',
        actorRole: 'player',
        type: 'rename-party',
        payload: {
          partyId: 'party-1',
          oldName: 'My Campaign',
          newName: 'The Misfits',
        },
      },
      {
        // R1.1: set-encumbrance round-trip. Per-character flip of the
        // rule + the orthogonal `enforce` boolean. Mirrors the rename
        // pair: { characterId, oldRule, newRule, oldEnforce, newEnforce }
        // recorded.
        id: 'log-9',
        partyId: 'party-1',
        sessionId: null,
        timestamp: '2026-06-24T11:05:00.000Z',
        actorUserId: 'user-1',
        actorRole: 'player',
        type: 'set-encumbrance',
        payload: {
          characterId: 'char-1',
          oldRule: 'off',
          newRule: 'variant',
          oldEnforce: false,
          newEnforce: false,
        },
      },
    ],
  };

  it('parses a freshly-constructed AppState', () => {
    expect(appStateSchema.parse(fixture)).toEqual(fixture);
  });

  it('survives JSON round-trip (export → import is identity)', () => {
    const serialized = JSON.stringify(fixture);
    const parsed = appStateSchema.parse(JSON.parse(serialized));
    expect(parsed).toEqual(fixture);
  });

  it('rejects an invalid scope on a stash', () => {
    const bad = structuredClone(fixture) as unknown as Record<string, unknown>;
    (bad['stashes'] as Array<Record<string, unknown>>)[0]!['scope'] = 'solo';
    expect(() => appStateSchema.parse(bad)).toThrow();
  });

  it('R1.3 migration — imports a pre-R1.3 export without flatWeight or container fields', () => {
    // Pre-R1.3-vintage shape: definitions omit `flatWeight`, item rows
    // carry `containerInstanceId: null` (was a Zod literal pre-R1.3).
    // The schema relaxations land additively — older exports parse
    // cleanly with no migration step required.
    const aged = structuredClone(fixture);
    aged.catalog = [
      {
        id: 'phb-2024:backpack',
        name: 'Backpack',
        source: 'PHB',
        category: 'container',
        weight: 5,
        // NOTE: no `flatWeight` field — pre-R1.3 exports never wrote it.
      },
    ];
    aged.items = [
      {
        id: 'item-backpack',
        definitionId: 'phb-2024:backpack',
        ownerType: 'stash',
        ownerId: 'stash-inv',
        containerInstanceId: null,
        quantity: 1,
        equipped: false,
        attuned: false,
        identified: true,
        currentCharges: null,
      },
    ];
    expect(() => appStateSchema.parse(aged)).not.toThrow();
  });

  it('R1.3 — accepts an item with a non-null containerInstanceId', () => {
    const withContainer = structuredClone(fixture);
    withContainer.catalog = [
      {
        id: 'phb-2024:backpack',
        name: 'Backpack',
        source: 'PHB',
        category: 'container',
        weight: 5,
      },
    ];
    withContainer.items = [
      {
        id: 'item-backpack',
        definitionId: 'phb-2024:backpack',
        ownerType: 'stash',
        ownerId: 'stash-inv',
        containerInstanceId: null,
        quantity: 1,
        equipped: false,
        attuned: false,
        identified: true,
        currentCharges: null,
      },
      {
        id: 'item-rations',
        definitionId: 'phb-2024:backpack', // catalog id reused for test brevity
        ownerType: 'stash',
        ownerId: 'stash-inv',
        containerInstanceId: 'item-backpack', // now a non-null id
        quantity: 3,
        equipped: false,
        attuned: false,
        identified: true,
        currentCharges: null,
      },
    ];
    const parsed = appStateSchema.parse(withContainer);
    expect(parsed.items[1]!.containerInstanceId).toBe('item-backpack');
  });

  it('R1.3 — accepts an ItemDefinition with flatWeight: true', () => {
    const dmgFlavoured = structuredClone(fixture);
    dmgFlavoured.catalog = [
      {
        id: 'dmg-2024:bag-of-holding',
        name: 'Bag of Holding',
        source: 'PHB', // M2 schema still gates `source` to PHB|homebrew; DMG seed lands in R2.1
        category: 'container',
        weight: 15,
        flatWeight: true,
      },
    ];
    const parsed = appStateSchema.parse(dmgFlavoured);
    expect(parsed.catalog[0]!.flatWeight).toBe(true);
  });
});
