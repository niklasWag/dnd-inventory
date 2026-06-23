import type { ReactElement } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useStore } from '@/store';
import type { TransactionLogEntry } from '@app/shared';

interface ItemHistoryProps {
  itemInstanceId: string;
}

/**
 * Per-item history view (OUTLINE §3.11). Filters `state.log` for entries
 * whose payload references `itemInstanceId`. Currently three TxTypes carry
 * an `itemInstanceId` on their payload: `acquire`, `consume`, and
 * `edit-item-instance` (M2.5). Future milestones (R1 equip/attune, R2
 * recharge / identify, R5 transfer) will extend the predicate.
 *
 * Permission gating (owner + DM only per OUTLINE §8) lands in R4/R5 —
 * single-user MVP shows the full slice.
 *
 * `useShallow` is mandatory here: `.filter()` returns a fresh array every
 * render, and without shallow-equality Zustand would treat each render as a
 * state change and infinite-loop (same pattern as `CatalogBrowser` /
 * `StashItemsTable`).
 */
type ItemEntry = Extract<
  TransactionLogEntry,
  { type: 'acquire' | 'consume' | 'edit-item-instance' }
>;

function isItemEntry(e: TransactionLogEntry): e is ItemEntry {
  return e.type === 'acquire' || e.type === 'consume' || e.type === 'edit-item-instance';
}

export function ItemHistory({ itemInstanceId }: ItemHistoryProps): ReactElement {
  const entries = useStore(
    useShallow((s) =>
      s.log.filter(
        (e): e is ItemEntry => isItemEntry(e) && e.payload.itemInstanceId === itemInstanceId,
      ),
    ),
  );

  if (entries.length === 0) {
    return (
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          History
        </h2>
        <p className="text-sm text-muted-foreground">No log entries for this item yet.</p>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        History
      </h2>
      <ul className="space-y-1 text-sm" role="list">
        {entries.map((e) => (
          <li
            key={e.id}
            className="flex items-baseline gap-3 border-b border-border/50 py-1 last:border-0"
          >
            <span className="font-mono text-xs text-muted-foreground">
              {new Date(e.timestamp).toLocaleString()}
            </span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs uppercase text-muted-foreground">
              {e.actorRole}
            </span>
            <span>{summarize(e)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Per-TxType human summary. Stays terse — the timestamp + actorRole are
 * shown beside it so this string is just the "what happened" piece. */
function summarize(e: ItemEntry): string {
  switch (e.type) {
    case 'acquire':
      return `Acquired \u00d7${String(e.payload.quantity)} (source: ${e.payload.source})`;
    case 'consume':
      return e.payload.removed
        ? `Removed (consumed last ${String(e.payload.quantity)})`
        : `Consumed \u00d7${String(e.payload.quantity)}`;
    case 'edit-item-instance':
      return `Edited ${e.payload.changedFields.join(' + ')}`;
  }
}
