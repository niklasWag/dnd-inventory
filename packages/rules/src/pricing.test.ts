import { describe, expect, it } from 'vitest';

import { buyPrice, formatPrice, sellPrice } from './pricing';

/**
 * R6.1 — Pricing rules (OUTLINE §3.5).
 *
 * Two pure functions:
 *   - `buyPrice(baseCostCp, source, {partyModifier, shopModifier?})` →
 *     integer CP. PHB / DMG scale by `partyModifier * (shopModifier ?? 1)`.
 *     Homebrew items skip `priceModifier` per §3.5 line 133 (they're
 *     typed in real coins) but ARE subject to `shopModifier`. Sub-cp
 *     results round to nearest cp; ties go up.
 *   - `formatPrice(cp, baseCurrency)` → human string. Renders in the
 *     largest denomination ≤ baseCurrency where the value is a whole
 *     number. Never rolls up past `baseCurrency`.
 */

describe('pricing.buyPrice — modifier composition', () => {
  it('identity for PHB when partyModifier = 1.0 and no shop', () => {
    expect(buyPrice(500, 'PHB', { partyModifier: 1.0 })).toBe(500);
  });

  it('DMG scales identically to PHB', () => {
    expect(buyPrice(500, 'DMG', { partyModifier: 0.1 })).toBe(50);
  });

  it('Silver-standard: 5 gp PHB item (500 cp) × 0.1 → 50 cp', () => {
    expect(buyPrice(500, 'PHB', { partyModifier: 0.1 })).toBe(50);
  });

  it('Copper-standard: 500 cp × 0.01 → 5 cp', () => {
    expect(buyPrice(500, 'PHB', { partyModifier: 0.01 })).toBe(5);
  });

  it('composes party × shop multiplicatively', () => {
    // 400 cp × 0.5 × 0.8 = 160 cp
    expect(buyPrice(400, 'PHB', { partyModifier: 0.5, shopModifier: 0.8 })).toBe(160);
  });

  it('homebrew ignores partyModifier', () => {
    // 500 cp × 0.1 = 500 cp (NOT 50); the party modifier is skipped.
    expect(buyPrice(500, 'homebrew', { partyModifier: 0.1 })).toBe(500);
  });

  it('homebrew still applies shopModifier', () => {
    // 500 cp × 0.5 = 250 cp; shop modifier applies even to homebrew.
    expect(buyPrice(500, 'homebrew', { partyModifier: 0.1, shopModifier: 0.5 })).toBe(250);
  });

  it('inflation preset (partyModifier=2.0) doubles PHB prices', () => {
    expect(buyPrice(500, 'PHB', { partyModifier: 2.0 })).toBe(1000);
  });

  it('sub-cp rounds to nearest; 0.4 rounds down to 0', () => {
    // 1 cp × 0.4 = 0.4 → 0 cp
    expect(buyPrice(1, 'PHB', { partyModifier: 0.4 })).toBe(0);
  });

  it('sub-cp rounds to nearest; 0.5 rounds up (ties go up per §3.5)', () => {
    // 1 cp × 0.5 = 0.5 → 1 cp
    expect(buyPrice(1, 'PHB', { partyModifier: 0.5 })).toBe(1);
  });

  it('sub-cp rounds to nearest; 0.6 rounds up to 1', () => {
    expect(buyPrice(1, 'PHB', { partyModifier: 0.6 })).toBe(1);
  });

  it('float-precision drift is absorbed by rounding', () => {
    // 500 * 0.3 in JS = 149.99999999999997 → must round to 150.
    expect(buyPrice(500, 'PHB', { partyModifier: 0.3 })).toBe(150);
  });

  it('zero base cost yields zero regardless of modifier', () => {
    expect(buyPrice(0, 'PHB', { partyModifier: 0.1 })).toBe(0);
    expect(buyPrice(0, 'homebrew', { partyModifier: 2.0, shopModifier: 3.0 })).toBe(0);
  });
});

describe('pricing.sellPrice — merchant payout (§3.9)', () => {
  it('half rate on an identity-scaled PHB item: 500 cp × 0.5 → 250 cp', () => {
    expect(sellPrice(500, 'PHB', { partyModifier: 1.0 }, 0.5)).toBe(250);
  });

  it('composes buy-scaling THEN sell rate: 400 cp × 0.5 (party) × 0.5 (rate) → 100 cp', () => {
    // buyPrice(400, party 0.5) = 200; 200 × 0.5 = 100.
    expect(sellPrice(400, 'PHB', { partyModifier: 0.5 }, 0.5)).toBe(100);
  });

  it('applies shopModifier through buyPrice then the sell rate', () => {
    // buyPrice(400, party 0.5, shop 0.8) = 160; 160 × 0.5 = 80.
    expect(sellPrice(400, 'PHB', { partyModifier: 0.5, shopModifier: 0.8 }, 0.5)).toBe(80);
  });

  it('homebrew skips partyModifier but the sell rate still applies', () => {
    // buyPrice(500, homebrew, party 0.1) = 500; 500 × 0.5 = 250.
    expect(sellPrice(500, 'homebrew', { partyModifier: 0.1 }, 0.5)).toBe(250);
  });

  it('full-rate merchant (1.0) pays the buy price', () => {
    expect(sellPrice(500, 'PHB', { partyModifier: 1.0 }, 1.0)).toBe(500);
  });

  it('sub-cp payout rounds to nearest; ties go up', () => {
    // buyPrice(1, party 1.0) = 1; 1 × 0.5 = 0.5 → 1 (ties up).
    expect(sellPrice(1, 'PHB', { partyModifier: 1.0 }, 0.5)).toBe(1);
    // buyPrice(1, party 1.0) = 1; 1 × 0.4 = 0.4 → 0.
    expect(sellPrice(1, 'PHB', { partyModifier: 1.0 }, 0.4)).toBe(0);
  });

  it('float-precision drift is absorbed by rounding', () => {
    // buyPrice(500, party 1.0) = 500; 500 × 0.3 = 149.999… → 150.
    expect(sellPrice(500, 'PHB', { partyModifier: 1.0 }, 0.3)).toBe(150);
  });

  it('zero base cost yields zero regardless of rate', () => {
    expect(sellPrice(0, 'PHB', { partyModifier: 1.0 }, 0.5)).toBe(0);
  });
});

describe('pricing.formatPrice — display canonicalization (§3.5)', () => {
  // ---- Gold standard (default) ----

  it('gp baseCurrency: 500 cp renders as "5 gp"', () => {
    expect(formatPrice(500, 'gp')).toBe('5 gp');
  });

  it('gp baseCurrency: 50 cp renders as "5 sp" (not "0.5 gp")', () => {
    expect(formatPrice(50, 'gp')).toBe('5 sp');
  });

  it('gp baseCurrency: 5 cp renders as "5 cp"', () => {
    expect(formatPrice(5, 'gp')).toBe('5 cp');
  });

  it('gp baseCurrency: 20000 cp renders as "200 gp" — no rollup past ceiling', () => {
    expect(formatPrice(20000, 'gp')).toBe('200 gp');
  });

  // ---- Silver standard ----

  it('sp baseCurrency: 50 cp renders as "5 sp"', () => {
    expect(formatPrice(50, 'sp')).toBe('5 sp');
  });

  it('sp baseCurrency: 5 cp renders as "5 cp" (never "0.5 sp")', () => {
    expect(formatPrice(5, 'sp')).toBe('5 cp');
  });

  // ---- Copper standard ----

  it('cp baseCurrency: 5 cp renders as "5 cp"', () => {
    expect(formatPrice(5, 'cp')).toBe('5 cp');
  });

  it('cp baseCurrency: 500 cp renders as "500 cp" (no rollup)', () => {
    expect(formatPrice(500, 'cp')).toBe('500 cp');
  });

  // ---- Electrum standard ----

  it('ep baseCurrency: 250 cp renders as "5 ep"', () => {
    // 250 cp / 50 (ep multiplier) = 5, divides cleanly.
    expect(formatPrice(250, 'ep')).toBe('5 ep');
  });

  it('ep baseCurrency: 100 cp renders as "2 ep"', () => {
    expect(formatPrice(100, 'ep')).toBe('2 ep');
  });

  it('ep baseCurrency: 20 cp renders as "2 sp"', () => {
    // 20 cp / 50 = 0.4 ep (not whole); falls to sp: 20 / 10 = 2 sp.
    expect(formatPrice(20, 'ep')).toBe('2 sp');
  });

  // ---- Platinum standard ----

  it('pp baseCurrency: 20000 cp renders as "20 pp"', () => {
    expect(formatPrice(20000, 'pp')).toBe('20 pp');
  });

  it('pp baseCurrency: 500 cp renders as "5 gp" (falls through when pp not whole)', () => {
    // 500 cp / 1000 (pp) = 0.5 → not whole. Falls to gp: 500/100 = 5.
    expect(formatPrice(500, 'pp')).toBe('5 gp');
  });

  // ---- Edge cases ----

  it('zero cp renders as "0 cp" regardless of baseCurrency', () => {
    expect(formatPrice(0, 'gp')).toBe('0 cp');
    expect(formatPrice(0, 'pp')).toBe('0 cp');
    expect(formatPrice(0, 'cp')).toBe('0 cp');
  });
});
