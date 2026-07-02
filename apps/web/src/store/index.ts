import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import { newUuidV7, deriveActorRoleForSlice } from '@app/shared';

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
  /**
   * RH2.1b — patch the timestamps of local PENDING log entries from
   * the server's `applied[]` echo. Called by the queue's post-flush
   * hook. Matches by content (`type` + JSON-canonicalised payload) —
   * the client- and server-side log entry ids diverge (client uses
   * `crypto.randomUUID()`, server uses `newUuidV7()`), so id-based
   * matching isn't available. Content matching is safe because the
   * reducer never emits two structurally-identical slices in a single
   * batch.
   *
   * RH2.6 retires client-side log emission in server mode entirely,
   * at which point this method's responsibility shifts to "append
   * server-authoritative entries" rather than "patch client-emitted
   * ones."
   */
  patchLogEntries: (applied: readonly TransactionLogEntry[]) => void;
}

const saver = createDebouncedSaver();

/**
 * The web's `ReducerContext` — passes UUID v7 (RH1 client-authoritative
 * id mint), `new Date().toISOString()`, and the shared `generateInviteCode`
 * (R4 128-bit base32 with `INV-` prefix) into the reducer. Tests inject a
 * deterministic context at the `@app/rules` boundary instead of using
 * this constant.
 */
const webReducerCtx: ReducerContext = {
  now: () => new Date().toISOString(),
  newInviteCode: generateInviteCode,
};

/**
 * Derives the actor identity (user, role, party) for a log entry from the
 * pre-mutation state and the reducer's slice. Bootstrap actions like
 * `create-character` run when `state` is null, so they MUST pull identity
 * from the slice payload (which the reducer just minted). Post-bootstrap
 * variants read `state.user.id` / `state.party.id`.
 *
 * RH2.1a — role derivation moved to the shared `deriveActorRoleForSlice`
 * function so the web store and the server log builder agree on the
 * per-action-type table. Identity (userId + partyId) still resolves
 * locally because the two sites source identity differently (web reads
 * from the pre-mutation store; server reads from the session-derived
 * `Actor`).
 */
function resolveActor(
  state: AppState,
  slice: LogEntrySlice,
): { actorUserId: string; actorRole: 'dm' | 'player' | 'banker'; partyId: string } {
  const actorRole = deriveActorRoleForSlice(state, slice);
  if (slice.type === 'create-character' && state === null) {
    // Bootstrap: identity lives on the slice payload (the reducer just
    // minted these ids). Every other bootstrap-scope field is derived
    // from them.
    return {
      actorUserId: slice.payload.userId,
      actorRole,
      partyId: slice.payload.partyId,
    };
  }
  if (state === null) {
    throw new Error(`resolveActor: ${slice.type} requires populated AppState`);
  }
  return {
    actorUserId: state.user.id,
    actorRole,
    partyId: state.party.id,
  };
}

/**
 * Builds a full `TransactionLogEntry` by injecting the non-deterministic
 * fields (`id`, `timestamp`, `sessionId`) and the resolved actor identity
 * onto the reducer's pure slice. Kept here — not in the reducer — so the
 * reducer stays free of `crypto.randomUUID()` / `new Date()` side effects.
 *
 * RH2.1b — in server mode the log entry's timestamp is stamped as the
 * sentinel `'PENDING'`; the queue's post-flush hook patches it to the
 * server-canonical value from `applied[]`. This makes the SERVER the
 * single authority for `TransactionLog.timestamp` under multi-writer
 * broadcast (R5.1). In local mode the client is still authoritative;
 * `new Date().toISOString()` lands on the entry immediately. See
 * `packages/shared/src/guards/actor.ts` for the analogous `actorRole`
 * derivation (RH2.1a).
 *
 * Note: entity `createdAt` / `joinedAt` / `leftAt` fields on state
 * (`Stash.createdAt`, `PartyMembership.joinedAt`, etc.) are NOT flipped
 * to PENDING here — that axis is scoped to RH2.6, which retires
 * client-side log emission entirely in server mode.
 */
function buildLogEntry(state: AppState, slice: LogEntrySlice): TransactionLogEntry {
  const { actorUserId, actorRole, partyId } = resolveActor(state, slice);
  return {
    id: crypto.randomUUID(),
    partyId,
    sessionId: null,
    timestamp: isServerMode ? 'PENDING' : new Date().toISOString(),
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
      // RH2.1b — never persist PENDING log entries to Dexie. In server
      // mode the source of truth is the server; PENDING entries live
      // only in memory until the queue's post-flush hook patches them.
      // If the tab closes before flush, the actions never reach the
      // server anyway, so dropping them from Dexie keeps hydrate
      // schema-valid (`.datetime()` refinement would reject PENDING).
      const persistableLog = isServerMode
        ? snapshot.log.filter((e) => e.timestamp !== 'PENDING')
        : snapshot.log;
      saver.save({ appState: snapshot.appState, log: persistableLog });

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
    /**
     * RH2.1b — patch local log entries' timestamps from the server's
     * `applied[]` echo. Content-matches on `(type, canonical-payload)`:
     * each applied entry pops the FIRST matching PENDING local entry
     * and overwrites its timestamp. Unmatched applied entries and
     * leftover PENDING entries are logged as warnings — under RH1's
     * one-authority-per-field regime they shouldn't occur.
     */
    patchLogEntries: (applied) => {
      if (applied.length === 0) return;
      set((draft) => {
        for (const remote of applied) {
          const remoteKey = matchKey(remote);
          const idx = draft.log.findIndex(
            (local) => local.timestamp === 'PENDING' && matchKey(local) === remoteKey,
          );
          if (idx === -1) {
            // No matching local PENDING entry. Post-RH1 this shouldn't
            // happen — the client and server produce structurally
            // equivalent slices per action. Log for diagnostics; RH2.3
            // will add a hard assertion.
            console.warn(
              '[store.patchLogEntries] no matching local PENDING entry for applied',
              remote.type,
              remote.id,
            );
            continue;
          }
          draft.log[idx]!.timestamp = remote.timestamp;
        }
      });
    },
  })),
);

/**
 * Content-match key for RH2.1b timestamp patching. Combines the slice
 * type and a canonical (sorted-key) JSON of the payload so that two
 * structurally-identical slices produce the same key regardless of
 * property insertion order.
 */
function matchKey(entry: TransactionLogEntry): string {
  return `${entry.type}:${stableStringify(entry.payload)}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/**
 * Flush any pending debounced persist. Useful before navigation away
 * from the app (beforeunload) and in tests. Exposed separately from
 * `dispatch` so callers don't have to await every mutation.
 */
export async function flushPendingPersist(): Promise<void> {
  await saver.flush();
}

/**
 * RH1.2 — Dispatch an action, minting UUID v7 ids client-side for any
 * `new<EntityName>Id` fields the payload requires. Call sites for the
 * 6 minting actions (`acquire`, `create-stash`, `split`,
 * `create-homebrew`, `transfer`, `create-character`) switch from
 * `useStore.getState().dispatch(action)` to
 * `dispatchMintingAction(action)` so they don't have to know which id
 * fields the action carries. Non-minting actions pass through.
 *
 * The ids injected here are the same ids the server persists — the
 * guard layer validates UUID v7 structure + clock-skew upstream, and
 * Prisma's unique constraint catches collisions. See
 * `packages/shared/src/guards/map.ts::checkMintedIds` for validation
 * and `apps/server/src/sync/routes.ts` for the P2002 → `id_already_exists`
 * mapping.
 *
 * The function takes an action whose payload lacks the `new*Id` fields
 * (`Action` narrowed with those keys omitted) and returns after minting.
 * TypeScript ergonomics: callers pass the action they'd otherwise
 * dispatch; TS accepts it because omitting a keyed prop is structurally
 * assignable to the un-widened original type.
 */
export function dispatchMintingAction(
  action: MintingActionInput | Exclude<Action, MintingActionInput>,
): void {
  useStore.getState().dispatch(injectMintedIds(action));
}

/**
 * Input to `dispatchMintingAction` for the 6 minting action variants,
 * with the `new<EntityName>Id` fields stripped from each payload. The
 * helper mints those fields; callers pass the "user-supplied" bits only.
 *
 * For `create-character` we distinguish bootstrap (no state) from
 * in-existing-party (state !== null) at the call site — both accepted
 * as a single input shape; the helper mints the appropriate id set.
 */
type MintingActionInput =
  | (Omit<Extract<Action, { type: 'acquire' }>, 'payload'> & {
      payload: Omit<Extract<Action, { type: 'acquire' }>['payload'], 'newItemInstanceId'>;
    })
  | (Omit<Extract<Action, { type: 'create-stash' }>, 'payload'> & {
      payload: Omit<
        Extract<Action, { type: 'create-stash' }>['payload'],
        'newStashId' | 'newCurrencyHoldingId'
      >;
    })
  | (Omit<Extract<Action, { type: 'split' }>, 'payload'> & {
      payload: Omit<Extract<Action, { type: 'split' }>['payload'], 'newItemInstanceId'>;
    })
  | (Omit<Extract<Action, { type: 'create-homebrew' }>, 'payload'> & {
      payload: Omit<Extract<Action, { type: 'create-homebrew' }>['payload'], 'newDefinitionId'>;
    })
  | (Omit<Extract<Action, { type: 'transfer' }>, 'payload'> & {
      payload: Omit<Extract<Action, { type: 'transfer' }>['payload'], 'newItemInstanceId'>;
    })
  | (Omit<Extract<Action, { type: 'create-character' }>, 'payload'> & {
      payload:
        | Omit<
            Extract<
              Extract<Action, { type: 'create-character' }>['payload'],
              { dmOnly?: false }
            >,
            | 'newCharacterId'
            | 'newInventoryStashId'
            | 'newCurrencyHoldingId'
            | 'newUserId'
            | 'newPartyId'
            | 'newPartyStashId'
            | 'newRecoveredLootStashId'
            | 'newPartyStashCurrencyId'
            | 'newRecoveredLootCurrencyId'
          >
        | Omit<
            Extract<
              Extract<Action, { type: 'create-character' }>['payload'],
              { dmOnly: true }
            >,
            | 'newUserId'
            | 'newPartyId'
            | 'newPartyStashId'
            | 'newRecoveredLootStashId'
            | 'newPartyStashCurrencyId'
            | 'newRecoveredLootCurrencyId'
          >;
    });

function injectMintedIds(action: MintingActionInput | Exclude<Action, MintingActionInput>): Action {
  switch (action.type) {
    case 'acquire':
      return {
        ...action,
        payload: { ...action.payload, newItemInstanceId: newUuidV7() },
      };
    case 'create-stash':
      return {
        ...action,
        payload: {
          ...action.payload,
          newStashId: newUuidV7(),
          newCurrencyHoldingId: newUuidV7(),
        },
      };
    case 'split':
      return {
        ...action,
        payload: { ...action.payload, newItemInstanceId: newUuidV7() },
      };
    case 'create-homebrew':
      return {
        ...action,
        payload: { ...action.payload, newDefinitionId: newUuidV7() },
      };
    case 'transfer':
      return {
        ...action,
        payload: { ...action.payload, newItemInstanceId: newUuidV7() },
      };
    case 'create-character': {
      // Whether we're at bootstrap or in-existing-party is a runtime
      // question (state-dependent). Mint the FULL id set every call —
      // the reducer discards ids it doesn't need. Cheap, deterministic,
      // avoids leaking store state into this helper.
      const partyScope = {
        newUserId: newUuidV7(),
        newPartyId: newUuidV7(),
        newPartyStashId: newUuidV7(),
        newRecoveredLootStashId: newUuidV7(),
        newPartyStashCurrencyId: newUuidV7(),
        newRecoveredLootCurrencyId: newUuidV7(),
      };
      if (action.payload.dmOnly === true) {
        return { ...action, payload: { ...action.payload, ...partyScope } };
      }
      return {
        ...action,
        payload: {
          ...action.payload,
          newCharacterId: newUuidV7(),
          newInventoryStashId: newUuidV7(),
          newCurrencyHoldingId: newUuidV7(),
          ...partyScope,
        },
      };
    }
    default:
      return action;
  }
}
