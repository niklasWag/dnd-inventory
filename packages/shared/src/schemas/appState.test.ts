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
      // R3.2 — userSchema .refine() requires at least one of discordId or
      // emailVerified. Populate discordId so the fixture parses; emailVerified
      // becomes load-bearing in R3.3.
      discordId: 'user-1',
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
    gameSessions: [],
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
      {
        // R2.2: use-charge round-trip. Mirrors `attune` shape (player-
        // role + characterId-on-payload) but also carries an `amount`.
        id: 'log-10',
        partyId: 'party-1',
        sessionId: null,
        timestamp: '2026-06-26T09:00:00.000Z',
        actorUserId: 'user-1',
        actorRole: 'player',
        type: 'use-charge',
        payload: {
          itemInstanceId: 'item-wand-1',
          characterId: 'char-1',
          amount: 1,
        },
      },
      {
        // R2.2: recharge round-trip. `trigger: 'manual'` covers the
        // Item Detail single-item Recharge button and the R6 DM
        // force-recharge path; batch dispatches fan out into N
        // entries with `trigger: 'dawn' | 'dusk' | 'long-rest' |
        // 'short-rest'`.
        id: 'log-11',
        partyId: 'party-1',
        sessionId: null,
        timestamp: '2026-06-26T09:01:00.000Z',
        actorUserId: 'user-1',
        actorRole: 'player',
        type: 'recharge',
        payload: {
          itemInstanceId: 'item-wand-1',
          characterId: 'char-1',
          from: 0,
          to: 7,
          trigger: 'manual',
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

  it('R1.5 — accepts a transfer entry with toContainerInstanceId as a string (pack)', () => {
    const packEntry = structuredClone(fixture);
    packEntry.log = [
      {
        id: 'log-1',
        partyId: packEntry.party.id,
        sessionId: null,
        timestamp: '2026-06-25T12:00:00.000Z',
        actorUserId: packEntry.user.id,
        actorRole: 'player',
        type: 'transfer',
        payload: {
          itemInstanceId: 'item-torch',
          quantity: 1,
          fromStashId: 'stash-inv',
          toStashId: 'stash-inv',
          toContainerInstanceId: 'item-backpack',
        },
      },
    ];
    const parsed = appStateSchema.parse(packEntry);
    const entry = parsed.log[0]!;
    if (entry.type !== 'transfer') throw new Error('expected transfer entry');
    expect(entry.payload.toContainerInstanceId).toBe('item-backpack');
  });

  it('R1.5 — accepts a transfer entry with toContainerInstanceId: null (take-out)', () => {
    const takeOutEntry = structuredClone(fixture);
    takeOutEntry.log = [
      {
        id: 'log-1',
        partyId: takeOutEntry.party.id,
        sessionId: null,
        timestamp: '2026-06-25T12:00:00.000Z',
        actorUserId: takeOutEntry.user.id,
        actorRole: 'player',
        type: 'transfer',
        payload: {
          itemInstanceId: 'item-torch',
          quantity: 1,
          fromStashId: 'stash-inv',
          toStashId: 'stash-inv',
          toContainerInstanceId: null,
        },
      },
    ];
    const parsed = appStateSchema.parse(takeOutEntry);
    const entry = parsed.log[0]!;
    if (entry.type !== 'transfer') throw new Error('expected transfer entry');
    expect(entry.payload.toContainerInstanceId).toBeNull();
  });

  it('R2.2 — accepts an ItemDefinition with a charges block', () => {
    const charged = structuredClone(fixture);
    charged.catalog = [
      {
        id: 'dmg-2024:wand-of-magic-missiles',
        name: 'Wand of Magic Missiles',
        source: 'DMG',
        category: 'magic',
        rarity: 'uncommon',
        requiresAttunement: false,
        charges: { max: 7, rechargeRule: 'dawn', rechargeAmount: '1d6+1' },
      },
    ];
    const parsed = appStateSchema.parse(charged);
    expect(parsed.catalog[0]!.charges).toEqual({
      max: 7,
      rechargeRule: 'dawn',
      rechargeAmount: '1d6+1',
    });
  });

  it('R2.2 — accepts an ItemInstance with currentCharges as a non-negative integer', () => {
    const withCharges = structuredClone(fixture);
    withCharges.catalog = [
      {
        id: 'dmg-2024:wand-of-magic-missiles',
        name: 'Wand of Magic Missiles',
        source: 'DMG',
        category: 'magic',
        rarity: 'uncommon',
        charges: { max: 7, rechargeRule: 'dawn' },
      },
    ];
    withCharges.items = [
      {
        id: 'item-wand-1',
        definitionId: 'dmg-2024:wand-of-magic-missiles',
        ownerType: 'stash',
        ownerId: 'stash-inv',
        containerInstanceId: null,
        quantity: 1,
        equipped: false,
        attuned: false,
        identified: true,
        currentCharges: 3,
      },
    ];
    const parsed = appStateSchema.parse(withCharges);
    expect(parsed.items[0]!.currentCharges).toBe(3);
  });

  it('R2.2 — rejects a negative currentCharges value', () => {
    const bad = structuredClone(fixture);
    bad.catalog = [
      {
        id: 'dmg-2024:wand-of-magic-missiles',
        name: 'Wand of Magic Missiles',
        source: 'DMG',
        category: 'magic',
        rarity: 'uncommon',
        charges: { max: 7, rechargeRule: 'dawn' },
      },
    ];
    bad.items = [
      {
        id: 'item-wand-1',
        definitionId: 'dmg-2024:wand-of-magic-missiles',
        ownerType: 'stash',
        ownerId: 'stash-inv',
        containerInstanceId: null,
        quantity: 1,
        equipped: false,
        attuned: false,
        identified: true,
        currentCharges: -1,
      },
    ];
    expect(() => appStateSchema.parse(bad)).toThrow();
  });

  it('R2.2 — rejects a charges block with max: 0', () => {
    const bad = structuredClone(fixture);
    bad.catalog = [
      {
        id: 'dmg-2024:broken-wand',
        name: 'Broken Wand',
        source: 'DMG',
        category: 'magic',
        rarity: 'common',
        charges: { max: 0, rechargeRule: 'dawn' },
      } as unknown as (typeof bad.catalog)[number],
    ];
    expect(() => appStateSchema.parse(bad)).toThrow();
  });

  it('R2.2 — edit-item-instance accepts currentCharges in changedFields', () => {
    const editEntry = structuredClone(fixture);
    editEntry.log = [
      {
        id: 'log-edit-charges',
        partyId: editEntry.party.id,
        sessionId: null,
        timestamp: '2026-06-26T10:00:00.000Z',
        actorUserId: editEntry.user.id,
        actorRole: 'player',
        type: 'edit-item-instance',
        payload: {
          itemInstanceId: 'item-wand-1',
          changedFields: ['currentCharges'],
        },
      },
    ];
    expect(() => appStateSchema.parse(editEntry)).not.toThrow();
  });

  it('R2.3 — accepts an ItemInstance with identified: false and a hint', () => {
    const unidentified = structuredClone(fixture);
    unidentified.catalog = [
      {
        id: 'dmg-2024:cloak-of-protection',
        name: 'Cloak of Protection',
        source: 'DMG',
        category: 'magic',
        rarity: 'uncommon',
        requiresAttunement: true,
      },
    ];
    unidentified.items = [
      {
        id: 'item-cloak-1',
        definitionId: 'dmg-2024:cloak-of-protection',
        ownerType: 'stash',
        ownerId: 'stash-inv',
        containerInstanceId: null,
        quantity: 1,
        equipped: false,
        attuned: false,
        identified: false,
        hint: 'shimmers faintly',
        currentCharges: null,
      },
    ];
    const parsed = appStateSchema.parse(unidentified);
    expect(parsed.items[0]!.identified).toBe(false);
    expect(parsed.items[0]!.hint).toBe('shimmers faintly');
  });

  it('R2.3 — rejects a hint that is not a string', () => {
    const bad = structuredClone(fixture);
    bad.catalog = [
      {
        id: 'phb-2024:torch',
        name: 'Torch',
        source: 'PHB',
        category: 'gear',
      },
    ];
    bad.items = [
      {
        id: 'item-x',
        definitionId: 'phb-2024:torch',
        ownerType: 'stash',
        ownerId: 'stash-inv',
        containerInstanceId: null,
        quantity: 1,
        equipped: false,
        attuned: false,
        identified: true,
        // hint must be a string when present.
        hint: 42 as unknown as string,
        currentCharges: null,
      },
    ];
    expect(() => appStateSchema.parse(bad)).toThrow();
  });

  it('R2.3 — identify log entry round-trips with full transition payload', () => {
    const identified = structuredClone(fixture);
    identified.log = [
      {
        id: 'log-identify-1',
        partyId: identified.party.id,
        sessionId: null,
        timestamp: '2026-06-26T11:00:00.000Z',
        actorUserId: identified.user.id,
        actorRole: 'dm',
        type: 'identify',
        payload: {
          itemInstanceId: 'item-cloak-1',
          previousIdentified: false,
          newIdentified: true,
          previousHint: 'shimmers faintly',
        },
      },
    ];
    const parsed = appStateSchema.parse(identified);
    const entry = parsed.log[0]!;
    expect(entry.type).toBe('identify');
    if (entry.type !== 'identify') throw new Error('expected identify');
    expect(entry.payload.previousIdentified).toBe(false);
    expect(entry.payload.newIdentified).toBe(true);
    expect(entry.payload.previousHint).toBe('shimmers faintly');
    expect(entry.payload.newHint).toBeUndefined();
  });

  it('R2.3 — identify log entry rejects when previousIdentified / newIdentified are missing', () => {
    const bad = structuredClone(fixture);
    bad.log = [
      {
        id: 'log-identify-bad',
        partyId: bad.party.id,
        sessionId: null,
        timestamp: '2026-06-26T11:00:00.000Z',
        actorUserId: bad.user.id,
        actorRole: 'dm',
        type: 'identify',
        // Missing previousIdentified / newIdentified — required by R2.3 schema.
        payload: {
          itemInstanceId: 'item-cloak-1',
        },
      } as unknown as (typeof bad.log)[number],
    ];
    expect(() => appStateSchema.parse(bad)).toThrow();
  });

  it('R2.3 — edit-item-instance accepts identified and hint in changedFields', () => {
    const editEntry = structuredClone(fixture);
    editEntry.log = [
      {
        id: 'log-edit-identified',
        partyId: editEntry.party.id,
        sessionId: null,
        timestamp: '2026-06-26T11:00:00.000Z',
        actorUserId: editEntry.user.id,
        actorRole: 'player',
        type: 'edit-item-instance',
        payload: {
          itemInstanceId: 'item-wand-1',
          changedFields: ['identified', 'hint'],
        },
      },
    ];
    expect(() => appStateSchema.parse(editEntry)).not.toThrow();
  });

  it('R4.1 — accepts a membership with a non-null leftAt timestamp', () => {
    // Soft-delete shape for `leave-party` / `kick-player` cascade
    // (OUTLINE §8.3). The schema widened from `z.null()` to
    // `z.string().datetime().nullable()`.
    const withLeftMember = structuredClone(fixture);
    withLeftMember.memberships = [
      ...withLeftMember.memberships,
      {
        userId: 'user-2',
        partyId: withLeftMember.party.id,
        role: 'player',
        characterId: null,
        joinedAt: '2026-06-23T10:00:00.000Z',
        leftAt: '2026-06-29T18:00:00.000Z',
      },
    ];
    const parsed = appStateSchema.parse(withLeftMember);
    expect(parsed.memberships[2]!.leftAt).toBe('2026-06-29T18:00:00.000Z');
  });
});
