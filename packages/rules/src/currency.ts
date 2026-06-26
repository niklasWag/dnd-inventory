/**
 * Currency math (OUTLINE §6, MVP §8).
 *
 * D&D 5e (2024) denomination ladder, with the CP-equivalent multipliers
 * baked into one constant `MULTIPLIER` so every function speaks the same
 * truth. Per OUTLINE §4:
 *
 *   cp = 1   sp = 10   ep = 50   gp = 100   pp = 1000
 *
 * The module is consumed by the M4 currency editor (CurrencyRow /
 * ConvertCurrencyModal / CurrencyBreakdown), by the M3 `delete-stash`
 * cascade (extracted from the M3 inline placeholder formula), and by
 * future M5 transfers + R4 Banker actions (`add` / `subtract`).
 *
 * All functions are pure: input → output, no I/O, no closures. The
 * `CurrencyDelta` shape is `Partial<Record<Denom, number>>` so callers
 * don't have to spell all five denominations when they only care about
 * one. Returns are always the full `Currency` (all five non-optional).
 *
 * Values may be negative on input (delta semantics — used by the
 * `convert` return shape and by the reducer's `currency-change` payload).
 * Outputs of `fromCopper` and `subtract` are non-negative (`subtract`
 * throws rather than returning a negative result; `fromCopper` throws
 * on negative cp input).
 */

export type Denom = 'cp' | 'sp' | 'ep' | 'gp' | 'pp';

/** Full 5-denomination value (e.g. a CurrencyHolding). */
export interface Currency {
  cp: number;
  sp: number;
  ep: number;
  gp: number;
  pp: number;
}

/**
 * Signed delta — same shape as Currency but every key is optional so
 * `{ gp: 1 }` is a valid "+1 gp" delta without spelling four zeros.
 */
export type CurrencyDelta = Partial<Currency>;

/** CP-equivalent multipliers per OUTLINE §4. */
const MULTIPLIER: Readonly<Record<Denom, number>> = {
  cp: 1,
  sp: 10,
  ep: 50,
  gp: 100,
  pp: 1000,
};

/** Denomination order for greedy fromCopper (largest first). */
const DENOMS_LARGEST_FIRST: readonly Denom[] = ['pp', 'gp', 'ep', 'sp', 'cp'];

/**
 * Flatten any currency value (full or partial) to its CP-equivalent.
 * Missing keys are treated as 0. Sign is preserved (a negative delta
 * returns a negative number — useful for the reducer's invariant check).
 */
export function toCopper(coins: CurrencyDelta): number {
  return (
    (coins.cp ?? 0) * MULTIPLIER.cp +
    (coins.sp ?? 0) * MULTIPLIER.sp +
    (coins.ep ?? 0) * MULTIPLIER.ep +
    (coins.gp ?? 0) * MULTIPLIER.gp +
    (coins.pp ?? 0) * MULTIPLIER.pp
  );
}

/**
 * Produce a sensible denomination mix from a CP count. Strategy: greedy
 * from largest denomination (pp → gp → ep → sp → cp). Throws on negative
 * or non-integer input.
 *
 * Example: 1234 cp → 1 pp + 2 gp + 3 sp + 4 cp (ep is skipped because the
 * 234 remainder after pp+gp is below ep's 50 only after sp consumes 30;
 * the greedy walk picks ep when residue ≥ 50, otherwise skips).
 */
export function fromCopper(cp: number): Currency {
  if (!Number.isInteger(cp)) {
    throw new Error(`currency.fromCopper: expected integer, got ${String(cp)}`);
  }
  if (cp < 0) {
    throw new Error(`currency.fromCopper: negative cp ${String(cp)}`);
  }

  let remaining = cp;
  const result: Currency = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
  for (const d of DENOMS_LARGEST_FIRST) {
    const m = MULTIPLIER[d];
    const count = Math.floor(remaining / m);
    result[d] = count;
    remaining -= count * m;
  }
  return result;
}

/** GP-equivalent of a value; float OK for display ("15.2 gp"). */
export function toGpEquivalent(coins: CurrencyDelta): number {
  return toCopper(coins) / MULTIPLIER.gp;
}

/**
 * Build a `CurrencyDelta` that converts `qty` of `source` into the
 * equivalent target denomination. Returns a full 5-key delta with the
 * source side negative and the target side positive — directly dispatch-
 * able as the `currency-change` payload.
 *
 * Throws when:
 *   - `source === target` (no-op; the UI guards this too).
 *   - `qty <= 0` (the Convert form's Zod resolver rejects this at the
 *     boundary; this is belt-and-braces).
 *   - The conversion would be lossy (e.g. 1 sp → 10 cp is fine, but
 *     1 sp → 0.1 gp loses precision because gp denominations are
 *     integers). The Convert modal disables submit on lossy combos.
 */
export function convert(source: Denom, qty: number, target: Denom): Currency {
  if (source === target) {
    throw new Error(`currency.convert: same denomination ${source}`);
  }
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error(`currency.convert: qty must be a positive integer, got ${String(qty)}`);
  }

  const cpEquivalent = qty * MULTIPLIER[source];
  if (cpEquivalent % MULTIPLIER[target] !== 0) {
    throw new Error(
      `currency.convert: lossy conversion ${String(qty)} ${source} \u2192 ${target} ` +
        `(${String(cpEquivalent)} cp not divisible by ${String(MULTIPLIER[target])})`,
    );
  }
  const targetQty = cpEquivalent / MULTIPLIER[target];

  const result: Currency = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
  result[source] = -qty;
  result[target] = targetQty;
  return result;
}

/** Per-denomination sum. Missing keys treated as 0. */
export function add(a: CurrencyDelta, b: CurrencyDelta): Currency {
  return {
    cp: (a.cp ?? 0) + (b.cp ?? 0),
    sp: (a.sp ?? 0) + (b.sp ?? 0),
    ep: (a.ep ?? 0) + (b.ep ?? 0),
    gp: (a.gp ?? 0) + (b.gp ?? 0),
    pp: (a.pp ?? 0) + (b.pp ?? 0),
  };
}

/**
 * Per-denomination difference `a - b`. Throws if any denomination would
 * go negative — currency holdings are `.nonnegative()` per the Zod
 * schema, so `subtract` is the boundary check that lets the reducer
 * trust its inputs.
 */
export function subtract(a: CurrencyDelta, b: CurrencyDelta): Currency {
  const result: Currency = {
    cp: (a.cp ?? 0) - (b.cp ?? 0),
    sp: (a.sp ?? 0) - (b.sp ?? 0),
    ep: (a.ep ?? 0) - (b.ep ?? 0),
    gp: (a.gp ?? 0) - (b.gp ?? 0),
    pp: (a.pp ?? 0) - (b.pp ?? 0),
  };
  if (result.cp < 0 || result.sp < 0 || result.ep < 0 || result.gp < 0 || result.pp < 0) {
    throw new Error(
      `currency.subtract: result would be negative ` +
        `(cp:${String(result.cp)} sp:${String(result.sp)} ep:${String(result.ep)} ` +
        `gp:${String(result.gp)} pp:${String(result.pp)})`,
    );
  }
  return result;
}
