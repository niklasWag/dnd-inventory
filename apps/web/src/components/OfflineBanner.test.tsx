import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';

import { OfflineBanner } from './OfflineBanner';
import type { AppState, PartyMembership } from '@app/shared';
import { useStore } from '@/store';

/**
 * R4.4.d — offline banner for multi-member parties per OUTLINE §9.
 *
 * Visibility rules:
 *   - Server mode only. Local mode never shows the banner (no network,
 *     no sync — offline is the normal state).
 *   - `navigator.onLine === false`. Uses the browser's online/offline
 *     events to react to state transitions.
 *   - `memberCount >= 2`. Solo parties work offline indefinitely per
 *     §9; the banner is misleading noise for them.
 *
 * All three predicates must be true simultaneously for the banner to
 * render.
 */

// Mock the serverMode module — `isServerMode` is captured at module
// load time from `import.meta.env`. `bootstrap()` isn't reachable here
// because it dispatches through the store's server-mode enqueue path,
// which requires a configured sync queue. Instead the tests build a
// minimal but fully-typed AppState by hand (no `as any`) — the shape
// is small enough that this is cheaper than wiring the queue.
vi.mock('@/lib/serverMode', () => ({ isServerMode: true }));

function setOnline(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
}

function fireOnlineEvent(): void {
  window.dispatchEvent(new Event('online'));
}

function fireOfflineEvent(): void {
  window.dispatchEvent(new Event('offline'));
}

/** Build a fully-typed AppState with N distinct-userId memberships. */
function makeAppStateFixture(memberCount: number): AppState {
  const memberships: PartyMembership[] = Array.from({ length: memberCount }, (_, i) => ({
    userId: `u${i}`,
    partyId: 'p1',
    role: 'player',
    characterId: null,
    joinedAt: '2026-01-01T00:00:00.000Z',
    leftAt: null,
  }));
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
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    memberships,
    characters: [],
    gameSessions: [],
    stashes: [],
    catalog: [],
    items: [],
    currencies: [],
    log: [],
  };
}

function seedMembers(count: number): void {
  useStore.setState({ appState: makeAppStateFixture(count), log: [] });
}

describe('OfflineBanner (R4.4.d)', () => {
  beforeEach(() => {
    setOnline(true);
    useStore.setState({ appState: null, log: [] });
  });
  afterEach(() => {
    setOnline(true);
  });

  it('renders nothing when online in a multi-member party', () => {
    setOnline(true);
    seedMembers(2);
    render(<OfflineBanner />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the banner when offline in a multi-member party', () => {
    setOnline(false);
    seedMembers(3);
    render(<OfflineBanner />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/offline/i);
  });

  it('renders nothing when offline in a solo party (memberCount === 1)', () => {
    setOnline(false);
    seedMembers(1);
    render(<OfflineBanner />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders nothing when appState is null (no party loaded)', () => {
    setOnline(false);
    render(<OfflineBanner />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('appears when the browser fires the offline event, disappears on online', () => {
    setOnline(true);
    seedMembers(2);
    render(<OfflineBanner />);
    expect(screen.queryByRole('alert')).toBeNull();

    act(() => {
      setOnline(false);
      fireOfflineEvent();
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();

    act(() => {
      setOnline(true);
      fireOnlineEvent();
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
