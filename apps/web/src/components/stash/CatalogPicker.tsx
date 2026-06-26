import { type ReactElement, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useStore } from '@/store';
import type { ItemCategory, ItemDefinition } from '@app/shared';

/** Stable empty-catalog reference — see CatalogBrowser for the why. */
const EMPTY_CATALOG: readonly ItemDefinition[] = [];

interface CatalogPickerProps {
  /** Stash that "Add" dispatches an `acquire` against. */
  stashId: string;
  /** Display name shown on the Add button (e.g. "Add to Inventory"). */
  stashLabel: string;
  /** Called after a successful add so the parent modal can close. */
  onAdded?: () => void;
}

const ALL_CATEGORIES: ReadonlyArray<{ value: 'all' | ItemCategory; label: string }> = [
  { value: 'all', label: 'All categories' },
  { value: 'weapon', label: 'Weapons' },
  { value: 'armor', label: 'Armor' },
  { value: 'gear', label: 'Adventuring gear' },
  { value: 'tool', label: 'Tools' },
  { value: 'ammunition', label: 'Ammunition' },
  { value: 'consumable', label: 'Consumables' },
  { value: 'container', label: 'Containers' },
  { value: 'other', label: 'Other' },
];

/**
 * Catalog tab of the AddItemModal. Substring search across
 * `name + description + tags` (per MVP §12 "default to fuzzy across…" —
 * MVP ships substring; R6 swaps in the real fuzzy ranker from
 * `rules/search.ts`). Category filter via shadcn select.
 *
 * Each row has its own quantity stepper + Add button so the user can pick
 * multiple distinct items without closing the modal between adds.
 */
export function CatalogPicker({ stashId, stashLabel, onAdded }: CatalogPickerProps): ReactElement {
  const catalog = useStore((s) => s.appState?.catalog ?? EMPTY_CATALOG);
  const dispatch = useStore((s) => s.dispatch);

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'all' | ItemCategory>('all');

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog
      .filter((d) => category === 'all' || d.category === category)
      .filter((d) => {
        if (q === '') return true;
        if (d.name.toLowerCase().includes(q)) return true;
        if ((d.description ?? '').toLowerCase().includes(q)) return true;
        if ((d.tags ?? []).some((t) => t.toLowerCase().includes(q))) return true;
        return false;
      })
      .slice(0, 50); // cap result list — the modal isn't a Catalog Browser.
  }, [catalog, query, category]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-[2fr_1fr] gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="catalog-search">Search</Label>
          <Input
            id="catalog-search"
            placeholder="rope, longsword, torch…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="catalog-category">Category</Label>
          <Select value={category} onValueChange={(v) => setCategory(v as 'all' | ItemCategory)}>
            <SelectTrigger id="catalog-category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALL_CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="max-h-[420px] overflow-y-auto rounded-md border border-border">
        {results.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            {catalog.length === 0
              ? 'Catalog is empty — the PHB seed will load on next boot.'
              : 'No items match your search.'}
          </p>
        ) : (
          <ul className="divide-y divide-border" role="list">
            {results.map((def) => (
              <CatalogRow
                key={def.id}
                def={def}
                onAdd={(quantity) => {
                  // R1.4 — hard-mode encumbrance can reject this dispatch.
                  // Surface as a toast so the user sees why the add didn't
                  // land instead of an uncaught console error.
                  try {
                    dispatch({
                      type: 'acquire',
                      payload: {
                        stashId,
                        definitionId: def.id,
                        quantity,
                        source: 'catalog-add',
                      },
                    });
                    onAdded?.();
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Could not add item');
                  }
                }}
                addLabel={`Add to ${stashLabel}`}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface CatalogRowProps {
  def: ItemDefinition;
  onAdd: (quantity: number) => void;
  addLabel: string;
}

function CatalogRow({ def, onAdd, addLabel }: CatalogRowProps): ReactElement {
  const [qty, setQty] = useState(1);

  return (
    <li className="flex items-center gap-3 p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{def.name}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs uppercase text-muted-foreground">
            {def.source}
          </span>
          <span className="text-xs text-muted-foreground">{def.category}</span>
        </div>
        {def.description !== undefined ? (
          <p className="line-clamp-1 text-xs text-muted-foreground">{def.description}</p>
        ) : null}
      </div>
      <Input
        type="number"
        min={1}
        max={999}
        value={qty}
        onChange={(e) => {
          const next = Number.parseInt(e.target.value, 10);
          setQty(Number.isFinite(next) && next >= 1 ? next : 1);
        }}
        aria-label={`Quantity for ${def.name}`}
        className="w-20"
      />
      <Button
        type="button"
        size="sm"
        onClick={() => {
          onAdd(qty);
        }}
      >
        {addLabel}
      </Button>
    </li>
  );
}
