/**
 * Weight aggregation (OUTLINE §6).
 *
 * R1.1 — `totalWeight` sums the weights of a flat row list
 * (`weight × quantity` summed across all rows). Still used wherever the
 * input doesn't have containers (M5 flat-stash aggregations etc.).
 *
 * R1.3 — `containerAwareWeight` widens to accept `ItemInstance` +
 * `ItemDefinition` pairs and implements the OUTLINE §3.6 container
 * cascade: items inside a container contribute their own weight
 * UNLESS the container's `ItemDefinition.flatWeight === true` (Bag
 * of Holding etc., per OUTLINE §3.6) — in which case contents are
 * ignored and only the container's own weight counts.
 *
 * Single-level only: a row whose parent (referenced via
 * `containerInstanceId`) is itself contained is reducer-rejected at
 * write time (OUTLINE §3.6), so the rule does NOT need to descend
 * more than one level.
 */

/** Sum `weight × quantity` over a flat row list. Returns 0 for empty input. */
export function totalWeight(
  items: ReadonlyArray<{ weight: number; quantity: number }>,
): number {
  return items.reduce((sum, item) => sum + item.weight * item.quantity, 0);
}

/**
 * Container-aware weight aggregation (R1.3 — OUTLINE §3.6).
 *
 * Returns the sum of `weight × quantity` over every row, with one
 * exception: a row whose `containerInstanceId` points at a parent
 * whose definition has `flatWeight === true` is skipped (its weight
 * is "absorbed" by the flat-weight container, mirroring the in-fiction
 * Bag of Holding behavior).
 *
 * Defensive against missing definitions: rows whose `definitionId`
 * isn't in `definitionsById` contribute 0 (so a partially-seeded state
 * doesn't NaN out the encumbrance bar). The container-parent lookup
 * also tolerates absent parents (treats them as non-flat).
 */
export function containerAwareWeight(
  rows: ReadonlyArray<{
    id: string;
    definitionId: string;
    quantity: number;
    containerInstanceId: string | null;
  }>,
  definitionsById: ReadonlyMap<string, { weight: number; flatWeight?: boolean }>,
): number {
  // Build parent → flatWeight lookup once so the inner sum stays O(N).
  const flatParents = new Set<string>();
  for (const row of rows) {
    const def = definitionsById.get(row.definitionId);
    if (def?.flatWeight === true) flatParents.add(row.id);
  }

  let total = 0;
  for (const row of rows) {
    const def = definitionsById.get(row.definitionId);
    if (def === undefined) continue;
    // Contained-in-a-flat-weight-parent rows contribute nothing.
    if (row.containerInstanceId !== null && flatParents.has(row.containerInstanceId)) {
      continue;
    }
    total += def.weight * row.quantity;
  }
  return total;
}
