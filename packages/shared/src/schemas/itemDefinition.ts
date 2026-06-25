import { z } from 'zod';

/**
 * ItemDefinition — the catalog entry. MVP carries PHB + homebrew only;
 * DMG (rarity, attunement, charges) lands in R2 (MVP §6 / §13).
 *
 * `source = "PHB"` entries are immutable in the UI; users `duplicate-to-edit`
 * to create a homebrew clone (carries `duplicatedFromId`).
 */
export const itemCategorySchema = z.enum([
  'weapon',
  'armor',
  'gear',
  'tool',
  'ammunition',
  'consumable',
  'container',
  'other',
]);
export type ItemCategory = z.infer<typeof itemCategorySchema>;

export const currencyDenominationSchema = z.enum(['cp', 'sp', 'ep', 'gp', 'pp']);
export type CurrencyDenomination = z.infer<typeof currencyDenominationSchema>;

export const itemDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  source: z.enum(['PHB', 'homebrew']),
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
  duplicatedFromId: z.string().min(1).optional(),
  createdBy: z.string().min(1).optional(),
  partyId: z.string().min(1).optional(),
});

export type ItemDefinition = z.infer<typeof itemDefinitionSchema>;
