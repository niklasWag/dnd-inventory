import { z } from 'zod';

/**
 * Creature size category (PHB 2024 p. 366). Carrying capacity scales by
 * the size multiplier: Tiny/Small × 0.5, Medium × 1, Large × 2, Huge × 4,
 * Gargantuan × 8 (see `packages/rules/capacity.ts:sizeMultiplier`).
 *
 * In 2024 rules, size is a CREATURE property (not strictly a species
 * property — most species let the player pick within a range, e.g.
 * Aasimar can be Small or Medium). We store it on `Character` so the
 * player's pick at creation is the source of truth, decoupled from the
 * free-form `species` string.
 *
 * Default at character creation is `medium` (covers ~80% of player
 * characters in PHB 2024).
 */
export const creatureSizeSchema = z.enum([
  'tiny',
  'small',
  'medium',
  'large',
  'huge',
  'gargantuan',
]);
export type CreatureSize = z.infer<typeof creatureSizeSchema>;

/**
 * Encumbrance rule (OUTLINE §3.3 + §3.6). BUG-011 (2026-07-06) moved
 * this off `Character` and onto `Party` — it's a party-wide house rule,
 * not a per-character setting. The enum itself stays here for
 * historical import stability; `Party.encumbranceRule` +
 * `Party.enforceEncumbrance` are the actual data.
 *
 * Values:
 * - `off`     — bar hidden, no math.
 * - `phb`     — PHB 2024 default rule: at-or-under `STR × 15 × size` is
 *               fine; above is over-capacity (single band).
 * - `variant` — PHB 2024 variant encumbrance (sidebar p. 366): three
 *               bands at `> 5×STR×size` (encumbered) and `> 10×STR×size`
 *               (heavily encumbered).
 *
 * Enforcement (whether moves OVER the threshold are rejected) is the
 * orthogonal `enforceEncumbrance` boolean on `Party`. R1.4 wires the
 * reducer rejection; R1.1 stored the flag display-only.
 */
export const encumbranceRuleSchema = z.enum(['off', 'phb', 'variant']);
export type EncumbranceRule = z.infer<typeof encumbranceRuleSchema>;

/**
 * R10.5 — a single item-wishlist entry. A per-character list of things the
 * player is hoping for; the DM sees it as a read-only hint when handing out
 * loot. Two kinds:
 *   - `catalog` — a concrete `ItemDefinition` (PHB/DMG/homebrew) picked via
 *     the ItemPicker. The loot wizard can match a rolled item by
 *     `definitionId` exactly.
 *   - `text` — a free-text wish (e.g. "a flaming sword", "anything +CHA").
 *     Plain text only, rendered as JSX children (SECURITY §4) — never HTML.
 *
 * Each entry carries a stable, client-minted `id` (uuid v7, like the
 * `newItemInstanceId` id-injection convention) so `wishlist-remove` targets
 * one entry unambiguously — free-text has no natural key and duplicate wishes
 * are allowed.
 */
export const wishlistEntrySchema = z.discriminatedUnion('kind', [
  z
    .object({
      id: z.string().min(1),
      kind: z.literal('catalog'),
      definitionId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      kind: z.literal('text'),
      text: z.string().trim().min(1).max(200),
    })
    .strict(),
]);
export type WishlistEntry = z.infer<typeof wishlistEntrySchema>;

/**
 * Character — STR + creature-size drive the carrying-capacity math; the
 * rule + enforce flag live on `Party` per BUG-011 (party-wide house
 * rule). `maxAttunement` is stored but not enforced (MVP §6); R1.2 will
 * make it DM-editable.
 */
export const characterSchema = z
  .object({
    id: z.string().min(1),
    partyId: z.string().min(1),
    ownerUserId: z.string().min(1),
    name: z.string().min(1),
    species: z.string().min(1),
    // R1.1: creature size category. Drives the carrying-capacity multiplier
    // (PHB 2024 p. 366). Set at character creation; not editable in v1
    // (size changes via Enlarge/Reduce etc. are out-of-scope per §3.3).
    size: creatureSizeSchema,
    class: z.string().min(1),
    level: z.number().int().min(1).max(20),
    abilityScores: z
      .object({
        STR: z.number().int().min(1).max(30),
      })
      .strict(),
    maxAttunement: z.number().int().min(0),
    inventoryStashId: z.string().min(1),
    // R10.5 — per-character item wishlist (DM loot hint). Defaults to empty
    // so pre-R10.5 character blobs parse cleanly.
    wishlist: z.array(wishlistEntrySchema).default([]),
  })
  .strict();

export type Character = z.infer<typeof characterSchema>;
