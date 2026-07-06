import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { RootLayout } from './Layout';
import type { AppState, GameSession } from '@app/shared';
import { useStore } from '@/store';

/**
 * R5.2 — Layout hosts a current-session indicator (§3.12) that surfaces
 * on every party-scoped screen. The badge appears iff:
 *   - We're inside `/party/:partyId/*` (partyId resolved via
 *     `useCurrentPartyIdOrNull`), AND
 *   - `state.appState.gameSessions` contains a row with `isCurrent: true`.
 *
 * These tests exercise the visibility rules only. Full navigation
 * behaviour and role-gated nav buttons are covered elsewhere.
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

function renderInParty(url: string): void {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route element={<RootLayout />}>
          <Route path="/party/:partyId/dm" element={<div>content</div>} />
          <Route path="/hub" element={<div>hub</div>} />
          <Route path="/" element={<div>root</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('RootLayout — current session indicator (R5.2)', () => {
  beforeEach(() => {
    useStore.setState({ appState: null, log: [] });
  });

  it('renders the badge when a session is current AND we are on a party route', () => {
    useStore.setState({ appState: makeState([makeSession({ number: 12 })]), log: [] });
    renderInParty('/party/p1/dm');
    expect(screen.getByLabelText(/session 12 in progress/i)).toBeInTheDocument();
    expect(screen.getByText(/session 12/i)).toBeInTheDocument();
  });

  it('hides the badge when gameSessions is empty', () => {
    useStore.setState({ appState: makeState([]), log: [] });
    renderInParty('/party/p1/dm');
    expect(screen.queryByLabelText(/session .* in progress/i)).toBeNull();
  });

  it('hides the badge when no session is current (all past)', () => {
    useStore.setState({
      appState: makeState([makeSession({ isCurrent: false })]),
      log: [],
    });
    renderInParty('/party/p1/dm');
    expect(screen.queryByLabelText(/session .* in progress/i)).toBeNull();
  });

  it('hides the badge outside the party subtree (e.g. /hub, /)', () => {
    useStore.setState({ appState: makeState([makeSession()]), log: [] });
    renderInParty('/hub');
    expect(screen.queryByLabelText(/session .* in progress/i)).toBeNull();
  });

  it('hides the badge when appState is null (no party loaded)', () => {
    renderInParty('/party/p1/dm');
    expect(screen.queryByLabelText(/session .* in progress/i)).toBeNull();
  });
});

describe('RootLayout — History nav button (R5.3.a)', () => {
  beforeEach(() => {
    useStore.setState({ appState: null, log: [] });
  });

  it('renders the History button in the party subtree', () => {
    useStore.setState({ appState: makeState([]), log: [] });
    renderInParty('/party/p1/dm');
    expect(screen.getByRole('button', { name: /^history$/i })).toBeInTheDocument();
  });

  it('hides the History button outside the party subtree', () => {
    useStore.setState({ appState: makeState([]), log: [] });
    renderInParty('/hub');
    expect(screen.queryByRole('button', { name: /^history$/i })).toBeNull();
  });

  it('hides the History button when appState is null (no party loaded)', () => {
    renderInParty('/party/p1/dm');
    expect(screen.queryByRole('button', { name: /^history$/i })).toBeNull();
  });
});
