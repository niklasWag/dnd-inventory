/**
 * R3.4.a — resolve the session-derived `Actor` for a sync request.
 *
 * Per SECURITY §2.1: the request body NEVER supplies `actorUserId` or
 * `actorRole`. Server flow:
 *   1. resolve `userId` from the session cookie (via `app.getSession`),
 *   2. read the user's `PartyMembership` for the target party,
 *   3. read the `Party` row for banker derivation,
 *   4. call `deriveActorRole(party, membership)` from `@app/shared/guards`.
 *
 * Returns either a typed `Actor` or a `{ error }` discriminator the
 * route handler maps to 403 / 404.
 */
import type { Actor } from '@app/shared';
import { deriveActorRole } from '@app/shared';

import type { Prisma, PrismaClient } from '../../prisma/generated/prisma/client.js';
import { fromPrismaParty, fromPrismaPartyMembership } from '../db/mappers.js';

type Tx = PrismaClient | Prisma.TransactionClient;

export type ActorResolution =
  | { ok: true; actor: Actor }
  | { ok: false; error: 'party_not_found' | 'not_a_member' };

export async function resolveActor(
  tx: Tx,
  userId: string,
  partyId: string,
): Promise<ActorResolution> {
  const [partyRow, membershipRows] = await Promise.all([
    tx.party.findUnique({ where: { id: partyId } }),
    // Composite PK is (userId, partyId, role) — a user may have multiple
    // active rows (dm + player). Take the FIRST one to seed the role
    // lookup; the `deriveActorRole` call uses Party.bankerUserId for
    // banker derivation regardless of which role row is consulted.
    tx.partyMembership.findMany({ where: { userId, partyId, leftAt: null } }),
  ]);

  if (partyRow === null) return { ok: false, error: 'party_not_found' };
  if (membershipRows.length === 0) return { ok: false, error: 'not_a_member' };

  // Prefer DM > player > banker for the membership row passed to
  // deriveActorRole. The banker derivation goes through Party.bankerUserId
  // anyway; the membership.role only matters as the fallback when
  // bankerUserId !== userId. DM is the strict superset of player rights
  // per OUTLINE §8.1 row "Edit own character name ... DM (any character)",
  // so picking DM when present gives the actor the broader rights.
  const dmRow = membershipRows.find((m) => m.role === 'dm');
  const chosenRow = dmRow ?? membershipRows[0]!;
  const membership = fromPrismaPartyMembership(chosenRow);
  const party = fromPrismaParty(partyRow);
  const role = deriveActorRole(party, membership);

  return { ok: true, actor: { userId, partyId, role } };
}
