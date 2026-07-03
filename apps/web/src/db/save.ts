import { db } from '@/db/schema';

/**
 * RH5.1 — per-party persistence keying (single-path).
 *
 * The web client holds ONE party's `AppState` in memory at a time. Each
 * party's blob is keyed as `appState:<partyId>`. There is no legacy
 * unkeyed fallback slot post-RH5.1 — the debounced saver skips writes
 * entirely while `state.appState` is null (pre-first-party / mid-swap
 * windows). The direct `saveAppState(state, partyId)` writer still
 * accepts an explicit partyId; callers must supply one for a keyed
 * write.
 */
const APP_STATE_KEY = 'appState';

function keyFor(partyId: string): string {
  return `${APP_STATE_KEY}:${partyId}`;
}

/**
 * Persist the AppState blob immediately under `appState:<partyId>`. Most
 * callers should prefer `createDebouncedSaver()` — every reducer mutation
 * triggers a save, so we batch consecutive writes to avoid hammering
 * IndexedDB.
 */
export async function saveAppState(state: unknown, partyId: string): Promise<void> {
  if (partyId.length === 0) {
    throw new Error('saveAppState: partyId must be non-empty');
  }
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
 * RH5.1 — the saver derives the Dexie key from `state.appState.party.id`
 * on each call. When the state is null (`appState === null`; pre-first-
 * party or mid-swap window), the save is a NO-OP — the null-state phase
 * is transient and doesn't survive reload by design. Post-RH5.1 there
 * is no legacy unkeyed fallback slot.
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
    // RH5.1 — never persist a null-state (partyId === null) snapshot.
    // Guards against a `flush()` that races a state-clear window.
    if (partyId === null) return;
    await saveAppState(snapshot, partyId);
  }

  return {
    save(state: unknown): void {
      const partyId = partyIdFromBlob(state);
      // RH5.1 — silently skip when there's no party in the snapshot.
      // The null-state window doesn't need persistence; on reload the
      // Hub CTA renders (see docs/roadmap.md RH5.1 Notes).
      if (partyId === null) return;
      pending = state;
      pendingPartyId = partyId;
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
