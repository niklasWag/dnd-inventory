/**
 * R3.5 — Sync action queue (server-mode optimistic dispatch).
 *
 * Sits BETWEEN the gameplay store and the network. Every dispatch in
 * server mode lands here via `enqueue(action)`. The queue:
 *
 *   1. Captures a pre-batch snapshot of `{ appState, log }` before
 *      the first batched push.
 *   2. Debounces 200ms so quick consecutive clicks (acquire → equip)
 *      ride together.
 *   3. POSTs to `/sync/actions` with up to 100 actions per request.
 *   4. On 200: drops the snapshot, continues. RH1.3 removed the
 *      post-flush re-pull — the client mints all entity ids ahead of
 *      time (RH1.2), so the server's `applied[]` echo carries the
 *      SAME ids the local reducer already produced. No canonicalize
 *      step is required.
 *   5. On 422 `BatchRejectedError`: restores the pre-batch snapshot
 *      (rolls back optimistic state) and surfaces a toast.
 *   6. On 401: clears the session — `ProtectedRoute` will redirect
 *      to /login.
 *   7. On 409 `display_name_required`: clears state and lets
 *      `ProtectedRoute` redirect to /login/display-name.
 *   8. On network error: keeps the snapshot in place, surfaces a
 *      transient toast, drops the batch. R5 hardens retry semantics.
 *
 * Flushed on `beforeunload` so a user who closes the tab mid-batch
 * doesn't lose work — the request goes out as a `fetch` (browsers
 * keep flight requests during unload for a short time).
 */
import { toast } from 'sonner';

import { ApiError } from '@/lib/api';
import { useSession } from '@/store/session';
import type { Action, AppState, TransactionLogEntry } from '@/store/types';

import { BatchRejectedError, pushActions } from './client';

const DEBOUNCE_MS = 200;
const MAX_BATCH = 100;

interface PendingFlushSnapshot {
  appState: AppState | null;
  log: TransactionLogEntry[];
}

export interface QueueDeps {
  /**
   * Returns the current store snapshot. Used by `flush` to capture the
   * pre-flight state for rollback.
   */
  getSnapshot: () => PendingFlushSnapshot;
  /**
   * Replace the store state wholesale (rollback OR canonical re-hydrate
   * from `pullState`). Implementations should NOT trigger another
   * enqueue / Dexie save — this is for restoring known-good state.
   */
  restoreSnapshot: (snapshot: PendingFlushSnapshot) => void;
  /**
   * RH2.6 — post-flush hook. After `POST /sync/actions` returns
   * `applied[]`, the queue passes the array to this dep so the store
   * can append the server-emitted log entries to `state.log`. In
   * server mode this is the SOLE path by which `state.log` grows;
   * the store's dispatch middleware discards the reducer's local
   * `logEntries` slice output (see `apps/web/src/store/index.ts`).
   *
   * Optional so tests that don't care about post-flush log growth
   * can omit it; production wiring in `main.tsx` always supplies it.
   */
  appendServerLogEntries?: (applied: readonly TransactionLogEntry[]) => void;
}

let queue: { action: Action; partyId: string }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let inflight: Promise<void> | null = null;
let preBatchSnapshot: PendingFlushSnapshot | null = null;
let deps: QueueDeps | null = null;

/**
 * Wire the queue's dependencies. Called once at app boot. Lets tests
 * inject fakes without re-importing.
 */
export function configureQueue(d: QueueDeps): void {
  deps = d;
}

export function resetQueue(): void {
  queue = [];
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  inflight = null;
  preBatchSnapshot = null;
}

/**
 * BUG-003 (2026-07-01) — capture the pre-batch snapshot from the
 * caller BEFORE the reducer applies its mutation to the store. Prior
 * to this fix, `enqueue()` captured the snapshot via
 * `deps.getSnapshot()` at first-in-batch time — but by that point the
 * dispatcher had already applied the mutation, so the snapshot was
 * post-mutation and 422 rollbacks were no-ops.
 *
 * The store's `dispatch` MUST call this BEFORE calling `reduce()`.
 * Subsequent calls within the same debounce window are no-ops (the
 * first snapshot in the batch is the one we want to restore to).
 * `resetQueue()` clears the snapshot; a successful push also clears
 * it via the normal `preBatchSnapshot = null` step in `flush()`.
 */
export function captureRollbackSnapshot(): void {
  if (deps === null) return;
  if (preBatchSnapshot !== null) return;
  preBatchSnapshot = deps.getSnapshot();
}

/**
 * Append an action to the pending batch. The pre-batch snapshot is
 * expected to have been captured by `captureRollbackSnapshot()` before
 * the caller applied the mutation to the store (see BUG-003). If it
 * wasn't (tests that don't call the capture step, or a caller that
 * forgets), fall back to the post-mutation snapshot from
 * `deps.getSnapshot()` — same behaviour as pre-fix but with the caveat
 * that rollback restores the mutated state.
 *
 * RH4.2 — `partyId` is now passed explicitly per enqueue. Previously
 * the queue asked its `getActivePartyId` dep at flush time, which
 * round-tripped through Dexie's `meta.currentPartyId`. Post-RH4.2 the
 * URL is authoritative for partyId; the dispatcher reads
 * `state.appState.party.id` (kept URL-synced by PartyScopeSync) at
 * dispatch time and threads it here. Zero Dexie meta reads on the
 * flush path in server mode.
 */
export function enqueue(action: Action, partyId: string): void {
  if (deps === null) {
    throw new Error('queue.enqueue: configureQueue was never called');
  }
  // `seed-catalog` is a local-only optimistic seed (`store/seed.ts`):
  // it populates the client's `appState.catalog` mirror so the UI has
  // items to show immediately after `create-character`. The server
  // already has the canonical PHB+DMG catalog (seed-runner writes it
  // at boot; `/sync/state` returns it). Pushing seed-catalog here would
  // (a) duplicate the data and (b) confuse the server's bootstrap
  // path in `apps/server/src/sync/routes.ts` (bootstrap dispatch keys
  // on `party.findUnique === null` — a seed-catalog against a not-yet-
  // existing party would slip past the router with no useful semantics).
  if (action.type === 'seed-catalog') return;
  if (queue.length === 0 && preBatchSnapshot === null) {
    // Fallback for callers that didn't call captureRollbackSnapshot
    // first. This is the pre-BUG-003 behaviour; log-only paths and
    // tests may end up here. Real dispatch flows call the capture
    // helper.
    preBatchSnapshot = deps.getSnapshot();
  }
  queue.push({ action, partyId });
  scheduleFlush();
}

function scheduleFlush(): void {
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, DEBOUNCE_MS);
}

/**
 * Flush the pending batch immediately. Awaited by Hub's submit
 * handler so the bootstrap pull lands before navigation, and by
 * `beforeunload` to drain on tab close.
 */
export async function flush(): Promise<void> {
  if (deps === null) return;
  if (inflight !== null) {
    // Coalesce — caller can `await` the in-flight promise.
    return inflight;
  }
  if (queue.length === 0) return;

  // Capture the narrowed `deps` for use inside the async lock callback.
  // TypeScript's control-flow analysis doesn't survive across the
  // callback boundary, so we bind `d` here (guaranteed non-null by the
  // early return above) rather than re-checking `deps !== null` at
  // every use site inside the callback.
  const d = deps;

  // Splice up to MAX_BATCH off the head; leftovers stay for the next
  // tick.
  const batch = queue.splice(0, MAX_BATCH);
  const snapshot = preBatchSnapshot;
  preBatchSnapshot = null;

  inflight = navigator.locks.request<void>(
    'sync-queue-flush',
    // The `LockGrantedCallback<T>` DOM type is `(lock) => T`, which
    // TS type-checks fine against an async callback (Promise<void> is
    // assignable to void). ESLint's `no-misused-promises` doesn't see
    // that Web Locks accepts async callbacks natively — the runtime
    // awaits the returned promise. Suppressing this one call site.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    async () => {
      // RH2.3 — same-origin multi-tab coordinator. `navigator.locks`
      // FIFO-queues requests to the same name across tabs so only ONE
      // tab issues a `POST /sync/actions` at a time. The lock releases
      // automatically when this callback settles or the tab closes; no
      // manual heartbeat / leader-election protocol needed. Baseline
      // Widely Available since March 2022 (all 4 major browsers). The
      // test env uses the FIFO shim in `apps/web/src/test/setup.ts`.
      try {
        // RH4.2 — partyId comes from the enqueue call site (dispatcher
        // reads it from `state.appState.party.id`, which PartyScopeSync
        // keeps URL-synced). No Dexie meta round-trip. Every entry in
        // the batch carries its own partyId; splitting the batch by
        // party is unlikely in practice (each URL identifies one party)
        // but the queue defends against it — we flush all entries that
        // share the first entry's partyId and leave the rest for the
        // next tick.
        const first = batch[0];
        if (first === undefined) return; // defensive; length checked above
        const partyId = first.partyId;
        const sameParty = batch.filter((b) => b.partyId === partyId);
        const otherParty = batch.filter((b) => b.partyId !== partyId);
        if (otherParty.length > 0) {
          // Requeue at the head; the next flush handles them.
          queue.unshift(...otherParty);
        }
        const actions = sameParty.map((b) => b.action);

        await pushActions(partyId, actions).then((response) => {
          // RH2.6 — server-authoritative log-authority in server mode.
          // The server's `applied[]` echo is the sole source of truth
          // for TransactionLog contents; the store's dispatch
          // middleware discards the reducer's local logEntries in
          // server mode, so this call is the only path by which
          // `state.log` grows. Skipped when the dep is absent (test
          // fakes that don't care about log growth).
          if (d.appendServerLogEntries !== undefined) {
            d.appendServerLogEntries(response.applied);
          }
        });

        // RH1.3 — no post-flush re-pull. The server's reducer runs with
        // NO id-minting authority (the RH1.2 contract removed `ctx.newId`
        // server-side); every id in the server's `applied[]` echo is the
        // same client-minted UUID v7 that's already in local state. The
        // pre-RH1.3 re-pull was necessary because the server's reducer
        // used to mint its own randomUUIDs — that divergence is gone.
      } catch (err) {
        if (err instanceof BatchRejectedError) {
          if (snapshot !== null) d.restoreSnapshot(snapshot);
          toast.error(`Action rejected: ${err.rejectedCode}`, {
            description: err.rejectedMessage,
          });
          return;
        }
        if (err instanceof ApiError) {
          if (err.code === 'unauthenticated') {
            if (snapshot !== null) d.restoreSnapshot(snapshot);
            await useSession.getState().signOut();
            return;
          }
          if (err.code === 'display_name_required') {
            if (snapshot !== null) d.restoreSnapshot(snapshot);
            // The session store's status will already be `authenticated`
            // — flip it so ProtectedRoute reroutes.
            const user = useSession.getState().user;
            if (user !== null) {
              useSession.getState().setUserPatch({ ...user, needsDisplayName: true });
            }
            return;
          }
          toast.error(`Sync error: ${err.code}`);
          // Don't roll back on transient errors — the user can retry.
          return;
        }
        // Network error: keep optimistic state, drop the batch.

        console.warn('[queue] flush failed; keeping optimistic state', err);
        toast.error('Network error — your changes may not have saved.');
      } finally {
        inflight = null;
        // If more actions arrived while we were in-flight, drain them.
        if (queue.length > 0) {
          // The next flush captures its own snapshot from the (already
          // server-confirmed) current state.
          preBatchSnapshot = d.getSnapshot();
          scheduleFlush();
        }
      }
    },
  );
  return inflight;
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
