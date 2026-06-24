import { describe, expect, it } from 'vitest';

import * as capacity from './capacity';

/**
 * D&D 5e (2024) carrying capacity. Two rules + a size multiplier:
 *   - `phb`     — capacity = STR × 15 × size; over the cap is heavily-encumbered.
 *   - `variant` — PHB sidebar (p. 366); encumbered at > 5×STR×size, heavily at > 10×STR×size.
 * Both rules use STRICT `>` thresholds — equal-to does NOT trip.
 *
 * Size multipliers (PHB 2024 p. 366):
 *   Tiny/Small × 0.5, Medium × 1, Large × 2, Huge × 4, Gargantuan × 8.
 */

describe('rules.capacity.sizeMultiplier (R1.1)', () => {
  it('returns the PHB 2024 p. 366 multipliers', () => {
    expect(capacity.sizeMultiplier('tiny')).toBe(0.5);
    expect(capacity.sizeMultiplier('small')).toBe(0.5);
    expect(capacity.sizeMultiplier('medium')).toBe(1);
    expect(capacity.sizeMultiplier('large')).toBe(2);
    expect(capacity.sizeMultiplier('huge')).toBe(4);
    expect(capacity.sizeMultiplier('gargantuan')).toBe(8);
  });
});

describe('rules.capacity.carryCapacity (R1.1)', () => {
  it('returns STR × 15 × size multiplier for Medium', () => {
    expect(capacity.carryCapacity(10, 'medium')).toBe(150);
    expect(capacity.carryCapacity(14, 'medium')).toBe(210);
  });

  it('halves capacity for Small creatures', () => {
    // PHB 2024: Halfling STR 10 = 75 lb cap.
    expect(capacity.carryCapacity(10, 'small')).toBe(75);
  });

  it('doubles capacity for Large creatures', () => {
    // PHB 2024: A Large mount with STR 18 = 540 lb.
    expect(capacity.carryCapacity(18, 'large')).toBe(540);
  });

  it('×4 for Huge, ×8 for Gargantuan', () => {
    expect(capacity.carryCapacity(10, 'huge')).toBe(600);
    expect(capacity.carryCapacity(10, 'gargantuan')).toBe(1200);
  });

  it('handles edge STR values for Medium', () => {
    expect(capacity.carryCapacity(1, 'medium')).toBe(15);
    expect(capacity.carryCapacity(30, 'medium')).toBe(450);
    expect(capacity.carryCapacity(0, 'medium')).toBe(0);
  });
});

describe('rules.capacity.encumbranceState — phb rule (R1.1)', () => {
  // Medium baseline.
  it('Medium STR 10: unencumbered at 150 lb (boundary; strict >)', () => {
    expect(capacity.encumbranceState(150, 10, 'medium', 'phb')).toBe('unencumbered');
  });

  it('Medium STR 10: heavily-encumbered at 151 lb', () => {
    expect(capacity.encumbranceState(151, 10, 'medium', 'phb')).toBe('heavily-encumbered');
  });

  it('Small STR 10: heavily-encumbered at 76 lb (cap = 75)', () => {
    expect(capacity.encumbranceState(75, 10, 'small', 'phb')).toBe('unencumbered');
    expect(capacity.encumbranceState(76, 10, 'small', 'phb')).toBe('heavily-encumbered');
  });

  it('Large STR 10: cap is 300 lb', () => {
    expect(capacity.encumbranceState(300, 10, 'large', 'phb')).toBe('unencumbered');
    expect(capacity.encumbranceState(301, 10, 'large', 'phb')).toBe('heavily-encumbered');
  });

  it('never returns the intermediate "encumbered" state', () => {
    for (const weight of [50, 75, 100, 149, 150, 200]) {
      expect(capacity.encumbranceState(weight, 10, 'medium', 'phb')).not.toBe('encumbered');
    }
  });
});

describe('rules.capacity.encumbranceState — variant rule (R1.1)', () => {
  // Medium baseline: 5×STR = 50, 10×STR = 100.
  it('Medium STR 10: unencumbered at exactly 50 lb', () => {
    expect(capacity.encumbranceState(50, 10, 'medium', 'variant')).toBe('unencumbered');
  });

  it('Medium STR 10: encumbered at 51 lb', () => {
    expect(capacity.encumbranceState(51, 10, 'medium', 'variant')).toBe('encumbered');
  });

  it('Medium STR 10: heavily at 101 lb', () => {
    expect(capacity.encumbranceState(101, 10, 'medium', 'variant')).toBe('heavily-encumbered');
  });

  it('Small STR 10: thresholds halve to 25 / 50', () => {
    expect(capacity.encumbranceState(25, 10, 'small', 'variant')).toBe('unencumbered');
    expect(capacity.encumbranceState(26, 10, 'small', 'variant')).toBe('encumbered');
    expect(capacity.encumbranceState(50, 10, 'small', 'variant')).toBe('encumbered');
    expect(capacity.encumbranceState(51, 10, 'small', 'variant')).toBe('heavily-encumbered');
  });

  it('Large STR 10: thresholds double to 100 / 200', () => {
    expect(capacity.encumbranceState(100, 10, 'large', 'variant')).toBe('unencumbered');
    expect(capacity.encumbranceState(101, 10, 'large', 'variant')).toBe('encumbered');
    expect(capacity.encumbranceState(200, 10, 'large', 'variant')).toBe('encumbered');
    expect(capacity.encumbranceState(201, 10, 'large', 'variant')).toBe('heavily-encumbered');
  });
});

describe('rules.capacity.encumbranceState — off rule (R1.1)', () => {
  it('always returns unencumbered regardless of weight, size, or STR', () => {
    expect(capacity.encumbranceState(0, 10, 'medium', 'off')).toBe('unencumbered');
    expect(capacity.encumbranceState(99999, 1, 'tiny', 'off')).toBe('unencumbered');
    expect(capacity.encumbranceState(500, 10, 'gargantuan', 'off')).toBe('unencumbered');
  });
});

describe('rules.capacity.heavyThreshold (R1.1)', () => {
  it('returns STR × 15 × size for phb rule', () => {
    expect(capacity.heavyThreshold(10, 'medium', 'phb')).toBe(150);
    expect(capacity.heavyThreshold(10, 'small', 'phb')).toBe(75);
    expect(capacity.heavyThreshold(10, 'large', 'phb')).toBe(300);
  });

  it('returns STR × 10 × size for variant rule', () => {
    expect(capacity.heavyThreshold(10, 'medium', 'variant')).toBe(100);
    expect(capacity.heavyThreshold(10, 'small', 'variant')).toBe(50);
    expect(capacity.heavyThreshold(10, 'huge', 'variant')).toBe(400);
  });

  it('returns Infinity for off rule regardless of size', () => {
    expect(capacity.heavyThreshold(10, 'medium', 'off')).toBe(Infinity);
    expect(capacity.heavyThreshold(10, 'huge', 'off')).toBe(Infinity);
  });
});
