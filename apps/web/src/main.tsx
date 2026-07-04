import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/App';
import { isServerMode } from '@/lib/serverMode';
import { useStore } from '@/store';
import { useSession } from '@/store/session';
import { hydrateFromDexie } from '@/store/hydrate';
import { seedCatalogIfNeeded } from '@/store/seed';
import { attachUnloadFlush, configureQueue } from '@/sync/queue';
import { syncSocketWithSession } from '@/sync/socket';
import '@/index.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found');
}

/**
 * R3.5 / RH4.2 — boot order:
 *
 *   1. Hydrate the session (local mode → no-op; server mode → `/auth/session`).
 *   2. Local mode: hydrate from Dexie (offline-survival cache) + seed catalog.
 *   3. Server mode: DO NOT pre-load AppState. The URL is authoritative for
 *      `partyId` post-RH4.1; when a `/party/:partyId/*` route mounts,
 *      PartyScopeSync triggers `pullState(urlPartyId)` and hydrates the
 *      store. Boot lands at `/hub` (party picker) if no URL partyId is
 *      present. Retires the previous "read `meta.currentPartyId` at boot,
 *      pre-load, redirect" flow — the URL is the durable identifier.
 *   4. Wire the queue's deps + the `beforeunload` flush, then mount.
 */
async function boot(): Promise<void> {
  await useSession.getState().hydrate();

  if (!isServerMode) {
    await hydrateFromDexie();
    seedCatalogIfNeeded();
  }
  // RH4.2 — server-mode boot is a no-op for AppState. PartyScopeSync
  // handles loading on route mount.

  // R3.5 — wire the queue's deps. Done after the store is hydrated
  // so the snapshot path reads a stable shape. Local mode also
  // configures the queue (it's a no-op there because nothing
  // enqueues), keeping the boot path uniform.
  //
  // RH4.2 — `getActivePartyId` dep retired. The dispatcher threads
  // partyId explicitly on each enqueue call (URL-authoritative via
  // PartyScopeSync); the queue no longer consults Dexie meta.
  configureQueue({
    getSnapshot: () => {
      const s = useStore.getState();
      return { appState: s.appState, log: s.log };
    },
    restoreSnapshot: (snap) => {
      useStore.getState().restoreSnapshot(snap);
    },
    // RH2.6 — queue passes the server's applied[] echo to the store
    // so it can append the server-emitted log entries to state.log.
    // In server mode this is the SOLE writer of state.log (client-
    // side reducer's logEntries are discarded at the store boundary).
    appendServerLogEntries: (applied) => {
      useStore.getState().appendServerLogEntries(applied);
    },
  });
  attachUnloadFlush();

  // R5.1.d — mirror `navigator.onLine` into the store so `canDispatch()`
  // + `OfflineBanner` derive from a single source. Listeners are
  // process-lifetime; no cleanup needed.
  window.addEventListener('online', () => {
    useStore.getState().setOnline(true);
  });
  window.addEventListener('offline', () => {
    useStore.getState().setOnline(false);
  });
  useStore.getState().setOnline(navigator.onLine);

  // R5.1.b — in server mode, open the Socket.IO connection so live
  // broadcasts from other party members flow into the store as they
  // happen. Local mode returns null (no server to connect to).
  // Kept AFTER `configureQueue` so the store + queue are wired before
  // the first inbound broadcast can arrive.
  //
  // R5.2.a — connect ONLY when the session has a valid cookie
  // (`authenticated` / `needsDisplayName`). Prevents a noisy
  // `connect_error: unauthenticated` on every login-screen visit
  // before the user signs in. Re-runs on every session-status flip
  // (login → connect, signOut → disconnect + tear down).
  if (isServerMode) {
    syncSocketWithSession(useSession.getState().status);
    useSession.subscribe((state, prev) => {
      if (state.status !== prev.status) {
        syncSocketWithSession(state.status);
      }
    });
  }

  createRoot(rootEl!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
