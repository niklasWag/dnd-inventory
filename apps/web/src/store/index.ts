import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import { createDebouncedSaver } from '@/db/save';
import { isServerMode } from '@/lib/serverMode';
import { enqueue, captureRollbackSnapshot } from '@/sync/queue';
import { generateInviteCode, reduce, type LogEntrySlice, type ReducerContext } from './reducer';
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
 * The reducer is pure modulo its injected `ReducerContext` (R3.4.a); the
 * middleware here owns the per-entry actor identity injection that the
 * reducer's `LogEntrySlice` deliberately omits.
 */
export interface StoreState {
  appState: AppState;
  log: TransactionLogEntry[];
  dispatch: (action: Action) => void;
  hydrate: (snapshot: { appState: AppState; log: TransactionLogEntry[] }) => void;
  restoreSnapshot: (snapshot: { appState: AppState; log: TransactionLogEntry[] }) => void;
}

const saver = createDebouncedSaver();

/**
 * The web's `ReducerContext` — passes real `crypto.randomUUID()`,
 * `new Date().toISOString()`, and the shared `generateInviteCode` (R4
 * 128-bit base32 with `INV-` prefix) into the reducer. Tests inject a
 * deterministic context at the `@app/rules` boundary instead of using
 * this constant.
 */
const webReducerCtx: ReducerContext = {
  newId: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
  newInviteCode: generateInviteCode,
};

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
): { actorUserId: string; actorRole: 'dm' | 'player' | 'banker'; partyId: string } {
  // R4.2.a — `'banker'` is the third actorRole. Derived per OUTLINE
  // §3.14: actor === party.bankerUserId AND the slice is a player-
  // dispatched action (not appoint-banker / revoke-banker / kick-player
  // / identify — those are DM-only by §8.1 and stay 'dm' even if the DM
  // were somehow the banker, which §3.14 prohibits). Implementation
  // mirrors `@app/shared/guards/actor.ts::deriveActorRole` for the
  // player-driven branches below.
  const playerOrBanker = (s: NonNullable<AppState>) =>
    s.party.bankerUserId === s.user.id ? ('banker' as const) : ('player' as const);

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
      // Player-initiated mutations. R4.2.a — when the actor IS the
      // party's Banker, the log entry surfaces as `'banker'` per §3.14
      // (the Banker keeps their underlying player rights AND inherits
      // the Banker badge for audit purposes).
      if (state === null) {
        throw new Error(`resolveActor: ${slice.type} requires populated AppState`);
      }
      return {
        actorUserId: state.user.id,
        actorRole: playerOrBanker(state),
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
    case 'equip':
    case 'unequip':
    case 'attune':
    case 'unattune':
    case 'use-charge':
    case 'recharge':
    case 'edit-character':
    case 'delete-character':
    case 'leave-party':
    case 'join-party':
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
      // R1.2 adds `equip` / `unequip` / `attune` / `unattune` — all
      // owner-only (the row must live in the character's own Inventory
      // per the reducer's `resolveInventoryRow` guard). `edit-character`
      // is logged as player-role in MVP; R4 will route `maxAttunement`
      // edits through the DM role per OUTLINE §8.1.
      // R2.2 adds `use-charge` / `recharge` — both owner-only in MVP
      // (the row must live in the character's own Inventory). R4 will
      // route DM force-use-charge / force-recharge through the DM role
      // per OUTLINE §8.1 (force-actions on Inventory items + force-
      // recharge on any-location items).
      // R4.1.b adds `delete-character` — player-role for owner-initiated
      // self-deletion; R4.3 will widen to DM role when the DM deletes
      // another player's character via explicit action per OUTLINE §8.1.
      // The cascade also emits synthetic `transfer` + (optional)
      // `currency-change` entries which share the same actor identity.
      // R4 (multi-member) will also let DM / Banker drive these.
      // R4.2.a: actor surfaces as `'banker'` when state.user IS the
      // Party's Banker, otherwise `'player'`.
      if (state === null) {
        throw new Error(`resolveActor: ${slice.type} requires populated AppState`);
      }
      return {
        actorUserId: state.user.id,
        actorRole: playerOrBanker(state),
        partyId: state.party.id,
      };
    case 'identify':
      // R2.3: DM-only action per OUTLINE §8.1 row 459 ("Identify magic
      // item (toggle identified)"). In MVP party-of-one the sole user
      // wears both hats so this routes the same physical user through
      // the DM membership for audit purposes. R3+ server-side gate
      // will enforce DM-only for multi-member parties.
      if (state === null) {
        throw new Error('resolveActor: identify requires populated AppState');
      }
      return {
        actorUserId: state.user.id,
        actorRole: 'dm',
        partyId: state.party.id,
      };
    case 'kick-player':
    case 'appoint-banker':
    case 'revoke-banker':
      // R4.1.d / R4.2.a — all DM-only per OUTLINE §8.1. Reducer rejects
      // non-DM dispatches before this resolver runs, so `'dm'` is the
      // structurally-correct value (and §3.14 bars the DM from being
      // the Banker, so even when bankerUserId is set, the actor of
      // these actions is never the Banker).
      if (state === null) {
        throw new Error(`resolveActor: ${slice.type} requires populated AppState`);
      }
      return {
        actorUserId: state.user.id,
        actorRole: 'dm',
        partyId: state.party.id,
      };
    case 'split-evenly':
      // R4.2.d — Banker-only per OUTLINE §8.1. Reducer + guard both
      // reject non-Banker dispatches, so the actor is always the Banker
      // by the time this resolver runs. Emitted with `actorRole:
      // 'banker'` for audit-trail clarity.
      if (state === null) {
        throw new Error('resolveActor: split-evenly requires populated AppState');
      }
      return {
        actorUserId: state.user.id,
        actorRole: 'banker',
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
      // BUG-003 — capture the pre-mutation snapshot NOW so the sync
      // queue can roll back to it on 422 rejection. Must run before
      // any `set()` mutation below; the queue module guarantees
      // idempotence (subsequent captures within the same debounce
      // window are no-ops).
      if (isServerMode) {
        captureRollbackSnapshot();
      }
      // Reduce against the pre-mutation snapshot (Immer's draft would
      // re-trigger our pure reducer with a proxy, which we deliberately
      // avoid — the reducer is meant to be plain-value pure).
      const prev = get();
      const result = reduce(prev.appState, action, webReducerCtx);
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

      // R3.5 / R4.1-followup — in server mode, optimistically push the
      // action to the sync queue. The queue debounces + handles 422
      // rollback + bootstrap pull-after-push.
      //
      // The enqueue is synchronous: callers that subsequently `await
      // flushSyncQueue()` (e.g. the Hub's Create-party handler) need
      // the action to be on the queue BEFORE their `flush()` call
      // checks `queue.length === 0` and bails. The pre-R4.1-followup
      // code used `void import('@/sync/queue').then(({enqueue}) =>
      // enqueue(action))` which deferred the enqueue across a
      // microtask, causing flushes that fired immediately after
      // dispatch to find an empty queue and the bootstrap pull to
      // never run — surfacing as `/sync/state` 404s on the next
      // screen.
      if (isServerMode) {
        enqueue(action);
      }
    },
    hydrate: (snapshot) => {
      set((draft) => {
        draft.appState = snapshot.appState;
        draft.log = snapshot.log;
      });
    },
    /**
     * R3.5 — restore state wholesale WITHOUT triggering a Dexie save
     * or a queue enqueue. Used by `sync/queue.ts` for rollback on 422
     * and for the bootstrap pull-after-push canonicalisation.
     */
    restoreSnapshot: (snapshot) => {
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
