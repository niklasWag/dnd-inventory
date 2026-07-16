/**
 * R10.4 — shared party-leave helper.
 *
 * Extracted from `POST /parties/:partyId/leave` so account deletion
 * (`POST /users/me/delete`) can leave every party the user belongs to
 * through the SAME archive-vs-cascade branch — no duplicated logic.
 *
 * Two paths, exactly as the leave route had them:
 *   - **Sole active member** → soft-delete the actor's memberships + stamp
 *     `Party.archivedAt`. No `leave-party` log entry (archive is a
 *     meta-state change, not a §8.3 cascade). Returns `{ archived: true }`.
 *   - **Multi-member** → dispatch the `leave-party` reducer action so the
 *     §8.3 cascade runs (items + currency → Recovered Loot, memberships
 *     soft-deleted, banker auto-clear, log entry). Returns
 *     `{ archived: false }`. A sole-DM-of-a-multi-member-party surfaces as
 *     `sole_dm_must_transfer_first` — the caller must map it to HTTP 422.
 *
 * The reducer + `applyDelta` pipeline keeps the AppState canonical and the
 * TransactionLog matching (CLAUDE.md "every mutation logs once").
 */
import type { Actor } from '@app/shared';
import { generateInviteCode, reduce } from '@app/rules';

import type { PrismaClient } from '../../prisma/generated/prisma/client.js';
import { appendTransactionLog, buildLogEntryServer } from '../sync/log-builder.js';
import { applyDelta } from '../sync/persistor.js';
import { loadAppStateForUser, StateLoaderError } from '../sync/state-loader.js';

/**
 * Same bridge cast as `parties/routes.ts` / `sync/routes.ts`: the reducer's
 * `Action` and Zod's inferred `Action` share the discriminator set but
 * diverge on `exactOptionalPropertyTypes` flavor.
 */
function asReducerAction(action: unknown): Parameters<typeof reduce>[1] {
  return action as Parameters<typeof reduce>[1];
}

export type LeavePartyResult =
  | { ok: true; archived: boolean }
  | { ok: false; error: 'party_not_found' | 'not_a_member' | 'sole_dm_must_transfer_first' };

/**
 * Leave `partyId` as `actor`. The caller MUST have already resolved the
 * actor for this party (via `resolveActor`) — this helper trusts it.
 */
export async function leavePartyForUser(
  prisma: PrismaClient,
  actor: Actor,
  partyId: string,
): Promise<LeavePartyResult> {
  const activeMembers = await prisma.partyMembership.findMany({
    where: { partyId, leftAt: null },
    select: { userId: true },
  });
  const uniqueActiveUsers = new Set(activeMembers.map((m) => m.userId));

  if (uniqueActiveUsers.size === 1 && uniqueActiveUsers.has(actor.userId)) {
    // Sole-member archive path.
    await prisma.$transaction(async (tx) => {
      await tx.partyMembership.updateMany({
        where: { userId: actor.userId, partyId, leftAt: null },
        data: { leftAt: new Date() },
      });
      await tx.party.update({
        where: { id: partyId },
        data: { archivedAt: new Date() },
      });
    });
    return { ok: true, archived: true };
  }

  // Multi-member leave-party cascade.
  try {
    const state = await loadAppStateForUser(prisma, actor.userId, partyId);
    const ctx = {
      now: () => new Date().toISOString(),
      newInviteCode: generateInviteCode,
    };

    await prisma.$transaction(async (tx) => {
      await applyDelta(tx, asReducerAction({ type: 'leave-party', payload: {} }), actor, ctx);
      const result = reduce(state, asReducerAction({ type: 'leave-party', payload: {} }), ctx);
      for (const slice of result.logEntries) {
        const entry = buildLogEntryServer(slice, actor, ctx, state);
        await appendTransactionLog(tx, entry);
      }
    });
    return { ok: true, archived: false };
  } catch (e) {
    if (e instanceof StateLoaderError) {
      return { ok: false, error: e.code === 'not_a_member' ? 'not_a_member' : 'party_not_found' };
    }
    if (e instanceof Error && e.message.includes('sole DM')) {
      return { ok: false, error: 'sole_dm_must_transfer_first' };
    }
    throw e;
  }
}
