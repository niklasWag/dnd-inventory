import { z } from 'zod';

import {
  chargesSchema,
  currencyDenominationSchema,
  itemCategorySchema,
  raritySchema,
} from '@app/shared';

/**
 * Schema for one entry in `data/dmg-2024.json` (R2.1).
 *
 * Mirrors `ItemDefinition` from `@app/shared` minus the fields the
 * loader mints itself:
 *   - `id` — derived from `slug` so re-seeds are stable across reloads.
 *   - `source` — always `"DMG"`; the loader sets it.
 *   - `duplicatedFromId`, `createdBy`, `partyId` — homebrew-only.
 *
 * `slug` is required and unique within the file: it's the deterministic
 * piece of the minted id (`dmg-2024:<slug>`). Keeping the slug in the
 * source data — rather than slugifying the name at load time — means
 * name tweaks ("Bag of Holding" → "Bag of Holding, Lesser") don't quietly
 * change the catalog id and orphan every `ItemInstance` that already
 * references it.
 *
 * Differences from the PHB seed schema:
 *   - `rarity` is REQUIRED (every DMG entry has a rarity tier).
 *   - `requiresAttunement` / `attunementPrereq` are optional but
 *     meaningful for magic items.
 *   - `flatWeight` is optional; set `true` on Bag of Holding /
 *     Handy Haversack / Portable Hole per OUTLINE §3.6.
 */
export const dmgSeedEntrySchema = z.object({
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'slug must be lowercase kebab-case (a-z, 0-9, hyphens)'),
  name: z.string().min(1),
  category: itemCategorySchema,
  rarity: raritySchema,
  weight: z.number().nonnegative().optional(),
  cost: z
    .object({
      amount: z.number().nonnegative(),
      currency: currencyDenominationSchema,
    })
    .optional(),
  description: z.string().optional(),
  tags: z.array(z.string().min(1)).optional(),
  requiresAttunement: z.boolean().optional(),
  attunementPrereq: z.string().optional(),
  flatWeight: z.boolean().optional(),
  // R2.2 — optional charges block (OUTLINE §3.8 + §4 line 277). Wands /
  // staves / rods / charged rings / single-use consumables ship this
  // block; everything else omits it. The MVP rules engine doesn't
  // evaluate `rechargeAmount` — the field is human-readable flavor.
  charges: chargesSchema.optional(),
});

export type DmgSeedEntry = z.infer<typeof dmgSeedEntrySchema>;

/** The seed file is an array of entries at the top level. */
export const dmgSeedFileSchema = z.array(dmgSeedEntrySchema);
export type DmgSeedFile = z.infer<typeof dmgSeedFileSchema>;
