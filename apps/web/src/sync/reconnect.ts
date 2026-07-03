/**
 * R5.1.c — Reconnect flow: catch up on missed state + drain outbox.
 *
 * Wired to `socket.on('connect')` in `apps/web/src/sync/socket.ts`.
 * Runs whenever the WebSocket transport (re-)establishes so the client
 * catches up on:
 *
 *   1. **Missed state.** Live broadcasts fire while we're connected,
 *      but during a disconnect window peer actions accumulate on the
 *      server that this client never saw. We fetch server-authoritative
 *      state via `GET /sync/state?partyId=` (the same endpoint
 *      `PartyScopeSync` uses on party navigation) and hydrate the
 *      store from it. Simpler + more reliable than log-replay:
 *      `TransactionLog` entries carry POST-mutation snapshots keyed
 *      by resolved entity ids (`itemInstanceId`), not action mint
 *      fields (`newItemInstanceId`) — reconstructing an Action from a
 *      log entry is lossy for id-minting variants.
 *   2. **Buffered writes.** Actions the user dispatched while offline
 *      that landed in the Dexie outbox (see R5.1.c's queue.ts). Each
 *      row is POSTed to `/sync/actions` in FIFO order via
 *      `replayOutboxRow`. Rows removed on 200 / 422; kept on network
 *      or auth failure (next reconnect will pick them up).
 *
 * Order matters: catch up on missed STATE first so the client's view
 * reflects the peer-authored changes; THEN drain the outbox so any
 * conflicts between our buffered writes and peer-authored ones surface
 * server-side (guards evaluate against the just-hydrated state).
 */
import { pullState } from '@/lib/api';
import { useStore } from '@/store';
import { listOutboxByParty } from '@/sync/outbox';
import { replayOutboxRow } from '@/sync/queue';

/**
 * Drain the missed-state + outbox pipelines for the currently-viewed
 * party. No-op when the store isn't hydrated to a party yet (Hub view,
 * logged-out, etc.).
 *
 * Exported so `socket.on('connect')` can invoke it AND so tests can
 * drive it directly.
 */
export async function drainOutbox(): Promise<void> {
  const store = useStore.getState();
  const partyId = store.appState?.party.id ?? null;
  if (partyId === null) return;

  // 1. Missed-state catch-up. Re-hydrate from server-authoritative
  // state. Cheaper than expected for typical parties (kB-range) and
  // sidesteps the log-entry-vs-action-payload divergence for id-
  // minting actions. Same endpoint `PartyScopeSync` uses.
  try {
    const response = await pullState(partyId);
    store.hydrate({ appState: response.state, log: response.state.log });
  } catch (err) {
    // Missed-state catch-up is best-effort. A failure here doesn't
    // block the outbox drain (buffered writes may still succeed and
    // trigger their own applied[] appends).
    console.warn('[reconnect] missed-state pull failed', err);
  }

  // 2. Outbox drain. Read rows for this party, replay one at a time
  // in FIFO order. Stop on first failure — the next reconnect picks up
  // where we left off.
  try {
    const rows = await listOutboxByParty(partyId);
    for (const row of rows) {
      if (row.id === undefined) continue; // defensive: unassigned local id
      const ok = await replayOutboxRow(row.partyId, row.actions, row.id);
      if (!ok) break;
    }
  } catch (err) {
    console.warn('[reconnect] outbox drain failed', err);
  }
}
