import { describe, expect, it } from 'vitest';

import type { ItemDefinition, ItemInstance } from '@app/shared';

import { UNKNOWN_MAGIC_ITEM_LABEL, displayName } from './identify';

function makeRow(overrides: Partial<ItemInstance> = {}): ItemInstance {
  return {
    id: 'item-1',
    definitionId: 'dmg-2024:cloak-of-protection',
    ownerType: 'stash',
    ownerId: 'stash-inv',
    containerInstanceId: null,
    quantity: 1,
    equipped: false,
    attuned: false,
    identified: true,
    currentCharges: null,
    ...overrides,
  };
}

function makeDef(overrides: Partial<ItemDefinition> = {}): ItemDefinition {
  return {
    id: 'dmg-2024:cloak-of-protection',
    name: 'Cloak of Protection',
    source: 'DMG',
    category: 'magic',
    ...overrides,
  };
}

describe('lib/identify (R2.3)', () => {
  it('UNKNOWN_MAGIC_ITEM_LABEL matches OUTLINE §8 verbatim', () => {
    expect(UNKNOWN_MAGIC_ITEM_LABEL).toBe('Unknown Magic Item');
  });

  it('displayName returns the definition name when identified=true', () => {
    expect(displayName(makeRow(), makeDef())).toBe('Cloak of Protection');
  });

  it('displayName returns "Unknown Magic Item" when identified=false', () => {
    expect(displayName(makeRow({ identified: false }), makeDef())).toBe(
      UNKNOWN_MAGIC_ITEM_LABEL,
    );
  });

  it('displayName uses customName when identified=true', () => {
    expect(
      displayName(makeRow({ customName: 'Stabby McStabface' }), makeDef()),
    ).toBe('Stabby McStabface');
  });

  it('displayName hides customName when identified=false (spoiler protection)', () => {
    expect(
      displayName(
        makeRow({ identified: false, customName: 'Stabby McStabface' }),
        makeDef(),
      ),
    ).toBe(UNKNOWN_MAGIC_ITEM_LABEL);
  });

  it('displayName falls back to "(unknown item)" when identified=true and def is missing', () => {
    expect(displayName(makeRow(), undefined)).toBe('(unknown item)');
  });

  it('displayName still returns "Unknown Magic Item" when identified=false and def is missing', () => {
    expect(displayName(makeRow({ identified: false }), undefined)).toBe(
      UNKNOWN_MAGIC_ITEM_LABEL,
    );
  });
});
