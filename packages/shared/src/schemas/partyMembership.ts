import { z } from 'zod';

/**
 * PartyMembership — composite primary key is `(userId, partyId, role)`,
 * which is why the party creator has TWO rows for the same user (dm +
 * player). `characterId` is null on the dm row, set on the player row
 * (OUTLINE §4 invariants / MVP §6).
 *
 * R4.1 — `leftAt` widened from `z.null()` to nullable ISO datetime to
 * support soft-deletion of memberships by `leave-party` / `kick-player`
 * (OUTLINE §8.3). Legacy MVP-vintage rows with `leftAt: null` parse
 * cleanly under the widened schema.
 */
export const partyMembershipSchema = z.object({
  userId: z.string().min(1),
  partyId: z.string().min(1),
  role: z.enum(['dm', 'player']),
  characterId: z.string().min(1).nullable(),
  joinedAt: z.string().datetime(),
  leftAt: z.string().datetime().nullable(),
});

export type PartyMembership = z.infer<typeof partyMembershipSchema>;
