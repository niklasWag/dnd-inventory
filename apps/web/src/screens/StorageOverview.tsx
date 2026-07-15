import { useMemo, useState, type ReactElement } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { ChevronRight, Coins, Package, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useCurrentPartyId } from '@/lib/useCurrentPartyId';
import { CreateStashModal } from '@/components/stash/CreateStashModal';
import { CurrencyBreakdown } from '@/components/stash/CurrencyBreakdown';
import { useStore } from '@/store';

/**
 * Storage Overview (R9.5 — ports `design-lab/src/storage/StorageOverviewCards.tsx`,
 * verified against `drawings/storage-list.png`). The per-character Storage
 * screen reached from the sidebar at `/party/:partyId/character/:id/stashes`;
 * replaces the R9.3 `StashPlaceholder`.
 *
 * Storage stashes = character-scope, non-carried. The one carried stash is
 * the Inventory (its own Character Sheet screen); Party Stash / Recovered
 * Loot are party-scope and live on their own party-wide screens.
 *
 * A responsive card grid — each card shows the stash name + item count (sum
 * of quantities, per the M3 plan decision) + a 5-denomination currency
 * breakdown, and opens that stash's detail (`/stash/:id`). Encumbrance never
 * applies to Storage (§3.3), stated in the subtitle.
 *
 * Selector design (M2.5 + StorageStashList lesson): pull the raw store
 * slices (`stashes` + `items`) through `useShallow` — both stable references
 * unless they actually change — and derive the `cards` array in `useMemo`.
 * Returning freshly-built nested objects from the selector triggers the
 * infinite-update loop because `useShallow` compares the outer container by
 * shallow-equality but the inner references change each render.
 */

interface StorageCard {
  id: string;
  name: string;
  createdAt: string;
  itemCount: number; // sum of quantities, not row count (per M3 plan decision)
}

export function StorageOverview(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const partyId = useCurrentPartyId();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  const view = useStore(
    useShallow((s) => {
      if (s.appState === null || id === undefined) return null;
      const character = s.appState.characters.find((c) => c.id === id);
      if (character === undefined) return null;
      return { characterId: character.id };
    }),
  );

  const { stashes, items } = useStore(
    useShallow((s) => ({
      stashes: s.appState?.stashes ?? null,
      items: s.appState?.items ?? null,
    })),
  );

  const cards = useMemo<StorageCard[]>(() => {
    if (stashes === null || items === null || view === null) return [];
    const storageStashes = stashes
      .filter(
        (st) =>
          st.scope === 'character' && st.ownerCharacterId === view.characterId && !st.isCarried,
      )
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return storageStashes.map((st) => ({
      id: st.id,
      name: st.name,
      createdAt: st.createdAt,
      itemCount: items.filter((i) => i.ownerId === st.id).reduce((sum, i) => sum + i.quantity, 0),
    }));
  }, [stashes, items, view]);

  if (view === null) return <Navigate to="/" replace />;
  const { characterId } = view;

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Storage</h1>
          <p className="text-sm text-muted-foreground">
            Named stashes outside your carried Inventory — no encumbrance applies.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          className="shrink-0 shadow-e1"
          onClick={() => {
            setCreating(true);
          }}
        >
          <Plus className="h-4 w-4" />
          New Storage stash
        </Button>
      </div>

      {cards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface-2/40 p-10 text-center text-sm text-muted-foreground">
          No Storage stashes yet. Create one to carve out a chest, a vault, or a wagon for your
          hoard.
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {cards.map((card) => (
            <li key={card.id}>
              <button
                type="button"
                onClick={() => {
                  void navigate(`/party/${partyId}/stash/${card.id}`);
                }}
                aria-label={`Open ${card.name} details`}
                className="group flex w-full items-center gap-3 rounded-xl border border-border bg-surface p-4 text-left shadow-e1 transition hover:border-foreground/20 hover:bg-surface-2/50"
              >
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Package className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-display text-base font-semibold tracking-tight">
                    {card.name}
                  </h3>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span>
                      {card.itemCount} {card.itemCount === 1 ? 'item' : 'items'}
                    </span>
                    <span>·</span>
                    <Coins className="h-3 w-3" aria-hidden="true" />
                    <span className="truncate">
                      <CurrencyBreakdown stashId={card.id} />
                    </span>
                  </p>
                </div>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </button>
            </li>
          ))}
        </ul>
      )}

      <CreateStashModal open={creating} onOpenChange={setCreating} ownerCharacterId={characterId} />
    </div>
  );
}
