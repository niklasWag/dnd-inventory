/**
 * R11 — Dice roller for the initiative tracker (OUTLINE §2 amended
 * 2026-07-17). Pure + deterministic: an injectable `rng` ∈ [0,1)
 * (default `Math.random`) makes every roll reproducible in tests,
 * mirroring the `hoard.ts` pattern.
 *
 * Encounter/combat state is transient table-side state and lives OUTSIDE
 * `TransactionLog`; these helpers are the pure core the ephemeral
 * encounter store calls.
 */

export type RollMode = 'advantage' | 'normal' | 'disadvantage';

/** One d20 face in [1,20] from a single rng draw ∈ [0,1). */
function d20Face(rng: () => number): number {
  return 1 + Math.floor(rng() * 20);
}

/**
 * Roll a d20 under the given advantage/disadvantage mode.
 *   - `normal` — one draw.
 *   - `advantage` — two draws, take the higher.
 *   - `disadvantage` — two draws, take the lower.
 */
export function rollD20(mode: RollMode, rng: () => number = Math.random): number {
  if (mode === 'normal') return d20Face(rng);
  const a = d20Face(rng);
  const b = d20Face(rng);
  return mode === 'advantage' ? Math.max(a, b) : Math.min(a, b);
}

/** A d20 roll (per `mode`) plus a signed initiative modifier. */
export function rollInitiative(
  modifier: number,
  mode: RollMode,
  rng: () => number = Math.random,
): number {
  return rollD20(mode, rng) + modifier;
}
