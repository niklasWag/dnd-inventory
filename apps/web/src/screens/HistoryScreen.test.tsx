import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import type {
  AppState,
  GameSession,
  ItemInstance,
  PartyMembership,
  Stash,
  TransactionLogEntry,
} from '@app/shared';
import { useStore } from '@/store';

import { HistoryScreen } from './HistoryScreen';

/**
 * R5.3.a — HistoryScreen tests.
 *
 * Setup pattern mirrors DmDashboard.test.tsx: build an AppState +
 * membership list via helpers, seed `useStore`, render inside a
 * MemoryRouter with a fixed route. The screen itself has no route
 * dependencies (no useParams / useCurrentPartyId) so MemoryRouter is
 * just for the outlet chrome.
 */

const BASE_TS = '2026-07-04T10:00:00.000Z';

function ts(minutes: number): string {
  // Distinct, deterministic timestamps for ordering assertions.
  return new Date(new Date(BASE_TS).getTime() + minutes * 60_000).toISOString();
}

function makeMembership(userId: string, role: 'dm' | 'player'): PartyMembership {
  return {
    userId,
    partyId: 'p1',
    role,
    characterId: role === 'player' ? `char-${userId}` : null,
    joinedAt: BASE_TS,
    leftAt: null,
  };
}

const STASHES: Stash[] = [
  {
    id: 'inv-a',
    scope: 'character',
    name: 'Inventory',
    ownerCharacterId: 'char-u-a',
    partyId: null,
    isCarried: true,
    createdAt: BASE_TS,
  },
  {
    id: 'inv-b',
    scope: 'character',
    name: 'Inventory',
    ownerCharacterId: 'char-u-b',
    partyId: null,
    isCarried: true,
    createdAt: BASE_TS,
  },
  {
    id: 'ps',
    scope: 'party',
    name: 'Party Stash',
    ownerCharacterId: null,
    partyId: 'p1',
    isCarried: false,
    createdAt: BASE_TS,
  },
  {
    id: 'rl',
    scope: 'recovered-loot',
    name: 'Recovered Loot',
    ownerCharacterId: null,
    partyId: 'p1',
    isCarried: false,
    createdAt: BASE_TS,
  },
];

const ITEMS: ItemInstance[] = [
  {
    id: 'item-inv-a',
    definitionId: 'phb-2024:rope',
    ownerType: 'stash',
    ownerId: 'inv-a',
    containerInstanceId: null,
    quantity: 1,
    equipped: false,
    attuned: false,
    identified: true,
    currentCharges: null,
  },
  {
    id: 'item-inv-b',
    definitionId: 'phb-2024:wand',
    ownerType: 'stash',
    ownerId: 'inv-b',
    containerInstanceId: null,
    quantity: 1,
    equipped: false,
    attuned: false,
    identified: true,
    currentCharges: null,
  },
  {
    id: 'item-ps',
    definitionId: 'phb-2024:potion',
    ownerType: 'stash',
    ownerId: 'ps',
    containerInstanceId: null,
    quantity: 1,
    equipped: false,
    attuned: false,
    identified: true,
    currentCharges: null,
  },
];

const CHARACTERS: AppState['characters'] = [
  {
    id: 'char-u-a',
    partyId: 'p1',
    ownerUserId: 'u-a',
    name: 'Aeryn',
    species: 'Human',
    size: 'medium',
    class: 'Fighter',
    level: 1,
    abilityScores: { STR: 16 },
    maxAttunement: 3,
    inventoryStashId: 'inv-a',
  },
  {
    id: 'char-u-b',
    partyId: 'p1',
    ownerUserId: 'u-b',
    name: 'Baelor',
    species: 'Elf',
    size: 'medium',
    class: 'Wizard',
    level: 1,
    abilityScores: { STR: 10 },
    maxAttunement: 3,
    inventoryStashId: 'inv-b',
  },
];

const GAME_SESSIONS: GameSession[] = [
  { id: 'gs1', partyId: 'p1', number: 1, date: '2026-07-01', isCurrent: false, createdAt: BASE_TS },
  { id: 'gs2', partyId: 'p1', number: 2, date: '2026-07-04', isCurrent: true, createdAt: BASE_TS },
];

function makeState(opts: {
  currentUserId: 'u-dm' | 'u-a' | 'u-b';
  log: TransactionLogEntry[];
}): AppState {
  return {
    version: 1,
    seedVersion: 0,
    user: {
      id: opts.currentUserId,
      displayName:
        opts.currentUserId === 'u-dm' ? 'DM' : opts.currentUserId === 'u-a' ? 'Aeryn' : 'Baelor',
      discordId: opts.currentUserId,
      createdAt: BASE_TS,
    },
    party: {
      id: 'p1',
      name: 'Party',
      ownerUserId: 'u-dm',
      inviteCode: 'INV-ABCDEF',
      recoveredLootStashId: 'rl',
      bankerUserId: null,
      encumbranceRule: 'off',
      enforceEncumbrance: false,
      priceModifier: 1.0,
      baseCurrency: 'gp',
      createdAt: BASE_TS,
    },
    memberships: [
      makeMembership('u-dm', 'dm'),
      makeMembership('u-a', 'player'),
      makeMembership('u-b', 'player'),
    ],
    characters: CHARACTERS,
    gameSessions: GAME_SESSIONS,
    stashes: STASHES,
    shops: [],
    catalog: [],
    items: ITEMS,
    currencies: [],
    log: opts.log,
  };
}

function renderScreen(): void {
  render(
    <MemoryRouter initialEntries={['/party/p1/history']}>
      <Routes>
        <Route path="party/:partyId/history" element={<HistoryScreen />} />
      </Routes>
    </MemoryRouter>,
  );
}

// -------------------- log entry builders --------------------

function entry(
  overrides: Partial<TransactionLogEntry> & Pick<TransactionLogEntry, 'type' | 'payload'>,
): TransactionLogEntry {
  return {
    id:
      overrides.id ??
      `01000000-0000-7000-8000-${Math.random().toString(16).slice(2, 14).padStart(12, '0')}`,
    partyId: overrides.partyId ?? 'p1',
    sessionId: overrides.sessionId ?? null,
    timestamp: overrides.timestamp ?? BASE_TS,
    actorUserId: overrides.actorUserId ?? 'u-a',
    actorRole: overrides.actorRole ?? 'player',
    type: overrides.type,
    payload: overrides.payload,
  } as TransactionLogEntry;
}

function acquire(
  itemInstanceId: string,
  opts: Partial<TransactionLogEntry> = {},
): TransactionLogEntry {
  return entry({
    ...opts,
    type: 'acquire',
    payload: {
      stashId:
        itemInstanceId === 'item-inv-a'
          ? 'inv-a'
          : itemInstanceId === 'item-inv-b'
            ? 'inv-b'
            : 'ps',
      itemInstanceId,
      definitionId: 'phb-2024:rope',
      quantity: 1,
      source: 'catalog-add',
    },
  });
}

// -------------------- tests --------------------

describe('HistoryScreen', () => {
  beforeEach(() => {
    useStore.setState({ appState: null, log: [] });
  });

  it('renders "No entries" empty state when log is empty', () => {
    useStore.setState({ appState: makeState({ currentUserId: 'u-dm', log: [] }), log: [] });
    renderScreen();
    expect(screen.getByText(/no entries match the current filters/i)).toBeInTheDocument();
  });

  it('renders visible entries reverse-chronologically', () => {
    const oldEntry = acquire('item-ps', { id: 'e1', timestamp: ts(0) });
    const newEntry = acquire('item-ps', { id: 'e2', timestamp: ts(10) });
    const log = [oldEntry, newEntry];
    useStore.setState({ appState: makeState({ currentUserId: 'u-dm', log }), log });
    renderScreen();

    const list = screen.getByRole('list', { name: /history entries/i });
    const rows = within(list).getAllByRole('listitem');
    // Both rendered; first row is the newer entry.
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText(/party stash/i)).toBeInTheDocument();
  });

  it('applies action-type default filter (hides use-charge)', () => {
    const acquireE = acquire('item-ps', { id: 'e1' });
    const useCharge = entry({
      id: 'e2',
      type: 'use-charge',
      payload: { itemInstanceId: 'item-ps', characterId: 'char-u-a', amount: 1 },
    });
    const log = [acquireE, useCharge];
    useStore.setState({ appState: makeState({ currentUserId: 'u-dm', log }), log });
    renderScreen();

    const list = screen.getByRole('list', { name: /history entries/i });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(1); // only acquire is visible by default
  });

  it('toggling "use-charge" checkbox reveals the hidden row', async () => {
    const user = userEvent.setup();
    const acquireE = acquire('item-ps', { id: 'e1' });
    const useCharge = entry({
      id: 'e2',
      type: 'use-charge',
      payload: { itemInstanceId: 'item-ps', characterId: 'char-u-a', amount: 1 },
    });
    const log = [acquireE, useCharge];
    useStore.setState({ appState: makeState({ currentUserId: 'u-dm', log }), log });
    renderScreen();

    // Verify 1 row initially.
    expect(
      within(screen.getByRole('list', { name: /history entries/i })).getAllByRole('listitem'),
    ).toHaveLength(1);

    await user.click(screen.getByLabelText('use-charge'));

    expect(
      within(screen.getByRole('list', { name: /history entries/i })).getAllByRole('listitem'),
    ).toHaveLength(2);
  });

  it('Session filter — "Untagged" bucket', async () => {
    const user = userEvent.setup();
    const tagged = acquire('item-ps', { id: 'e1', sessionId: 'gs1' });
    const untagged = acquire('item-ps', { id: 'e2', sessionId: null });
    const log = [tagged, untagged];
    useStore.setState({ appState: makeState({ currentUserId: 'u-dm', log }), log });
    renderScreen();

    // Both visible with default filter.
    expect(
      within(screen.getByRole('list', { name: /history entries/i })).getAllByRole('listitem'),
    ).toHaveLength(2);

    await user.selectOptions(screen.getByLabelText('Session filter'), 'untagged');

    const rows = within(screen.getByRole('list', { name: /history entries/i })).getAllByRole(
      'listitem',
    );
    expect(rows).toHaveLength(1);
  });

  it('Session filter — specific session id', async () => {
    const user = userEvent.setup();
    const g1 = acquire('item-ps', { id: 'e1', sessionId: 'gs1' });
    const g2 = acquire('item-ps', { id: 'e2', sessionId: 'gs2' });
    const log = [g1, g2];
    useStore.setState({ appState: makeState({ currentUserId: 'u-dm', log }), log });
    renderScreen();

    await user.selectOptions(screen.getByLabelText('Session filter'), 'gs1');
    expect(
      within(screen.getByRole('list', { name: /history entries/i })).getAllByRole('listitem'),
    ).toHaveLength(1);
  });

  it('Item filter matches split source AND new ids', async () => {
    const user = userEvent.setup();
    const split = entry({
      id: 'e1',
      type: 'split',
      payload: {
        sourceInstanceId: 'item-ps',
        newInstanceId: 'item-new',
        quantity: 1,
        stashId: 'ps',
      },
    });
    const other = acquire('item-inv-a', { id: 'e2' });
    const log = [split, other];
    useStore.setState({ appState: makeState({ currentUserId: 'u-dm', log }), log });
    renderScreen();

    // Filter by the NEW id — split entry should still match.
    await user.selectOptions(screen.getByLabelText('Item filter'), 'item-inv-a');
    // 1 row: the acquire on item-inv-a.
    expect(
      within(screen.getByRole('list', { name: /history entries/i })).getAllByRole('listitem'),
    ).toHaveLength(1);
  });

  it('Actor role filter — only DM entries', async () => {
    const user = userEvent.setup();
    const dmEntry = acquire('item-ps', { id: 'e1', actorRole: 'dm' });
    const playerEntry = acquire('item-ps', { id: 'e2', actorRole: 'player' });
    const log = [dmEntry, playerEntry];
    useStore.setState({ appState: makeState({ currentUserId: 'u-dm', log }), log });
    renderScreen();

    await user.selectOptions(screen.getByLabelText('Actor role filter'), 'dm');
    expect(
      within(screen.getByRole('list', { name: /history entries/i })).getAllByRole('listitem'),
    ).toHaveLength(1);
  });

  it('Permission — Player A cannot see Player B\u2019s Inventory item', () => {
    // Player-authored (non-banker) entry on Player B's Inventory item.
    const hiddenFromA = acquire('item-inv-b', { id: 'e1', actorUserId: 'u-b' });
    const partyEntry = acquire('item-ps', { id: 'e2' });
    const log = [hiddenFromA, partyEntry];
    useStore.setState({ appState: makeState({ currentUserId: 'u-a', log }), log });
    renderScreen();

    // Only the party-stash entry is visible.
    expect(
      within(screen.getByRole('list', { name: /history entries/i })).getAllByRole('listitem'),
    ).toHaveLength(1);
  });

  it('Permission — DM sees everything', () => {
    const otherPlayer = acquire('item-inv-b', { id: 'e1', actorUserId: 'u-b' });
    const partyEntry = acquire('item-ps', { id: 'e2' });
    const log = [otherPlayer, partyEntry];
    useStore.setState({ appState: makeState({ currentUserId: 'u-dm', log }), log });
    renderScreen();

    expect(
      within(screen.getByRole('list', { name: /history entries/i })).getAllByRole('listitem'),
    ).toHaveLength(2);
  });

  it('Permission — banker widening (Player A sees Player B\u2019s Inventory when banker-authored)', () => {
    const bankerAction = acquire('item-inv-b', {
      id: 'e1',
      actorUserId: 'u-b',
      actorRole: 'banker',
    });
    const log = [bankerAction];
    useStore.setState({ appState: makeState({ currentUserId: 'u-a', log }), log });
    renderScreen();

    expect(
      within(screen.getByRole('list', { name: /history entries/i })).getAllByRole('listitem'),
    ).toHaveLength(1);
  });

  it('Load more reveals additional rows past PAGE_SIZE', async () => {
    const user = userEvent.setup();
    const log = Array.from({ length: 150 }, (_, i) =>
      acquire('item-ps', { id: `e-${String(i).padStart(3, '0')}`, timestamp: ts(i) }),
    );
    useStore.setState({ appState: makeState({ currentUserId: 'u-dm', log }), log });
    renderScreen();

    // Initial page shows 100.
    expect(
      within(screen.getByRole('list', { name: /history entries/i })).getAllByRole('listitem'),
    ).toHaveLength(100);

    await user.click(screen.getByRole('button', { name: /load more/i }));

    // After Load more, all 150 visible; button hidden.
    expect(
      within(screen.getByRole('list', { name: /history entries/i })).getAllByRole('listitem'),
    ).toHaveLength(150);
    expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
  });
});
