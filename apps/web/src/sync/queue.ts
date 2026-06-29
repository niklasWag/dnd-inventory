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
 *   4. On 200: drops the snapshot, continues. For bootstrap batches
 *      (first action is `create-character`), re-pulls `/sync/state`
 *      to canonicalize ids before the Hub navigates to /character/:id.
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
import { getCurrentPartyId, setCurrentPartyId } from '@/db/meta';
import { useSession } from '@/store/session';
import type { Action, AppState, TransactionLogEntry } from '@/store/types';

import { BatchRejectedError, pullState, pushActions } from './client';

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
   * After a server response, get the active party id (or `null` if
   * not yet known — bootstrap case). The queue persists the canonical
   * id via `setCurrentPartyId`.
   */
  getActivePartyId: () => Promise<string | null>;
}

let queue: Action[] = [];
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
 * Append an action to the pending batch. The first call captures the
 * snapshot; subsequent calls (within the debounce window) ride along.
 */
export function enqueue(action: Action): void {
  if (deps === null) {
    throw new Error('queue.enqueue: configureQueue was never called');
  }
  // `seed-catalog` is a local-only optimistic seed (`store/seed.ts`):
  // it populates the client's `appState.catalog` mirror so the UI has
  // items to show immediately after `create-character`. The server
  // already has the canonical PHB+DMG catalog (seed-runner writes it
  // at boot; `/sync/state` returns it). Pushing seed-catalog here would
  // (a) duplicate the data and (b) violate the bootstrap batch invariant
  // in `apps/server/src/sync/routes.ts:244` which requires every action
  // in a bootstrap batch to be `create-character`.
  if (action.type === 'seed-catalog') return;
  if (queue.length === 0) {
    preBatchSnapshot = deps.getSnapshot();
  }
  queue.push(action);
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

  // Splice up to MAX_BATCH off the head; leftovers stay for the next
  // tick.
  const batch = queue.splice(0, MAX_BATCH);
  const snapshot = preBatchSnapshot;
  preBatchSnapshot = null;

  inflight = (async () => {
    try {
      const isBootstrap = batch[0]?.type === 'create-character';
      // Resolve the partyId for the push. Bootstrap: send a synthetic
      // marker — the server's bootstrap branch mints the real one.
      // Post-bootstrap: read from the active-party pointer (Dexie meta).
      const partyId = isBootstrap ? 'will-be-minted' : await deps.getActivePartyId();
      if (partyId === null) {
        toast.error('No active party — refresh and try again.');
        if (snapshot !== null) deps.restoreSnapshot(snapshot);
        return;
      }

      const response = await pushActions(partyId, batch);

      // Bootstrap success: re-pull canonical state so the new party's
      // server-minted ids land in the store before the Hub navigates.
      if (isBootstrap) {
        // The server runs its own reducer with its own `randomUUID()`
        // ctx, so the party's server-side id DIFFERS from the local
        // optimistic id minted by the client's reducer. We have to
        // read the server's id back from the `applied[]` response —
        // specifically the `create-character` log entry, whose payload
        // carries the server's `partyId` (server-derived from the
        // applied reducer's `result.state.party.id`).
        //
        // Falls back to the optimistic local id only if (a) the
        // response is empty or (b) the first applied entry isn't a
        // create-character (defensive — the server route invariant
        // says it always is for a bootstrap batch).
        const firstApplied = response.applied[0];
        const post = deps.getSnapshot();
        if (post.appState === null) {
          // Reducer must have produced a party for a bootstrap action;
          // if not, something is structurally wrong — bail.
          toast.error('Bootstrap failed to apply locally.');
          return;
        }
        const serverPartyId =
          firstApplied !== undefined && firstApplied.type === 'create-character'
            ? firstApplied.payload.partyId
            : post.appState.party.id;
        const pulled = await pullState(serverPartyId);
        deps.restoreSnapshot({ appState: pulled.state, log: pulled.state.log });
        await setCurrentPartyId(pulled.state.party.id);
      }
    } catch (err) {
      if (err instanceof BatchRejectedError) {
        if (snapshot !== null) deps.restoreSnapshot(snapshot);
        toast.error(`Action rejected: ${err.rejectedCode}`, {
          description: err.rejectedMessage,
        });
        return;
      }
      if (err instanceof ApiError) {
        if (err.code === 'unauthenticated') {
          if (snapshot !== null) deps.restoreSnapshot(snapshot);
          await useSession.getState().signOut();
          return;
        }
        if (err.code === 'display_name_required') {
          if (snapshot !== null) deps.restoreSnapshot(snapshot);
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
        preBatchSnapshot = deps.getSnapshot();
        scheduleFlush();
      }
    }
  })();
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

// Re-export getCurrentPartyId so callers don't need a second import.
export { getCurrentPartyId };
