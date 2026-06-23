import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import { ItemHistory } from './ItemHistory';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';
import { transactionLogEntrySchema, type TransactionLogEntry } from '@app/shared';

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

/**
 * Build a minimal valid log entry with sensible defaults. We parse through
 * `transactionLogEntrySchema` so the fixture is provably a real entry —
 * this also keeps us inside the CLAUDE.md "no `any`, validate at boundaries"
 * rule (the entry is constructed as `unknown`, then Zod parses it back).
 */
function makeEntry<T extends TransactionLogEntry['type']>(
  type: T,
  payload: Extract<TransactionLogEntry, { type: T }>['payload'],
  overrides: Partial<Pick<TransactionLogEntry, 'id' | 'timestamp' | 'actorRole'>> = {},
): TransactionLogEntry {
  const candidate: unknown = {
    id: overrides.id ?? crypto.randomUUID(),
    partyId: 'party-fixture',
    sessionId: null,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    actorUserId: 'user-fixture',
    actorRole: overrides.actorRole ?? 'player',
    type,
    payload,
  };
  return transactionLogEntrySchema.parse(candidate);
}

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
});
