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
 * `actorRole` value reflects the §3.14 banker derivation done in
 * `resolveActor`.
 */
import type { Actor, TransactionLogEntry } from '@app/shared';
import { transactionLogEntrySchema } from '@app/shared';
import type { LogEntrySlice, ReducerContext } from '@app/rules';

import type { Prisma } from '../../prisma/generated/prisma/client.js';
import { toDbActorRole } from '../db/mappers.js';

export function buildLogEntryServer(
  slice: LogEntrySlice,
  actor: Actor,
  ctx: ReducerContext,
): TransactionLogEntry {
  return transactionLogEntrySchema.parse({
    id: ctx.newId(),
    partyId: actor.partyId,
    sessionId: null,
    timestamp: ctx.now(),
    actorUserId: actor.userId,
    actorRole: actor.role,
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
