import type { ChargesBlock, ChargesRechargeRule } from '@app/shared';

/**
 * Charges display helpers (R2.2). Mirror `lib/rarity.ts`: pure, no React,
 * Tailwind-string returns. Consumed by `ItemDetail`, `StashItemsTable`,
 * and the CharacterSheet `Rest` dropdown.
 *
 * Two-enum reminder (see `packages/rules/src/charges.ts` for the long
 * version):
 *   - `ChargesRechargeRule` (`'dawn' | … | 'custom' | 'none'`) lives on
 *     the definition's `charges.rechargeRule`. Describes HOW an item
 *     recharges.
 *   - The recharge log entry's `trigger` field uses `'manual'` instead
 *     of `'custom'` and lacks `'none'`. `BATCH_TRIGGER_LABEL` covers
 *     only the four time-based triggers the Rest dropdown surfaces.
 */

/** The four batch triggers the Character Sheet Rest dropdown fires. */
export type BatchRechargeTrigger = 'dawn' | 'dusk' | 'long-rest' | 'short-rest';

/** Canonical display order for the Rest dropdown menu. */
export const BATCH_TRIGGER_ORDER: readonly BatchRechargeTrigger[] = [
  'short-rest',
  'long-rest',
  'dawn',
  'dusk',
];

/**
 * Human-readable label for the recharge rule (rendered on Item Detail
 * alongside the charges counter, e.g. "Recharges at dawn (1d6+1)").
 */
export function rechargeRuleLabel(rule: ChargesRechargeRule): string {
  switch (rule) {
    case 'dawn':
      return 'Recharges at dawn';
    case 'dusk':
      return 'Recharges at dusk';
    case 'long-rest':
      return 'Recharges on a long rest';
    case 'short-rest':
      return 'Recharges on a short rest';
    case 'custom':
      return 'DM-recharged';
    case 'none':
      return 'Single use';
  }
}

/**
 * Human-readable label for a batch recharge trigger (the Rest dropdown).
 * Distinct from `rechargeRuleLabel` — the dropdown verb is "trigger the
 * recharge", not "describe how the item recharges".
 */
export function batchTriggerLabel(trigger: BatchRechargeTrigger): string {
  switch (trigger) {
    case 'short-rest':
      return 'Short Rest';
    case 'long-rest':
      return 'Long Rest';
    case 'dawn':
      return 'Dawn';
    case 'dusk':
      return 'Dusk';
  }
}

/**
 * Compact charges display for stash row suffixes: `"3/7"` when both
 * values are present, `"—/7"` when the row hasn't been initialised
 * (currentCharges null — should only happen on rows outside Inventory,
 * which won't render this string anyway).
 */
export function formatChargesShort(current: number | null, max: number): string {
  return `${current ?? '—'}/${max}`;
}

/**
 * Full charges line for the Item Detail panel:
 *   `"3 / 7 charges — Recharges at dawn (1d6+1)"`
 *   `"1 / 1 charges — Single use"`
 * Falls back to `"—/{max} charges — {rule}"` when currentCharges is
 * null (item not in Inventory).
 */
export function formatChargesLong(
  current: number | null,
  charges: ChargesBlock,
): string {
  const counter = `${current ?? '—'} / ${charges.max} charges`;
  const ruleText = rechargeRuleLabel(charges.rechargeRule);
  const formula =
    charges.rechargeAmount !== undefined && charges.rechargeAmount.length > 0
      ? ` (${charges.rechargeAmount})`
      : '';
  return `${counter} — ${ruleText}${formula}`;
}
