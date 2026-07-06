import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppState, PartyMembership } from '@app/shared';

import { useStore } from '@/store';
import { configureQueue, resetQueue } from '@/sync/queue';

/**
 * R5.1.d — store `dispatch()` correctness backstop.
 *
 * `useCanDispatch` disables Save buttons for user affordance, but a
 * programmatic `useStore.getState().dispatch(...)` from anywhere in
 * the app (screens, tests, effects) MUST also be blocked when the
 * multi-member-offline condition holds. This is the store-level
 * short-circuit.
 *
 * The tests here mock `sonner` so we can assert the toast fires
 * without actually rendering a toaster. `configureQueue` is called
 * with a no-op stub so the successful-dispatch paths don't throw at
 * `queue.enqueue`.
 */

vi.mock('@/lib/serverMode', () => ({ isServerMode: true }));
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { toast } from 'sonner';

beforeAll(() => {
  configureQueue({
    getSnapshot: () => ({
      appState: useStore.getState().appState,
      log: useStore.getState().log,
    }),
    restoreSnapshot: (snap) => {
      useStore.getState().restoreSnapshot(snap);
    },
    // No-op: this test file doesn't drive the actual sync path.
    appendServerLogEntries: () => {},
  });
});

function makeAppState(memberCount: number): AppState {
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
      priceModifier: 1.0,
      baseCurrency: 'gp',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    memberships,
    characters: [],
    gameSessions: [],
    stashes: [],
    shops: [],
    catalog: [],
    items: [],
    currencies: [],
    log: [],
  };
}

beforeEach(() => {
  useStore.setState({ appState: null, log: [], online: true });
  vi.mocked(toast.error).mockClear();
});
afterEach(() => {
  useStore.setState({ appState: null, log: [], online: true });
  resetQueue();
});

describe('R5.1.d — store.dispatch write-block backstop', () => {
  it('blocks dispatch + toasts when server-mode + offline + multi-member', () => {
    useStore.setState({ appState: makeAppState(3), online: false });
    const preLogLen = useStore.getState().log.length;
    const preAppState = useStore.getState().appState;

    // Any mutation — even a `rename-party` which normally succeeds.
    useStore.getState().dispatch({
      type: 'rename-party',
      payload: { partyId: 'p1', newName: 'Renamed' },
    });

    // State + log unchanged (block was in effect).
    expect(useStore.getState().appState).toBe(preAppState);
    expect(useStore.getState().log).toHaveLength(preLogLen);
    expect(toast.error).toHaveBeenCalledWith('Offline — changes are disabled until you reconnect.');
  });

  it('allows dispatch when the party is solo (memberCount === 1) even while offline', () => {
    useStore.setState({ appState: makeAppState(1), online: false });

    // `rename-party` reducer requires the payload's partyId to match
    // state.party.id; matches for this fixture.
    useStore.getState().dispatch({
      type: 'rename-party',
      payload: { partyId: 'p1', newName: 'Renamed-Solo' },
    });

    // Dispatch went through — state's party name flipped, log grew.
    expect(useStore.getState().appState!.party.name).toBe('Renamed-Solo');
    expect(toast.error).not.toHaveBeenCalledWith(
      'Offline — changes are disabled until you reconnect.',
    );
  });

  it('allows dispatch when online in a multi-member party', () => {
    useStore.setState({ appState: makeAppState(3), online: true });

    useStore.getState().dispatch({
      type: 'rename-party',
      payload: { partyId: 'p1', newName: 'Renamed-Online' },
    });

    expect(useStore.getState().appState!.party.name).toBe('Renamed-Online');
    expect(toast.error).not.toHaveBeenCalledWith(
      'Offline — changes are disabled until you reconnect.',
    );
  });

  it('allows `seed-catalog` even while blocked (it is a local-only bootstrap seed)', () => {
    useStore.setState({ appState: makeAppState(3), online: false });

    // seed-catalog is a system action, not user-initiated. It populates
    // the local catalog mirror and never hits the server.
    useStore.getState().dispatch({
      type: 'seed-catalog',
      payload: { seedVersion: 1, entries: [] },
    });

    // No block toast fired.
    expect(toast.error).not.toHaveBeenCalledWith(
      'Offline — changes are disabled until you reconnect.',
    );
  });
});
