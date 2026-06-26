import type { ItemDefinition, ItemInstance } from '@app/shared';

/**
 * Identification helpers shared by ItemDetail, StashItemsTable, and the
 * ItemHistory entry summarizer (R2.3).
 *
 * Pure — no React imports. The OUTLINE §8 display invariant is
 * implemented here: when `row.identified === false`, the user sees
 * "Unknown Magic Item" instead of the real definition name. Spoiler
 * protection extends to `customName` too — a player-supplied nickname
 * would also reveal "this is a magic item" to anyone reading the row.
 */

/**
 * Single source of truth for the display name shown when an item is
 * unidentified. Matches OUTLINE §8 verbatim ("Players always see
 * unidentified items as 'Unknown Magic Item' plus the DM-set hint.").
 */
export const UNKNOWN_MAGIC_ITEM_LABEL = 'Unknown Magic Item';

/**
 * Computes the user-visible name for a row, applying the OUTLINE §8
 * display invariant. When `row.identified === false`, returns the
 * unknown-label regardless of `customName`. When identified, returns
 * `customName` if set, otherwise the catalog definition name, with
 * `(unknown item)` as a final fallback for an orphan row.
 */
export function displayName(row: ItemInstance, def: ItemDefinition | undefined): string {
  if (row.identified === false) return UNKNOWN_MAGIC_ITEM_LABEL;
  return row.customName ?? def?.name ?? '(unknown item)';
}
