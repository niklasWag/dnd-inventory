/**
 * R5.1 — Broadcast reconciliation entrypoint.
 *
 * Extracted from `sync/socket.ts` in R5.1.c so both the live-broadcast
 * handler (`socket.on('applied', applyBroadcast)`) AND the reconnect
 * drainer (`reconnect.ts::drainOutbox`) can share the same
 * reconciliation path without a circular import between the two.
 *
 * See `sync/socket.ts`'s module docstring for the full contract; this
 * file is the single-file home for the reconciliation logic itself.
 */
import { appliedBroadcastSchema } from '@app/shared';

import { flushPendingPersist, useStore } from '@/store';
import { reduce } from '@/store/reducer';
import type { Action } from '@/store/types';

/**
 * Reducer context used when applying broadcast actions. RH2 determinism
 * guarantees the reducer, given the same state + action, produces the
 * same output on every client. But some reducer paths would ordinarily
 * consult `ctx.now()` for a mutation timestamp field. In a broadcast
 * re-run those values are ALREADY in the server's `applied[]` — the
 * reducer must not re-derive them or state would drift. The helpers
 * `throw` on call so any drift surfaces loudly.
 */
const broadcastReducerCtx = {
  now: () => {
    throw new Error(
      'applyBroadcast: reducer called ctx.now() during broadcast re-run — ' +
        'server-echoed log entries carry their own timestamps and the reducer must ' +
        'not depend on wall-clock here.',
    );
  },
  newInviteCode: () => {
    throw new Error(
      'applyBroadcast: reducer called ctx.newInviteCode() during broadcast re-run — ' +
        'invite codes are minted by the acting client only.',
    );
  },
};

/**
 * Apply a validated broadcast payload to the local store.
 *
 * Flow:
 *   1. Zod-parse the wire payload via `appliedBroadcastSchema`.
 *      Malformed → log + drop (defensive; server is trusted, but
 *      Zod at every boundary is the invariant).
 *   2. If the broadcast's `partyId` !== `state.appState.party.id`,
 *      ignore (user is viewing another party or Hub). When they
 *      navigate to that party, PartyScopeSync's `pullState` will
 *      fetch canonical state (which already reflects the mutation).
 *   3. Dedupe by `entry.id`: covers self-echo (HTTP response already
 *      appended the same `applied[]`) + duplicate broadcasts.
 *   4. For the non-duplicate slices, re-run the local reducer for
 *      state mutation. Discard the reducer's own `logEntries` —
 *      RH2.6's log-authority rule means the server's `applied[]` is
 *      the sole source of truth for `state.log`. Append via
 *      `appendServerLogEntries()`.
 *   5. Trigger the debounced saver via `flushPendingPersist()`.
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
  if (currentPartyId !== partyId) return;

  const seenIds = new Set(store.log.map((e) => e.id));
  const novel = applied.filter((e) => !seenIds.has(e.id));
  if (novel.length === 0) return;

  // Structural bridge between shared Zod's Action (exactOptional
  // `field?: T | undefined`) and the reducer's TS Action (`field?: T`).
  // Same shape at runtime; only the TS optional-field flavour differs.
  const reducerAction = action as unknown as Action;
  const result = reduce(store.appState, reducerAction, broadcastReducerCtx);

  useStore.setState({ appState: result.state });
  store.appendServerLogEntries(novel);

  void flushPendingPersist();
}
