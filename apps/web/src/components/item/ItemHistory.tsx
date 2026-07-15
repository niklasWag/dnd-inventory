import type { ReactElement } from 'react';
import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ArrowLeftRight, Eye, ShieldCheck } from 'lucide-react';

import { useStore } from '@/store';
import { buildStashLabels, shortStashId } from '@/lib/stashLabels';
import { RoleBadge } from '@/components/RoleBadge';
import { canSeeLogEntry } from '@app/shared';
import type { ItemDefinition, ItemInstance, TransactionLogEntry } from '@app/shared';

/**
 * R9.4 — the "History" heading with its leading shield icon. Shared by
 * both the empty-state branch and the populated branch so the two render
 * identically.
 */
function HistoryHeading(): ReactElement {
  return (
    <h2 className="flex items-center gap-1.5 font-display text-sm font-semibold uppercase tracking-wide">
      <ShieldCheck className="h-4 w-4 text-muted-foreground" /> History
    </h2>
  );
}

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
 * whose payload references `itemInstanceId`. The TxType set that carries
 * an item id has grown across milestones:
 *   - M2:  acquire, consume
 *   - M2.5: edit-item-instance
 *   - M3:  transfer (synthetic delete-cascade)
 *   - M5:  transfer (user-initiated), split
 *   - R1.2: equip, unequip, attune, unattune
 *   - R2.2: use-charge, recharge
 *   - R2.3: identify
 *
 * R2.3 — OUTLINE §3.11 default filter shows the "ownership transition"
 * entries (events that change *who holds the item* or *what it is*) and
 * hides the noisier `use-charge` / `recharge` / `edit-item-instance`
 * rows behind a "Show all events" toggle. Component-state toggle —
 * resets per mount, which is the right ergonomic default for "I'm
 * inspecting one item right now."
 *
 * Permission gating (R5.3.b) per OUTLINE §3.4 amendment: for items
 * currently in a character's Inventory or Storage, per-item history is
 * visible only to the owner + DM; for items in Party Stash or
 * Recovered Loot every party member sees the full history. Banker-
 * authored entries widen visibility to all party members regardless of
 * where the item currently lives. The gate lives in `canSeeLogEntry`
 * in `@app/shared`; a footer surfaces how many entries were hidden by
 * permission so viewers know the log isn't exhaustive.
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
  {
    type:
      | 'acquire'
      | 'consume'
      | 'edit-item-instance'
      | 'transfer'
      | 'split'
      | 'equip'
      | 'unequip'
      | 'attune'
      | 'unattune'
      | 'use-charge'
      | 'recharge'
      | 'identify';
  }
>;

/**
 * OUTLINE §3.11 default-filter TxTypes — "what changes who holds it /
 * what it is". The remaining ItemEntry types (`use-charge`, `recharge`,
 * `edit-item-instance`) are hidden until the user toggles "Show all
 * events". `purchase` / `sale` aren't implemented yet (R5) but the spec
 * lists them — when added they slot into this set.
 */
const DEFAULT_FILTER_TYPES: ReadonlySet<ItemEntry['type']> = new Set<ItemEntry['type']>([
  'acquire',
  'consume',
  'transfer',
  'split',
  'equip',
  'unequip',
  'attune',
  'unattune',
  'identify',
]);

function isItemEntry(e: TransactionLogEntry): e is ItemEntry {
  return (
    e.type === 'acquire' ||
    e.type === 'consume' ||
    e.type === 'edit-item-instance' ||
    e.type === 'transfer' ||
    e.type === 'split' ||
    e.type === 'equip' ||
    e.type === 'unequip' ||
    e.type === 'attune' ||
    e.type === 'unattune' ||
    e.type === 'use-charge' ||
    e.type === 'recharge' ||
    e.type === 'identify'
  );
}

/**
 * Predicate over a `split` entry: both its source and new ids count as
 * "this item's history" because the same event lives on both rows.
 */
function entryReferencesItem(e: ItemEntry, itemInstanceId: string): boolean {
  if (e.type === 'split') {
    return (
      e.payload.sourceInstanceId === itemInstanceId || e.payload.newInstanceId === itemInstanceId
    );
  }
  return e.payload.itemInstanceId === itemInstanceId;
}

export function ItemHistory({ itemInstanceId }: ItemHistoryProps): ReactElement {
  // R2.3 — component-local toggle. Default `false` matches OUTLINE §3.11
  // "ownership-transition filter". Resets per mount; R5 may lift to
  // Zustand if cross-navigation persistence becomes a real need.
  const [showAll, setShowAll] = useState(false);

  // R5.3.b — permission gate needs the full AppState for stash/character
  // ownership lookups. `useShallow` on the reference (`appState`) is
  // fine because `canSeeLogEntry` reads properties without mutating.
  const appState = useStore((s) => s.appState);

  const allEntries = useStore(
    useShallow((s) =>
      s.log.filter((e): e is ItemEntry => isItemEntry(e) && entryReferencesItem(e, itemInstanceId)),
    ),
  );

  // R5.3.b — apply the §3.4 permission gate BEFORE the show-all toggle
  // so `hiddenByPermission` reflects the audit-invisible slice
  // regardless of the user's own toggle state.
  const permittedEntries = useMemo(() => {
    if (appState === null) return allEntries;
    const currentUserId = appState.user.id;
    const isDm = appState.memberships.some(
      (m) => m.userId === currentUserId && m.role === 'dm' && m.leftAt === null,
    );
    const ctx = { currentUserId, isDm, state: appState };
    return allEntries.filter((e) => canSeeLogEntry(e, ctx));
  }, [allEntries, appState]);
  const permissionHiddenCount = allEntries.length - permittedEntries.length;

  const visibleEntries = useMemo(
    () =>
      showAll ? permittedEntries : permittedEntries.filter((e) => DEFAULT_FILTER_TYPES.has(e.type)),
    [permittedEntries, showAll],
  );
  const hiddenCount = permittedEntries.length - visibleEntries.length;

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

  if (permittedEntries.length === 0) {
    return (
      <section className="space-y-2">
        <HistoryHeading />
        {permissionHiddenCount > 0 ? (
          <p className="text-sm text-muted-foreground">
            {permissionHiddenCount} entr{permissionHiddenCount === 1 ? 'y is' : 'ies are'} hidden by
            permission.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">No log entries for this item yet.</p>
        )}
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <HistoryHeading />
        {/*
         * The show-all / ownership-only toggle renders only when it would
         * actually change what's shown — i.e. the default ownership-only
         * filter is hiding non-transition events (`hiddenCount > 0`), or the
         * user has already expanded (`showAll`) and needs a way back. For an
         * item whose events are all ownership-transitions the two views are
         * identical, so the toggle is suppressed (nothing to collapse).
         */}
        {hiddenCount > 0 || showAll ? (
          <button
            type="button"
            onClick={() => {
              setShowAll((v) => !v);
            }}
            aria-pressed={showAll}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition hover:text-foreground"
          >
            {showAll ? <Eye className="h-3 w-3" /> : <ArrowLeftRight className="h-3 w-3" />}
            {showAll
              ? 'Ownership only'
              : `Show all events${hiddenCount > 0 ? ` (+${String(hiddenCount)})` : ''}`}
          </button>
        ) : null}
      </div>
      {visibleEntries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No ownership-transition events for this item yet — toggle "Show all events" to see{' '}
          {hiddenCount} hidden entr{hiddenCount === 1 ? 'y' : 'ies'}.
        </p>
      ) : (
        <ul className="space-y-1 text-sm" role="list">
          {visibleEntries.map((e) => (
            <li
              key={e.id}
              className="flex items-baseline gap-3 border-b border-border/50 py-1 last:border-0"
            >
              <span className="font-mono text-xs text-muted-foreground">
                {new Date(e.timestamp).toLocaleString()}
              </span>
              <RoleBadge role={e.actorRole} />
              <span>{summarize(e, itemInstanceId, stashLabelById, containerLabelById)}</span>
            </li>
          ))}
        </ul>
      )}
      {permissionHiddenCount > 0 ? (
        <p className="text-xs italic text-muted-foreground">
          {permissionHiddenCount} entr{permissionHiddenCount === 1 ? 'y' : 'ies'} hidden by
          permission.
        </p>
      ) : null}
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
      const stashLabel = stashLabels.get(e.payload.toStashId) ?? shortStashId(e.payload.toStashId);
      if (sameStash && typeof e.payload.toContainerInstanceId === 'string') {
        // The container row may have been deleted between the pack event
        // and the current view; fall back to a generic "container" word
        // so the line stays readable.
        const containerLabel = containerLabels.get(e.payload.toContainerInstanceId) ?? 'container';
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
      const from = stashLabels.get(e.payload.fromStashId) ?? shortStashId(e.payload.fromStashId);
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
    case 'equip':
      return 'Equipped';
    case 'unequip':
      return 'Unequipped';
    case 'attune':
      return 'Attuned';
    case 'unattune':
      return 'Unattuned';
    case 'use-charge':
      return `Used \u00d7${String(e.payload.amount)} charge${e.payload.amount === 1 ? '' : 's'}`;
    case 'recharge': {
      const delta = e.payload.to - e.payload.from;
      const triggerLabel =
        e.payload.trigger === 'manual' ? 'manual' : e.payload.trigger.replace('-', ' ');
      return `Recharged +${String(delta)} (${String(e.payload.from)} \u2192 ${String(e.payload.to)}, ${triggerLabel})`;
    }
    case 'identify': {
      const { previousIdentified, newIdentified, previousHint, newHint } = e.payload;
      if (previousIdentified !== newIdentified) {
        // Identification flip is the headline; mention the hint only if it
        // also changed in the same dispatch.
        const base = newIdentified ? 'Identified' : 'Marked unidentified';
        if (previousHint !== newHint) {
          if (newHint !== undefined && newHint.length > 0) {
            return `${base} (hint: "${newHint}")`;
          }
          return `${base} (hint cleared)`;
        }
        return base;
      }
      // Hint-only change (identified unchanged).
      if (newHint === undefined) return 'Cleared unidentified hint';
      if (previousHint === undefined) return `Set unidentified hint to "${newHint}"`;
      return `Updated unidentified hint to "${newHint}"`;
    }
  }
}
