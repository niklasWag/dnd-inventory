import { z } from 'zod';

/**
 * PartyMembership — composite primary key is `(userId, partyId, role)`,
 * which is why the party creator has TWO rows for the same user (dm +
 * player). `characterId` is null on the dm row, set on the player row
 * (OUTLINE §4 invariants).
 *
 * `leftAt` is a nullable ISO datetime: `null` for active members,
 * timestamp for soft-deleted members per `leave-party` / `kick-player`
 * (OUTLINE §8.3).
 */
export const partyMembershipSchema = z
  .object({
    userId: z.string().min(1),
    partyId: z.string().min(1),
    role: z.enum(['dm', 'player']),
    characterId: z.string().min(1).nullable(),
    joinedAt: z.string().datetime(),
    leftAt: z.string().datetime().nullable(),
  })
  .strict();

export type PartyMembership = z.infer<typeof partyMembershipSchema>;
