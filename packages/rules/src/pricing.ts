/**
 * Pricing rules (OUTLINE §3.5 + §6).
 *
 * Two pure, deterministic helpers:
 *
 *   - `buyPrice(baseCostCp, source, ctx)` — compute the effective cost
 *     in integer CP for an item at a party/shop. PHB / DMG scale by
 *     `partyModifier × (shopModifier ?? 1)`; homebrew skips the
 *     `priceModifier` per §3.5 line 133 (homebrew is typed in real
 *     coins) but IS still scaled by `shopModifier`. Sub-cp results
 *     round to nearest cp; ties go up.
 *
 *   - `formatPrice(cp, baseCurrency)` — canonicalize an integer-CP
 *     value for display. Renders in the largest denomination
 *     ≤ `baseCurrency` where the value is a whole number. Never rolls
 *     up past `baseCurrency` (a gold-standard campaign reads "200 gp"
 *     rather than "20 pp"). Sub-cp values are impossible on input
 *     because `buyPrice` already floors to integer cp.
 *
 * `sellPrice` remains a stub — activated in R6.2 when the `purchase` /
 * `sale` reducers land.
 */

export type ItemSource = 'PHB' | 'DMG' | 'homebrew';
export type BaseCurrency = 'cp' | 'sp' | 'ep' | 'gp' | 'pp';

export interface PriceContext {
  /** `Party.priceModifier` — applies to PHB/DMG only. */
  partyModifier: number;
  /**
   * `Shop.priceModifier` — applies to all sources including homebrew.
   * Optional so catalog-display can call without a shop context (uses
   * `1.0` when omitted).
   */
  shopModifier?: number;
}

/**
 * CP-equivalent multipliers per OUTLINE §4. Mirrors
 * `packages/rules/currency.ts:MULTIPLIER` — duplicated here rather than
 * cross-imported to keep pricing.ts leaf-level (no cyclic-import risk
 * as the rules package grows).
 */
const CP_PER: Readonly<Record<BaseCurrency, number>> = {
  cp: 1,
  sp: 10,
  ep: 50,
  gp: 100,
  pp: 1000,
};

/**
 * Descent ladder for `formatPrice`. Electrum is deliberately excluded
 * from the descent unless `baseCurrency === 'ep'` — §3.5 designates ep
 * as a niche/historical denomination that only surfaces when a party
 * explicitly opts into the Electrum-standard preset. Otherwise the
 * canonical human ladder is pp → gp → sp → cp (see §3.5 example line
 * 121: 50 cp under gp-standard renders as "5 sp", not "1 ep").
 */
const DESCENT_NO_EP: readonly BaseCurrency[] = ['pp', 'gp', 'sp', 'cp'];
const DESCENT_WITH_EP: readonly BaseCurrency[] = ['pp', 'gp', 'ep', 'sp', 'cp'];

/**
 * Compute buy-side effective cost in integer CP. See module docstring
 * for the semantics of `source` + `ctx.partyModifier` interaction.
 *
 * Rounding uses `Math.floor(x + 0.5)` (half-up) instead of `Math.round`
 * because JS's `Math.round` rounds `-0.5` to `0` but `0.5` to `1` —
 * asymmetric-at-zero doesn't matter for non-negative prices, but the
 * explicit form matches the §3.5 "ties go up" wording exactly.
 */
export function buyPrice(baseCostCp: number, source: ItemSource, ctx: PriceContext): number {
  const shop = ctx.shopModifier ?? 1;
  const scale = source === 'homebrew' ? shop : ctx.partyModifier * shop;
  const raw = baseCostCp * scale;
  return Math.floor(raw + 0.5);
}

/**
 * Canonicalize an integer CP value for display. Walks from `baseCurrency`
 * downward, picking the largest denomination where the value divides
 * cleanly (whole-number rule per §3.5).
 *
 * `cp === 0` short-circuits to "0 cp" — §3.5 doesn't spell this case
 * explicitly but "0 cp" is the least ambiguous rendering (a 0-cost
 * catalog row shouldn't display as "0 gp").
 */
export function formatPrice(cp: number, baseCurrency: BaseCurrency): string {
  if (cp === 0) return '0 cp';
  const ladder = baseCurrency === 'ep' ? DESCENT_WITH_EP : DESCENT_NO_EP;
  const ceilingIdx = ladder.indexOf(baseCurrency);
  // Walk from the baseCurrency down. Return the first denom where
  // `cp` divides cleanly.
  for (let i = ceilingIdx; i < ladder.length; i += 1) {
    const denom = ladder[i]!;
    const mult = CP_PER[denom];
    if (cp % mult === 0) {
      return `${String(cp / mult)} ${denom}`;
    }
  }
  // Unreachable: cp is a non-zero integer, so the last iteration (cp)
  // always divides. Belt-and-braces fallback.
  return `${String(cp)} cp`;
}
