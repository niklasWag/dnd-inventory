/**
 * Charge tracking and recharge rules (OUTLINE §3.8 + §6).
 *
 * R2.2 — full implementation. Pure, deterministic helpers. The reducer
 * (`use-charge` / `recharge` cases) calls these to apply state changes;
 * UI components call `canUseCharge` to gate buttons.
 *
 * Two enums that look similar but mean different things:
 *
 *   - **`rechargeRule`** lives on `ItemDefinition.charges.rechargeRule`
 *     and describes HOW an item recharges:
 *     `'dawn' | 'dusk' | 'long-rest' | 'short-rest' | 'custom' | 'none'`.
 *     `'custom'` = DM-recharged manually (MVP doesn't parse formulas).
 *     `'none'` = single-use sentinel (auto-consume on zero).
 *
 *   - **`recharge` log entry `trigger`** describes WHAT FIRED a recharge:
 *     `'dawn' | 'dusk' | 'long-rest' | 'short-rest' | 'manual'`.
 *     `'manual'` covers the Item Detail Recharge button AND R6 DM force-
 *     recharge. The two enums intentionally have different shapes.
 *
 * Two narrower types capture the batch-recharge slice of each enum:
 * `BatchRechargeTrigger` = the four time-based triggers the Character
 * Sheet Rest dropdown fires; `RechargeTrigger` = the full set including
 * `'manual'` for the log payload's trigger.
 */

/** Full set of recharge rules per OUTLINE §3.8 line 160. */
export type RechargeRule = 'dawn' | 'dusk' | 'long-rest' | 'short-rest' | 'custom' | 'none';

/** Triggers the Character Sheet Rest dropdown can fire (batch dispatch). */
export type BatchRechargeTrigger = 'dawn' | 'dusk' | 'long-rest' | 'short-rest';

/** Full set of trigger values that appear on the `recharge` log entry. */
export type RechargeTrigger = BatchRechargeTrigger | 'manual';

/**
 * A `charges` block on an `ItemDefinition`. Lives in `@app/shared` as
 * the canonical schema; this module's local mirror exists so the rules
 * layer can be consumed without dragging a Zod dependency into pure
 * code paths.
 */
export interface ChargeSpec {
  max: number;
  rechargeRule: RechargeRule;
  /**
   * Opaque human-readable formula (e.g. `"1d6+1"`). MVP doesn't parse.
   *
   * Typed as `string | undefined` (not bare `string?`) to interop with
   * the `@app/shared` Zod schema, which infers `rechargeAmount?: string |
   * undefined` due to its `.optional()` modifier. Without the explicit
   * `| undefined` arm, `exactOptionalPropertyTypes: true` would reject
   * passing a `ChargesBlock` parsed from JSON.
   */
  rechargeAmount?: string | undefined;
}

/**
 * Returns the next `currentCharges` value after spending `amount`
 * charges. Clamps at 0 — over-spend is a UI/reducer concern (the
 * reducer rejects dispatches that would go negative; this function
 * is also called downstream where clamping is the friendlier default).
 *
 * Throws on non-positive `amount` — callers must pass a positive
 * integer (1 in the MVP UI; multi-charge spells in R6).
 */
export function useCharge(current: number, amount = 1): number {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`charges.useCharge: amount must be a positive integer, got ${amount}`);
  }
  return Math.max(0, current - amount);
}

/**
 * `true` when the row has at least one charge to spend. Null-safe:
 * returns `false` for `null` (out-of-Inventory items have null
 * currentCharges per OUTLINE §3.4) and `false` for 0.
 */
export function canUseCharge(current: number | null): boolean {
  return current !== null && current > 0;
}

/**
 * Returns the post-recharge `currentCharges` value. MVP behavior: always
 * fully recharge to `spec.max`. Formula evaluation (`rechargeAmount`)
 * lands in R6 (DM tools).
 *
 * `_trigger` is accepted but currently unused — the rules layer doesn't
 * branch on trigger in MVP. The reducer is the source of truth for
 * "does this item match this trigger" (via `eligibleForBatchRecharge`).
 */
export function rechargeTo(spec: ChargeSpec): number {
  return spec.max;
}

/**
 * Strict trigger-to-rule match: a wand with `rechargeRule: 'dawn'` is
 * eligible for a `'dawn'` batch trigger and nothing else. A
 * long-rest dispatch will NOT auto-fire dawn-rule items — the user
 * picks the right trigger from the Rest dropdown.
 *
 * Returns `false` for `rechargeRule: 'custom'` (DM-only manual recharge
 * via Item Detail) and `rechargeRule: 'none'` (single-use; never
 * recharges).
 *
 * Trigger type is the narrower `BatchRechargeTrigger`; the `'manual'`
 * value never reaches this function (batch dispatches don't pass it).
 */
export function eligibleForBatchRecharge(
  spec: ChargeSpec,
  trigger: BatchRechargeTrigger,
): boolean {
  return spec.rechargeRule === trigger;
}

/**
 * `true` for the single-use sentinel `rechargeRule: 'none'`. The
 * reducer's `use-charge` case checks this when `currentCharges` lands
 * at 0 — when true, it emits a synthetic `consume` entry to remove
 * (or decrement-stack) the row.
 */
export function isSingleUse(spec: ChargeSpec): boolean {
  return spec.rechargeRule === 'none';
}
