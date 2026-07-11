/**
 * R3.5 — Sync action queue (server-mode optimistic dispatch).
 * R5.1.c — retry-with-backoff + persisted outbox for network resilience.
 *
 * Sits BETWEEN the gameplay store and the network. Every dispatch in
 * server mode lands here via `enqueue(action)`. The queue:
 *
 *   1. Captures a pre-batch snapshot of `{ appState, log }` before
 *      the first batched push.
 *   2. Debounces 200ms so quick consecutive clicks (acquire → equip)
 *      ride together.
 *   3. POSTs to `/sync/actions` with up to 100 actions per request.
 *   4. On 200: drops the snapshot, removes the outbox row if the batch
 *      was replayed from one, appends the server's `applied[]` echo
 *      via `appendServerLogEntries`.
 *   5. On 422 `BatchRejectedError`: restores the pre-batch snapshot
 *      (rolls back optimistic state) and surfaces a toast. Removes
 *      the outbox row — a rejected batch shouldn't sit forever.
 *   6. On 401 / 409 (`display_name_required`): rollback + redirect;
 *      outbox row is KEPT so a re-auth drain can replay it.
 *   7. On network error: persist the batch to the Dexie outbox if
 *      not already (survives tab close), then schedule an
 *      exponential-backoff retry (500ms → 8s, ±25% jitter). After
 *      MAX_ATTEMPTS = 5 consecutive failures, the batch stays in the
 *      outbox and the queue stops auto-retrying — `drainOutbox()`
 *      picks it up on next `socket.on('connect')`.
 *
 * Flushed on `beforeunload` so a user who closes the tab mid-batch
 * doesn't lose work — the request goes out as a `fetch` (browsers
 * keep flight requests during unload for a short time). Any in-
 * flight batch that fails during unload survives via the outbox row
 * (persisted BEFORE the retry loop kicks in).
 */
import { toast } from 'sonner';

import { newUuidV7 } from '@app/shared';

import { ApiError } from '@/lib/api';
import { computeBackoff, MAX_ATTEMPTS } from '@/lib/backoff';
import { useSession } from '@/store/session';
import type { MutationOutcome } from '@/store/outcome';
import type { Action, AppState, TransactionLogEntry } from '@/store/types';

import { BatchRejectedError, pushActions } from './client';
import { enqueueToOutbox, removeOutbox, updateOutboxAttempt } from './outbox';
import { rejectionToastArgs } from './rejectionToast';

const DEBOUNCE_MS = 200;
const MAX_BATCH = 100;

interface PendingFlushSnapshot {
  appState: AppState | null;
  log: TransactionLogEntry[];
}

export interface QueueDeps {
  getSnapshot: () => PendingFlushSnapshot;
  restoreSnapshot: (snapshot: PendingFlushSnapshot) => void;
  appendServerLogEntries?: (applied: readonly TransactionLogEntry[]) => void;
}

/**
 * R8.5 — a queued action carries a `dispatchId` correlation token so
 * the flush path can resolve the exact `MutationOutcome` promise the
 * store handed back to the calling component. Minted per-`enqueue`.
 */
interface QueueItem {
  action: Action;
  partyId: string;
  dispatchId: string;
}

let queue: QueueItem[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * Resolver for the currently-pending retry-delay promise. `resetQueue`
 * flips `cancelled = true` and resolves this so the awaiter unwinds
 * without firing another attempt.
 */
let retryResolver: (() => void) | null = null;
let cancelled = false;
let inflight: Promise<void> | null = null;
let preBatchSnapshot: PendingFlushSnapshot | null = null;
let deps: QueueDeps | null = null;

/**
 * R8.5 — per-dispatch outcome resolvers. `registerOutcome(dispatchId)`
 * (called by the store immediately after `enqueue`) inserts a resolver
 * here; the flush path drains it once the batch reaches a terminal
 * outcome. Every terminal path — 200, 422, auth failure, parked-after-
 * retries, `resetQueue` — MUST resolve the correlations for the actions
 * it handled so an awaiting `useDispatch` caller never hangs.
 */
const pending = new Map<string, (o: MutationOutcome) => void>();

/**
 * R8.5 — register a resolver for a freshly-enqueued dispatch. Returns
 * the promise the store hands back from `dispatch`. Paired 1:1 with an
 * `enqueue` call sharing the same `dispatchId`.
 */
export function registerOutcome(dispatchId: string): Promise<MutationOutcome> {
  return new Promise<MutationOutcome>((resolve) => {
    pending.set(dispatchId, resolve);
  });
}

/** Resolve + clear the resolvers for a set of dispatch ids. */
function resolveOutcomes(dispatchIds: readonly string[], outcome: MutationOutcome): void {
  for (const id of dispatchIds) {
    const resolve = pending.get(id);
    if (resolve !== undefined) {
      resolve(outcome);
      pending.delete(id);
    }
  }
}

export function configureQueue(d: QueueDeps): void {
  deps = d;
  cancelled = false;
}

export function resetQueue(): void {
  queue = [];
  cancelled = true;
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (retryTimer !== null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (retryResolver !== null) {
    retryResolver();
    retryResolver = null;
  }
  inflight = null;
  preBatchSnapshot = null;
  // R8.5 — unwind any dangling outcome awaiters so callers don't hang
  // across a reset (test teardown, mode swap). The buffered write may
  // still exist in the outbox; from the UI's perspective the dispatch
  // is simply no longer pending.
  for (const [id, resolve] of pending) {
    resolve({ ok: false, code: 'queue_reset' });
    pending.delete(id);
  }
}

/**
 * BUG-003 (2026-07-01) — capture the pre-batch snapshot from the
 * caller BEFORE the reducer applies its mutation to the store. The
 * store's `dispatch` MUST call this BEFORE calling `reduce()`.
 * Subsequent calls within the same debounce window are no-ops.
 */
export function captureRollbackSnapshot(): void {
  if (deps === null) return;
  if (preBatchSnapshot !== null) return;
  preBatchSnapshot = deps.getSnapshot();
}

/**
 * Append an action to the pending batch. RH4.2 — `partyId` is passed
 * explicitly (URL-authoritative). See the store's `dispatch` for the
 * source.
 *
 * R8.5 — returns a `dispatchId` correlation token. The store calls
 * `registerOutcome(dispatchId)` to obtain the `MutationOutcome` promise
 * it hands back from `dispatch`. `seed-catalog` short-circuits (never
 * hits the network) and returns `null` — the store resolves that case
 * itself.
 */
export function enqueue(action: Action, partyId: string): string | null {
  if (deps === null) {
    throw new Error('queue.enqueue: configureQueue was never called');
  }
  // `seed-catalog` is a local-only optimistic seed — the server already
  // has the canonical PHB+DMG catalog. See the R3.5 rationale (retained
  // from pre-R5.1.c code).
  if (action.type === 'seed-catalog') return null;
  if (queue.length === 0 && preBatchSnapshot === null) {
    preBatchSnapshot = deps.getSnapshot();
  }
  const dispatchId = newUuidV7();
  queue.push({ action, partyId, dispatchId });
  scheduleFlush();
  return dispatchId;
}

function scheduleFlush(): void {
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, DEBOUNCE_MS);
}

/**
 * Flush the pending batch immediately. Awaited by Hub's submit handler
 * so the bootstrap pull lands before navigation, and by `beforeunload`
 * to drain on tab close.
 */
export async function flush(): Promise<void> {
  if (deps === null) return;
  if (inflight !== null) return inflight;
  if (queue.length === 0) return;

  const d = deps;
  const batch = queue.splice(0, MAX_BATCH);
  const snapshot = preBatchSnapshot;
  preBatchSnapshot = null;

  // Group by partyId — every entry in a single POST must share a party.
  const first = batch[0];
  if (first === undefined) return;
  const partyId = first.partyId;
  const sameParty = batch.filter((b) => b.partyId === partyId);
  const otherParty = batch.filter((b) => b.partyId !== partyId);
  if (otherParty.length > 0) {
    // Requeue at the head; the next flush handles them (carrying their
    // dispatchId correlations forward).
    queue.unshift(...otherParty);
  }
  const actions = sameParty.map((b) => b.action);
  const dispatchIds = sameParty.map((b) => b.dispatchId);

  inflight = navigator.locks.request<void>(
    'sync-queue-flush',
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    async () => {
      try {
        await flushBatchWithRetry(d, partyId, actions, dispatchIds, snapshot, undefined, 0);
      } finally {
        inflight = null;
        // Drain leftovers that arrived during our flight.
        if (queue.length > 0) {
          preBatchSnapshot = d.getSnapshot();
          scheduleFlush();
        }
      }
    },
  );
  return inflight;
}

/**
 * R5.1.c — Attempt one flush of a batch, with retry semantics on
 * network failure and outbox persistence for tab-close survival.
 *
 * `outboxId`: if the batch is being retried from a previously
 * persisted outbox row (either an intra-session retry or a
 * reconnect-drain replay), pass the row id so it can be cleaned up
 * on success or 422. If undefined and a network error hits, we
 * persist a NEW outbox row.
 *
 * `attempt`: 0-indexed retry counter. After MAX_ATTEMPTS consecutive
 * network failures we surface a "paused" toast and leave the batch
 * in the outbox for reconnect drain.
 *
 * `snapshot`: pre-batch state for rollback on 422. Not consulted on
 * network errors — the batch is presumed retryable, not rejected.
 *
 * R8.5 — `dispatchIds`: the correlation tokens for the actions in this
 * batch. Every terminal outcome (200 success, 422 rejection, auth
 * failure, parked-after-retries) resolves them via `resolveOutcomes`
 * so awaiting `useDispatch` callers settle. The inline `toast.error`
 * calls that used to fire here are RETIRED — the outcome carries the
 * rejection code and `useDispatch`'s default consumer renders the
 * toast, eliminating the BUG-005 green-then-red flash.
 */
async function flushBatchWithRetry(
  d: QueueDeps,
  partyId: string,
  actions: readonly Action[],
  dispatchIds: readonly string[],
  snapshot: PendingFlushSnapshot | null,
  outboxId: number | undefined,
  attempt: number,
): Promise<void> {
  try {
    const response = await pushActions(partyId, actions);
    // 200 — drained. Remove outbox row if we had one.
    if (outboxId !== undefined) {
      await removeOutbox(outboxId);
    }
    if (d.appendServerLogEntries !== undefined) {
      d.appendServerLogEntries(response.applied);
    }
    resolveOutcomes(dispatchIds, { ok: true, applied: response.applied });
    return;
  } catch (err) {
    if (err instanceof BatchRejectedError) {
      // 422 — server permanently rejected. Roll back optimistic state
      // + drop the outbox row (no point re-sending). The outcome
      // carries the rejection; no inline toast (BUG-005 fix).
      if (snapshot !== null) d.restoreSnapshot(snapshot);
      if (outboxId !== undefined) {
        await removeOutbox(outboxId);
      }
      resolveOutcomes(dispatchIds, {
        ok: false,
        code: err.rejectedCode,
        message: err.rejectedMessage,
      });
      return;
    }
    if (err instanceof ApiError) {
      if (err.code === 'unauthenticated') {
        if (snapshot !== null) d.restoreSnapshot(snapshot);
        // KEEP the outbox row — post-login drain will replay it.
        resolveOutcomes(dispatchIds, { ok: false, code: err.code });
        await useSession.getState().signOut();
        return;
      }
      if (err.code === 'display_name_required') {
        if (snapshot !== null) d.restoreSnapshot(snapshot);
        const user = useSession.getState().user;
        if (user !== null) {
          useSession.getState().setUserPatch({ ...user, needsDisplayName: true });
        }
        resolveOutcomes(dispatchIds, { ok: false, code: err.code });
        return;
      }
      // Other 4xx / 5xx: treat as transient. Don't rollback (user can
      // retry the action manually). Don't retry auto-magically either
      // — a 500 on the server side is a signal to stop hammering.
      resolveOutcomes(dispatchIds, { ok: false, code: err.code });
      return;
    }
    // Network error (fetch throw, offline, DNS fail, etc.). Persist
    // to outbox on first hit; then schedule a retry with backoff.
    let currentOutboxId = outboxId;
    if (currentOutboxId === undefined) {
      currentOutboxId = await enqueueToOutbox(partyId, actions);
    } else {
      await updateOutboxAttempt(currentOutboxId);
    }

    const nextAttempt = attempt + 1;
    if (nextAttempt >= MAX_ATTEMPTS) {
      // Give up auto-retrying. Row stays in the outbox for reconnect
      // drain. Do NOT roll back — solo parties + offline sessions
      // depend on optimistic state persisting across the disconnect.
      // R8.5 — resolve the outcome as `sync_paused` so awaiters settle;
      // the buffered write still persists locally + drains on reconnect.
      console.warn('[queue] max retry attempts reached, parking in outbox', {
        partyId,
        attempts: nextAttempt,
      });
      resolveOutcomes(dispatchIds, { ok: false, code: 'sync_paused' });
      return;
    }

    const delay = computeBackoff(attempt);
    await new Promise<void>((resolve) => {
      retryResolver = resolve;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        retryResolver = null;
        resolve();
      }, delay);
    });
    if (cancelled) return; // resetQueue was called mid-retry
    // Recursive tail call — the outer `try` block's error paths
    // handle all subsequent outcomes.
    await flushBatchWithRetry(
      d,
      partyId,
      actions,
      dispatchIds,
      snapshot,
      currentOutboxId,
      nextAttempt,
    );
  }
}

/**
 * R5.1.c — Drain-time flush entrypoint used by `reconnect.ts`. Called
 * once per outbox row (in FIFO order); shares the same retry semantics
 * as the inline flush path but starts with a known `outboxId`.
 *
 * Returns `true` on success (row removed), `false` on any failure
 * (row remains in outbox). The caller uses the return value to decide
 * whether to continue draining the queue or stop and let normal retry
 * take over.
 */
export async function replayOutboxRow(
  partyId: string,
  actions: readonly Action[],
  outboxId: number,
): Promise<boolean> {
  if (deps === null) return false;
  const d = deps;
  try {
    const response = await pushActions(partyId, actions);
    await removeOutbox(outboxId);
    if (d.appendServerLogEntries !== undefined) {
      d.appendServerLogEntries(response.applied);
    }
    return true;
  } catch (err) {
    if (err instanceof BatchRejectedError) {
      // Rejected batch: server refused. Remove the row (retry won't help)
      // and toast. Don't roll back — the local state may have been
      // hydrated from server after the disconnect, so there's nothing to
      // roll back TO. This matches the R3.5 "422 error surface" contract.
      //
      // R8.5 — the reconnect drain has NO live `useDispatch` awaiter
      // (the dispatching component unmounted at disconnect time), so
      // this path toasts directly. It routes through the shared
      // `rejectionToastArgs` so the copy matches the primary path.
      await removeOutbox(outboxId);
      const args = rejectionToastArgs(err.rejectedCode, err.rejectedMessage);
      toast.error(
        args.title,
        args.description !== undefined ? { description: args.description } : undefined,
      );
      return false;
    }
    // Network / 5xx / auth errors → leave row in outbox for next drain.
    return false;
  }
}

/**
 * Wire `beforeunload` to flush. Idempotent — calling twice is fine.
 */
export function attachUnloadFlush(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeunload', () => {
    void flush();
  });
}
