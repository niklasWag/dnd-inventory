import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { RootLayout } from './Layout';
import type { AppState, GameSession } from '@app/shared';
import { useStore } from '@/store';
import { useSidebarStore } from '@/store/sidebar';

/**
 * R9.2 — RootLayout is now a two-shape shell:
 *   - inside a party (`/party/:partyId/*` + AppState loaded) → the grouped
 *     `Sidebar` frames the routed content;
 *   - outside a party (`/hub`, `/settings`, auth) → chrome-light, no sidebar.
 *
 * The nav items themselves (Character Sheet / History / Shops / …) are
 * covered by `nav/Sidebar.test.tsx`. These tests assert the shell's
 * shape decisions + the current-session badge visibility.
 */

function makeSession(overrides: Partial<GameSession> = {}): GameSession {
  return {
    id: 'gs-1',
    partyId: 'p1',
    number: 3,
    date: '2026-03-05',
    isCurrent: true,
    createdAt: '2026-03-05T18:00:00.000Z',
    ...overrides,
  };
}

function makeState(gameSessions: GameSession[]): AppState {
  return {
    version: 1,
    seedVersion: 0,
    user: {
      id: 'u0',
      displayName: 'Tester',
      discordId: 'discord-tester',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    party: {
      id: 'p1',
      name: 'Party',
      ownerUserId: 'u0',
      inviteCode: 'inv-test',
      recoveredLootStashId: 's-rl',
      bankerUserId: null,
      encumbranceRule: 'off',
      enforceEncumbrance: false,
      priceModifier: 1.0,
      baseCurrency: 'gp',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    memberships: [
      {
        userId: 'u0',
        partyId: 'p1',
        role: 'player',
        characterId: null,
        joinedAt: '2026-01-01T00:00:00.000Z',
        leftAt: null,
      },
    ],
    characters: [],
    gameSessions,
    stashes: [],
    shops: [],
    catalog: [],
    items: [],
    currencies: [],
    log: [],
  };
}

function renderAt(url: string): void {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route element={<RootLayout />}>
          <Route path="/party/:partyId/dm" element={<div>content</div>} />
          <Route path="/hub" element={<div>hub</div>} />
          <Route path="/settings" element={<div>settings</div>} />
          <Route path="/" element={<div>root</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useStore.setState({ appState: null, log: [] });
  useSidebarStore.setState({ collapsed: false, hydrated: true });
});

describe('RootLayout — shell shape', () => {
  it('renders the party sidebar inside the party subtree', () => {
    useStore.setState({ appState: makeState([]), log: [] });
    renderAt('/party/p1/dm');
    expect(screen.getByRole('navigation', { name: /party navigation/i })).toBeInTheDocument();
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('does NOT render the sidebar on /hub (unscoped)', () => {
    useStore.setState({ appState: makeState([]), log: [] });
    renderAt('/hub');
    expect(screen.queryByRole('navigation', { name: /party navigation/i })).toBeNull();
    expect(screen.getByText('hub')).toBeInTheDocument();
  });

  it('does NOT render the sidebar on /settings (unscoped)', () => {
    useStore.setState({ appState: makeState([]), log: [] });
    renderAt('/settings');
    expect(screen.queryByRole('navigation', { name: /party navigation/i })).toBeNull();
    expect(screen.getByText('settings')).toBeInTheDocument();
  });

  it('does NOT render the sidebar when appState is null (no party loaded)', () => {
    renderAt('/party/p1/dm');
    expect(screen.queryByRole('navigation', { name: /party navigation/i })).toBeNull();
  });
});

describe('RootLayout — current session badge (R5.2)', () => {
  it('renders the badge when a session is current AND we are inside a party', () => {
    useStore.setState({ appState: makeState([makeSession({ number: 12 })]), log: [] });
    renderAt('/party/p1/dm');
    // Two placements (mobile top bar + desktop strip) both carry the aria-label.
    expect(screen.getAllByLabelText(/session 12 in progress/i).length).toBeGreaterThan(0);
  });

  it('hides the badge when gameSessions is empty', () => {
    useStore.setState({ appState: makeState([]), log: [] });
    renderAt('/party/p1/dm');
    expect(screen.queryByLabelText(/session .* in progress/i)).toBeNull();
  });

  it('hides the badge when no session is current (all past)', () => {
    useStore.setState({ appState: makeState([makeSession({ isCurrent: false })]), log: [] });
    renderAt('/party/p1/dm');
    expect(screen.queryByLabelText(/session .* in progress/i)).toBeNull();
  });

  it('hides the badge outside the party subtree (e.g. /hub)', () => {
    useStore.setState({ appState: makeState([makeSession()]), log: [] });
    renderAt('/hub');
    expect(screen.queryByLabelText(/session .* in progress/i)).toBeNull();
  });
});
