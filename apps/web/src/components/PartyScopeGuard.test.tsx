import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement } from 'react';

import { server, TEST_SERVER_ORIGIN } from '../test/msw';

/**
 * RH4.3 — PartyScopeGuard tests.
 *
 * The guard runs INSIDE PartyScopeSync (which loads state for the URL's
 * partyId). Once state is loaded and state.party.id === urlPartyId, the
 * guard checks memberships. If the current user has no active
 * membership in that party, redirect to /hub.
 */

async function loadModules(serverMode: boolean) {
  vi.stubEnv('VITE_SERVER_URL', serverMode ? TEST_SERVER_ORIGIN : '');
  vi.resetModules();
  const [guardMod, storeMod, queueMod, wipeMod, fixturesMod] = await Promise.all([
    import('./PartyScopeGuard'),
    import('@/store'),
    import('@/sync/queue'),
    import('@/db/wipe'),
    import('@/test/fixtures'),
  ]);
  await wipeMod.wipeAll();
  storeMod.useStore.setState({ appState: null, log: [] });
  queueMod.resetQueue();

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
    server.use(
      http.post(`${TEST_SERVER_ORIGIN}/sync/actions`, () =>
        HttpResponse.json({ applied: [], serverTime: '2026-07-03T00:00:00.000Z' }),
      ),
    );
  }

  return {
    PartyScopeGuard: guardMod.PartyScopeGuard,
    store: storeMod,
    fixtures: fixturesMod,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

function renderWithRoute(
  PartyScopeGuard: () => ReactElement,
  initialEntry: string,
): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/party/:partyId" element={<PartyScopeGuard />}>
          <Route path="settings" element={<div data-testid="child">Party Settings</div>} />
        </Route>
        <Route path="/hub" element={<div data-testid="hub">Hub</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PartyScopeGuard — RH4.3', () => {
  it('server mode: user is a member → renders child', async () => {
    const { PartyScopeGuard, store, fixtures } = await loadModules(true);
    fixtures.bootstrap();
    const partyId = store.useStore.getState().appState!.party.id;

    renderWithRoute(PartyScopeGuard, `/party/${partyId}/settings`);

    await waitFor(() => expect(screen.getByTestId('child')).toBeInTheDocument());
  });

  it('server mode: URL partyId matches state, user has NO membership → redirect to /hub', async () => {
    const { PartyScopeGuard, store, fixtures } = await loadModules(true);
    fixtures.bootstrap();
    const state = store.useStore.getState().appState!;
    // Strip the user's memberships in the current party to simulate
    // "not a member." State's party.id still matches the URL, so
    // PartyScopeGuard's fully-reconciled branch runs.
    store.useStore.setState({
      appState: {
        ...state,
        memberships: state.memberships.filter((m) => m.userId !== state.user.id),
      },
    });
    const partyId = state.party.id;

    renderWithRoute(PartyScopeGuard, `/party/${partyId}/settings`);

    await waitFor(() => expect(screen.getByTestId('hub')).toBeInTheDocument());
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
  });

  it('server mode: mid-reconciliation (state.party.id !== urlPartyId) → renders (defers to PartyScopeSync)', async () => {
    const { PartyScopeGuard, fixtures } = await loadModules(true);
    fixtures.bootstrap();
    // Guard is used in isolation here (no PartyScopeSync wrapping).
    // With state.party.id === "A" but URL partyId === "B", the guard
    // must NOT redirect on its own — it defers to PartyScopeSync
    // (which in the real router runs AROUND the guard and would either
    // reconcile or fail via 403).

    renderWithRoute(PartyScopeGuard, `/party/completely-different-party-id/settings`);

    // Guard renders the Outlet (child) because state is not
    // fully-reconciled. In the real router, PartyScopeSync would
    // suspend on the pull; here we just verify the guard's own
    // behavior in isolation.
    await waitFor(() => expect(screen.getByTestId('child')).toBeInTheDocument());
  });

  it('local mode: any URL partyId renders (guard is a no-op)', async () => {
    const { PartyScopeGuard, store, fixtures } = await loadModules(false);
    fixtures.bootstrap();
    const partyId = store.useStore.getState().appState!.party.id;

    renderWithRoute(PartyScopeGuard, `/party/${partyId}/settings`);

    await waitFor(() => expect(screen.getByTestId('child')).toBeInTheDocument());
  });

  it('server mode: state.appState === null → renders (defers to PartyScopeSync)', async () => {
    const { PartyScopeGuard } = await loadModules(true);
    // No bootstrap — store is empty.

    renderWithRoute(PartyScopeGuard, `/party/some-party/settings`);

    // With no state, PartyScopeSync would trigger a pull; the guard
    // doesn't judge yet. Child renders (guard no-op).
    await waitFor(() => expect(screen.getByTestId('child')).toBeInTheDocument());
  });
});
