import { describe, expect, it } from 'vitest';

import * as currency from './currency';

/**
 * D&D 5e (2024) currency math. Per OUTLINE §4 the denomination multipliers
 * are `cp=1, sp=10, ep=50, gp=100, pp=1000` (all CP-equivalents).
 *
 * The module is consumed by:
 *   - `apps/web/src/store/reducer.ts:deleteStash` → `toCopper` for the
 *     `currencyTotalCp` snapshot.
 *   - `apps/web/src/components/stash/CurrencyRow.tsx` → `toGpEquivalent`
 *     for the "Total: X gp" line.
 *   - `apps/web/src/components/stash/ConvertCurrencyModal.tsx` → `convert`
 *     to compute the source/target delta for the dispatch.
 *   - `add` / `subtract` are unused in M4 but ship now to unblock M5
 *     transfers and R4 Banker actions (trivial enough that one commit is
 *     cheaper than two).
 */

describe('rules.currency.toCopper (M4)', () => {
  it('returns 0 for an all-zero holding', () => {
    expect(currency.toCopper({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 })).toBe(0);
  });

  it('applies the cp=1, sp=10, ep=50, gp=100, pp=1000 multipliers to single denominations', () => {
    expect(currency.toCopper({ cp: 7, sp: 0, ep: 0, gp: 0, pp: 0 })).toBe(7);
    expect(currency.toCopper({ cp: 0, sp: 3, ep: 0, gp: 0, pp: 0 })).toBe(30);
    expect(currency.toCopper({ cp: 0, sp: 0, ep: 4, gp: 0, pp: 0 })).toBe(200);
    expect(currency.toCopper({ cp: 0, sp: 0, ep: 0, gp: 5, pp: 0 })).toBe(500);
    expect(currency.toCopper({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 6 })).toBe(6000);
  });

  it('sums mixed denominations', () => {
    // 1 cp + 2 sp + 3 ep + 4 gp + 5 pp = 1 + 20 + 150 + 400 + 5000 = 5571
    expect(currency.toCopper({ cp: 1, sp: 2, ep: 3, gp: 4, pp: 5 })).toBe(5571);
  });

  it('treats missing denomination keys as 0 (CurrencyDelta partial shape)', () => {
    expect(currency.toCopper({ gp: 1 })).toBe(100);
    expect(currency.toCopper({})).toBe(0);
  });

  it('preserves sign on negative denominations (delta semantics)', () => {
    expect(currency.toCopper({ cp: 0, sp: -10, ep: 0, gp: 1, pp: 0 })).toBe(0);
    expect(currency.toCopper({ cp: -1, sp: 0, ep: 0, gp: 0, pp: 0 })).toBe(-1);
  });
});

describe('rules.currency.fromCopper (M4)', () => {
  it('returns all-zero for 0 cp', () => {
    expect(currency.fromCopper(0)).toEqual({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
  });

  it('1 cp → 1 cp only', () => {
    expect(currency.fromCopper(1)).toEqual({ cp: 1, sp: 0, ep: 0, gp: 0, pp: 0 });
  });

  it('greedy from largest: 50 cp → 1 ep (ep multiplier = 50)', () => {
    expect(currency.fromCopper(50)).toEqual({ cp: 0, sp: 0, ep: 1, gp: 0, pp: 0 });
  });

  it('99 cp → 1 ep + 4 sp + 9 cp (greedy: ep then sp then cp)', () => {
    // 99 - 50 (1 ep) = 49 - 40 (4 sp) = 9 (9 cp)
    expect(currency.fromCopper(99)).toEqual({ cp: 9, sp: 4, ep: 1, gp: 0, pp: 0 });
  });

  it('100 cp → 1 gp', () => {
    expect(currency.fromCopper(100)).toEqual({ cp: 0, sp: 0, ep: 0, gp: 1, pp: 0 });
  });

  it('1234 cp → 1 pp + 2 gp + 3 sp + 4 cp (greedy from pp down)', () => {
    // 1234 - 1000 (1 pp) = 234 - 200 (2 gp) = 34 - 0 (ep needs 50) = 34 - 30 (3 sp) = 4 cp
    expect(currency.fromCopper(1234)).toEqual({ cp: 4, sp: 3, ep: 0, gp: 2, pp: 1 });
  });

  it('throws on negative cp', () => {
    expect(() => currency.fromCopper(-1)).toThrow(/negative/i);
  });

  it('throws on non-integer cp', () => {
    expect(() => currency.fromCopper(1.5)).toThrow(/integer/i);
  });
});

describe('rules.currency.toGpEquivalent (M4)', () => {
  it('returns 0 for all-zero', () => {
    expect(currency.toGpEquivalent({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 })).toBe(0);
  });

  it('100 cp = 1 gp', () => {
    expect(currency.toGpEquivalent({ cp: 100, sp: 0, ep: 0, gp: 0, pp: 0 })).toBe(1);
  });

  it('produces a float for fractional gp', () => {
    // 1 sp = 10 cp = 0.1 gp
    expect(currency.toGpEquivalent({ cp: 0, sp: 1, ep: 0, gp: 0, pp: 0 })).toBe(0.1);
    // Mixed: 1 pp + 5 gp + 2 sp = 1000 + 500 + 20 = 1520 cp = 15.2 gp
    expect(currency.toGpEquivalent({ cp: 0, sp: 2, ep: 0, gp: 5, pp: 1 })).toBe(15.2);
  });
});

describe('rules.currency.convert (M4)', () => {
  it('100 sp → 10 gp returns a delta that withdraws sp and adds gp', () => {
    expect(currency.convert('sp', 100, 'gp')).toEqual({
      cp: 0,
      sp: -100,
      ep: 0,
      gp: 10,
      pp: 0,
    });
  });

  it('1 gp → 10 sp (down-conversion)', () => {
    expect(currency.convert('gp', 1, 'sp')).toEqual({
      cp: 0,
      sp: 10,
      ep: 0,
      gp: -1,
      pp: 0,
    });
  });

  it('1 gp → 100 cp (down-conversion across two steps)', () => {
    expect(currency.convert('gp', 1, 'cp')).toEqual({
      cp: 100,
      sp: 0,
      ep: 0,
      gp: -1,
      pp: 0,
    });
  });

  it('refuses same-denomination converts', () => {
    expect(() => currency.convert('gp', 5, 'gp')).toThrow(/same denomination/i);
  });

  it('refuses non-positive quantities', () => {
    expect(() => currency.convert('sp', 0, 'gp')).toThrow(/positive/i);
    expect(() => currency.convert('sp', -1, 'gp')).toThrow(/positive/i);
  });

  it('refuses lossy converts (1 sp = 10 cp = 0.1 gp is not an integer)', () => {
    // The Convert modal will preview-disable the submit, but the function
    // defends in depth.
    expect(() => currency.convert('sp', 1, 'gp')).toThrow(/lossy|non-integer/i);
  });
});

describe('rules.currency.add (M4)', () => {
  it('sums two deltas per denomination', () => {
    expect(
      currency.add(
        { cp: 1, sp: 2, ep: 3, gp: 4, pp: 5 },
        { cp: 10, sp: 20, ep: 30, gp: 40, pp: 50 },
      ),
    ).toEqual({ cp: 11, sp: 22, ep: 33, gp: 44, pp: 55 });
  });

  it('treats missing keys as 0', () => {
    expect(currency.add({ gp: 1 }, { sp: 2 })).toEqual({
      cp: 0,
      sp: 2,
      ep: 0,
      gp: 1,
      pp: 0,
    });
  });

  it('supports negative deltas (withdraw on one side)', () => {
    expect(currency.add({ gp: 5 }, { gp: -3 })).toEqual({
      cp: 0,
      sp: 0,
      ep: 0,
      gp: 2,
      pp: 0,
    });
  });
});

describe('rules.currency.subtract (M4)', () => {
  it('subtracts b from a per denomination', () => {
    expect(
      currency.subtract(
        { cp: 10, sp: 20, ep: 30, gp: 40, pp: 50 },
        { cp: 1, sp: 2, ep: 3, gp: 4, pp: 5 },
      ),
    ).toEqual({ cp: 9, sp: 18, ep: 27, gp: 36, pp: 45 });
  });

  it('throws if any denomination would go negative', () => {
    expect(() => currency.subtract({ gp: 5 }, { gp: 10 })).toThrow(/negative/i);
  });

  it('treats missing keys as 0', () => {
    expect(currency.subtract({ gp: 5 }, {})).toEqual({
      cp: 0,
      sp: 0,
      ep: 0,
      gp: 5,
      pp: 0,
    });
  });
});

// -------------------- R4.2.d — splitEvenly --------------------

/**
 * R4.2.d — cascade-down-denominations split. For each denom in
 * [pp, gp, ep, sp, cp], give each of N recipients `floor(pool[d] / N)`,
 * then convert the per-denom remainder into the next lower denom
 * (via the OUTLINE §4 rate constants) and continue. The CP-level
 * remainder (0 to N-1 cp) stays in the pool.
 *
 * Result: each recipient receives a mixed-denomination share that
 * reflects the shape of the pool as closely as possible; the pool
 * retains only stray copper. Matches "how a DM splits loot at the
 * table" — piles of coins on the table, not raw copper.
 */

describe('splitEvenly', () => {
  it('3 gp 4 sp split 3 ways: each 1 gp 1 sp 3 cp, pool retains 1 cp', () => {
    const pool: currency.Currency = { cp: 0, sp: 4, ep: 0, gp: 3, pp: 0 };
    const { share, remainder } = currency.splitEvenly(pool, 3);
    expect(share).toEqual({ cp: 3, sp: 1, ep: 0, gp: 1, pp: 0 });
    expect(remainder).toEqual({ cp: 1, sp: 0, ep: 0, gp: 0, pp: 0 });
  });

  it('100 gp split 3 ways: each 33 gp 3 sp 3 cp, pool retains 1 cp', () => {
    const pool: currency.Currency = { cp: 0, sp: 0, ep: 0, gp: 100, pp: 0 };
    const { share, remainder } = currency.splitEvenly(pool, 3);
    expect(share).toEqual({ cp: 3, sp: 3, ep: 0, gp: 33, pp: 0 });
    expect(remainder).toEqual({ cp: 1, sp: 0, ep: 0, gp: 0, pp: 0 });
  });

  it('30 gp split 3 ways: each 10 gp exactly, pool retains 0', () => {
    const pool: currency.Currency = { cp: 0, sp: 0, ep: 0, gp: 30, pp: 0 };
    const { share, remainder } = currency.splitEvenly(pool, 3);
    expect(share).toEqual({ cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 });
    expect(remainder).toEqual({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
  });

  it('N=1 gives everything to the sole recipient, pool retains 0', () => {
    const pool: currency.Currency = { cp: 7, sp: 3, ep: 1, gp: 42, pp: 5 };
    const { share, remainder } = currency.splitEvenly(pool, 1);
    expect(share).toEqual({ cp: 7, sp: 3, ep: 1, gp: 42, pp: 5 });
    expect(remainder).toEqual({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
  });

  it('empty pool: everyone gets 0, pool retains 0', () => {
    const pool: currency.Currency = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
    const { share, remainder } = currency.splitEvenly(pool, 4);
    expect(share).toEqual({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
    expect(remainder).toEqual({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
  });

  it('all-CP pool splits by pure CP arithmetic', () => {
    const pool: currency.Currency = { cp: 1000, sp: 0, ep: 0, gp: 0, pp: 0 };
    const { share, remainder } = currency.splitEvenly(pool, 3);
    // 1000 / 3 = 333 cp each, 1 cp remainder
    expect(share).toEqual({ cp: 333, sp: 0, ep: 0, gp: 0, pp: 0 });
    expect(remainder).toEqual({ cp: 1, sp: 0, ep: 0, gp: 0, pp: 0 });
  });

  it('platinum cascades into gp: 1 pp split 3 ways cascades to ep then sp then cp', () => {
    const pool: currency.Currency = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 1 };
    // 1 pp = 10 gp → gp: 10/3=3 each, remainder 1 gp = 2 ep
    //   ep: 2/3=0 each, remainder 2 ep = 10 sp
    //   sp: 10/3=3 each, remainder 1 sp = 10 cp
    //   cp: 10/3=3 each, remainder 1 cp
    const { share, remainder } = currency.splitEvenly(pool, 3);
    expect(share).toEqual({ cp: 3, sp: 3, ep: 0, gp: 3, pp: 0 });
    expect(remainder).toEqual({ cp: 1, sp: 0, ep: 0, gp: 0, pp: 0 });
  });

  it('pool starts in sp/cp only (typical Recovered Loot residue)', () => {
    const pool: currency.Currency = { cp: 5, sp: 7, ep: 0, gp: 0, pp: 0 };
    // sp: 7/2=3 each, remainder 1 sp = 10 cp → pool.cp = 5+10 = 15
    // cp: 15/2=7 each, remainder 1 cp
    const { share, remainder } = currency.splitEvenly(pool, 2);
    expect(share).toEqual({ cp: 7, sp: 3, ep: 0, gp: 0, pp: 0 });
    expect(remainder).toEqual({ cp: 1, sp: 0, ep: 0, gp: 0, pp: 0 });
  });

  it('conservation: N × share + remainder === original pool (in CP)', () => {
    const pool: currency.Currency = { cp: 17, sp: 23, ep: 5, gp: 91, pp: 4 };
    const n = 5;
    const { share, remainder } = currency.splitEvenly(pool, n);
    const shareCp = currency.toCopper(share);
    const remainderCp = currency.toCopper(remainder);
    const poolCp = currency.toCopper(pool);
    expect(n * shareCp + remainderCp).toBe(poolCp);
  });

  it('remainder is always < N in CP-equivalent (never enough to split again)', () => {
    const pool: currency.Currency = { cp: 17, sp: 23, ep: 5, gp: 91, pp: 4 };
    const n = 5;
    const { remainder } = currency.splitEvenly(pool, n);
    expect(currency.toCopper(remainder)).toBeLessThan(n);
  });

  it('rejects N < 1', () => {
    const pool: currency.Currency = { cp: 100, sp: 0, ep: 0, gp: 0, pp: 0 };
    expect(() => currency.splitEvenly(pool, 0)).toThrow(/n must be/i);
    expect(() => currency.splitEvenly(pool, -1)).toThrow(/n must be/i);
  });

  it('rejects non-integer N', () => {
    const pool: currency.Currency = { cp: 100, sp: 0, ep: 0, gp: 0, pp: 0 };
    expect(() => currency.splitEvenly(pool, 2.5)).toThrow(/integer/i);
  });
});
