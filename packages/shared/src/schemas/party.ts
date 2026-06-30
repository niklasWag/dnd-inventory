import { z } from 'zod';

/**
 * Party — every party-of-one is the same shape as a 2+-member party.
 *
 * `bankerUserId` is hard-coded `null` until R4.2 widens the schema to
 * accept a non-null banker (OUTLINE §3.14 — banker is denormalized on
 * Party, not a membership row).
 */
export const partySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    ownerUserId: z.string().min(1),
    inviteCode: z.string().min(1),
    recoveredLootStashId: z.string().min(1),
    bankerUserId: z.null(),
    createdAt: z.string().datetime(),
  })
  .strict();

export type Party = z.infer<typeof partySchema>;
