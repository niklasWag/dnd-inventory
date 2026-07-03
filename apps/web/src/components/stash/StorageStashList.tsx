import { useMemo, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useCurrentPartyId } from '@/lib/useCurrentPartyId';
import { CreateStashModal } from './CreateStashModal';
import { CurrencyBreakdown } from './CurrencyBreakdown';
import { useStore } from '@/store';

interface StorageStashListProps {
  /** The character whose Storage stashes we're listing. */
  characterId: string;
}

interface StorageCard {
  id: string;
  name: string;
  createdAt: string;
  itemCount: number; // sum of quantities, not row count (per M3 plan decision)
}

/**
 * Card grid of Storage stashes (M3 / MVP §7 screen 2 Storage tab).
 *
 * Storage stashes = character-scope, non-carried. Inventory is the one
 * carried stash and lives on its own tab; Party Stash / Recovered Loot
 * are party-scope and have their own tabs.
 *
 * Each card shows the stash name + item count (sum of quantities) and a
 * 5-denomination breakdown of the stash's CurrencyHolding (M4 — previously
 * an `— gp` placeholder). Clicking a card navigates to `/storage/:stashId`.
 *
 * Selector design (M2.5 lesson + M3 refinement): `useShallow` does
 * shallow-equal on the OUTER container; nested objects we construct on
 * the fly will always look "different" by reference and trigger the
 * infinite-update loop. So we select the raw store slices we care about
 * (stashes + items) — both are stable references unless they actually
 * change — and derive the `cards` array in `useMemo` from those.
 */
export function StorageStashList({ characterId }: StorageStashListProps): ReactElement {
  const navigate = useNavigate();
  const partyId = useCurrentPartyId();
  const [creating, setCreating] = useState(false);

  const { stashes, items } = useStore(
    useShallow((s) => ({
      stashes: s.appState?.stashes ?? null,
      items: s.appState?.items ?? null,
    })),
  );

  const cards = useMemo<StorageCard[]>(() => {
    if (stashes === null || items === null) return [];
    const storageStashes = stashes
      .filter(
        (st) => st.scope === 'character' && st.ownerCharacterId === characterId && !st.isCarried,
      )
      .slice()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return storageStashes.map((st) => ({
      id: st.id,
      name: st.name,
      createdAt: st.createdAt,
      itemCount: items.filter((i) => i.ownerId === st.id).reduce((sum, i) => sum + i.quantity, 0),
    }));
  }, [stashes, items, characterId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">Storage stashes</h2>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            setCreating(true);
          }}
        >
          <Plus className="h-4 w-4" />
          New Storage stash
        </Button>
      </div>

      {cards.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
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
                className="w-full rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-foreground/30 hover:bg-accent"
              >
                <h3 className="text-base font-semibold tracking-tight">{card.name}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {card.itemCount} {card.itemCount === 1 ? 'item' : 'items'} ·{' '}
                  <CurrencyBreakdown stashId={card.id} />
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      <CreateStashModal open={creating} onOpenChange={setCreating} ownerCharacterId={characterId} />
    </div>
  );
}
