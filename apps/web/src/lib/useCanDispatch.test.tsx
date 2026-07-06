import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';

import type { AppState, PartyMembership } from '@app/shared';

import { useCanDispatch } from './useCanDispatch';
import { useStore } from '@/store';

vi.mock('@/lib/serverMode', () => ({ isServerMode: true }));

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
      encumbranceRule: 'off',
      enforceEncumbrance: false,
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

function Probe(): ReactElement {
  const canDispatch = useCanDispatch();
  return <span data-testid="probe">{canDispatch ? 'yes' : 'no'}</span>;
}

beforeEach(() => {
  useStore.setState({ appState: null, log: [], online: true });
});
afterEach(() => {
  useStore.setState({ appState: null, log: [], online: true });
});

describe('R5.1.d — useCanDispatch (reactive)', () => {
  it('yields true when the store is online in a multi-member party', () => {
    useStore.setState({ appState: makeAppStateFixture(3), online: true });
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('yes');
  });

  it('yields false when the store is offline in a multi-member party', () => {
    useStore.setState({ appState: makeAppStateFixture(3), online: false });
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('no');
  });

  it('yields true when the store is offline in a solo party (memberCount === 1)', () => {
    useStore.setState({ appState: makeAppStateFixture(1), online: false });
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('yes');
  });

  it('re-renders when connectivity flips', () => {
    useStore.setState({ appState: makeAppStateFixture(2), online: true });
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('yes');

    act(() => {
      useStore.setState({ online: false });
    });
    expect(screen.getByTestId('probe').textContent).toBe('no');

    act(() => {
      useStore.setState({ online: true });
    });
    expect(screen.getByTestId('probe').textContent).toBe('yes');
  });
});
