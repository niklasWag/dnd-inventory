/**
 * R3.4.a — server-side `TransactionLogEntry` composition + persistence.
 *
 * The reducer returns `LogEntrySlice[]` — `{ type, payload }` pairs that
 * leave the derived fields (id, timestamp, actor identity, partyId,
 * sessionId) to the dispatcher. The web's middleware composes them in
 * `apps/web/src/store/index.ts`; the server does the same here.
 *
 * Critical: `actorUserId` and `actorRole` come from the server-derived
 * `Actor` tuple — NEVER from the request body (SECURITY §2.1). The
 * `actorRole` value stamped onto the log entry is per-action-type,
 * derived by `deriveActorRoleForSlice(state, slice)` from
 * `@app/shared/guards` — RH2.1a moved this out of `Actor.role` (which
 * captured the actor's coarse party role) so the web store and the
 * server agree on the per-action-type table (e.g. `identify` always
 * logs as `'dm'` even if the actor's PartyMembership.role is `'player'`,
 * because `identify` is a DM-only action per §8.1).
 */
import type { Actor, AppState, TransactionLogEntry } from '@app/shared';
import {
  currentGameSessionId,
  deriveActorRoleForSlice,
  newUuidV7,
  transactionLogEntrySchema,
} from '@app/shared';
import type { LogEntrySlice, ReducerContext } from '@app/rules';

import type { Prisma } from '../../prisma/generated/prisma/client.js';
import { toDbActorRole } from '../db/mappers.js';

export function buildLogEntryServer(
  slice: LogEntrySlice,
  actor: Actor,
  ctx: ReducerContext,
  state: AppState | null,
): TransactionLogEntry {
  return transactionLogEntrySchema.parse({
    // RH1.2 — `TransactionLog.id` is server-minted (each log entry is a
    // server-composed record, not a client-carried entity id per RH1's
    // client-authoritative rule). We mint it inline rather than via
    // `ctx.newId` because that field was removed from `ReducerContext`
    // when entity-id minting moved to the action payload.
    id: newUuidV7(),
    partyId: actor.partyId,
    sessionId: currentGameSessionId(state),
    timestamp: ctx.now(),
    actorUserId: actor.userId,
    // RH2.1a — per-action-type role derivation via the shared function.
    // Prior to RH2.1a this used `actor.role` verbatim, which stamped
    // the actor's coarse party role even for DM-only or Banker-only
    // actions. Now the shared function encodes §8.1's per-action-type
    // hat and both web + server agree on the value.
    actorRole: deriveActorRoleForSlice(state, slice),
    type: slice.type,
    payload: slice.payload,
  });
}

export async function appendTransactionLog(
  tx: Prisma.TransactionClient,
  entry: TransactionLogEntry,
): Promise<void> {
  await tx.transactionLog.create({
    data: {
      id: entry.id,
      partyId: entry.partyId,
      sessionId: entry.sessionId,
      timestamp: new Date(entry.timestamp),
      actorUserId: entry.actorUserId,
      actorRole: toDbActorRole(entry.actorRole),
      type: entry.type,
      // Prisma's `Json` accepts any JSON-serializable value — the
      // Zod-parsed payload is already a plain object.
      payload: entry.payload,
    },
  });
}
