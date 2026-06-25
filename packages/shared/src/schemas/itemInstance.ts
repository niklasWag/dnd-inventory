import { z } from 'zod';

/**
 * ItemInstance — a row in a stash. MVP hard-coded the magic/equip fields
 * to placeholder literals so the schema is forward-compatible with R1
 * (equip/attune) and R2 (magic items + charges + identification) without
 * a migration (MVP §6 / §13).
 *
 * R1.2 relaxed `equipped` and `attuned` from `z.literal(false)` to
 * `z.boolean()` so the equip/attune reducer cases can flip them.
 *
 * R1.3 relaxes `containerInstanceId` from `z.null()` to a nullable
 * id-string so an item can be marked as living inside a container per
 * OUTLINE §3.6. The "exactly one level deep" invariant (§3.6) is
 * enforced by the reducer's `transfer` cascade — not by the schema —
 * because a self-referential ID rule needs cross-row lookup. The
 * schema only guarantees the field is either a valid id or null.
 *
 * The "only meaningful when the containing stash is Inventory"
 * invariant (OUTLINE §4) is reducer-enforced for `equipped` / `attuned`
 * (the schema has no knowledge of stash scope).
 *
 * `identified` and `currentCharges` stay as MVP-vintage literals — they
 * activate in R2 (magic items + identification + charges).
 *
 * Auto-stack key (enforced by the reducer, not the schema): `(definitionId, notes ?? "")`.
 */
export const itemInstanceSchema = z.object({
  id: z.string().min(1),
  definitionId: z.string().min(1),
  ownerType: z.literal('stash'),
  ownerId: z.string().min(1),
  containerInstanceId: z.string().min(1).nullable(),
  quantity: z.number().int().positive(),
  equipped: z.boolean(),
  attuned: z.boolean(),
  identified: z.literal(true),
  currentCharges: z.null(),
  customName: z.string().min(1).optional(),
  notes: z.string().optional(),
  conditionOverrides: z.record(z.string(), z.unknown()).optional(),
});

export type ItemInstance = z.infer<typeof itemInstanceSchema>;
