import { type ReactElement, useMemo, useState } from 'react';

import type { ItemDefinition, Rarity as ItemRarity } from '@app/shared';
import type { hoard } from '@app/rules';
import { searchCatalog } from '@app/rules';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Rarity = hoard.Rarity;

/**
 * Display labels for the 5 hoard-relevant rarity tiers. Exported so the
 * Loot Distribution Wizard (the picker's original home) can reuse the
 * same mapping for its own row labels.
 */
export const RARITY_LABELS: Record<Rarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  'very-rare': 'Very rare',
  legendary: 'Legendary',
};

export interface ItemPickerProps {
  catalog: ReadonlyArray<ItemDefinition>;
  rarityFilter?: Rarity | undefined;
  onCancel: () => void;
  onPick: (def: ItemDefinition) => void;
}

/**
 * Modal catalog picker — searches by name (R6.5 fuzzy ranker) with an
 * optional rarity pre-filter. Callback-only: hands the chosen
 * `ItemDefinition` back to the parent, which decides what to dispatch.
 *
 * Distinct from `components/stash/CatalogPicker`, which auto-dispatches
 * an `acquire`. Use this when the parent needs to gather extra fields
 * (quantity, price override, target stash, …) before dispatching.
 *
 * Originally inline in `LootDistributionWizard` (R6.3); extracted for
 * reuse in the R6.2 shop add-stock flow.
 */
export function ItemPicker({
  catalog,
  rarityFilter,
  onCancel,
  onPick,
}: ItemPickerProps): ReactElement {
  const [query, setQuery] = useState('');
  const results = useMemo(() => {
    const filtered = catalog.filter(
      (d) => rarityFilter === undefined || (d.rarity as ItemRarity) === rarityFilter,
    );
    const q = query.trim();
    if (q === '') {
      return [...filtered].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 30);
    }
    return searchCatalog(q, filtered)
      .map((r) => r.item)
      .slice(0, 30);
  }, [catalog, query, rarityFilter]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-lg border border-border bg-background p-4 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            Pick item {rarityFilter !== undefined ? `(${RARITY_LABELS[rarityFilter]})` : ''}
          </h3>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
        <div className="mb-3 space-y-1.5">
          <Label htmlFor="item-picker-search">Search</Label>
          <Input
            id="item-picker-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            placeholder="wand, sword…"
          />
        </div>
        <div className="max-h-80 overflow-y-auto rounded-md border border-border">
          {results.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No matching catalog items.</p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {results.map((def) => (
                <li key={def.id} className="flex items-center gap-2 p-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{def.name}</div>
                    <div className="text-xs uppercase text-muted-foreground">
                      {def.source} · {def.rarity ?? '—'}
                    </div>
                  </div>
                  <Button type="button" size="sm" onClick={() => onPick(def)}>
                    Pick
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
