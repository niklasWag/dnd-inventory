import { type ReactElement, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Search } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useStore } from '@/store';
import { StashItemsTable } from './StashItemsTable';
import type { BankerContext } from './CurrencyRow';

/**
 * R9.3 — framed inventory/stash panel (from `CharacterCombined.tsx`).
 *
 * A `shadow-e1` card with an in-card toolbar header — title + item counts,
 * a search input, a category `<select>`, and quick-filter pills — over the
 * shared `StashItemsTable`. Owns the search/category/state filter UI + state
 * and passes them down; the table stays the scope-agnostic renderer reused
 * by Storage / Party Stash / Recovered Loot (R9.5).
 *
 * `characterId` (Inventory only) enables the equip/attune row actions AND
 * the Equipped/Attuned quick-filters. Non-character scopes get search +
 * category only.
 *
 * R7.5 lineage — the fuzzy `query` this panel owns replaces the old
 * CharacterSheet per-tab `searchByTab` state; `StashItemsTable` still runs
 * the same `searchCatalog` ranker (identify-invariant aware) on it.
 */

type StateFilter = 'all' | 'equipped' | 'attuned' | 'unidentified';

interface InventoryPanelProps {
  /** The stash whose items this panel lists. */
  stashId: string;
  /** Card title (e.g. "Inventory", "Party Stash"). */
  title: string;
  /** Inventory only — enables equip/attune actions + Equipped/Attuned filters. */
  characterId?: string;
  /** Shared-pool banker context, forwarded to the table (unused today but kept symmetric). */
  bankerContext?: BankerContext;
  /** Primary action rendered at the top-right of the toolbar (e.g. "Add item"). */
  action?: ReactElement;
}

const BASE_QUICK_FILTERS: { id: StateFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unidentified', label: 'Unidentified' },
];

const CHARACTER_QUICK_FILTERS: { id: StateFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'equipped', label: 'Equipped' },
  { id: 'attuned', label: 'Attuned' },
  { id: 'unidentified', label: 'Unidentified' },
];

export function InventoryPanel({
  stashId,
  title,
  characterId,
  action,
}: InventoryPanelProps): ReactElement {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');

  // Select the WHOLE (reference-stable) items + catalog arrays; filter +
  // derive in `useMemo`. Selecting `.filter(...)` in the selector returns a
  // fresh array each call and breaks Zustand's shallow-equality → infinite
  // loop (the M2.5/M3 selector lesson).
  const { allItems, catalog } = useStore(
    useShallow((s) => ({
      allItems: s.appState?.items ?? null,
      catalog: s.appState?.catalog ?? null,
    })),
  );

  const { totalQty, categories } = useMemo(() => {
    if (allItems === null || catalog === null) return { totalQty: 0, categories: [] as string[] };
    const defById = new Map(catalog.map((d) => [d.id, d]));
    const cats = new Set<string>();
    let qty = 0;
    for (const row of allItems) {
      if (row.ownerId !== stashId) continue;
      qty += row.quantity;
      const cat = defById.get(row.definitionId)?.category;
      if (cat !== undefined) cats.add(cat);
    }
    return { totalQty: qty, categories: [...cats].sort() };
  }, [allItems, catalog, stashId]);

  const quickFilters = characterId !== undefined ? CHARACTER_QUICK_FILTERS : BASE_QUICK_FILTERS;

  const categoryOptions = useMemo(() => ['All', ...categories], [categories]);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-e1">
      <div className="space-y-3 border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide">
            {title}{' '}
            <span className="text-muted-foreground">
              · {totalQty} {totalQty === 1 ? 'item' : 'items'}
            </span>
          </h2>
          {action ?? null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[10rem] flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search items…"
              aria-label={`Search ${title}`}
              className="h-9 w-full rounded-md border border-border bg-surface-2 pl-8 pr-3 text-sm outline-none transition focus:border-primary/50"
            />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-9 w-[10rem] bg-surface-2" aria-label="Filter by category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categoryOptions.map((c) => (
                <SelectItem key={c} value={c} className={c === 'All' ? '' : 'capitalize'}>
                  {c === 'All' ? 'All categories' : c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="inline-flex h-9 overflow-hidden rounded-md border border-border">
            {quickFilters.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={stateFilter === f.id}
                onClick={() => setStateFilter(f.id)}
                className={cn(
                  'flex items-center px-2.5 text-xs font-medium transition',
                  stateFilter === f.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-surface-2',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <StashItemsTable
        stashId={stashId}
        {...(characterId !== undefined ? { characterId } : {})}
        query={query}
        categoryFilter={category}
        stateFilter={stateFilter}
      />
    </div>
  );
}
