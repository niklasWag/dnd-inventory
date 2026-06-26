/**
 * Capacity / encumbrance rules (OUTLINE §6).
 *
 * R1.1 — first slice of R1. Two rule variants, each scaled by the
 * character's size category:
 *
 * - **`phb`** — PHB 2024 default. Carrying capacity = `STR × 15 × size`.
 *   At-or-under = unencumbered; above = `heavily-encumbered`.
 *
 * - **`variant`** — PHB 2024 variant rule (sidebar p. 366). Three bands:
 *   `encumbered` at `> 5×STR×size`; `heavily-encumbered` at `> 10×STR×size`.
 *   Both bands use strict `>` — a Medium STR-10 character at exactly
 *   50 lb is still unencumbered.
 *
 * Size multiplier per PHB 2024 p. 366: Tiny/Small × 0.5, Medium × 1,
 * Large × 2, Huge × 4, Gargantuan × 8. PHB doesn't list Tiny explicitly
 * in the carrying-capacity sidebar (players never play Tiny in 2024
 * rules) but we ship 0.5 for forward-compat with R6 DM-NPC tooling.
 *
 * Enforcement (whether a move OVER the upper band is reducer-rejected)
 * is the orthogonal `enforceEncumbrance` boolean on `Character` — R1.2
 * will wire that. R1.1's `encumbranceState` is pure display.
 *
 * The `off` rule short-circuits to `'unencumbered'` so callers don't
 * have to special-case a null return; the `CapacityBar` separately
 * hides itself on `off`.
 */

export type EncumbranceState = 'unencumbered' | 'encumbered' | 'heavily-encumbered';

export type EncumbranceRule = 'off' | 'phb' | 'variant';

export type CreatureSize = 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan';

/**
 * Carrying-capacity multiplier per PHB 2024 p. 366. Public so the UI
 * can show e.g. "Large × 2" next to the size dropdown if useful.
 */
export function sizeMultiplier(size: CreatureSize): number {
  switch (size) {
    case 'tiny':
    case 'small':
      return 0.5;
    case 'medium':
      return 1;
    case 'large':
      return 2;
    case 'huge':
      return 4;
    case 'gargantuan':
      return 8;
  }
}

/**
 * Returns the carrying capacity (in lbs) for a character given their
 * STR and size category. `STR × 15 × sizeMultiplier(size)`.
 */
export function carryCapacity(str: number, size: CreatureSize): number {
  return str * 15 * sizeMultiplier(size);
}

/**
 * Categorize a current weight against a character's STR + size + rule.
 *
 * `phb` collapses to two outputs: `unencumbered` (at-or-under STR×15×size)
 * or `heavily-encumbered` (above). `variant` produces all three states
 * at the 5×/10× STR×size thresholds. `off` always returns `unencumbered`.
 */
export function encumbranceState(
  currentWeight: number,
  str: number,
  size: CreatureSize,
  rule: EncumbranceRule,
): EncumbranceState {
  if (rule === 'off') return 'unencumbered';
  const m = sizeMultiplier(size);
  if (rule === 'phb') {
    return currentWeight > str * 15 * m ? 'heavily-encumbered' : 'unencumbered';
  }
  // rule === 'variant'
  if (currentWeight > str * 10 * m) return 'heavily-encumbered';
  if (currentWeight > str * 5 * m) return 'encumbered';
  return 'unencumbered';
}

/**
 * The numeric ceiling above which `encumbranceState` returns
 * `heavily-encumbered` for the given rule + size. R1.2 will use this
 * as the reject threshold for `acquire` / `transfer` when
 * `Character.enforceEncumbrance === true`. R1.1's CapacityBar uses it
 * to compute the bar fill percentage.
 *
 * - phb     → `STR × 15 × size` (cap)
 * - variant → `STR × 10 × size`
 * - off     → `Infinity` (no ceiling; caller usually short-circuits on
 *   `rule === 'off'` before reaching this)
 */
export function heavyThreshold(str: number, size: CreatureSize, rule: EncumbranceRule): number {
  if (rule === 'off') return Infinity;
  const m = sizeMultiplier(size);
  if (rule === 'phb') return str * 15 * m;
  return str * 10 * m;
}

/**
 * R1.4 — pure composition helper for the reducer's hard-mode guard.
 *
 * Returns `true` IFF the hypothetical post-write weight
 * (`currentWeight + addedWeight`) would CROSS the `heavyThreshold`
 * ceiling for the given `(str, size, rule)`. Equal-to is NOT a cross
 * (`>`-strict; matches the `encumbranceState` band semantics so the
 * threshold reads the same in display and enforcement).
 *
 * `rule === 'off'` returns `false` unconditionally — there is no
 * ceiling, so no post-write weight can cross it. The reducer caller
 * typically short-circuits before reaching this when `enforce === false`
 * OR `rule === 'off'`, but the helper stays safe to call regardless.
 *
 * Intentionally NOT named `would-reject` — the rejection decision is the
 * reducer's (it combines this with `enforceEncumbrance`); this helper
 * only answers the "are we over?" half.
 */
export function wouldExceedThreshold(
  currentWeight: number,
  addedWeight: number,
  str: number,
  size: CreatureSize,
  rule: EncumbranceRule,
): boolean {
  if (rule === 'off') return false;
  return currentWeight + addedWeight > heavyThreshold(str, size, rule);
}
