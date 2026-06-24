/**
 * Weight aggregation (OUTLINE §6).
 *
 * R1.1 — sums the weights of a flat row list (`weight × quantity` summed
 * across all rows). MVP items live one-deep in an Inventory stash with
 * no container nesting, so this is the complete formula for R1.1.
 *
 * R1.2 will widen the signature to accept `ItemInstance` + `ItemDefinition`
 * pairs so we can implement the container cascade: items inside a
 * container contribute their own weight UNLESS the container's
 * `ItemDefinition.flatWeight === true` (Bag of Holding etc., per
 * OUTLINE §3.6) — in which case contents are ignored and only the
 * container's own weight counts.
 */

/** Sum `weight × quantity` over a flat row list. Returns 0 for empty input. */
export function totalWeight(
  items: ReadonlyArray<{ weight: number; quantity: number }>,
): number {
  return items.reduce((sum, item) => sum + item.weight * item.quantity, 0);
}
