import { type ReactElement, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';

import { useCurrentPartyId } from '@/lib/useCurrentPartyId';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreHorizontal } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useStore, dispatchMintingAction } from '@/store';
import type { Action } from '@/store/types';
import type { ItemDefinition } from '@app/shared';
import { attunement, searchCatalog } from '@app/rules';
import { rarityPillClass, rarityLabel } from '@/lib/rarity';
import { formatChargesShort } from '@/lib/charges';
import { displayName as computeDisplayName } from '@/lib/identify';
import { stashRowSearchable } from '@/lib/stashSearch';
import { isCurrentUserDmOrSolo } from '@/lib/currentUserRole';
import { MoveItemModal } from './MoveItemModal';
import { PackItemModal } from './PackItemModal';
import { SplitModal } from './SplitModal';

/** Stable empty-catalog reference — fresh `[]` literals would break Zustand
 * reference equality and cause an infinite render loop when `appState` is
 * null (see CatalogBrowser for the long version). */
const EMPTY_CATALOG: readonly ItemDefinition[] = [];

interface StashItemsTableProps {
  stashId: string;
  /**
   * R1.2 — when provided AND the row lives in this character's
   * Inventory (i.e. `stashId === character.inventoryStashId`), render
   * Equip / Attune toggle buttons. Omitted for Party Stash / Recovered
   * Loot / Storage tabs (those scopes ignore the flags per OUTLINE §4).
   */
  characterId?: string;
  /**
   * R7.5 — free-text query. When present and non-empty, rows are
   * filtered by `searchCatalog` (the same fuzzy ranker the Catalog
   * Browser uses) applied to a Searchable adapter that respects the
   * OUTLINE §8 identify invariant (unidentified rows are only findable
   * by hint text, not by their real name). Rows are surfaced in ranked
   * order; container/child pairs are decoupled so a matching child
   * whose parent doesn't match still shows (hoisted to depth 0).
   *
   * When the prop is `undefined` or an all-whitespace string, this is
   * a no-op — the table renders every row in its normal
   * parent-then-children order.
   */
  query?: string;
  /**
   * R9.3 — optional category filter (exact `ItemDefinition.category`
   * match). `undefined` / `'All'` is a no-op. Composes (AND) with
   * `query` + `stateFilter`. Used by the Character Sheet inventory
   * toolbar; the shared table stays scope-agnostic.
   */
  categoryFilter?: string;
  /**
   * R9.3 — optional per-row state quick-filter. `'all'` / `undefined`
   * is a no-op. `equipped` / `attuned` match the row flags; `unidentified`
   * matches `identified === false`. Composes (AND) with the others.
   */
  stateFilter?: 'all' | 'equipped' | 'attuned' | 'unidentified';
}

/**
 * Renders one row per `ItemInstance` in `stashId`. Reusable across the
 * Inventory / Party Stash / Recovered Loot tabs (M2) and Storage detail
 * (M3).
 *
 * Per-row actions:
 *   - **−** / **+**: dispatch `consume` / `acquire` against the auto-stack
 *     key `(definitionId, notes ?? "")`. The `+` re-dispatches via
 *     `acquire` rather than mutating the row directly so the log captures
 *     the increment.
 *   - **Split** (M5): open the SplitModal. Disabled when `quantity < 2`
 *     (`validateSplit` would reject anyway, but the button signals
 *     un-splittability up front).
 *   - **Move** (M5): open the MoveItemModal.
 *   - **Remove**: drop the row by consuming its full quantity. The
 *     reducer logs `removed: true` so the history view gets a clean
 *     "row gone" entry.
 *
 * Modal state lives at the table level: one MoveItemModal + one SplitModal
 * are mounted and re-targeted by the row that opened them (mirrors the way
 * `CharacterSheet` mounts `AddItemModal` once per tab). The active
 * `itemInstanceId` is stored in component state.
 */
export function StashItemsTable({
  stashId,
  characterId,
  query,
  categoryFilter,
  stateFilter,
}: StashItemsTableProps): ReactElement {
  const navigate = useNavigate();
  const partyId = useCurrentPartyId();
  const allItems = useStore(
    useShallow((s) =>
      s.appState === null ? [] : s.appState.items.filter((i) => i.ownerId === stashId),
    ),
  );
  // Catalog lookup map. Recomputed when the catalog identity changes — and
  // since `seed-catalog` rebuilds the array, it'll re-render correctly.
  const catalog = useStore((s) => s.appState?.catalog ?? EMPTY_CATALOG);
  const catalogById = useMemo(() => new Map(catalog.map((d) => [d.id, d])), [catalog]);
  const dispatch = useStore((s) => s.dispatch);

  // R9.3 — category + per-row state quick-filters (Character Sheet toolbar).
  // Applied upstream of the fuzzy search + container/child layout so the
  // rest of the pipeline is unchanged. Both no-op when unset / 'All' / 'all'.
  const items = useMemo(() => {
    const cat = categoryFilter !== undefined && categoryFilter !== 'All' ? categoryFilter : null;
    const st = stateFilter !== undefined && stateFilter !== 'all' ? stateFilter : null;
    if (cat === null && st === null) return allItems;
    return allItems.filter((row) => {
      if (cat !== null && (catalogById.get(row.definitionId)?.category ?? '') !== cat) return false;
      if (st === 'equipped' && !row.equipped) return false;
      if (st === 'attuned' && !row.attuned) return false;
      if (st === 'unidentified' && row.identified) return false;
      return true;
    });
  }, [allItems, catalogById, categoryFilter, stateFilter]);

  // R1.2 — surface the attunement cap state to the row buttons so the
  // Attune toggle can pre-disable when full (rather than letting the
  // reducer-rejection throw bubble to the console). Subscribed via
  // `useShallow` so the returned object is shallow-compared (fresh
  // literals would otherwise trigger an infinite re-render loop). The
  // Inventory-tab render path (characterId provided) is the only
  // consumer; non-Inventory tabs get `null`.
  const attunementState = useStore(
    useShallow((s) => {
      if (characterId === undefined || s.appState === null) return null;
      const character = s.appState.characters.find((c) => c.id === characterId);
      if (character === undefined) return null;
      let attunedCount = 0;
      for (const it of s.appState.items) {
        if (it.ownerId === character.inventoryStashId && it.attuned) attunedCount += 1;
      }
      return {
        hasFreeSlot: attunement.hasFreeSlot(attunedCount, character.maxAttunement),
        attunedCount,
        maxAttunement: character.maxAttunement,
      };
    }),
  );

  // R4.5 — DM cap-override eligibility. When the current user is a DM
  // (or solo per §8.2 union-of-rights) AND the target character's slots
  // are full, the Attune button routes through a confirm dialog rather
  // than being pre-disabled. Confirming dispatches `attune` with
  // `overrideCap: true` per OUTLINE §3.8 amendment.
  const userIsDmOrSolo = useStore(useShallow((s) => isCurrentUserDmOrSolo(s.appState)));

  /**
   * R7.5 — fuzzy filter. Empty / all-whitespace query keeps every row
   * (`null` sentinel). Non-empty query builds a set of row ids the
   * fuzzy ranker matched; downstream `displayRows` construction reads
   * this set to decide inclusion. Recomputed only when items, catalog,
   * or query change.
   */
  const normalizedQuery = (query ?? '').trim();
  const matchedRowIds = useMemo<ReadonlySet<string> | null>(() => {
    if (normalizedQuery === '') return null;
    const searchables = items.map((row) =>
      stashRowSearchable(row, catalogById.get(row.definitionId)),
    );
    const hits = searchCatalog(normalizedQuery, searchables);
    return new Set(hits.map((h) => h.item.id));
  }, [items, catalogById, normalizedQuery]);
  const filterActive = matchedRowIds !== null;

  // Modal state — one of each mounted at the table level; `activeItemId`
  // tells the modal which row to operate on.
  const [moveOpen, setMoveOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [packOpen, setPackOpen] = useState(false);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  // R4.5 — attune cap-override dialog state. Holds the target item id
  // when the DM confirms bypassing the slot cap; null when idle.
  const [capOverrideItemId, setCapOverrideItemId] = useState<string | null>(null);

  if (items.length === 0) {
    // R9.3 — distinguish a truly-empty stash from one filtered to empty by
    // the category / state quick-filters (the mockup's "no matches" state).
    if (allItems.length > 0) {
      return <p className="p-4 text-sm text-muted-foreground">No items match your filters.</p>;
    }
    return (
      <p className="p-4 text-sm text-muted-foreground">
        Nothing here yet. Add items from the catalog.
      </p>
    );
  }

  // R1.5 — does this stash hold at least one top-level container row?
  // (`containerInstanceId === null` filter excludes nested containers,
  // which the reducer would reject as pack targets anyway.) Pack button
  // visibility hangs on this flag — hiding it when no containers exist
  // is cheaper UX than letting the empty-modal experience confuse users.
  const hasTopLevelContainer = items.some((row) => {
    if (row.containerInstanceId !== null) return false;
    const def = catalogById.get(row.definitionId);
    return def?.category === 'container';
  });

  // R1.5 — count children (by SUMMED quantity, not row count) per
  // container row. Used to render the "Backpack — 3 items inside"
  // summary on container rows. Computed once per render; cheap because
  // we're already iterating the same item list in displayRows.
  const childCountByParent = new Map<string, number>();
  for (const row of items) {
    if (row.containerInstanceId === null) continue;
    childCountByParent.set(
      row.containerInstanceId,
      (childCountByParent.get(row.containerInstanceId) ?? 0) + row.quantity,
    );
  }

  /**
   * R1.3 — one-level container view: arrange `items` so that each
   * container's children (rows with `containerInstanceId === parent.id`)
   * render directly under their parent. The visual nesting is a single
   * level deep per OUTLINE §3.6. Items whose `containerInstanceId`
   * references a row in a DIFFERENT stash are rendered as top-level
   * here (defensive — shouldn't happen in practice, but the cascade
   * across §3.4 keeps the (parent, child) pair in the same stash).
   *
   * R7.5 — when a fuzzy filter is active, drop rows that didn't match.
   * A matching child of a filtered-out parent gets hoisted to depth 0
   * so the search result is visible even though its container isn't.
   */
  const displayRows: { row: (typeof items)[number]; depth: 0 | 1 }[] = (() => {
    const includeAll = matchedRowIds === null;
    const isMatch = (id: string): boolean => includeAll || matchedRowIds.has(id);

    const byParent = new Map<string, (typeof items)[number][]>();
    const stashIds = new Set(items.map((i) => i.id));
    const tops: (typeof items)[number][] = [];
    for (const row of items) {
      if (row.containerInstanceId !== null && stashIds.has(row.containerInstanceId)) {
        const arr = byParent.get(row.containerInstanceId) ?? [];
        arr.push(row);
        byParent.set(row.containerInstanceId, arr);
      } else {
        tops.push(row);
      }
    }
    const out: { row: (typeof items)[number]; depth: 0 | 1 }[] = [];
    const emittedIds = new Set<string>();
    for (const parent of tops) {
      const children = byParent.get(parent.id) ?? [];
      if (isMatch(parent.id)) {
        out.push({ row: parent, depth: 0 });
        emittedIds.add(parent.id);
        for (const child of children) {
          if (isMatch(child.id)) {
            out.push({ row: child, depth: 1 });
            emittedIds.add(child.id);
          }
        }
      } else if (!includeAll) {
        // Parent filtered out — but any matching child is still shown,
        // hoisted to depth 0 so it doesn't visually dangle.
        for (const child of children) {
          if (isMatch(child.id) && !emittedIds.has(child.id)) {
            out.push({ row: child, depth: 0 });
            emittedIds.add(child.id);
          }
        }
      }
    }
    return out;
  })();

  if (filterActive && displayRows.length === 0) {
    return <p className="text-sm text-muted-foreground">No items match your search.</p>;
  }

  /**
   * Wraps a `dispatch` call so reducer rejections surface as a toast
   * instead of a console error (R1.2 follow-up). The reducer's "throw on
   * rejection" contract stays — silent fallback would violate the
   * CLAUDE.md "every dispatch logs exactly once" invariant — but the
   * direct one-click toggles in this table aren't wrapped by a modal's
   * try/catch the way the M3/M5 dispatch sites are, so we need a local
   * boundary.
   */
  function dispatchOrToast(action: Action, fallback: string): void {
    try {
      void dispatch(action);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : fallback);
    }
  }

  /**
   * RH1.2 variant of `dispatchOrToast` for the 6 minting actions —
   * routes through `dispatchMintingAction` so the helper mints the
   * `new<EntityName>Id` fields client-side. Same toast-on-reject
   * boundary as the non-minting sibling above.
   */
  function dispatchMintingOrToast(
    action: Parameters<typeof dispatchMintingAction>[0],
    fallback: string,
  ): void {
    try {
      void dispatchMintingAction(action);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : fallback);
    }
  }

  return (
    <>
      <table className="w-full text-left text-sm">
        <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Name</th>
            <th className="px-3 py-2 font-medium">Category</th>
            <th className="px-3 py-2 font-medium">State</th>
            <th className="px-3 py-2 text-center font-medium">Qty</th>
            <th className="px-3 py-2 text-right font-medium">Wt</th>
            <th className="px-3 py-2 text-center font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {displayRows.map(({ row, depth }) => {
            const def = catalogById.get(row.definitionId);
            const isIdentified = row.identified;
            // R2.3 — display gate per OUTLINE §8: unidentified rows render
            // as "Unknown Magic Item". Helper centralises the rule + also
            // hides `customName` (spoiler protection — a nickname can
            // reveal magic-item-ness).
            const displayName = computeDisplayName(row, def);
            const canSplit = row.quantity >= 2;
            // R1.5 — row classification for Pack / Take out buttons + the
            // "N items inside" container summary.
            const isContainer = def?.category === 'container';
            // A row is "contained" only when its `containerInstanceId`
            // resolves to a parent IN THIS STASH. Mirrors `displayRows`'
            // defensive filter (parent might live elsewhere after a
            // cross-stash Move — the reducer's R1.5 orphan-drop normally
            // clears the reference, but partial states like JSON imports
            // could still trip this; belt-and-braces).
            const parentInStash =
              row.containerInstanceId !== null &&
              items.some((p) => p.id === row.containerInstanceId);
            const isContained = parentInStash;
            const childCount = childCountByParent.get(row.id) ?? 0;
            // Pack button: visible only on free, top-level, non-container
            // rows in a stash that has at least one container. Containers
            // themselves don't get the button (no container-in-container
            // by OUTLINE §3.6). Already-contained rows don't get it
            // either (the user can take out first, or use Move).
            const canPack = hasTopLevelContainer && !isContainer && !isContained;
            return (
              <tr key={row.id} className="transition-colors hover:bg-surface-2/60">
                <td className={`px-3 py-2${depth === 1 ? ' pl-8' : ''}`}>
                  {depth === 1 ? (
                    <span aria-hidden="true" className="mr-2 text-muted-foreground">
                      ↳
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      void navigate(`/party/${partyId}/item/${row.id}`);
                    }}
                    className={`text-left font-medium underline-offset-2 hover:underline focus:outline-none focus-visible:underline${
                      isIdentified ? '' : ' italic text-muted-foreground'
                    }`}
                    aria-label={`Open details for ${displayName}`}
                  >
                    {!isIdentified ? (
                      <span
                        aria-label="Unidentified"
                        title={row.hint ?? 'Unidentified'}
                        className="mr-2 inline-block w-3 align-middle text-center text-xs font-semibold text-muted-foreground"
                      >
                        ?
                      </span>
                    ) : null}
                    {displayName}
                  </button>
                  {isIdentified && def?.rarity != null && def.rarity !== 'common' ? (
                    <Badge
                      variant="outline"
                      aria-label={`Rarity: ${rarityLabel(def.rarity)}`}
                      title={rarityLabel(def.rarity)}
                      className={`ml-2 align-middle ${rarityPillClass(def.rarity)}`}
                    >
                      {rarityLabel(def.rarity)}
                    </Badge>
                  ) : null}
                  {isContainer && childCount > 0 ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      — {childCount} {childCount === 1 ? 'item' : 'items'} inside
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 capitalize text-muted-foreground">
                  {def?.category ?? '—'}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {row.equipped ? (
                      <Badge variant="secondary" className="text-[10px]">
                        Equipped
                      </Badge>
                    ) : null}
                    {row.attuned ? (
                      <Badge variant="secondary" className="text-[10px]">
                        Attuned
                      </Badge>
                    ) : null}
                    {isIdentified && def?.charges !== undefined && row.currentCharges !== null ? (
                      <Badge
                        variant="outline"
                        className="text-[10px] tabular-nums"
                        aria-label={`Charges: ${formatChargesShort(row.currentCharges, def.charges.max)}`}
                      >
                        {formatChargesShort(row.currentCharges, def.charges.max)}
                      </Badge>
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-2 text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    <button
                      type="button"
                      aria-label={`Decrease ${displayName}`}
                      onClick={() => {
                        void dispatch({
                          type: 'consume',
                          payload: { itemInstanceId: row.id, quantity: 1 },
                        });
                      }}
                      className="grid h-5 w-5 place-items-center rounded text-xs text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
                    >
                      −
                    </button>
                    <span className="min-w-[2ch] text-center tabular-nums">{row.quantity}</span>
                    <button
                      type="button"
                      aria-label={`Increase ${displayName}`}
                      onClick={() => {
                        // Re-dispatch via `acquire` rather than mutating the
                        // row directly so the log captures the increment.
                        // Wrapped via `dispatchMintingOrToast` because R1.4
                        // hard-mode encumbrance can reject this dispatch (and
                        // uncaught reducer throws would surface as a console
                        // error instead of user-visible feedback).
                        dispatchMintingOrToast(
                          {
                            type: 'acquire',
                            payload: {
                              stashId,
                              definitionId: row.definitionId,
                              quantity: 1,
                              source: 'catalog-add',
                              ...(row.notes !== undefined ? { notes: row.notes } : {}),
                            },
                          },
                          'Could not add item',
                        );
                      }}
                      className="grid h-5 w-5 place-items-center rounded text-xs text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
                    >
                      +
                    </button>
                  </div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {def?.weight !== undefined ? (def.weight * row.quantity).toFixed(1) : '—'}
                </td>
                <td className="px-3 py-2 text-center">
                  {/*
                   * R9.3 — the per-row actions (Split, Equip/Attune toggles +
                   * DM cap-override, Pack, Take out, Move, Remove) collapse
                   * into one kebab DropdownMenu to keep the table clean (matches
                   * the character.png mockup) while preserving every action +
                   * its handler + disabled logic + aria-label. The Equip /
                   * Attune items are dynamic-label toggles that render with an
                   * accent tint when the flag is ON (mirrors the old filled
                   * button's active state).
                   */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Actions for ${displayName}`}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        disabled={!canSplit}
                        aria-label={`Split ${displayName}`}
                        onSelect={() => {
                          setActiveItemId(row.id);
                          setSplitOpen(true);
                        }}
                      >
                        Split
                      </DropdownMenuItem>
                      {characterId !== undefined ? (
                        <>
                          <DropdownMenuItem
                            aria-label={`${row.equipped ? 'Unequip' : 'Equip'} ${displayName}`}
                            className={row.equipped ? 'text-primary focus:text-primary' : ''}
                            onSelect={() => {
                              // BUG-008 — `equip` mints `newItemInstanceId` via
                              // `dispatchMintingAction` so the reducer can
                              // auto-split a stacked row (quantity > 1) into a
                              // fresh quantity-1 row before flipping
                              // `equipped: true`. Ignored when quantity is 1.
                              if (row.equipped) {
                                dispatchOrToast(
                                  {
                                    type: 'unequip',
                                    payload: { characterId, itemInstanceId: row.id },
                                  },
                                  'Could not unequip',
                                );
                              } else {
                                dispatchMintingOrToast(
                                  {
                                    type: 'equip',
                                    payload: { characterId, itemInstanceId: row.id },
                                  },
                                  'Could not equip',
                                );
                              }
                            }}
                          >
                            {row.equipped ? 'Unequip' : 'Equip'}
                          </DropdownMenuItem>
                          {/*
                           * R2.1 — hide the Attune toggle entirely on rows whose
                           * definition has `requiresAttunement !== true` (the
                           * reducer rejects it anyway; hiding is cleaner UX than
                           * disabling). `row.attuned === true` keeps Unattune
                           * visible for legacy/cleanup state.
                           */}
                          {def?.requiresAttunement === true || row.attuned ? (
                            <DropdownMenuItem
                              // Pre-disable the "Attune" direction when slots are
                              // full — cheaper UX than a reject toast. Unattune
                              // stays enabled. R4.5 — DM/solo skip the disable
                              // and route through the cap-override confirm dialog.
                              disabled={
                                !row.attuned &&
                                attunementState !== null &&
                                !attunementState.hasFreeSlot &&
                                !userIsDmOrSolo
                              }
                              className={row.attuned ? 'text-primary focus:text-primary' : ''}
                              aria-label={`${row.attuned ? 'Unattune' : 'Attune'} ${displayName}`}
                              onSelect={() => {
                                // R4.5 — DM cap-override branch: open the confirm
                                // dialog instead of dispatching directly.
                                if (
                                  !row.attuned &&
                                  attunementState !== null &&
                                  !attunementState.hasFreeSlot &&
                                  userIsDmOrSolo
                                ) {
                                  setCapOverrideItemId(row.id);
                                  return;
                                }
                                // BUG-008 — `attune` mints `newItemInstanceId` so
                                // the reducer can auto-split a stacked row before
                                // attuning. Ignored when quantity is 1.
                                if (row.attuned) {
                                  dispatchOrToast(
                                    {
                                      type: 'unattune',
                                      payload: { characterId, itemInstanceId: row.id },
                                    },
                                    'Could not unattune',
                                  );
                                } else {
                                  dispatchMintingOrToast(
                                    {
                                      type: 'attune',
                                      payload: { characterId, itemInstanceId: row.id },
                                    },
                                    'Could not attune',
                                  );
                                }
                              }}
                            >
                              {row.attuned ? 'Unattune' : 'Attune'}
                            </DropdownMenuItem>
                          ) : null}
                        </>
                      ) : null}
                      {canPack ? (
                        <DropdownMenuItem
                          aria-label={`Pack ${displayName} into a container`}
                          onSelect={() => {
                            setActiveItemId(row.id);
                            setPackOpen(true);
                          }}
                        >
                          Pack
                        </DropdownMenuItem>
                      ) : null}
                      {isContained ? (
                        <DropdownMenuItem
                          aria-label={`Take ${displayName} out of its container`}
                          onSelect={() => {
                            // R1.5 — direct dispatch (no modal): same-stash
                            // transfer with `toContainerInstanceId: null` unsets
                            // the container parent.
                            dispatchMintingOrToast(
                              {
                                type: 'transfer',
                                payload: {
                                  itemInstanceId: row.id,
                                  toStashId: row.ownerId,
                                  quantity: row.quantity,
                                  toContainerInstanceId: null,
                                },
                              },
                              'Could not take item out',
                            );
                          }}
                        >
                          Take out
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem
                        aria-label={`Move ${displayName}`}
                        onSelect={() => {
                          setActiveItemId(row.id);
                          setMoveOpen(true);
                        }}
                      >
                        Move
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        aria-label={`Remove ${displayName}`}
                        className="text-destructive focus:text-destructive"
                        onSelect={() => {
                          void dispatch({
                            type: 'consume',
                            payload: { itemInstanceId: row.id, quantity: row.quantity },
                          });
                        }}
                      >
                        Remove
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {activeItemId !== null ? (
        <>
          <MoveItemModal
            open={moveOpen}
            onOpenChange={(next) => {
              setMoveOpen(next);
              if (!next) setActiveItemId(null);
            }}
            itemInstanceId={activeItemId}
          />
          <SplitModal
            open={splitOpen}
            onOpenChange={(next) => {
              setSplitOpen(next);
              if (!next) setActiveItemId(null);
            }}
            itemInstanceId={activeItemId}
          />
          <PackItemModal
            open={packOpen}
            onOpenChange={(next) => {
              setPackOpen(next);
              if (!next) setActiveItemId(null);
            }}
            itemInstanceId={activeItemId}
          />
        </>
      ) : null}

      {/* R4.5 — Attune cap-override confirm dialog. Only reachable by
       * DM (or solo) users. Confirms bypass of the maxAttunement cap and
       * dispatches `attune` with `overrideCap: true` per OUTLINE §3.8. */}
      <AlertDialog
        open={capOverrideItemId !== null}
        onOpenChange={(open) => {
          if (!open) setCapOverrideItemId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bypass attunement cap?</AlertDialogTitle>
            <AlertDialogDescription>
              {attunementState !== null
                ? `This character is already attuned to ${attunementState.attunedCount} of ${attunementState.maxAttunement} items. `
                : ''}
              As DM you can override the cap for this attunement. The log entry will record the
              override for the party audit trail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (capOverrideItemId === null || characterId === undefined) return;
                // BUG-008 — DM cap-override also routes through the
                // minting dispatch so an over-cap attune on a stacked
                // row still auto-splits correctly.
                dispatchMintingOrToast(
                  {
                    type: 'attune',
                    payload: {
                      characterId,
                      itemInstanceId: capOverrideItemId,
                      overrideCap: true,
                    },
                  },
                  'Could not attune',
                );
                setCapOverrideItemId(null);
              }}
            >
              Confirm override
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
