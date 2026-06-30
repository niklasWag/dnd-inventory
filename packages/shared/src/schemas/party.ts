import { z } from 'zod';

/**
 * Party — every party-of-one is the same shape as a 2+-member party.
 *
 * `bankerUserId` may be a userId (active Banker appointment per OUTLINE
 * §3.14) or null (no Banker). Widened from `z.null()` in R4.2.a; the
 * reducer/server guards enforce the §3.14 invariants (target is an
 * active player, target is not the DM, party has memberCount ≥ 2, only
 * one Banker at a time — reassignment must revoke first).
 */
export const partySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    ownerUserId: z.string().min(1),
    inviteCode: z.string().min(1),
    recoveredLootStashId: z.string().min(1),
    bankerUserId: z.string().min(1).nullable(),
    createdAt: z.string().datetime(),
  })
  .strict();

export type Party = z.infer<typeof partySchema>;
