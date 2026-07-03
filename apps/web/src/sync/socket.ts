/**
 * R5.1.b — Client-side Socket.IO consumer + inbound reconciliation.
 *
 * In server mode, boot wires this to `main.tsx`: the socket connects
 * to `/socket.io`, receives `applied` broadcasts from other party
 * members' actions, Zod-parses each broadcast, and applies it to the
 * local store.
 *
 * Reconciliation flow (per plan §R5.1.b + RH2.6):
 *
 *   1. Zod-parse the wire payload via `appliedBroadcastSchema`.
 *      Malformed → log + drop (defensive; server is trusted, but
 *      Zod at every boundary is the invariant).
 *   2. If the broadcast's `partyId` !== `state.appState.party.id`, the
 *      user is looking at another party (or the Hub, where `appState`
 *      may be null). Ignore. When they navigate to that party,
 *      PartyScopeSync will pull authoritative state via `/sync/state`,
 *      which already reflects the mutation. When they navigate back to
 *      the current party, they'll see the mutation too — reconnect
 *      replay (R5.1.c) picks up anything that fell off the wire in
 *      the interim.
 *   3. Dedupe by `entry.id`: if a slice's id already exists in
 *      `state.log`, skip it. Covers both (a) the acting client's own
 *      self-echo (HTTP `POST /sync/actions` already appended the same
 *      `applied[]` via `appendServerLogEntries()`) and (b) any
 *      duplicate broadcasts from transient socket weirdness.
 *   4. For the non-duplicate slices, re-run the local reducer against
 *      the source `action` so `state.appState` mutates. Discard the
 *      reducer's own `logEntries` — RH2.6's log-authority rule requires
 *      the server's `applied[]` be the sole source of truth for
 *      `state.log`. Append via `appendServerLogEntries()`.
 *   5. Persist via the existing debounced saver.
 *
 * Auth uses the same session cookie as HTTP (`withCredentials: true`);
 * server middleware in `apps/server/src/realtime/io.ts` reuses
 * `getSession()` and rejects unauth upgrades.
 */
import { io as ioClient, type Socket } from 'socket.io-client';

import { appliedBroadcastSchema } from '@app/shared';

import { flushPendingPersist, useStore } from '@/store';
import { reduce } from '@/store/reducer';
import type { Action } from '@/store/types';

const env = import.meta.env as { VITE_SERVER_URL?: string };

// Module-scope singleton — one connection per browser tab. `main.tsx`
// wires the connect on boot in server mode.
let socket: Socket | null = null;

/**
 * Reducer context used when applying broadcast actions. Deterministic
 * per RH2 (the `newInviteCode` never fires on a broadcast-only reducer
 * pass because invite codes are minted only inside `join-party` /
 * `appoint-banker` flows that the ACTING client already ran; the
 * server's `applied[]` echo carries those minted values, not fresh
 * ones). `now()` matches: entries carry `timestamp` server-side too,
 * so a fresh Date here is used only if a reducer path incidentally
 * calls it — which it MUST NOT for a deterministic re-run. Guard by
 * throwing so any drift surfaces loudly.
 */
const broadcastReducerCtx = {
  now: () => {
    throw new Error(
      'socket.applyBroadcast: reducer called ctx.now() during broadcast re-run — ' +
        'server-echoed log entries carry their own timestamps and the reducer must ' +
        'not depend on wall-clock here.',
    );
  },
  newInviteCode: () => {
    throw new Error(
      'socket.applyBroadcast: reducer called ctx.newInviteCode() during broadcast re-run — ' +
        'invite codes are minted by the acting client only.',
    );
  },
};

/**
 * Apply a validated broadcast payload to the local store. Extracted so
 * both the socket event handler (R5.1.b) and the reconnect drainer
 * (R5.1.c) can share the same reconciliation path.
 *
 * Exported for tests; production consumers reach it via `socket.on
 * ('applied', ...)` inside `connectSocket()`.
 */
export function applyBroadcast(payload: unknown): void {
  const parsed = appliedBroadcastSchema.safeParse(payload);
  if (!parsed.success) {
    console.error('[socket] invalid applied broadcast payload', parsed.error);
    return;
  }
  const { partyId, action, applied } = parsed.data;

  const store = useStore.getState();
  const currentPartyId = store.appState?.party.id ?? null;
  if (currentPartyId !== partyId) {
    // Not viewing this party right now. When the user navigates to it,
    // PartyScopeSync's `pullState` will fetch the server's canonical
    // state (which already reflects this mutation). Reconnect replay
    // (R5.1.c) will fill in anything missed for the current party.
    return;
  }

  // Dedupe by log-entry id. Handles self-echo (acting client already
  // appended the same applied[] via HTTP response) + duplicate
  // broadcasts.
  const seenIds = new Set(store.log.map((e) => e.id));
  const novel = applied.filter((e) => !seenIds.has(e.id));
  if (novel.length === 0) return;

  // Re-run the reducer against the source action for state mutation.
  // RH2.6: discard the reducer's log slices; the server's `applied[]`
  // is authoritative.
  //
  // The action type at the shared-Zod boundary and the reducer's TS
  // `Action` differ only in `exactOptionalPropertyTypes` flavour
  // (see the routes.ts `toReducerAction` cast). Reuse the same
  // structural bridge.
  const reducerAction = action as unknown as Action;
  const result = reduce(store.appState, reducerAction, broadcastReducerCtx);

  // Update the store: mutate state per reducer, then append the
  // server-authoritative log entries via the RH2.6 hook.
  useStore.setState({ appState: result.state });
  store.appendServerLogEntries(novel);

  // Persist. The saver is a module-scope singleton owned by the store;
  // trigger it via the existing flush helper. (No new saver here — we
  // don't want to duplicate debounce state.)
  void flushPendingPersist();
}

/**
 * Build the Socket.IO client. Returns null in local mode (no server
 * to connect to). Caller invokes `.connect()` when ready.
 *
 * Kept as a factory so tests can drive the module without side effects
 * at import time. `main.tsx` invokes this + `.connect()` after the
 * store is hydrated.
 */
export function connectSocket(): Socket | null {
  const serverUrl = env.VITE_SERVER_URL;
  if (serverUrl === undefined || serverUrl.length === 0) return null;

  socket = ioClient(serverUrl, {
    path: '/socket.io',
    withCredentials: true,
    autoConnect: false,
    // Socket.IO's own reconnect handles transient network drops.
    // Bounded retry + outbox drain for HTTP writes ship in R5.1.c.
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 8000,
    reconnectionAttempts: Infinity,
  });

  socket.on('applied', applyBroadcast);
  socket.on('connect', () => {
    useStore.setState({ socketConnected: true });
  });
  socket.on('disconnect', () => {
    useStore.setState({ socketConnected: false });
  });
  socket.on('connect_error', (err: Error) => {
    // Auth failures fire here with e.g. `err.message === 'unauthenticated'`
    // (server middleware `next(new Error('unauthenticated'))`). Higher-
    // layer redirect flows (`ProtectedRoute`) handle logged-out UI; here
    // we just log so a bug in the connect path is diagnosable.
    console.warn('[socket] connect_error:', err.message);
  });

  return socket;
}

/**
 * Testing seam: force-close the module-scope singleton. Idempotent.
 */
export function resetSocket(): void {
  if (socket !== null) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}

/**
 * Read-only accessor for the current socket. Returns null if
 * `connectSocket()` hasn't been called (or in local mode).
 */
export function getSocket(): Socket | null {
  return socket;
}
