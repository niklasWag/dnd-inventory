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

/**
 * Recharge rule on a magic-item `charges` block (OUTLINE §3.8 + §6
 * `charges.ts`). Activated in R2.2.
 *
 * - `'dawn' | 'dusk' | 'long-rest' | 'short-rest'` — standard 5e
 *   recharge triggers. The Character Sheet "Rest" dropdown fires the
 *   matching batch dispatch; the reducer iterates Inventory and
 *   recharges every item whose `rechargeRule` strictly matches the
 *   trigger.
 * - `'custom'` — DM-recharged manually (e.g. Rod of Resurrection's
 *   multi-day recharge). The MVP rules layer ignores the formula and
 *   the Item Detail Recharge button fully recharges to `max` on press;
 *   R6 (DM tools) is the natural home for formula evaluation.
 * - `'none'` — single-use sentinel (potions, scrolls, necklace beads).
 *   When `currentCharges` decrements to 0 and `rechargeRule === 'none'`,
 *   the reducer emits a synthetic `consume` entry to remove (or
 *   decrement-stack) the row.
 *
 * Distinct from the `recharge` log entry's `trigger` enum, which uses
 * `'manual'` for the user-initiated path (button press / R6 force-
 * recharge). The two enums are intentionally not the same shape:
 * `rechargeRule` describes how an item recharges; `trigger` describes
 * what fired the recharge.
 */
export const chargesRechargeRuleSchema = z.enum([
  'dawn',
  'dusk',
  'long-rest',
  'short-rest',
  'custom',
  'none',
]);
export type ChargesRechargeRule = z.infer<typeof chargesRechargeRuleSchema>;

/**
 * `charges` block on a magic-item `ItemDefinition`. `max` is the
 * fully-recharged count; `rechargeAmount` is an opaque human-readable
 * formula (e.g. `"1d6+1"`) — the MVP rules engine does not evaluate
 * it. R6 may add formula parsing.
 */
export const chargesSchema = z.object({
  max: z.number().int().positive(),
  rechargeRule: chargesRechargeRuleSchema,
  rechargeAmount: z.string().min(1).optional(),
});
export type ChargesBlock = z.infer<typeof chargesSchema>;

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
  // R2.2 — magic-item charges block (OUTLINE §3.8 + §4 line 277).
  // Optional rather than `.default(...)` so PHB seed rows + M6 homebrew
  // creation paths don't need retrofitting — undefined / absent means
  // "this item has no charges mechanic". DMG seed entries that describe
  // charges in their flavor text (wands, staves, rings, potions, scrolls)
  // ship with this block populated.
  charges: chargesSchema.optional(),
  duplicatedFromId: z.string().min(1).optional(),
  createdBy: z.string().min(1).optional(),
  partyId: z.string().min(1).optional(),
});

export type ItemDefinition = z.infer<typeof itemDefinitionSchema>;
