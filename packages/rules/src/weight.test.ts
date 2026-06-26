import { describe, expect, it } from 'vitest';

import * as weight from './weight';

/**
 * Flat-list weight aggregation. R1.1 sums `weight × quantity` across
 * a row list — no container traversal yet (MVP items don't nest).
 *
 * R1.2 will widen the signature to accept `ItemInstance` +
 * `ItemDefinition` pairs and implement the OUTLINE §3.6 container
 * cascade: contents contribute their own weight unless the parent's
 * `ItemDefinition.flatWeight === true` (Bag of Holding etc.).
 *
 * Consumer: `apps/web/src/components/inventory/CapacityBar.tsx`.
 */

describe('rules.weight.totalWeight (R1.1)', () => {
  it('returns 0 for an empty list', () => {
    expect(weight.totalWeight([])).toBe(0);
  });

  it('sums a single row', () => {
    expect(weight.totalWeight([{ weight: 10, quantity: 1 }])).toBe(10);
  });

  it('applies quantity as a multiplier', () => {
    // 5× Hempen Rope (10 lb each) = 50 lb.
    expect(weight.totalWeight([{ weight: 10, quantity: 5 }])).toBe(50);
  });

  it('sums across multiple rows', () => {
    expect(
      weight.totalWeight([
        { weight: 10, quantity: 1 }, // 10
        { weight: 2, quantity: 3 }, // 6
        { weight: 5, quantity: 2 }, // 10
      ]),
    ).toBe(26);
  });

  it('handles zero-weight items', () => {
    // Many PHB consumables (rations etc.) ship with weight 0; they
    // contribute nothing to encumbrance.
    expect(weight.totalWeight([{ weight: 0, quantity: 100 }])).toBe(0);
  });

  it('handles fractional weights without rounding', () => {
    // OUTLINE doesn't forbid fractional weights — D&D 5e ships some
    // (1/2 lb arrows etc.). The aggregator must stay numeric.
    expect(weight.totalWeight([{ weight: 0.05, quantity: 20 }])).toBeCloseTo(1, 10);
  });

  it('returns 0 when all rows have quantity 0', () => {
    // Quantity 0 is a transient reducer state during consume; the
    // aggregator handles it cleanly without special-casing.
    expect(weight.totalWeight([{ weight: 10, quantity: 0 }])).toBe(0);
  });
});

describe('rules.weight.containerAwareWeight (R1.3)', () => {
  /**
   * R1.3 — descends into single-level containers respecting OUTLINE §3.6:
   * an item with `containerInstanceId === parent.id` adds its `weight ×
   * quantity` toward total UNLESS the parent's `ItemDefinition.flatWeight
   * === true` (Bag-of-Holding-style; contents become "free" weight-wise).
   *
   * Signature widens from the flat-row aggregator to `(rows,
   * definitionsById)` so the rule can resolve `flatWeight` off each
   * parent's definition. The R1.1 `totalWeight` flat aggregator stays
   * untouched — it's still the right shape for non-container inputs.
   */

  type Row = {
    id: string;
    definitionId: string;
    ownerId: string;
    quantity: number;
    containerInstanceId: string | null;
  };
  type Def = { id: string; weight: number; flatWeight?: boolean };

  const rope: Def = { id: 'rope', weight: 10 };
  const ration: Def = { id: 'ration', weight: 2 };
  const backpack: Def = { id: 'backpack', weight: 5 };
  const bagOfHolding: Def = { id: 'bag-of-holding', weight: 15, flatWeight: true };

  const defs = new Map<string, Def>([
    [rope.id, rope],
    [ration.id, ration],
    [backpack.id, backpack],
    [bagOfHolding.id, bagOfHolding],
  ]);

  it('matches totalWeight for the no-container case', () => {
    const rows: Row[] = [
      { id: 'r1', definitionId: 'rope', ownerId: 'inv', quantity: 1, containerInstanceId: null },
      { id: 'r2', definitionId: 'ration', ownerId: 'inv', quantity: 3, containerInstanceId: null },
    ];
    expect(weight.containerAwareWeight(rows, defs)).toBe(16); // 10 + 2*3
  });

  it('sums contents of a normal (non-flatWeight) container', () => {
    const rows: Row[] = [
      {
        id: 'pack',
        definitionId: 'backpack',
        ownerId: 'inv',
        quantity: 1,
        containerInstanceId: null,
      },
      {
        id: 'food',
        definitionId: 'ration',
        ownerId: 'inv',
        quantity: 3,
        containerInstanceId: 'pack',
      },
    ];
    // backpack (5) + 3 rations × 2 = 11.
    expect(weight.containerAwareWeight(rows, defs)).toBe(11);
  });

  it('ignores contents of a flatWeight: true container (Bag of Holding)', () => {
    const rows: Row[] = [
      {
        id: 'boh',
        definitionId: 'bag-of-holding',
        ownerId: 'inv',
        quantity: 1,
        containerInstanceId: null,
      },
      {
        id: 'food',
        definitionId: 'ration',
        ownerId: 'inv',
        quantity: 50,
        containerInstanceId: 'boh',
      },
      {
        id: 'rope',
        definitionId: 'rope',
        ownerId: 'inv',
        quantity: 10,
        containerInstanceId: 'boh',
      },
    ];
    // Only the BoH's own weight (15) counts — 50 rations + 10 ropes inside vanish.
    expect(weight.containerAwareWeight(rows, defs)).toBe(15);
  });

  it('mixes flat and non-flat containers correctly', () => {
    const rows: Row[] = [
      // Backpack (5) + 3 rations (6) inside = 11
      {
        id: 'pack',
        definitionId: 'backpack',
        ownerId: 'inv',
        quantity: 1,
        containerInstanceId: null,
      },
      {
        id: 'food',
        definitionId: 'ration',
        ownerId: 'inv',
        quantity: 3,
        containerInstanceId: 'pack',
      },
      // BoH (15) + 50 ropes inside (free) = 15
      {
        id: 'boh',
        definitionId: 'bag-of-holding',
        ownerId: 'inv',
        quantity: 1,
        containerInstanceId: null,
      },
      { id: 'r', definitionId: 'rope', ownerId: 'inv', quantity: 50, containerInstanceId: 'boh' },
      // Plus 1 loose rope outside containers (10)
      { id: 'loose', definitionId: 'rope', ownerId: 'inv', quantity: 1, containerInstanceId: null },
    ];
    expect(weight.containerAwareWeight(rows, defs)).toBe(36); // 11 + 15 + 10
  });

  it('ignores rows whose definitionId is missing from the map (defensive)', () => {
    const rows: Row[] = [
      {
        id: 'unknown',
        definitionId: 'mystery',
        ownerId: 'inv',
        quantity: 5,
        containerInstanceId: null,
      },
    ];
    expect(weight.containerAwareWeight(rows, defs)).toBe(0);
  });

  it('treats flatWeight: undefined the same as flatWeight: false (homebrew default)', () => {
    // Homebrew rows that omit the field must descend normally.
    const homebrewBag: Def = { id: 'homebrew-bag', weight: 4 }; // flatWeight absent
    const localDefs = new Map<string, Def>([
      [homebrewBag.id, homebrewBag],
      [ration.id, ration],
    ]);
    const rows: Row[] = [
      {
        id: 'bag',
        definitionId: 'homebrew-bag',
        ownerId: 'inv',
        quantity: 1,
        containerInstanceId: null,
      },
      {
        id: 'food',
        definitionId: 'ration',
        ownerId: 'inv',
        quantity: 2,
        containerInstanceId: 'bag',
      },
    ];
    expect(weight.containerAwareWeight(rows, localDefs)).toBe(8); // 4 + 2*2
  });
});
