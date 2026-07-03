import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

import { newUuidV7, currentGameSessionId, deriveActorRoleForSlice } from '@app/shared';

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
   * RH2.6 — mode-aware log-authority split. In **server mode** the
   * client's reducer discards its `logEntries` slice output; `state.log`
   * grows only via this method, which the queue calls after each
   * successful `POST /sync/actions` with the response's `applied[]`
   * array. Pure append — the server-emitted entries are the canonical
   * source of truth (server-minted `id`, `timestamp`, `actorRole`).
   *
   * In **local mode** this method is unused; `dispatch` appends
   * client-built entries directly.
   *
   * BUG-004 closure: prior to RH2.6, the client emitted a log entry
   * with `id = crypto.randomUUID()` and the queue's post-flush hook
   * patched only the timestamp — the id never converged with the
   * server's `TransactionLog.id`. Retiring client-side emission in
   * server mode eliminates that divergence axis entirely.
   */
  appendServerLogEntries: (applied: readonly TransactionLogEntry[]) => void;
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
 * RH2.6 — only called in **local mode**. In server mode `dispatch`
 * skips the log-append entirely; the server is the sole authority for
 * `TransactionLog` contents, and `state.log` grows from the queue's
 * `appendServerLogEntries` post-flush hook.
 *
 * RH3.1 — `sessionId` is derived from `state.gameSessions` via
 * `currentGameSessionId(state)` — a shared helper that both this
 * middleware and the server-side `buildLogEntryServer` call, keeping
 * the web + server stampers bit-identical (RH2.1a's shared-derivation
 * pattern). `null` when no `GameSession` has `isCurrent: true`
 * (the "Untagged" bucket per OUTLINE §3.12).
 */
function buildLogEntry(state: AppState, slice: LogEntrySlice): TransactionLogEntry {
  const { actorUserId, actorRole, partyId } = resolveActor(state, slice);
  return {
    id: crypto.randomUUID(),
    partyId,
    sessionId: currentGameSessionId(state),
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
      // RH2.6 — mode-aware log-authority split. In LOCAL mode the client
      // builds full log entries from the reducer's slices and appends
      // to `state.log`. In SERVER mode the reducer's `logEntries` output
      // is DISCARDED at this boundary; the queue's post-flush hook
      // (`appendServerLogEntries`) is the sole writer of `state.log`
      // in server mode. See `docs/SECURITY.md` §3.1.6 for the contract.
      //
      // Most reducer cases emit one slice; M3's `delete-stash` cascade
      // emits N+1 (transfers + delete-stash) or N+2 (when currency rolls
      // into Recovered Loot). Resolve each slice against the SAME
      // pre-mutation snapshot — within a single dispatch all entries
      // share `actorUserId`/`actorRole`/`partyId`.
      const entries = isServerMode
        ? []
        : result.logEntries.map((slice) => buildLogEntry(prev.appState, slice));

      set((draft) => {
        draft.appState = result.state;
        for (const entry of entries) {
          draft.log.push(entry);
        }
      });

      const snapshot = get();
      // RH2.6 — no PENDING sentinel to filter out. In server mode the
      // client no longer emits log entries at all; in local mode every
      // entry has a real ISO timestamp. Persist the log as-is.
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
        // RH4.2 — thread partyId explicitly to the queue (retires the
        // Dexie `meta.currentPartyId` round-trip on the flush path).
        // `snapshot.appState.party.id` is the URL-authoritative partyId
        // per RH4.1's PartyScopeSync guard: state was reconciled with
        // the URL before this dispatch could fire. For bootstrap
        // `create-character` the party was just minted by the reducer
        // above and is now in state.
        const partyId = snapshot.appState?.party.id;
        if (partyId !== undefined) {
          enqueue(action, partyId);
        }
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
     * RH2.6 — server-mode log append. The queue calls this after each
     * successful `POST /sync/actions` with the server's `applied[]`
     * echo. Every entry is server-minted (id, timestamp, actorRole,
     * payload); we append them verbatim.
     *
     * No matching, no patching — the server IS the source of truth.
     * `state.log` in server mode grows exclusively through this seam.
     * In local mode this method is never called (dispatch appends
     * client-built entries directly).
     */
    appendServerLogEntries: (applied) => {
      if (applied.length === 0) return;
      set((draft) => {
        for (const entry of applied) {
          draft.log.push(entry);
        }
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
            Extract<Extract<Action, { type: 'create-character' }>['payload'], { dmOnly?: false }>,
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
            Extract<Extract<Action, { type: 'create-character' }>['payload'], { dmOnly: true }>,
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
