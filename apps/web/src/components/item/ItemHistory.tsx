import type { ReactElement } from 'react';
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useStore } from '@/store';
import { buildStashLabels, shortStashId } from '@/lib/stashLabels';
import type { ItemDefinition, ItemInstance, TransactionLogEntry } from '@app/shared';

interface ItemHistoryProps {
  itemInstanceId: string;
}

/** Stable empty references — fresh `[]` literals would break Zustand's
 * shallow equality and cause an infinite render loop when `appState` is
 * null. */
const EMPTY_ITEMS: readonly ItemInstance[] = [];
const EMPTY_DEFS: readonly ItemDefinition[] = [];

/**
 * Per-item history view (OUTLINE §3.11). Filters `state.log` for entries
 * whose payload references `itemInstanceId`. Five TxTypes currently carry
 * an item id on their payload: `acquire`, `consume`, `edit-item-instance`
 * (M2.5), `transfer` (M3 synthetic + M5 user-initiated), and `split`
 * (M5 — surfaces on both the source row's filter and the new row's
 * filter). Future milestones (R1 equip/attune, R2 recharge / identify)
 * will extend the predicate.
 *
 * Permission gating (owner + DM only per OUTLINE §8) lands in R4/R5 —
 * single-user MVP shows the full slice.
 *
 * `useShallow` on the log filter is mandatory: `.filter()` returns a
 * fresh array every render, and without shallow-equality Zustand would
 * treat each render as a state change and infinite-loop.
 *
 * For `transfer` / `split` summaries we need legible stash labels. Behind
 * the scenes the log carries opaque stash ids (forensic-grade); the UI
 * resolves them via `buildStashLabels`. When the stash has been deleted
 * (the delete-cascade is the very thing that emits these entries), we
 * fall back to a short-uuid prefix so the row is still legible.
 */
type ItemEntry = Extract<
  TransactionLogEntry,
  { type: 'acquire' | 'consume' | 'edit-item-instance' | 'transfer' | 'split' }
>;

function isItemEntry(e: TransactionLogEntry): e is ItemEntry {
  return (
    e.type === 'acquire' ||
    e.type === 'consume' ||
    e.type === 'edit-item-instance' ||
    e.type === 'transfer' ||
    e.type === 'split'
  );
}

/**
 * Predicate over a `split` entry: both its source and new ids count as
 * "this item's history" because the same event lives on both rows.
 */
function entryReferencesItem(e: ItemEntry, itemInstanceId: string): boolean {
  if (e.type === 'split') {
    return (
      e.payload.sourceInstanceId === itemInstanceId ||
      e.payload.newInstanceId === itemInstanceId
    );
  }
  return e.payload.itemInstanceId === itemInstanceId;
}

export function ItemHistory({ itemInstanceId }: ItemHistoryProps): ReactElement {
  const entries = useStore(
    useShallow((s) =>
      s.log.filter(
        (e): e is ItemEntry => isItemEntry(e) && entryReferencesItem(e, itemInstanceId),
      ),
    ),
  );

  // Stash + character lookups for the `transfer` / `split` summarizers.
  // Raw arrays come through `useShallow`; the per-id dictionary is
  // derived in `useMemo` so its identity is stable until the underlying
  // arrays actually change.
  const { stashes, characters, log } = useStore(
    useShallow((s) => ({
      stashes: s.appState?.stashes ?? null,
      characters: s.appState?.characters ?? null,
      log: s.log,
    })),
  );
  const stashLabelById = useMemo<ReadonlyMap<string, string>>(
    () => buildStashLabels(stashes, characters, log),
    [stashes, characters, log],
  );

  // R1.5 — the `transfer` summarizer needs to resolve `toContainerInstanceId`
  // to a human-readable container name (e.g. "Backpack (#1)"). Subscribe to
  // the raw `items` + `catalog` slices and derive the lookup in `useMemo`.
  const items = useStore((s) => s.appState?.items ?? EMPTY_ITEMS);
  const catalog = useStore((s) => s.appState?.catalog ?? EMPTY_DEFS);
  const containerLabelById = useMemo<ReadonlyMap<string, string>>(() => {
    const defsById = new Map(catalog.map((d) => [d.id, d]));
    const out = new Map<string, string>();
    for (const row of items) {
      const def = defsById.get(row.definitionId);
      const baseName = row.customName ?? def?.name ?? 'container';
      const suffix = row.notes !== undefined ? ` (${row.notes})` : '';
      out.set(row.id, `${baseName}${suffix}`);
    }
    return out;
  }, [items, catalog]);

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
            <span>{summarize(e, itemInstanceId, stashLabelById, containerLabelById)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Per-TxType human summary. Stays terse — the timestamp + actorRole are
 * shown beside it so this string is just the "what happened" piece. */
function summarize(
  e: ItemEntry,
  viewingItemId: string,
  stashLabels: ReadonlyMap<string, string>,
  containerLabels: ReadonlyMap<string, string>,
): string {
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
      // R1.5 — `toContainerInstanceId` distinguishes four variants that
      // share the same TxType but mean very different things to a
      // reader. Without this branch every same-stash pack/take-out
      // rendered as the uninformative "Transferred ×1 from X to X".
      //
      //   - same-stash + parent: string  → "Packed ×N into {container} (in {stash})"
      //   - same-stash + parent: null    → "Took ×N out of container (in {stash})"
      //   - cross-stash + parent: null   → existing "from X to Y" + "(removed from container)"
      //   - cross-stash + parent: undef  → existing "from X to Y" (pre-R1.5 phrasing)
      const sameStash = e.payload.fromStashId === e.payload.toStashId;
      const stashLabel =
        stashLabels.get(e.payload.toStashId) ?? shortStashId(e.payload.toStashId);
      if (sameStash && typeof e.payload.toContainerInstanceId === 'string') {
        // The container row may have been deleted between the pack event
        // and the current view; fall back to a generic "container" word
        // so the line stays readable.
        const containerLabel =
          containerLabels.get(e.payload.toContainerInstanceId) ?? 'container';
        return `Packed \u00d7${String(e.payload.quantity)} into ${containerLabel} (in ${stashLabel})`;
      }
      if (sameStash && e.payload.toContainerInstanceId === null) {
        return `Took \u00d7${String(e.payload.quantity)} out of container (in ${stashLabel})`;
      }
      // Cross-stash path: fall through to the legacy phrasing. The
      // orphan-drop case (cross-stash + `toContainerInstanceId: null`)
      // intentionally renders identically to a plain cross-stash move:
      // the parent-clear is structural plumbing, the source/destination
      // stash labels already tell the whole story, and an extra
      // "(removed from container)" suffix makes the line too long to
      // fit one row in the log timeline. The reducer-side orphan-drop
      // still keeps state honest; the log just doesn't shout about it.
      const from =
        stashLabels.get(e.payload.fromStashId) ?? shortStashId(e.payload.fromStashId);
      const to = stashLabel;
      return `Transferred \u00d7${String(e.payload.quantity)} from ${from} to ${to}`;
    }
    case 'split': {
      // The same split entry lives on two rows' histories. Phrase it
      // from the viewing row's perspective so each side reads naturally.
      const isSource = e.payload.sourceInstanceId === viewingItemId;
      return isSource
        ? `Split \u00d7${String(e.payload.quantity)} into a new row`
        : `Split off from another stack (\u00d7${String(e.payload.quantity)})`;
    }
  }
}
