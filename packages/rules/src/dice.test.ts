import { describe, expect, it } from 'vitest';

import { rollD20, rollInitiative, type RollMode } from './dice';

/**
 * R11 — Dice roller (initiative tracker).
 *
 * `rollD20(mode, rng)` draws a d20: one draw for `normal`, two draws
 * taking the best (advantage) or worst (disadvantage). `rollInitiative`
 * adds a signed modifier. Injectable `rng` ∈ [0,1) makes results
 * deterministic for tests (same pattern as `hoard.ts`).
 */

/** Deterministic rng that always returns the same value. */
function constRng(value: number): () => number {
  return () => value;
}

/** Deterministic rng that walks a sequence, looping. */
function seqRng(values: readonly number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i += 1;
    return v ?? 0;
  };
}

const MODES: RollMode[] = ['advantage', 'normal', 'disadvantage'];

describe('dice.rollD20', () => {
  it('rng=0 maps to a natural 1 (all modes)', () => {
    for (const mode of MODES) {
      expect(rollD20(mode, constRng(0))).toBe(1);
    }
  });

  it('rng≈0.999 maps to a natural 20 (all modes)', () => {
    for (const mode of MODES) {
      expect(rollD20(mode, constRng(0.999))).toBe(20);
    }
  });

  it('always lands in [1,20] across an rng sweep', () => {
    const samples = [0, 0.05, 0.25, 0.5, 0.75, 0.95, 0.999];
    for (const mode of MODES) {
      for (const v of samples) {
        const r = rollD20(mode, constRng(v));
        expect(r).toBeGreaterThanOrEqual(1);
        expect(r).toBeLessThanOrEqual(20);
      }
    }
  });

  it('advantage takes the higher of two draws', () => {
    // First draw low (→1), second draw high (→20): adv should pick 20.
    expect(rollD20('advantage', seqRng([0, 0.999]))).toBe(20);
    // Reversed order — still 20.
    expect(rollD20('advantage', seqRng([0.999, 0]))).toBe(20);
  });

  it('disadvantage takes the lower of two draws', () => {
    expect(rollD20('disadvantage', seqRng([0, 0.999]))).toBe(1);
    expect(rollD20('disadvantage', seqRng([0.999, 0]))).toBe(1);
  });

  it('normal consumes exactly one draw', () => {
    // Sequence [0.999, 0]: normal must use only the first (→20), ignoring
    // the second. If it consumed two, the result would differ.
    expect(rollD20('normal', seqRng([0.999, 0]))).toBe(20);
  });

  it('same rng → same result (determinism)', () => {
    for (const mode of MODES) {
      const a = rollD20(mode, seqRng([0.3, 0.7]));
      const b = rollD20(mode, seqRng([0.3, 0.7]));
      expect(a).toBe(b);
    }
  });
});

describe('dice.rollInitiative', () => {
  it('adds a positive modifier to the d20 result', () => {
    // rng=0 → nat 1; +5 = 6.
    expect(rollInitiative(5, 'normal', constRng(0))).toBe(6);
  });

  it('adds a negative modifier', () => {
    // rng≈0.999 → nat 20; -3 = 17.
    expect(rollInitiative(-3, 'normal', constRng(0.999))).toBe(17);
  });

  it('modifier of 0 equals the raw d20', () => {
    expect(rollInitiative(0, 'normal', constRng(0.5))).toBe(rollD20('normal', constRng(0.5)));
  });

  it('advantage ≥ disadvantage on the same two-draw sequence + modifier', () => {
    const seq = [0.2, 0.8] as const;
    const adv = rollInitiative(4, 'advantage', seqRng(seq));
    const dis = rollInitiative(4, 'disadvantage', seqRng(seq));
    expect(adv).toBeGreaterThanOrEqual(dis);
  });
});
