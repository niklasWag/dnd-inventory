import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/App';
import { getCurrentPartyId } from '@/db/meta';
import { isServerMode } from '@/lib/serverMode';
import { useStore } from '@/store';
import { useSession } from '@/store/session';
import { hydrateFromDexie } from '@/store/hydrate';
import { seedCatalogIfNeeded } from '@/store/seed';
import { pullState } from '@/sync/client';
import { attachUnloadFlush, configureQueue } from '@/sync/queue';
import '@/index.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found');
}

/**
 * R3.5 — boot order:
 *
 *   1. Hydrate the session (local mode → no-op; server mode → `/auth/session`).
 *   2. Local mode: hydrate from Dexie (offline-survival cache) + seed catalog.
 *   3. Server mode + authenticated + `currentPartyId`: pull canonical
 *      AppState from `/sync/state` and rewrite the store. If anonymous
 *      or `needsDisplayName`, skip — `ProtectedRoute` routes to /login
 *      or /login/display-name.
 *   4. Wire the queue's deps + the `beforeunload` flush, then mount.
 */
async function boot(): Promise<void> {
  await useSession.getState().hydrate();

  if (!isServerMode) {
    await hydrateFromDexie();
    seedCatalogIfNeeded();
  } else {
    const sessionStatus = useSession.getState().status;
    if (sessionStatus === 'authenticated') {
      const partyId = await getCurrentPartyId();
      if (partyId !== null) {
        try {
          const pulled = await pullState(partyId);
          useStore.getState().hydrate({ appState: pulled.state, log: pulled.state.log });
        } catch (err) {
          // Don't block boot on a stale party pointer — the Hub will
          // surface the error and let the user pick a different party.

          console.warn('[boot] pullState failed; rendering anyway', err);
        }
      }
    }
  }

  // R3.5 — wire the queue's deps. Done after the store is hydrated
  // so the snapshot path reads a stable shape. Local mode also
  // configures the queue (it's a no-op there because nothing
  // enqueues), keeping the boot path uniform.
  configureQueue({
    getSnapshot: () => {
      const s = useStore.getState();
      return { appState: s.appState, log: s.log };
    },
    restoreSnapshot: (snap) => {
      useStore.getState().restoreSnapshot(snap);
    },
    getActivePartyId: () => getCurrentPartyId(),
    // RH2.6 — queue passes the server's applied[] echo to the store
    // so it can append the server-emitted log entries to state.log.
    // In server mode this is the SOLE writer of state.log (client-
    // side reducer's logEntries are discarded at the store boundary).
    appendServerLogEntries: (applied) => {
      useStore.getState().appendServerLogEntries(applied);
    },
  });
  attachUnloadFlush();

  createRoot(rootEl!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
