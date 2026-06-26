import { describe, expect, it } from 'vitest';

import * as inventory from './inventory';
import type { ItemInstance } from '@app/shared';

/**
 * Inventory math (OUTLINE §6, MVP §8). Three pure helpers that centralize
 * the move/split rules so reducer cases (`acquire`, `transfer`, `split`)
 * agree on the auto-stack key and the quantity-validation boundaries.
 *
 * Consumed by:
 *   - `apps/web/src/store/reducer.ts:transfer` → `findAutoStackTarget` to
 *     decide whether a moved row collapses into an existing row on
 *     arrival, plus `validateTransfer` for qty guard.
 *   - `apps/web/src/store/reducer.ts:split` → `validateSplit` for the
 *     strict `1 \u2264 qty < source.quantity` window.
 *   - (existing M2 `acquire` already inlines the auto-stack key search;
 *     refactoring it to call `findAutoStackTarget` is left for a future
 *     simplify pass — the inlined version is covered by M2 tests and
 *     the two paths are byte-identical.)
 */

/** Build a minimal `ItemInstance` with sensible MVP placeholder values. */
function makeItem(
  overrides: Partial<ItemInstance> &
    Pick<ItemInstance, 'id' | 'ownerId' | 'definitionId' | 'quantity'>,
): ItemInstance {
  return {
    ownerType: 'stash',
    containerInstanceId: null,
    equipped: false,
    attuned: false,
    identified: true,
    currentCharges: null,
    ...overrides,
  };
}

describe('rules.inventory.findAutoStackTarget (M5)', () => {
  it('returns undefined when no row matches the stash + definition', () => {
    const items = [
      makeItem({ id: 'a', ownerId: 'stash-1', definitionId: 'def-torch', quantity: 1 }),
    ];
    expect(inventory.findAutoStackTarget(items, 'stash-2', 'def-torch', undefined)).toBeUndefined();
    expect(inventory.findAutoStackTarget(items, 'stash-1', 'def-rope', undefined)).toBeUndefined();
  });

  it('finds a row with the same (stash, definition) when notes are both absent', () => {
    const target = makeItem({
      id: 'a',
      ownerId: 'stash-1',
      definitionId: 'def-torch',
      quantity: 3,
    });
    expect(inventory.findAutoStackTarget([target], 'stash-1', 'def-torch', undefined)).toBe(target);
  });

  it('treats absent notes as equivalent to empty string (auto-stack key collapses)', () => {
    const target = makeItem({
      id: 'a',
      ownerId: 'stash-1',
      definitionId: 'def-torch',
      quantity: 3,
      notes: '',
    });
    expect(inventory.findAutoStackTarget([target], 'stash-1', 'def-torch', undefined)).toBe(target);

    const target2 = makeItem({
      id: 'b',
      ownerId: 'stash-1',
      definitionId: 'def-torch',
      quantity: 3,
    });
    expect(inventory.findAutoStackTarget([target2], 'stash-1', 'def-torch', '')).toBe(target2);
  });

  it('matches on identical notes', () => {
    const target = makeItem({
      id: 'a',
      ownerId: 'stash-1',
      definitionId: 'def-torch',
      quantity: 3,
      notes: 'given by Volo',
    });
    expect(inventory.findAutoStackTarget([target], 'stash-1', 'def-torch', 'given by Volo')).toBe(
      target,
    );
  });

  it('does NOT match when notes differ', () => {
    const items = [
      makeItem({
        id: 'a',
        ownerId: 'stash-1',
        definitionId: 'def-torch',
        quantity: 3,
        notes: 'lit',
      }),
    ];
    expect(inventory.findAutoStackTarget(items, 'stash-1', 'def-torch', 'unlit')).toBeUndefined();
    expect(inventory.findAutoStackTarget(items, 'stash-1', 'def-torch', undefined)).toBeUndefined();
  });

  it('does NOT consider customName as part of the auto-stack key', () => {
    // Two rows with the same (stash, def, notes) but different customNames
    // still stack on the first match — customName is a per-instance label,
    // not part of the dedupe key.
    const a = makeItem({
      id: 'a',
      ownerId: 'stash-1',
      definitionId: 'def-torch',
      quantity: 1,
      customName: "Volo's torch",
    });
    expect(inventory.findAutoStackTarget([a], 'stash-1', 'def-torch', undefined)).toBe(a);
  });
});

describe('rules.inventory.validateTransfer (M5)', () => {
  it('accepts a partial transfer (qty < source.quantity)', () => {
    const source = makeItem({ id: 'a', ownerId: 'stash-1', definitionId: 'def', quantity: 5 });
    expect(() => {
      inventory.validateTransfer(source, 2);
    }).not.toThrow();
  });

  it('accepts a full transfer (qty === source.quantity)', () => {
    const source = makeItem({ id: 'a', ownerId: 'stash-1', definitionId: 'def', quantity: 5 });
    expect(() => {
      inventory.validateTransfer(source, 5);
    }).not.toThrow();
  });

  it('rejects qty <= 0', () => {
    const source = makeItem({ id: 'a', ownerId: 'stash-1', definitionId: 'def', quantity: 5 });
    expect(() => {
      inventory.validateTransfer(source, 0);
    }).toThrow(/positive/i);
    expect(() => {
      inventory.validateTransfer(source, -1);
    }).toThrow(/positive/i);
  });

  it('rejects non-integer qty', () => {
    const source = makeItem({ id: 'a', ownerId: 'stash-1', definitionId: 'def', quantity: 5 });
    expect(() => {
      inventory.validateTransfer(source, 1.5);
    }).toThrow(/integer/i);
  });

  it('rejects qty > source.quantity (over-transfer)', () => {
    const source = makeItem({ id: 'a', ownerId: 'stash-1', definitionId: 'def', quantity: 3 });
    expect(() => {
      inventory.validateTransfer(source, 4);
    }).toThrow(/exceeds|too large/i);
  });
});

describe('rules.inventory.validateSplit (M5)', () => {
  it('accepts qty strictly between 1 and source.quantity - 1 (inclusive)', () => {
    const source = makeItem({ id: 'a', ownerId: 'stash-1', definitionId: 'def', quantity: 5 });
    expect(() => {
      inventory.validateSplit(source, 1);
    }).not.toThrow();
    expect(() => {
      inventory.validateSplit(source, 4);
    }).not.toThrow();
  });

  it('rejects qty === source.quantity (would empty the source row)', () => {
    const source = makeItem({ id: 'a', ownerId: 'stash-1', definitionId: 'def', quantity: 3 });
    // qty === quantity is a "move", not a split — UI dispatches transfer instead.
    expect(() => {
      inventory.validateSplit(source, 3);
    }).toThrow(/exceeds|less than|<|cannot equal source/i);
  });

  it('rejects qty > source.quantity', () => {
    const source = makeItem({ id: 'a', ownerId: 'stash-1', definitionId: 'def', quantity: 3 });
    expect(() => {
      inventory.validateSplit(source, 4);
    }).toThrow();
  });

  it('rejects qty <= 0', () => {
    const source = makeItem({ id: 'a', ownerId: 'stash-1', definitionId: 'def', quantity: 5 });
    expect(() => {
      inventory.validateSplit(source, 0);
    }).toThrow(/positive/i);
    expect(() => {
      inventory.validateSplit(source, -1);
    }).toThrow(/positive/i);
  });

  it('rejects non-integer qty', () => {
    const source = makeItem({ id: 'a', ownerId: 'stash-1', definitionId: 'def', quantity: 5 });
    expect(() => {
      inventory.validateSplit(source, 2.5);
    }).toThrow(/integer/i);
  });

  it('rejects a source with quantity 1 (cannot split a singleton)', () => {
    const source = makeItem({ id: 'a', ownerId: 'stash-1', definitionId: 'def', quantity: 1 });
    expect(() => {
      inventory.validateSplit(source, 1);
    }).toThrow();
  });
});
