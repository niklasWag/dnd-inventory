import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement } from 'react';

import { server, TEST_SERVER_ORIGIN } from '../test/msw';

/**
 * RH4.1 — PartyScopeSync guard tests.
 *
 * The guard reconciles URL `:partyId` against `state.appState.party.id`:
 *   - match → render child Outlet.
 *   - mismatch → trigger a pull (server mode) or load (local mode).
 *   - failure → redirect to /hub.
 *
 * These tests use `vi.resetModules()` + `vi.stubEnv` to toggle server
 * mode (matches the RH2.6 log-authority test pattern).
 */

async function loadModules(serverMode: boolean) {
  vi.stubEnv('VITE_SERVER_URL', serverMode ? TEST_SERVER_ORIGIN : '');
  vi.resetModules();
  const [guardMod, storeMod, queueMod, wipeMod, fixturesMod] = await Promise.all([
    import('./PartyScopeSync'),
    import('@/store'),
    import('@/sync/queue'),
    import('@/db/wipe'),
    import('@/test/fixtures'),
  ]);
  await wipeMod.wipeAll();
  storeMod.useStore.setState({ appState: null, log: [] });
  queueMod.resetQueue();

  // Server mode: wire queue deps (bootstrap dispatch pushes to queue).
  if (serverMode) {
    queueMod.configureQueue({
      getSnapshot: () => {
        const s = storeMod.useStore.getState();
        return { appState: s.appState, log: s.log };
      },
      restoreSnapshot: (snap) => storeMod.useStore.getState().restoreSnapshot(snap),
      appendServerLogEntries: (applied) =>
        storeMod.useStore.getState().appendServerLogEntries(applied),
    });
    // Default: echo empty applied[] on any POST /sync/actions.
    server.use(
      http.post(`${TEST_SERVER_ORIGIN}/sync/actions`, () =>
        HttpResponse.json({ applied: [], serverTime: '2026-07-03T00:00:00.000Z' }),
      ),
    );
  }

  return {
    PartyScopeSync: guardMod.PartyScopeSync,
    store: storeMod,
    fixtures: fixturesMod,
    flush: storeMod.flushPendingPersist,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

function renderWithRoute(
  PartyScopeSync: () => ReactElement,
  initialEntry: string,
): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/party/:partyId" element={<PartyScopeSync />}>
          <Route path="settings" element={<div data-testid="child">Party Settings</div>} />
        </Route>
        <Route path="/hub" element={<div data-testid="hub">Hub</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PartyScopeSync — RH4.1', () => {
  it('URL partyId matches state → renders child immediately', async () => {
    const { PartyScopeSync, store, fixtures } = await loadModules(false);
    fixtures.bootstrap();
    const partyId = store.useStore.getState().appState!.party.id;

    renderWithRoute(PartyScopeSync, `/party/${partyId}/settings`);

    // Match on first render — no loading state.
    await waitFor(() => expect(screen.getByTestId('child')).toBeInTheDocument());
  });

  it('local mode: URL partyId mismatched with state → loads correct blob before rendering', async () => {
    const { PartyScopeSync, store, fixtures, flush } = await loadModules(false);
    fixtures.bootstrap();
    const snapshot = store.useStore.getState();
    const partyId = snapshot.appState!.party.id;
    // Force-save the blob synchronously so the guard's loadAppState
    // finds it. The debounced saver is racy under a Router mount +
    // React effects; a direct save closes the door on flake.
    const { saveAppState } = await import('@/db/save');
    await saveAppState({ appState: snapshot.appState, log: snapshot.log }, partyId);
    // Additionally flush any pending debounce for completeness.
    await flush();

    // Simulate stale in-memory state: pretend the store has a different
    // party. Dexie still holds the correct partyId's blob.
    store.useStore.setState({
      appState: {
        ...snapshot.appState!,
        party: { ...snapshot.appState!.party, id: 'stale-partyId' },
      },
    });

    renderWithRoute(PartyScopeSync, `/party/${partyId}/settings`);

    // Guard reconciles via loadAppState and swaps the store back to the
    // correct party.
    await waitFor(() => expect(screen.getByTestId('child')).toBeInTheDocument());
    expect(store.useStore.getState().appState!.party.id).toBe(partyId);
  });

  it('local mode: unknown partyId → redirect to /hub', async () => {
    const { PartyScopeSync } = await loadModules(false);

    renderWithRoute(PartyScopeSync, `/party/nonexistent-party/settings`);

    await waitFor(() => expect(screen.getByTestId('hub')).toBeInTheDocument());
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
  });

  it('server mode: URL partyId mismatched → pulls state and hydrates', async () => {
    const { PartyScopeSync, store, fixtures } = await loadModules(true);
    const { newUuidV7 } = await import('@app/shared');
    // Bootstrap a local baseline so the reducer has valid state to
    // shape the pulled response after.
    fixtures.bootstrap();
    const seededState = store.useStore.getState().appState!;
    const otherPartyId = newUuidV7();

    // MSW handler: return a canonical AppState for the other party.
    server.use(
      http.get(`${TEST_SERVER_ORIGIN}/sync/state`, ({ request }) => {
        const url = new URL(request.url);
        const queried = url.searchParams.get('partyId');
        if (queried !== otherPartyId) {
          return HttpResponse.json({ error: 'unexpected partyId' }, { status: 500 });
        }
        return HttpResponse.json({
          state: {
            ...seededState,
            party: { ...seededState.party, id: otherPartyId, name: 'Other Party' },
            log: [],
          },
          serverTime: '2026-07-03T00:00:00.000Z',
        });
      }),
    );

    renderWithRoute(PartyScopeSync, `/party/${otherPartyId}/settings`);

    await waitFor(() => expect(screen.getByTestId('child')).toBeInTheDocument());
    expect(store.useStore.getState().appState!.party.id).toBe(otherPartyId);
    expect(store.useStore.getState().appState!.party.name).toBe('Other Party');
  });
});
