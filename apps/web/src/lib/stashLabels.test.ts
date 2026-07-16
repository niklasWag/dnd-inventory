import { describe, expect, it } from 'vitest';

import { buildStashLabels, shortStashId } from './stashLabels';
import type { Character, Stash, TransactionLogEntry } from '@app/shared';

function characterStash(
  id: string,
  name: string,
  ownerCharacterId: string,
  isCarried = false,
): Stash {
  return {
    id,
    scope: 'character',
    name,
    ownerCharacterId,
    partyId: null,
    isCarried,
    createdAt: '2026-06-24T00:00:00.000Z',
  };
}

function partyStash(id: string, name: string, partyId: string): Stash {
  return {
    id,
    scope: 'party',
    name,
    ownerCharacterId: null,
    partyId,
    isCarried: false,
    createdAt: '2026-06-24T00:00:00.000Z',
  };
}

function recoveredLootStash(id: string, name: string, partyId: string): Stash {
  return {
    id,
    scope: 'recovered-loot',
    name,
    ownerCharacterId: null,
    partyId,
    isCarried: false,
    createdAt: '2026-06-24T00:00:00.000Z',
  };
}

function makeChar(id: string, name: string): Character {
  return {
    id,
    partyId: 'p',
    ownerUserId: 'u',
    name,
    species: 'Dwarf',
    size: 'medium',
    class: 'Fighter',
    level: 1,
    abilityScores: { STR: 10 },
    maxAttunement: 3,
    inventoryStashId: 's',
    wishlist: [],
  };
}

function deleteEntry(
  stashId: string,
  name: string,
  ownerCharacterId?: string,
): TransactionLogEntry {
  return {
    id: `log-${stashId}`,
    partyId: 'p',
    sessionId: null,
    timestamp: '2026-06-24T00:00:00.000Z',
    actorUserId: 'u',
    actorRole: 'player',
    type: 'delete-stash',
    payload: {
      stashId,
      name,
      itemCount: 0,
      currencyTotalCp: 0,
      ...(ownerCharacterId !== undefined ? { ownerCharacterId } : {}),
    },
  };
}

describe('lib.stashLabels.buildStashLabels (M5)', () => {
  it('prefixes character-scope stashes with the owning character name', () => {
    const characters = [makeChar('c1', 'Thorin')];
    const stashes = [
      characterStash('s1', 'Inventory', 'c1', true),
      characterStash('s2', 'Chest at home', 'c1'),
    ];
    const labels = buildStashLabels(stashes, characters, []);
    expect(labels.get('s1')).toBe('Thorin \u2014 Inventory');
    expect(labels.get('s2')).toBe('Thorin \u2014 Chest at home');
  });

  it('uses bare names for party-scope and recovered-loot stashes', () => {
    const stashes = [
      partyStash('p1', 'Party Stash', 'p'),
      recoveredLootStash('l1', 'Recovered Loot', 'p'),
    ];
    const labels = buildStashLabels(stashes, [], []);
    expect(labels.get('p1')).toBe('Party Stash');
    expect(labels.get('l1')).toBe('Recovered Loot');
  });

  it('resolves deleted stashes from the log with the "(deleted)" suffix and char prefix', () => {
    const characters = [makeChar('c1', 'Thorin')];
    const stashes: Stash[] = [];
    const log = [deleteEntry('gone-1', 'Old Chest', 'c1')];
    const labels = buildStashLabels(stashes, characters, log);
    expect(labels.get('gone-1')).toBe('Thorin \u2014 Old Chest (deleted)');
  });

  it('renders deleted stashes without a char prefix when ownerCharacterId is missing (pre-amendment entries)', () => {
    const log = [deleteEntry('gone-2', 'Mystery Stash')];
    const labels = buildStashLabels([], [], log);
    expect(labels.get('gone-2')).toBe('Mystery Stash (deleted)');
  });

  it("live stashes win over delete-log entries with the same id (shouldn't happen but defends the order)", () => {
    const stashes = [partyStash('s1', 'Live Name', 'p')];
    const log = [deleteEntry('s1', 'Old Name')];
    const labels = buildStashLabels(stashes, [], log);
    expect(labels.get('s1')).toBe('Live Name');
  });

  it('returns an empty map when given null stashes and characters', () => {
    const labels = buildStashLabels(null, null, []);
    expect(labels.size).toBe(0);
  });
});

describe('lib.stashLabels.shortStashId (M5)', () => {
  it('returns the first 8 chars of the id', () => {
    expect(shortStashId('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe('aaaaaaaa');
  });
});
