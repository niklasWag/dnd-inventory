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
        class: 'Fighter',
        level: 1,
        abilityScores: { STR: 16 },
        maxAttunement: 3,
        encumbranceRule: 'off',
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
});
