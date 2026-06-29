import { db } from '@/db/schema';

/**
 * R4-followup — per-party persistence keying.
 *
 * The web client holds ONE party's `AppState` in memory at a time, but a
 * user may have many parties (server mode lists them via `GET
 * /sync/parties`; local mode keeps them under separate Dexie keys). The
 * persistence layer keys each party's blob under `appState:<partyId>`.
 *
 * Backward-compat: the original single-key path (`'appState'`) is kept
 * as a fallback for tests and for the "no character yet" bootstrap
 * window — `saveAppState` / `loadAppState` accept an optional partyId,
 * and when absent fall back to the legacy unkeyed slot. The store
 * middleware always passes the current `state.party.id` once it has
 * one.
 */
const APP_STATE_KEY = 'appState';

function keyFor(partyId?: string | null): string {
  if (partyId === undefined || partyId === null || partyId.length === 0) {
    return APP_STATE_KEY;
  }
  return `${APP_STATE_KEY}:${partyId}`;
}

/**
 * Persist the AppState blob immediately. Most callers should prefer
 * `createDebouncedSaver()` instead — every reducer mutation triggers a save,
 * so we batch consecutive writes to avoid hammering IndexedDB.
 */
export async function saveAppState(state: unknown, partyId?: string | null): Promise<void> {
  await db.meta.put({ key: keyFor(partyId), value: state });
}

/**
 * Remove the persisted blob for a specific party. Used by Hub flows
 * that delete a local-only party (no destructive cascade — the user
 * is explicitly opting in).
 */
export async function deleteAppStateForParty(partyId: string): Promise<void> {
  await db.meta.delete(keyFor(partyId));
}

const DEFAULT_DEBOUNCE_MS = 250;

/**
 * Returns a debounced save function. The latest call within the debounce
 * window wins; intermediate states are dropped. `flush()` forces a pending
 * save immediately (useful before navigation away or in tests).
 *
 * R4-followup: the saver derives the Dexie key from `state.party.id` on
 * each call so a "switch parties" mid-session writes to the right blob.
 * When the state is null (pre-character-creation), it falls back to the
 * legacy unkeyed slot so the existing test suite + bootstrap path keeps
 * working.
 */
export function createDebouncedSaver(debounceMs: number = DEFAULT_DEBOUNCE_MS): {
  save: (state: unknown) => void;
  flush: () => Promise<void>;
} {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: unknown = undefined;
  let pendingPartyId: string | null = null;
  let hasPending = false;

  function partyIdFromBlob(state: unknown): string | null {
    if (typeof state !== 'object' || state === null) return null;
    const appState = (state as Record<string, unknown>)['appState'];
    if (typeof appState !== 'object' || appState === null) return null;
    const party = (appState as Record<string, unknown>)['party'];
    if (typeof party !== 'object' || party === null) return null;
    const id = (party as Record<string, unknown>)['id'];
    return typeof id === 'string' && id.length > 0 ? id : null;
  }

  async function commit(): Promise<void> {
    if (!hasPending) return;
    const snapshot = pending;
    const partyId = pendingPartyId;
    hasPending = false;
    pending = undefined;
    pendingPartyId = null;
    await saveAppState(snapshot, partyId);
  }

  return {
    save(state: unknown): void {
      pending = state;
      pendingPartyId = partyIdFromBlob(state);
      hasPending = true;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void commit();
      }, debounceMs);
    },
    async flush(): Promise<void> {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      await commit();
    },
  };
}
