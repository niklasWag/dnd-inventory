import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import { createDebouncedSaver } from '@/db/save';
import { reduce, type LogEntrySlice } from './reducer';
import type { Action, AppState, TransactionLogEntry } from './types';

/**
 * Store shape — pairs `appState` (typed root from `@app/shared`) with
 * the `log` so both persist atomically as one blob.
 *
 * Invariant (per CLAUDE.md): every mutation flows through `dispatch`:
 *   1. validate + apply the action via `reduce`,
 *   2. append the resulting log entry (with derived id/timestamp/actor),
 *   3. trigger a debounced persist.
 *
 * The reducer is pure; the middleware here injects the non-deterministic
 * pieces of the log entry (id, timestamp, actorUserId, actorRole, partyId,
 * sessionId).
 */
export interface StoreState {
  appState: AppState;
  log: TransactionLogEntry[];
  dispatch: (action: Action) => void;
  hydrate: (snapshot: { appState: AppState; log: TransactionLogEntry[] }) => void;
}

const saver = createDebouncedSaver();

/**
 * Derives the actor identity (user, role, party) for a log entry from the
 * pre-mutation state and the reducer's slice. Bootstrap actions like
 * `create-character` run when `state` is null, so they MUST pull identity
 * from the slice payload (which the reducer just minted). Post-bootstrap
 * variants will read `state.user.id` / `state.party.id` here.
 */
function resolveActor(
  state: AppState,
  slice: LogEntrySlice,
): { actorUserId: string; actorRole: 'dm' | 'player'; partyId: string } {
  // Single switch over the discriminant. When new TxType variants land in
  // M2+, add a `case` here AND the @app/shared union, both type-checked.
  switch (slice.type) {
    case 'create-character':
      // The AppState BEFORE this action is null, so we pull party/user
      // from the slice payload itself (the reducer just generated them).
      return {
        actorUserId: slice.payload.userId,
        actorRole: 'dm',
        partyId: slice.payload.partyId,
      };
    case 'acquire':
    case 'consume':
    case 'edit-item-instance':
      // Player-initiated mutations. In MVP the sole user wears both hats;
      // R4 (multi-member parties) introduces the DM/player split + the
      // `'banker'` actorRole variant.
      if (state === null) {
        throw new Error(`resolveActor: ${slice.type} requires populated AppState`);
      }
      return {
        actorUserId: state.user.id,
        actorRole: 'player',
        partyId: state.party.id,
      };
    case 'seed-catalog':
      // System-driven (bootstrap), but the User is the actor of record so
      // the entry stays self-explanatory in the future history view.
      // Logged as `'dm'` because catalog curation is the DM's domain per
      // OUTLINE §3.7 (and the MVP user wears both hats anyway).
      if (state === null) {
        throw new Error('resolveActor: seed-catalog requires populated AppState');
      }
      return {
        actorUserId: state.user.id,
        actorRole: 'dm',
        partyId: state.party.id,
      };
    case 'transfer':
    case 'split':
    case 'create-stash':
    case 'rename-stash':
    case 'delete-stash':
    case 'currency-change':
    case 'currency-transfer':
    case 'create-homebrew':
    case 'edit-homebrew':
    case 'delete-homebrew':
    case 'rename-character':
    case 'rename-party':
    case 'set-encumbrance':
      // M3 player-initiated stash CRUD + the synthetic transfer +
      // currency-change emitted from the delete-stash cascade. M5
      // adds user-initiated `transfer` + `split` (always player-driven
      // in the MVP; R4 widens the role split). M5.5 adds
      // `currency-transfer` for atomic stash-to-stash currency moves.
      // M6 adds the homebrew CRUD trio — in MVP party-of-one these
      // are player-role; R4 will restrict create/edit/delete to DM
      // when the party has 2+ members per OUTLINE §8.1 (custom-item
      // creation is DM-only in multi-member parties).
      // M7 adds `rename-character` (owner-only in MVP party-of-one;
      // owner-only in R4 too — character names belong to the owning
      // player) and `rename-party` (player-role in MVP; R4 widens to
      // DM-only when the party has 2+ members per OUTLINE §8.1).
      // R1.1 adds `set-encumbrance` — owner-only in MVP; R4 will
      // restrict to DM in 2+-member parties per OUTLINE §8.1 ("Edit
      // any character encumbrance rule" DM-only row).
      // R4 (multi-member) will also let DM / Banker drive these.
      if (state === null) {
        throw new Error(`resolveActor: ${slice.type} requires populated AppState`);
      }
      return {
        actorUserId: state.user.id,
        actorRole: 'player',
        partyId: state.party.id,
      };
  }
}

/**
 * Builds a full `TransactionLogEntry` by injecting the non-deterministic
 * fields (`id`, `timestamp`, `sessionId`) and the resolved actor identity
 * onto the reducer's pure slice. Kept here — not in the reducer — so the
 * reducer stays free of `crypto.randomUUID()` / `new Date()` side effects.
 */
function buildLogEntry(state: AppState, slice: LogEntrySlice): TransactionLogEntry {
  const { actorUserId, actorRole, partyId } = resolveActor(state, slice);
  return {
    id: crypto.randomUUID(),
    partyId,
    sessionId: null,
    timestamp: new Date().toISOString(),
    actorUserId,
    actorRole,
    ...slice,
  };
}

export const useStore = create<StoreState>()(
  immer((set, get) => ({
    appState: null,
    log: [],
    dispatch: (action) => {
      // Reduce against the pre-mutation snapshot (Immer's draft would
      // re-trigger our pure reducer with a proxy, which we deliberately
      // avoid — the reducer is meant to be plain-value pure).
      const prev = get();
      const result = reduce(prev.appState, action);
      // Most reducer cases emit one slice; M3's `delete-stash` cascade
      // emits N+1 (transfers + delete-stash) or N+2 (when currency rolls
      // into Recovered Loot). Resolve each slice against the SAME
      // pre-mutation snapshot — within a single dispatch all entries
      // share `actorUserId`/`actorRole`/`partyId`.
      const entries = result.logEntries.map((slice) => buildLogEntry(prev.appState, slice));

      set((draft) => {
        draft.appState = result.state;
        for (const entry of entries) {
          draft.log.push(entry);
        }
      });

      const snapshot = get();
      saver.save({ appState: snapshot.appState, log: snapshot.log });
    },
    hydrate: (snapshot) => {
      set((draft) => {
        draft.appState = snapshot.appState;
        draft.log = snapshot.log;
      });
    },
  })),
);

/**
 * Flush any pending debounced persist. Useful before navigation away
 * from the app (beforeunload) and in tests. Exposed separately from
 * `dispatch` so callers don't have to await every mutation.
 */
export async function flushPendingPersist(): Promise<void> {
  await saver.flush();
}
