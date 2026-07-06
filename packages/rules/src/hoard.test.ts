import { describe, expect, it } from 'vitest';

import { rollHoard, type CrBand, type HoardRoll } from './hoard';

/**
 * R6.3 — Hoard rules (OUTLINE §3.5 + §6, DMG 2024 tables).
 *
 * `rollHoard(band, rng?)` returns coin totals + magic-item rarity bucket
 * counts + gem/art tier counts. Rarity/tier picks are buckets; the DM
 * selects specific catalog items in the Loot Distribution Wizard.
 *
 * A deterministic `rng` (returns 0..1) makes results reproducible for tests.
 */

const BANDS: CrBand[] = ['0-4', '5-10', '11-16', '17+'];

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

function totalMagicItems(roll: HoardRoll): number {
  const m = roll.magicItemsByRarity;
  return m.common + m.uncommon + m.rare + m['very-rare'] + m.legendary;
}

function totalGems(roll: HoardRoll): number {
  const g = roll.gemsByTier;
  return g['10'] + g['50'] + g['100'] + g['500'] + g['1000'] + g['5000'];
}

describe('hoard.rollHoard — determinism', () => {
  it.each(BANDS)('same rng → same result on band %s', (band) => {
    const a = rollHoard(band, constRng(0.5));
    const b = rollHoard(band, constRng(0.5));
    expect(a).toEqual(b);
  });

  it('different rng values produce different rolls (any band)', () => {
    const a = rollHoard('5-10', constRng(0.1));
    const b = rollHoard('5-10', constRng(0.9));
    // The two rolls must not be byte-equal — otherwise the rng isn't
    // actually driving anything.
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });
});

describe('hoard.rollHoard — non-negative invariants', () => {
  it.each(BANDS)('all coin fields non-negative on band %s (rng=0)', (band) => {
    const r = rollHoard(band, constRng(0));
    expect(r.coins.cp).toBeGreaterThanOrEqual(0);
    expect(r.coins.sp).toBeGreaterThanOrEqual(0);
    expect(r.coins.ep).toBeGreaterThanOrEqual(0);
    expect(r.coins.gp).toBeGreaterThanOrEqual(0);
    expect(r.coins.pp).toBeGreaterThanOrEqual(0);
  });

  it.each(BANDS)('all coin fields non-negative on band %s (rng=0.999)', (band) => {
    const r = rollHoard(band, constRng(0.999));
    expect(r.coins.cp).toBeGreaterThanOrEqual(0);
    expect(r.coins.sp).toBeGreaterThanOrEqual(0);
    expect(r.coins.ep).toBeGreaterThanOrEqual(0);
    expect(r.coins.gp).toBeGreaterThanOrEqual(0);
    expect(r.coins.pp).toBeGreaterThanOrEqual(0);
  });

  it.each(BANDS)('all rarity/tier counts non-negative on band %s', (band) => {
    const r = rollHoard(band, seqRng([0, 0.25, 0.5, 0.75, 0.99]));
    for (const v of Object.values(r.magicItemsByRarity)) {
      expect(v).toBeGreaterThanOrEqual(0);
    }
    for (const v of Object.values(r.gemsByTier)) {
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('hoard.rollHoard — band scaling', () => {
  it('higher bands have higher expected coin totals', () => {
    // Average across a fixed rng sequence, sum GP-equivalent across bands.
    const seq = [0.1, 0.3, 0.5, 0.7, 0.9];
    function gpEquiv(r: HoardRoll): number {
      return r.coins.cp / 100 + r.coins.sp / 10 + r.coins.ep / 2 + r.coins.gp + r.coins.pp * 10;
    }
    const low = gpEquiv(rollHoard('0-4', seqRng(seq)));
    const mid = gpEquiv(rollHoard('5-10', seqRng(seq)));
    const high = gpEquiv(rollHoard('11-16', seqRng(seq)));
    const epic = gpEquiv(rollHoard('17+', seqRng(seq)));

    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
    expect(epic).toBeGreaterThan(high);
  });

  it('legendary items only appear at high bands (17+)', () => {
    // Sample the whole rng range on the low band — legendary should stay 0.
    const seq = Array.from({ length: 50 }, (_, i) => i / 50);
    const low = rollHoard('0-4', seqRng(seq));
    expect(low.magicItemsByRarity.legendary).toBe(0);
  });

  it('common items dominate on the lowest band', () => {
    // Sum common vs legendary+very-rare across a mid-rng sweep.
    const seq = Array.from({ length: 20 }, (_, i) => (i + 0.5) / 20);
    let common = 0;
    let epicish = 0;
    for (const v of seq) {
      const r = rollHoard('0-4', constRng(v));
      common += r.magicItemsByRarity.common;
      epicish += r.magicItemsByRarity.legendary + r.magicItemsByRarity['very-rare'];
    }
    expect(common).toBeGreaterThan(epicish);
  });
});

describe('hoard.rollHoard — default rng (no injection)', () => {
  it('runs without throwing when no rng is provided', () => {
    expect(() => rollHoard('5-10')).not.toThrow();
  });

  it('returns a well-shaped HoardRoll object', () => {
    const r = rollHoard('11-16');
    expect(r).toHaveProperty('coins');
    expect(r).toHaveProperty('magicItemsByRarity');
    expect(r).toHaveProperty('gemsByTier');
    // Coin block has all 5 denoms.
    for (const denom of ['cp', 'sp', 'ep', 'gp', 'pp'] as const) {
      expect(r.coins[denom]).toBeTypeOf('number');
    }
  });
});

describe('hoard.rollHoard — snapshot per band (rng=0.5)', () => {
  // Locks the tables against unintended regressions.
  it('band 0-4', () => {
    expect(rollHoard('0-4', constRng(0.5))).toMatchSnapshot();
  });
  it('band 5-10', () => {
    expect(rollHoard('5-10', constRng(0.5))).toMatchSnapshot();
  });
  it('band 11-16', () => {
    expect(rollHoard('11-16', constRng(0.5))).toMatchSnapshot();
  });
  it('band 17+', () => {
    expect(rollHoard('17+', constRng(0.5))).toMatchSnapshot();
  });
});

describe('hoard.rollHoard — magic item + gem counts sanity', () => {
  it('band 17+ produces some legendary or very-rare items across a rng sweep', () => {
    const seq = Array.from({ length: 30 }, (_, i) => i / 30);
    let epicish = 0;
    for (const v of seq) {
      const r = rollHoard('17+', constRng(v));
      epicish += r.magicItemsByRarity.legendary + r.magicItemsByRarity['very-rare'];
    }
    expect(epicish).toBeGreaterThan(0);
  });

  it('band 0-4 produces mostly small gem tiers when gems roll', () => {
    const seq = Array.from({ length: 20 }, (_, i) => (i + 0.5) / 20);
    let low = 0;
    let high = 0;
    for (const v of seq) {
      const r = rollHoard('0-4', constRng(v));
      low += r.gemsByTier['10'] + r.gemsByTier['50'];
      high += r.gemsByTier['1000'] + r.gemsByTier['5000'];
    }
    // No expensive gems at all at the lowest band.
    expect(high).toBe(0);
    // Some low-tier gems may or may not appear — but if any gems roll,
    // they should be the low tiers. Assert: `low + high >= 0` (weak),
    // AND `high == 0` (strong).
    expect(low).toBeGreaterThanOrEqual(0);
  });

  it('totals: magic items count is bounded (never > 20 per hoard)', () => {
    // Defensive: a bug in the rarity loop could infinite-loop or over-roll.
    const seq = [0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99];
    for (const band of BANDS) {
      for (const v of seq) {
        const r = rollHoard(band, constRng(v));
        expect(totalMagicItems(r)).toBeLessThanOrEqual(20);
        expect(totalGems(r)).toBeLessThanOrEqual(30);
      }
    }
  });
});
