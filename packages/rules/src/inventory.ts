/**
 * Inventory math (OUTLINE §6, MVP §8). Pure helpers shared by the reducer
 * cases that move items between stashes (`transfer`) or break a stack
 * in place (`split`). M5 ships them as the single source of truth for the
 * auto-stack key + the quantity validation boundaries.
 *
 * The auto-stack key is `(stashId, definitionId, notes ?? "")` — `customName`
 * is intentionally NOT part of the key (it's a per-instance label, not a
 * dedupe field). Missing `notes` and empty-string `notes` collapse to the
 * same key so `acquire({ notes: undefined })` and `acquire({ notes: '' })`
 * stack onto each other; this matches the M2 `acquire` reducer.
 *
 * `validateTransfer` accepts `qty === source.quantity` (a "move-all"); only
 * `validateSplit` is strict at the upper bound (a pure split must leave
 * BOTH rows non-empty per the M5 user decision).
 */

import type { ItemInstance } from '@app/shared';

/**
 * Find the row in `items` that a stack of `(stashId, definitionId, notes)`
 * would auto-stack onto on arrival. Returns `undefined` when no such row
 * exists. Caller decides whether to create a new row or merge.
 *
 * Auto-stack key: `(ownerId, definitionId, notes ?? "")`. Matches the M2
 * `acquire` reducer's inlined search.
 */
export function findAutoStackTarget(
  items: readonly ItemInstance[],
  stashId: string,
  definitionId: string,
  notes: string | undefined,
): ItemInstance | undefined {
  const notesKey = notes ?? '';
  return items.find(
    (i) => i.ownerId === stashId && i.definitionId === definitionId && (i.notes ?? '') === notesKey,
  );
}

/**
 * Validate a transfer quantity. Accepts `1 \u2264 qty \u2264 source.quantity`
 * (the upper bound is inclusive — a transfer of the entire stack is the
 * common "move-all" case).
 *
 * Throws on non-integer, non-positive, or over-quantity inputs.
 */
export function validateTransfer(source: ItemInstance, qty: number): void {
  if (!Number.isInteger(qty)) {
    throw new Error(`inventory.validateTransfer: qty must be an integer, got ${String(qty)}`);
  }
  if (qty <= 0) {
    throw new Error(`inventory.validateTransfer: qty must be positive, got ${String(qty)}`);
  }
  if (qty > source.quantity) {
    throw new Error(
      `inventory.validateTransfer: qty ${String(qty)} exceeds source quantity ${String(
        source.quantity,
      )}`,
    );
  }
}

/**
 * Validate a split quantity. Accepts `1 \u2264 qty < source.quantity` (the
 * upper bound is EXCLUSIVE — a "split" that empties the source is a
 * transfer, not a split, and `validateTransfer` is the right gate for
 * that). Splitting a singleton row (quantity 1) is always rejected.
 *
 * Throws on non-integer, non-positive, or `qty >= source.quantity`.
 */
export function validateSplit(source: ItemInstance, qty: number): void {
  if (!Number.isInteger(qty)) {
    throw new Error(`inventory.validateSplit: qty must be an integer, got ${String(qty)}`);
  }
  if (qty <= 0) {
    throw new Error(`inventory.validateSplit: qty must be positive, got ${String(qty)}`);
  }
  if (qty >= source.quantity) {
    throw new Error(
      `inventory.validateSplit: qty ${String(qty)} must be less than source quantity ${String(
        source.quantity,
      )} (use a transfer for a full move)`,
    );
  }
}
