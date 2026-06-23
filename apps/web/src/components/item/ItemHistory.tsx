import type { ReactElement } from 'react';
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useStore } from '@/store';
import type { TransactionLogEntry } from '@app/shared';

interface ItemHistoryProps {
  itemInstanceId: string;
}

/**
 * Per-item history view (OUTLINE §3.11). Filters `state.log` for entries
 * whose payload references `itemInstanceId`. Four TxTypes currently carry
 * an `itemInstanceId` on their payload: `acquire`, `consume`,
 * `edit-item-instance` (M2.5), and `transfer` (M3 — synthetic via the
 * `delete-stash` cascade, then user-initiated in M5). Future milestones
 * (R1 equip/attune, R2 recharge / identify) will extend the predicate.
 *
 * Permission gating (owner + DM only per OUTLINE §8) lands in R4/R5 —
 * single-user MVP shows the full slice.
 *
 * `useShallow` on the log filter is mandatory: `.filter()` returns a
 * fresh array every render, and without shallow-equality Zustand would
 * treat each render as a state change and infinite-loop.
 *
 * For `transfer` summaries we need to look up stash names — but the
 * source stash may have been deleted (delete-cascade is the very thing
 * that emits these entries). The lookup map is derived from
 * `state.stashes` via `useShallow` + `useMemo` so a missing stash falls
 * back to a short-uuid prefix.
 */
type ItemEntry = Extract<
  TransactionLogEntry,
  { type: 'acquire' | 'consume' | 'edit-item-instance' | 'transfer' }
>;

function isItemEntry(e: TransactionLogEntry): e is ItemEntry {
  return (
    e.type === 'acquire' ||
    e.type === 'consume' ||
    e.type === 'edit-item-instance' ||
    e.type === 'transfer'
  );
}

export function ItemHistory({ itemInstanceId }: ItemHistoryProps): ReactElement {
  const entries = useStore(
    useShallow((s) =>
      s.log.filter(
        (e): e is ItemEntry => isItemEntry(e) && e.payload.itemInstanceId === itemInstanceId,
      ),
    ),
  );

  // Stash-name lookup. `useShallow` on the underlying array; the
  // dictionary is derived in `useMemo` so the object identity is stable
  // until `stashes` actually changes.
  const stashes = useStore(useShallow((s) => s.appState?.stashes ?? null));
  const stashNameById = useMemo<ReadonlyMap<string, string>>(() => {
    const map = new Map<string, string>();
    if (stashes !== null) for (const st of stashes) map.set(st.id, st.name);
    return map;
  }, [stashes]);

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
            <span>{summarize(e, stashNameById)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Per-TxType human summary. Stays terse — the timestamp + actorRole are
 * shown beside it so this string is just the "what happened" piece. */
function summarize(e: ItemEntry, stashNames: ReadonlyMap<string, string>): string {
  switch (e.type) {
    case 'acquire':
      return `Acquired \u00d7${String(e.payload.quantity)} (source: ${e.payload.source})`;
    case 'consume':
      return e.payload.removed
        ? `Removed (consumed last ${String(e.payload.quantity)})`
        : `Consumed \u00d7${String(e.payload.quantity)}`;
    case 'edit-item-instance':
      return `Edited ${e.payload.changedFields.join(' + ')}`;
    case 'transfer': {
      // Source stash may have been deleted (delete-cascade synthesizes
      // these). Fall back to a short-uuid prefix so the row is still
      // legible — the full id stays in the log for forensic use.
      const from = stashNames.get(e.payload.fromStashId) ?? shortId(e.payload.fromStashId);
      const to = stashNames.get(e.payload.toStashId) ?? shortId(e.payload.toStashId);
      return `Transferred \u00d7${String(e.payload.quantity)} from ${from} to ${to}`;
    }
  }
}

function shortId(id: string): string {
  return id.slice(0, 8);
}
