import { z } from 'zod';

/**
 * ItemDefinition — the catalog entry. PHB (mundane), DMG (magic), and
 * homebrew all share this shape.
 *
 * `source = "PHB" | "DMG"` entries are immutable in the UI; users
 * `duplicate-to-edit` to create a homebrew clone (carries
 * `duplicatedFromId`).
 */
export const itemCategorySchema = z.enum([
  'weapon',
  'armor',
  'gear',
  'tool',
  'ammunition',
  'consumable',
  // R2.1 — added 'magic' (wands, rods, staves, miscellaneous magic
  // items) and 'currency' (gems, art objects, coin-equivalents) per
  // OUTLINE §4 line 272. Listed after 'consumable' / before 'container'
  // / 'other' so the natural ordering reads "physical → magical →
  // valuables → containers → misc".
  'magic',
  'currency',
  'container',
  'other',
]);
export type ItemCategory = z.infer<typeof itemCategorySchema>;

export const currencyDenominationSchema = z.enum(['cp', 'sp', 'ep', 'gp', 'pp']);
export type CurrencyDenomination = z.infer<typeof currencyDenominationSchema>;

/**
 * Magic-item rarity tiers per OUTLINE §4 line 273 + DMG 2024.
 * Kebab-case `'very-rare'` matches the existing category enum style.
 * Nullable in the schema below to support "no rarity" rows (PHB mundane
 * entries omit it; explicit `null` is also valid for forward-compat).
 */
export const raritySchema = z.enum([
  'common',
  'uncommon',
  'rare',
  'very-rare',
  'legendary',
  'artifact',
]);
export type Rarity = z.infer<typeof raritySchema>;

export const itemDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  // R2.1 — `'DMG'` added alongside `'PHB'` / `'homebrew'` for the magic
  // items catalog. The reducer's `seed-catalog` upsert key is the row
  // id (prefixed `phb-2024:` / `dmg-2024:` / homebrew `homebrew:<uuid>`)
  // so the source enum is purely descriptive — no behavioral fork.
  source: z.enum(['PHB', 'DMG', 'homebrew']),
  category: itemCategorySchema,
  weight: z.number().nonnegative().optional(),
  // R1.3: Bag-of-Holding-style discriminator per OUTLINE §3.6 + §4.
  // When `true`, `packages/rules/weight.ts` stops descending into the
  // container's contents — only the container's own `weight` counts
  // toward encumbrance. PHB seed entries omit it (treated as `false`);
  // DMG seed (R2.1) ships `flatWeight: true` on BoH / Handy Haversack
  // / Portable Hole. Homebrew can opt in via the same field.
  //
  // Optional rather than `.default(false)` so existing PHB seed rows +
  // M6 homebrew creation paths don't have to be retrofitted — the
  // consumer (`weight.ts`) treats `undefined` and `false` identically.
  // R1.1-vintage exports import cleanly: the field is just absent on
  // every row, equivalent to `false` at the rules layer.
  flatWeight: z.boolean().optional(),
  cost: z
    .object({
      amount: z.number().nonnegative(),
      currency: currencyDenominationSchema,
    })
    .optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  // R2.1 — magic-item metadata (OUTLINE §3.8 + §4 line 273).
  // `rarity` is `null | absent` for mundane rows; one of the 6 tiers
  // for magic items. `requiresAttunement` gates the reducer's `attune`
  // action (only `true` can be attuned) and the StashItemsTable's
  // Attune button visibility. `attunementPrereq` is an advisory
  // display string per OUTLINE §3.8 ("Requires attunement by a wizard").
  rarity: raritySchema.nullable().optional(),
  requiresAttunement: z.boolean().optional(),
  attunementPrereq: z.string().optional(),
  duplicatedFromId: z.string().min(1).optional(),
  createdBy: z.string().min(1).optional(),
  partyId: z.string().min(1).optional(),
});

export type ItemDefinition = z.infer<typeof itemDefinitionSchema>;
