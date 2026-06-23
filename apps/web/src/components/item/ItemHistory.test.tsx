import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import { ItemHistory } from './ItemHistory';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';

import { makeEntry } from '@/test/fixtures';

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

describe('ItemHistory', () => {
  it('renders the empty state when no entries match', () => {
    useStore.setState({ log: [] });
    render(<ItemHistory itemInstanceId="item-1" />);
    expect(screen.getByText(/no log entries for this item yet/i)).toBeInTheDocument();
  });

  it('renders acquire + consume + edit-item-instance entries in chronological order', () => {
    const t1 = '2026-06-23T10:00:00.000Z';
    const t2 = '2026-06-23T10:01:00.000Z';
    const t3 = '2026-06-23T10:02:00.000Z';
    useStore.setState({
      log: [
        makeEntry(
          'acquire',
          {
            stashId: 'stash-1',
            itemInstanceId: 'item-1',
            definitionId: 'phb-2024:torch',
            quantity: 3,
            source: 'catalog-add',
          },
          { timestamp: t1 },
        ),
        makeEntry(
          'consume',
          {
            stashId: 'stash-1',
            itemInstanceId: 'item-1',
            quantity: 1,
            removed: false,
          },
          { timestamp: t2 },
        ),
        makeEntry(
          'edit-item-instance',
          { itemInstanceId: 'item-1', changedFields: ['notes'] },
          { timestamp: t3 },
        ),
      ],
    });

    render(<ItemHistory itemInstanceId="item-1" />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(within(items[0]!).getByText(/acquired/i)).toBeInTheDocument();
    expect(within(items[1]!).getByText(/consumed/i)).toBeInTheDocument();
    expect(within(items[2]!).getByText(/edited notes/i)).toBeInTheDocument();
  });

  it('summarizes consume with removed=true as "Removed (consumed last N)"', () => {
    useStore.setState({
      log: [
        makeEntry('consume', {
          stashId: 'stash-1',
          itemInstanceId: 'item-1',
          quantity: 2,
          removed: true,
        }),
      ],
    });
    render(<ItemHistory itemInstanceId="item-1" />);
    expect(screen.getByText(/removed \(consumed last 2\)/i)).toBeInTheDocument();
  });

  it('summarizes edit-item-instance with both fields as "Edited customName + notes"', () => {
    useStore.setState({
      log: [
        makeEntry('edit-item-instance', {
          itemInstanceId: 'item-1',
          changedFields: ['customName', 'notes'],
        }),
      ],
    });
    render(<ItemHistory itemInstanceId="item-1" />);
    expect(screen.getByText(/edited customName \+ notes/i)).toBeInTheDocument();
  });

  it('filters out entries belonging to other itemInstanceIds', () => {
    useStore.setState({
      log: [
        makeEntry('acquire', {
          stashId: 'stash-1',
          itemInstanceId: 'item-1',
          definitionId: 'phb-2024:torch',
          quantity: 1,
          source: 'catalog-add',
        }),
        makeEntry('acquire', {
          stashId: 'stash-1',
          itemInstanceId: 'item-2', // different item
          definitionId: 'phb-2024:rope-hempen-50ft',
          quantity: 1,
          source: 'catalog-add',
        }),
      ],
    });

    render(<ItemHistory itemInstanceId="item-1" />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(within(items[0]!).getByText(/source: catalog-add/i)).toBeInTheDocument();
  });

  it('renders a transfer entry summary with stash names from state (M3)', () => {
    // Seed state.stashes so the summary can look up names.
    const fromStashId = 'stash-from';
    const toStashId = 'stash-to';
    useStore.setState({
      appState: {
        version: 1,
        seedVersion: 0,
        user: { id: 'u', displayName: 'You', createdAt: new Date().toISOString() },
        party: {
          id: 'p',
          name: 'P',
          ownerUserId: 'u',
          inviteCode: 'INV-ABCDEF',
          recoveredLootStashId: toStashId,
          bankerUserId: null,
          isSoloShortcut: true,
          createdAt: new Date().toISOString(),
        },
        memberships: [],
        characters: [],
        stashes: [
          {
            id: fromStashId,
            scope: 'character',
            name: 'Chest at home',
            ownerCharacterId: 'c1',
            partyId: null,
            isCarried: false,
            createdAt: new Date().toISOString(),
          },
          {
            id: toStashId,
            scope: 'recovered-loot',
            name: 'Recovered Loot',
            ownerCharacterId: null,
            partyId: 'p',
            isCarried: false,
            createdAt: new Date().toISOString(),
          },
        ],
        catalog: [],
        items: [],
        currencies: [],
        log: [],
      },
      log: [
        makeEntry('transfer', {
          itemInstanceId: 'item-1',
          quantity: 3,
          fromStashId,
          toStashId,
        }),
      ],
    });

    render(<ItemHistory itemInstanceId="item-1" />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(within(items[0]!).getByText(/Transferred ×3 from Chest at home to Recovered Loot/i))
      .toBeInTheDocument();
  });

  it('falls back to a short uuid when the source stash has been deleted (M3)', () => {
    // No stashes in state — the source has been removed (delete-cascade
    // synthesizes the transfer entry, then the stash row goes away).
    useStore.setState({
      log: [
        makeEntry('transfer', {
          itemInstanceId: 'item-1',
          quantity: 2,
          fromStashId: 'abcdef12-0000-0000-0000-000000000000',
          toStashId: 'fedcba98-0000-0000-0000-000000000000',
        }),
      ],
    });

    render(<ItemHistory itemInstanceId="item-1" />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    // Both ids fall back to their first-8 prefix.
    expect(within(items[0]!).getByText(/Transferred ×2 from abcdef12 to fedcba98/i))
      .toBeInTheDocument();
  });
});
