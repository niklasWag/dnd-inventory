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
