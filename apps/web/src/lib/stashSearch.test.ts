import { describe, expect, it } from 'vitest';

import type { ItemDefinition, ItemInstance } from '@app/shared';

import { stashRowSearchable } from './stashSearch';

/**
 * R7.5 — search-adapter contract.
 *
 * The adapter respects the OUTLINE §8 identify display invariant:
 * unidentified rows must NOT expose their real name to a text-search
 * kernel that could otherwise let a player type "cloak of the bat"
 * and find their unidentified magic cloak.
 */

const baseDef = (over: Partial<ItemDefinition> = {}): ItemDefinition => ({
  id: 'def-1',
  name: 'Longsword',
  source: 'PHB',
  category: 'weapon',
  ...over,
});

const baseRow = (over: Partial<ItemInstance> = {}): ItemInstance => ({
  id: 'row-1',
  definitionId: 'def-1',
  ownerType: 'stash',
  ownerId: 'stash-1',
  containerInstanceId: null,
  quantity: 1,
  equipped: false,
  attuned: false,
  identified: true,
  currentCharges: null,
  ...over,
});

describe('stashRowSearchable — identified rows', () => {
  it('exposes def.name / def.description / def.tags', () => {
    const def = baseDef({ description: 'A martial melee weapon.', tags: ['martial', 'melee'] });
    const row = baseRow();
    const s = stashRowSearchable(row, def);
    expect(s.id).toBe('row-1');
    expect(s.name).toBe('Longsword');
    expect(s.description).toBe('A martial melee weapon.');
    expect(s.tags).toEqual(['martial', 'melee']);
  });

  it('prefers customName over def.name AND keeps def.name in tags as fallback', () => {
    const def = baseDef({ tags: ['martial'] });
    const row = baseRow({ customName: 'Blackreave' });
    const s = stashRowSearchable(row, def);
    expect(s.name).toBe('Blackreave');
    expect(s.tags).toContain('martial');
    expect(s.tags).toContain('Longsword');
  });

  it('includes notes in tags when present', () => {
    const row = baseRow({ notes: 'gift from Elric' });
    const s = stashRowSearchable(row, baseDef());
    expect(s.tags).toContain('gift from Elric');
  });

  it('handles a missing definition (orphan row) with empty name + no tags', () => {
    const s = stashRowSearchable(baseRow(), undefined);
    expect(s.name).toBe('');
    expect(s.description).toBe('');
    expect(s.tags).toEqual([]);
  });
});

describe('stashRowSearchable — unidentified rows (OUTLINE §8 invariant)', () => {
  it('replaces name with "Unknown Magic Item" even when def has a real name', () => {
    const def = baseDef({
      name: 'Cloak of the Bat',
      description: 'Grants flight.',
      tags: ['cloak'],
    });
    const row = baseRow({ identified: false, hint: 'leathery cloak' });
    const s = stashRowSearchable(row, def);
    expect(s.name).toBe('Unknown Magic Item');
    // Real name / description MUST NOT appear anywhere — a text search
    // for "cloak of the bat" or "flight" must miss this row.
    expect(s.description).toBe('');
    expect(s.tags).not.toContain('Cloak of the Bat');
    expect(s.tags).not.toContain('cloak');
  });

  it('exposes the hint (if any) as a tag so hint-text queries hit', () => {
    const row = baseRow({ identified: false, hint: 'smells of pine' });
    const s = stashRowSearchable(row, baseDef({ name: 'Bag of Holding' }));
    expect(s.tags).toEqual(['smells of pine']);
  });

  it('empty hint means no tags — the row is essentially unsearchable except by the generic label', () => {
    const row = baseRow({ identified: false });
    const s = stashRowSearchable(row, baseDef());
    expect(s.tags).toEqual([]);
  });

  it('ignores customName on unidentified rows (spoiler protection)', () => {
    // A nickname like "Grandpa's cloak" could out-reveal the item; suppress it.
    const row = baseRow({ identified: false, customName: "Grandpa's cloak", hint: 'leathery' });
    const s = stashRowSearchable(row, baseDef());
    expect(s.name).toBe('Unknown Magic Item');
    expect(s.tags).not.toContain("Grandpa's cloak");
  });
});
