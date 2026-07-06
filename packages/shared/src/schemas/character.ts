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
  })
  .strict();

export type Character = z.infer<typeof characterSchema>;
