import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';

import { OfflineBanner } from './OfflineBanner';
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

// Mock the serverMode module — its `isServerMode` is captured at
// module-load time from `import.meta.env`, so tests must vi.mock() to
// flip between local and server mode. Each `describe` block sets the
// mock once via `vi.doMock` before importing the component.
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

function seedMembers(count: number): void {
  // Fresh AppState fixture with N distinct-userId memberships.
  // The store's `appState.memberships` is what OfflineBanner reads
  // for the memberCount derivation.
  const memberships = Array.from({ length: count }, (_, i) => ({
    userId: `u${i}`,
    partyId: 'p1',
    role: 'player' as const,
    characterId: null,
    joinedAt: '2026-01-01T00:00:00.000Z',
    leftAt: null,
  }));
  useStore.setState({
    appState: {
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
        archivedAt: null,
      },
      memberships,
      characters: [],
      stashes: [],
      catalog: [],
      items: [],
      currencies: [],
      log: [],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    log: [],
  });
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
