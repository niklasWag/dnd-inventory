import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TEST_SERVER_ORIGIN } from '../test/msw';
import { wipeAll } from '@/db/wipe';
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
