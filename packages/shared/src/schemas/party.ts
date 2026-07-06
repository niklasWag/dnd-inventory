import { z } from 'zod';

import { encumbranceRuleSchema } from './character';

/**
 * Party — every party-of-one is the same shape as a 2+-member party.
 *
 * `bankerUserId` may be a userId (active Banker appointment per OUTLINE
 * §3.14) or null (no Banker). Widened from `z.null()` in R4.2.a; the
 * reducer/server guards enforce the §3.14 invariants (target is an
 * active player, target is not the DM, party has memberCount ≥ 2, only
 * one Banker at a time — reassignment must revoke first).
 *
 * BUG-011 (2026-07-06) — encumbrance is a party-wide house rule, not a
 * per-character setting. `encumbranceRule` (`off | phb | variant`) and
 * `enforceEncumbrance` (whether the reducer rejects over-capacity
 * acquires/transfers) live here and apply uniformly to every character
 * in the party. DM-only edit permission (see `guards/map.ts`
 * `setEncumbranceGuard`); flipped via the party-scoped `set-encumbrance`
 * action. STR + creature-size stay on `Character` — those are the
 * per-character body inputs the rule reads from.
 */
export const partySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    ownerUserId: z.string().min(1),
    inviteCode: z.string().min(1),
    recoveredLootStashId: z.string().min(1),
    bankerUserId: z.string().min(1).nullable(),
    encumbranceRule: encumbranceRuleSchema,
    enforceEncumbrance: z.boolean(),
    createdAt: z.string().datetime(),
  })
  .strict();

export type Party = z.infer<typeof partySchema>;
