import type { ItemDefinition, ItemInstance } from '@app/shared';

import { UNKNOWN_MAGIC_ITEM_LABEL } from './identify';

/**
 * R7.5 — search adapter for stash rows.
 *
 * `searchCatalog` (from `@app/rules`) scores anything shaped like
 * `Searchable` (name + description? + tags?). Stash rows are two things
 * joined: `ItemInstance` (per-row state — `identified`, `customName`,
 * `notes`, `hint`) and `ItemDefinition` (catalog entry — `name`,
 * `description`, `tags`, `category`, `rarity`). This adapter produces
 * one `Searchable` per row, applying the OUTLINE §8 display invariant:
 *
 *   - **Identified rows** expose:
 *       name        = customName ?? def.name  (matches the visible label)
 *       description = def.description
 *       tags        = def.tags + row.notes (if any) + row.customName
 *                     (already in name, but repeated in tags so a two-
 *                     word query like "keg dwarven" can match against
 *                     [customName, def.tags] independently)
 *
 *   - **Unidentified rows** expose:
 *       name        = "Unknown Magic Item"  (the user-visible label)
 *       description = ''                     (never leak def.description)
 *       tags        = row.hint ? [row.hint] : []
 *
 *     This means a player who types "cloak of the bat" against their
 *     unidentified magic cloak gets NO hit — matching the display
 *     invariant. Typing the hint text (e.g. "leathery" if that's the
 *     DM-set hint) DOES hit. DMs get the same reveal restriction here
 *     as everyone else; they can still browse the catalog to find real
 *     names, and the item detail view already reveals the real name
 *     to identify-authorized viewers via `hydratedDisplayName`.
 *
 * `category` is intentionally NOT indexed — it's rendered in its own
 * column and filtered separately (future R7.5 sub-slice on filters).
 * `rarity` is a facet, not free-text.
 *
 * Pure. No React imports, no store access. Callers pass the row + the
 * resolved definition (may be `undefined` for orphan rows — treated as
 * unidentified since the real name is unknowable in that state).
 */

export interface StashRowSearchable {
  /** Stable row id — used to map the `SearchResult` back to the row. */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tags: readonly string[];
}

export function stashRowSearchable(
  row: ItemInstance,
  def: ItemDefinition | undefined,
): StashRowSearchable {
  if (row.identified === false) {
    return {
      id: row.id,
      name: UNKNOWN_MAGIC_ITEM_LABEL,
      description: '',
      tags: row.hint !== undefined && row.hint !== '' ? [row.hint] : [],
    };
  }
  const defName = def?.name ?? '';
  const name = row.customName ?? defName;
  const description = def?.description ?? '';
  const tags: string[] = [];
  if (def?.tags !== undefined) tags.push(...def.tags);
  if (row.notes !== undefined && row.notes !== '') tags.push(row.notes);
  // Include the def's real name as a tag when a customName masks it —
  // otherwise a search for "longsword" on a row named "Blackreave" would
  // miss even though the row IS a longsword. Categorized as a tag so
  // it doesn't out-score the customName in name scoring.
  if (row.customName !== undefined && row.customName !== '' && defName !== '') {
    tags.push(defName);
  }
  return { id: row.id, name, description, tags };
}
