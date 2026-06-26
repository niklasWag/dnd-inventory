import type { Party, PartyMembership } from '../schemas';

import type { Actor, ActorRole } from './index';

/**
 * R3.4.a — derive the actor's role for the §8.1 guard layer.
 *
 * Per SECURITY §2.1: the request body NEVER supplies `actorUserId` or
 * `actorRole`. The server-side flow is:
 *   1. resolve `userId` from the session cookie,
 *   2. read the user's `PartyMembership` row for the target party,
 *   3. call this function with the `Party` row + the membership.
 *
 * Returns `'banker'` iff the user is the Party's denormalized banker
 * (per OUTLINE §3.14); otherwise the membership's `role`. The banker
 * value can ONLY come from `Party.bankerUserId === membership.userId`
 * — never from a `PartyMembership.role = 'banker'` row.
 *
 * MVP note: `party.bankerUserId` is null in MVP-validated state, so
 * this currently returns `membership.role` always. R4.2 broadens the
 * Zod schema for `Party.bankerUserId` and `PartyMembership.role`.
 */
export function deriveActorRole(party: Party, membership: PartyMembership): ActorRole {
  if (party.bankerUserId !== null && party.bankerUserId === membership.userId) {
    return 'banker';
  }
  return membership.role;
}

/**
 * Solo bypass — when the party has exactly one unique active member, the
 * §8.1 permission matrix is bypassed and the sole member gets the UNION
 * of DM + Player rights per OUTLINE §8.2.
 *
 * "Active" = `leftAt === null` (not yet left). The MVP schema literally
 * encodes `leftAt: z.null()` so this is structurally true for every
 * membership today, but the function is correct for the R4 multi-member
 * future where leftAt becomes settable.
 *
 * Counts distinct `userId`s — a party creator has 2 rows (dm + player)
 * but only 1 unique user, so a solo party is still solo even with the
 * MVP-standard two memberships per user.
 */
export function isSolo(memberships: readonly PartyMembership[]): boolean {
  const active = memberships.filter((m) => m.leftAt === null);
  const userIds = new Set(active.map((m) => m.userId));
  return userIds.size === 1;
}

/**
 * True iff the actor has an active membership in the party. Defensive
 * helper for guards that need to assert party membership before any
 * other check (e.g. `view-other-character` — only meaningful for
 * actors who are members of the party in question).
 */
export function isMember(actor: Actor, memberships: readonly PartyMembership[]): boolean {
  return memberships.some(
    (m) => m.userId === actor.userId && m.partyId === actor.partyId && m.leftAt === null,
  );
}
