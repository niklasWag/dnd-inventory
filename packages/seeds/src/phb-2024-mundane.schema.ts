import { z } from 'zod';

import { currencyDenominationSchema, itemCategorySchema } from '@app/shared';

/**
 * Schema for one entry in `data/phb-2024-mundane.json`.
 *
 * Mirrors `ItemDefinition` from `@app/shared` minus the fields the loader
 * mints itself:
 *   - `id` — derived from `slug` so re-seeds are stable across reloads.
 *   - `source` — always `"PHB"`; the loader sets it.
 *   - `duplicatedFromId`, `createdBy`, `partyId` — only meaningful for homebrew.
 *
 * `slug` is required and unique within the file: it's the deterministic
 * piece of the minted id (`phb-2024:<slug>`). Keeping the slug in the source
 * data — rather than slugifying the name at load time — means name tweaks
 * (e.g. "Hempen Rope" → "Rope, Hempen") don't quietly change the catalog id
 * and orphan every `ItemInstance` that already references it.
 */
export const phbSeedEntrySchema = z.object({
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'slug must be lowercase kebab-case (a-z, 0-9, hyphens)'),
  name: z.string().min(1),
  category: itemCategorySchema,
  weight: z.number().nonnegative().optional(),
  cost: z
    .object({
      amount: z.number().nonnegative(),
      currency: currencyDenominationSchema,
    })
    .optional(),
  description: z.string().optional(),
  tags: z.array(z.string().min(1)).optional(),
});

export type PhbSeedEntry = z.infer<typeof phbSeedEntrySchema>;

/** The seed file is an array of entries at the top level. */
export const phbSeedFileSchema = z.array(phbSeedEntrySchema);
export type PhbSeedFile = z.infer<typeof phbSeedFileSchema>;
