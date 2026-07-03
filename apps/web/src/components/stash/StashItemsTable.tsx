import { type ReactElement, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';

import { useCurrentPartyId } from '@/lib/useCurrentPartyId';

import { Button } from '@/components/ui/button';
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
import { attunement } from '@app/rules';
import { rarityDotClass, rarityLabel } from '@/lib/rarity';
import { formatChargesShort } from '@/lib/charges';
import { displayName as computeDisplayName } from '@/lib/identify';
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
export function StashItemsTable({ stashId, characterId }: StashItemsTableProps): ReactElement {
  const navigate = useNavigate();
  const partyId = useCurrentPartyId();
  const items = useStore(
    useShallow((s) =>
      s.appState === null ? [] : s.appState.items.filter((i) => i.ownerId === stashId),
    ),
  );
  // Catalog lookup map. Recomputed when the catalog identity changes — and
  // since `seed-catalog` rebuilds the array, it'll re-render correctly.
  const catalog = useStore((s) => s.appState?.catalog ?? EMPTY_CATALOG);
  const catalogById = useMemo(() => new Map(catalog.map((d) => [d.id, d])), [catalog]);
  const dispatch = useStore((s) => s.dispatch);

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
    return (
      <p className="text-sm text-muted-foreground">Nothing here yet. Add items from the catalog.</p>
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
   */
  const displayRows: { row: (typeof items)[number]; depth: 0 | 1 }[] = (() => {
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
    for (const parent of tops) {
      out.push({ row: parent, depth: 0 });
      for (const child of byParent.get(parent.id) ?? []) {
        out.push({ row: child, depth: 1 });
      }
    }
    return out;
  })();

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
      dispatch(action);
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
      dispatchMintingAction(action);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : fallback);
    }
  }

  return (
    <>
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border text-xs uppercase text-muted-foreground">
          <tr>
            <th className="py-2 pr-2 font-medium">Name</th>
            <th className="py-2 pr-2 font-medium">Category</th>
            <th className="py-2 pr-2 text-right font-medium">Qty</th>
            <th className="py-2 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
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
              <tr key={row.id} className="border-b border-border/50 last:border-0">
                <td className={`py-2 pr-2${depth === 1 ? ' pl-6' : ''}`}>
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
                    className="text-left underline-offset-2 hover:underline focus:outline-none focus-visible:underline"
                    aria-label={`Open details for ${displayName}`}
                  >
                    {isIdentified && def?.rarity != null ? (
                      <span
                        aria-label={`Rarity: ${rarityLabel(def.rarity)}`}
                        title={rarityLabel(def.rarity)}
                        className={`mr-2 inline-block h-2 w-2 rounded-full align-middle ${rarityDotClass(def.rarity)}`}
                      />
                    ) : null}
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
                  {isIdentified && def?.charges !== undefined && row.currentCharges !== null ? (
                    <span
                      aria-label={`Charges: ${formatChargesShort(row.currentCharges, def.charges.max)}`}
                      className="ml-2 text-xs tabular-nums text-muted-foreground"
                    >
                      ({formatChargesShort(row.currentCharges, def.charges.max)})
                    </span>
                  ) : null}
                  {isContainer && childCount > 0 ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      — {childCount} {childCount === 1 ? 'item' : 'items'} inside
                    </span>
                  ) : null}
                </td>
                <td className="py-2 pr-2 text-muted-foreground">{def?.category ?? '—'}</td>
                <td className="py-2 pr-2 text-right tabular-nums">{row.quantity}</td>
                <td className="py-2 text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-label={`Decrease ${displayName}`}
                      onClick={() => {
                        dispatch({
                          type: 'consume',
                          payload: { itemInstanceId: row.id, quantity: 1 },
                        });
                      }}
                    >
                      −
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-label={`Increase ${displayName}`}
                      onClick={() => {
                        // Re-dispatch via `acquire` rather than mutating the
                        // row directly so the log captures the increment.
                        // Wrapped via `dispatchOrToast` because R1.4
                        // hard-mode encumbrance can reject this dispatch
                        // (and uncaught reducer throws would surface as a
                        // console error instead of user-visible feedback).
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
                    >
                      +
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!canSplit}
                      aria-label={`Split ${displayName}`}
                      onClick={() => {
                        setActiveItemId(row.id);
                        setSplitOpen(true);
                      }}
                    >
                      Split
                    </Button>
                    {characterId !== undefined ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant={row.equipped ? 'default' : 'outline'}
                          aria-pressed={row.equipped}
                          aria-label={`${row.equipped ? 'Unequip' : 'Equip'} ${displayName}`}
                          onClick={() => {
                            dispatchOrToast(
                              {
                                type: row.equipped ? 'unequip' : 'equip',
                                payload: { characterId, itemInstanceId: row.id },
                              },
                              row.equipped ? 'Could not unequip' : 'Could not equip',
                            );
                          }}
                        >
                          {row.equipped ? 'Unequip' : 'Equip'}
                        </Button>
                        {/*
                         * R2.1 — hide the Attune toggle entirely on rows whose
                         * definition has `requiresAttunement !== true`. The
                         * reducer rejects the dispatch anyway (mundane-item
                         * gate), but hiding the button is cleaner UX than
                         * disabling — attunement is meaningless on a Torch.
                         * `row.attuned === true` keeps the Unattune button
                         * visible for legacy / cleanup state where a mundane
                         * row was attuned before the gate landed.
                         */}
                        {def?.requiresAttunement === true || row.attuned ? (
                          <Button
                            type="button"
                            size="sm"
                            variant={row.attuned ? 'default' : 'outline'}
                            aria-pressed={row.attuned}
                            // Pre-disable the "Attune" direction when the
                            // character's slots are full — cheaper UX than
                            // letting the click reject into a toast. The
                            // "Unattune" direction stays clickable (and the
                            // reducer always allows it modulo no-op).
                            // R4.5 — DM (or solo per §8.2) users skip the
                            // disable and route through a cap-override
                            // confirm dialog instead.
                            disabled={
                              !row.attuned &&
                              attunementState !== null &&
                              !attunementState.hasFreeSlot &&
                              !userIsDmOrSolo
                            }
                            title={
                              !row.attuned &&
                              attunementState !== null &&
                              !attunementState.hasFreeSlot &&
                              !userIsDmOrSolo
                                ? `Attunement slots full (${attunementState.attunedCount}/${attunementState.maxAttunement})`
                                : undefined
                            }
                            aria-label={`${row.attuned ? 'Unattune' : 'Attune'} ${displayName}`}
                            onClick={() => {
                              // R4.5 — DM cap-override branch: open the
                              // confirm dialog instead of dispatching
                              // directly.
                              if (
                                !row.attuned &&
                                attunementState !== null &&
                                !attunementState.hasFreeSlot &&
                                userIsDmOrSolo
                              ) {
                                setCapOverrideItemId(row.id);
                                return;
                              }
                              dispatchOrToast(
                                {
                                  type: row.attuned ? 'unattune' : 'attune',
                                  payload: { characterId, itemInstanceId: row.id },
                                },
                                row.attuned ? 'Could not unattune' : 'Could not attune',
                              );
                            }}
                          >
                            {row.attuned ? 'Unattune' : 'Attune'}
                          </Button>
                        ) : null}
                      </>
                    ) : null}
                    {canPack ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label={`Pack ${displayName} into a container`}
                        onClick={() => {
                          setActiveItemId(row.id);
                          setPackOpen(true);
                        }}
                      >
                        Pack
                      </Button>
                    ) : null}
                    {isContained ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label={`Take ${displayName} out of its container`}
                        onClick={() => {
                          // R1.5 — direct dispatch (no modal): same-stash
                          // transfer with `toContainerInstanceId: null`
                          // unsets the container parent. Wrapped via
                          // `dispatchOrToast` for the (rare) race where
                          // the reducer rejects.
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
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      aria-label={`Move ${displayName}`}
                      onClick={() => {
                        setActiveItemId(row.id);
                        setMoveOpen(true);
                      }}
                    >
                      Move
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        dispatch({
                          type: 'consume',
                          payload: { itemInstanceId: row.id, quantity: row.quantity },
                        });
                      }}
                    >
                      Remove
                    </Button>
                  </div>
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
                dispatchOrToast(
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
