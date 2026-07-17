import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TEST_SERVER_ORIGIN } from '../test/msw';
import { wipeAll } from '@/db/wipe';
import { saveAppState } from '@/db/save';
import type * as HubModule from './Hub';
import type * as StoreModule from '@/store';

async function loadHub(serverMode: boolean): Promise<{
  Hub: typeof HubModule.Hub;
  useStore: typeof StoreModule.useStore;
}> {
  vi.stubEnv('VITE_SERVER_URL', serverMode ? TEST_SERVER_ORIGIN : '');
  vi.resetModules();
  const mod = await import('./Hub.js');
  const store = await import('@/store');
  return { Hub: mod.Hub, useStore: store.useStore };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('Hub — local mode invariants', () => {
  it('renders the action cards', async () => {
    await wipeAll();
    const { Hub, useStore } = await loadHub(false);
    useStore.setState({ appState: null, log: [] });
    render(
      <MemoryRouter initialEntries={['/hub']}>
        <Routes>
          <Route path="hub" element={<Hub />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: /^Solo/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Create party/i })).toBeInTheDocument();
  });

  it('disables the Join party card in local mode (R4.1.e server-mode-only)', async () => {
    await wipeAll();
    const { Hub, useStore } = await loadHub(false);
    useStore.setState({ appState: null, log: [] });
    render(
      <MemoryRouter initialEntries={['/hub']}>
        <Routes>
          <Route path="hub" element={<Hub />} />
        </Routes>
      </MemoryRouter>,
    );
    const joinButton = screen.getByRole('button', { name: /Join party/i });
    expect(joinButton).toBeDisabled();
  });

  it('does not show login or logout chrome', async () => {
    await wipeAll();
    const { Hub, useStore } = await loadHub(false);
    useStore.setState({ appState: null, log: [] });
    render(
      <MemoryRouter initialEntries={['/hub']}>
        <Routes>
          <Route path="hub" element={<Hub />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/logout/i)).not.toBeInTheDocument();
  });
});

describe('Hub — per-party stats (R10.3)', () => {
  it('shows item quantity + gp-equivalent computed from the local blob', async () => {
    await wipeAll();
    // Seed a keyed AppState blob with two item stacks (quantities 3 + 2 = 5)
    // and currency totalling 1234 cp = 12.34 gp across two stashes.
    await saveAppState(
      {
        appState: {
          party: { id: 'p-local-1', name: 'Riverside Rats' },
          items: [{ quantity: 3 }, { quantity: 2 }],
          currencies: [
            { cp: 0, sp: 0, ep: 0, gp: 12, pp: 0 }, // 1200 cp
            { cp: 34, sp: 0, ep: 0, gp: 0, pp: 0 }, //   34 cp
          ],
        },
        log: [],
      },
      'p-local-1',
    );

    const { Hub, useStore } = await loadHub(false);
    useStore.setState({ appState: null, log: [] });
    render(
      <MemoryRouter initialEntries={['/hub']}>
        <Routes>
          <Route path="hub" element={<Hub />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Riverside Rats')).toBeInTheDocument();
    expect(await screen.findByText('5 items')).toBeInTheDocument();
    expect(await screen.findByText('12.34 gp')).toBeInTheDocument();
  });

  it('shows 0 items / 0 gp for an empty party', async () => {
    await wipeAll();
    await saveAppState(
      {
        appState: {
          party: { id: 'p-local-2', name: 'Empty Coffers' },
          items: [],
          currencies: [],
        },
        log: [],
      },
      'p-local-2',
    );

    const { Hub, useStore } = await loadHub(false);
    useStore.setState({ appState: null, log: [] });
    render(
      <MemoryRouter initialEntries={['/hub']}>
        <Routes>
          <Route path="hub" element={<Hub />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Empty Coffers')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('0 items')).toBeInTheDocument());
    expect(screen.getByText('0 gp')).toBeInTheDocument();
  });
});
