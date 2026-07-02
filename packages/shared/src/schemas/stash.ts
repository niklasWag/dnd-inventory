import { z } from 'zod';

/**
 * Stash — `scope` is a discriminated union across the three legal kinds.
 *
 * Invariants enforced via the discriminant (OUTLINE §4 / MVP §6):
 * - `scope=character` → `ownerCharacterId` set, `partyId` null
 * - `scope=party` → `partyId` set, `ownerCharacterId` null
 * - `scope=recovered-loot` → `partyId` set, `ownerCharacterId` null
 *
 * Only `scope=character` stashes may be the carried Inventory
 * (`isCarried: true`). Exactly one such stash exists per character, and
 * `Character.inventoryStashId` references it (asserted at the AppState
 * level, not by the row schema alone).
 */
const baseStashFields = {
  id: z.string().min(1),
  name: z.string().min(1),
  isCarried: z.boolean(),
  createdAt: z.string().datetime(),
};

export const stashSchema = z.discriminatedUnion('scope', [
  z
    .object({
      ...baseStashFields,
      scope: z.literal('character'),
      ownerCharacterId: z.string().min(1),
      partyId: z.null(),
    })
    .strict(),
  z
    .object({
      ...baseStashFields,
      scope: z.literal('party'),
      ownerCharacterId: z.null(),
      partyId: z.string().min(1),
      isCarried: z.literal(false),
    })
    .strict(),
  z
    .object({
      ...baseStashFields,
      scope: z.literal('recovered-loot'),
      ownerCharacterId: z.null(),
      partyId: z.string().min(1),
      isCarried: z.literal(false),
    })
    .strict(),
]);

export type Stash = z.infer<typeof stashSchema>;
