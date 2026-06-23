import type { ItemDefinition } from '@app/shared';

import phbRaw from '../data/phb-2024-mundane.json' with { type: 'json' };

import { phbSeedFileSchema, type PhbSeedEntry } from './phb-2024-mundane.schema';

/**
 * ID prefix for PHB 2024 entries. Combined with each entry's `slug` to mint
 * a stable id (`phb-2024:hempen-rope-50ft`), so re-seeds don't churn ids
 * and never orphan `ItemInstance.definitionId` references.
 */
const PHB_ID_PREFIX = 'phb-2024:';

/**
 * Parse + validate the bundled PHB 2024 mundane-items seed file. Throws if
 * the JSON fails schema (the caller — the reducer's `seed-catalog` action
 * or our tests — surfaces the error; we deliberately don't swallow it,
 * since a malformed seed is a hard build-time failure).
 *
 * Pure: no I/O at runtime, no caching needed — Vite inlines the JSON at
 * build time. Tests can call this freely.
 */
export function loadPhbSeed(): ItemDefinition[] {
  const entries = phbSeedFileSchema.parse(phbRaw);
  return entries.map(toItemDefinition);
}

function toItemDefinition(entry: PhbSeedEntry): ItemDefinition {
  // Build the definition without spreading optional `undefined`s — under
  // `exactOptionalPropertyTypes` an explicit `undefined` is not the same
  // as an omitted key, and the Zod schema rejects `weight: undefined`.
  const def: ItemDefinition = {
    id: `${PHB_ID_PREFIX}${entry.slug}`,
    name: entry.name,
    source: 'PHB',
    category: entry.category,
  };
  if (entry.weight !== undefined) def.weight = entry.weight;
  if (entry.cost !== undefined) def.cost = entry.cost;
  if (entry.description !== undefined) def.description = entry.description;
  if (entry.tags !== undefined) def.tags = entry.tags;
  return def;
}
