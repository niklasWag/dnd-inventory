/**
 * R5.1.c — Persisted-outbox helpers.
 *
 * The outbox stores batches of actions that couldn't reach the server on
 * their first attempt (transient network error, server 5xx, etc.). Rows
 * survive tab close and drain automatically on next successful
 * `socket.on('connect')` via `apps/web/src/sync/reconnect.ts::drainOutbox`.
 *
 * The queue module (`./queue.ts`) writes rows on first network-error
 * catch, bumps `attemptCount` on each retry, and removes rows on 200
 * success or 422 rejection. Reconnect replay reads rows in FIFO order
 * (`createdAt` index).
 *
 * All operations are keyed by `partyId` — a user with multiple parties
 * (local mode) can accumulate outbox rows per party, and reconnect
 * drains only the currently-viewed party's rows.
 */
import { db, type OutboxRow } from '@/db/schema';
import type { Action } from '@/store/types';

/**
 * Persist a batch to the outbox. Returns the assigned local id so the
 * caller can update / remove the row without re-querying.
 */
export async function enqueueToOutbox(
  partyId: string,
  actions: readonly Action[],
): Promise<number> {
  const row: OutboxRow = {
    partyId,
    actions: [...actions],
    createdAt: new Date().toISOString(),
    attemptCount: 0,
  };
  return db.outbox.add(row);
}

/**
 * List every outbox row for a party in FIFO order (`createdAt` asc).
 * Used by `drainOutbox()` on reconnect.
 */
export async function listOutboxByParty(partyId: string): Promise<OutboxRow[]> {
  const rows = await db.outbox.where('partyId').equals(partyId).toArray();
  // Dexie's `equals(...).toArray()` doesn't guarantee `createdAt` order
  // (it uses the equality index, not a range on the compound key), so
  // sort in-memory. Cardinality is bounded (per-party outbox during a
  // disconnect window; hundreds at most).
  return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Bump retry metadata for a row that just re-attempted. Called after
 * each failed attempt so an operator inspecting Dexie devtools can see
 * how many times a batch has been re-tried.
 */
export async function updateOutboxAttempt(id: number): Promise<void> {
  const now = new Date().toISOString();
  await db.outbox
    .where('id')
    .equals(id)
    .modify((row) => {
      row.attemptCount = (row.attemptCount ?? 0) + 1;
      row.lastAttemptAt = now;
    });
}

/**
 * Remove a row from the outbox. Called on 200 (drained) or 422
 * (server permanently rejected the batch — no point re-sending).
 */
export async function removeOutbox(id: number): Promise<void> {
  await db.outbox.delete(id);
}
