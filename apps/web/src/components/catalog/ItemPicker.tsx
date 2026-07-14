import { type ReactElement, useMemo, useState } from 'react';
import { Search, Sparkles, FlaskConical, X } from 'lucide-react';

import type { ItemDefinition, Rarity as ItemRarity } from '@app/shared';
import type { hoard } from '@app/rules';
import { searchCatalog, pricing, currency } from '@app/rules';

import { cn } from '@/lib/utils';
import { rarityDotClass } from '@/lib/rarity';

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

/** R9.6 — the rarity chips / rail entries offered by the interactive filter. */
const RARITY_FILTERS: { value: Rarity | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'common', label: 'Common' },
  { value: 'uncommon', label: 'Uncommon' },
  { value: 'rare', label: 'Rare' },
  { value: 'very-rare', label: 'Very rare' },
  { value: 'legendary', label: 'Legendary' },
];

/** R9.6 — muted rarity-text tint for the row subline. */
function rarityTextClass(r: ItemRarity | null | undefined): string {
  switch (r) {
    case 'uncommon':
      return 'text-rarity-uncommon';
    case 'rare':
      return 'text-rarity-rare';
    case 'very-rare':
      return 'text-rarity-very-rare';
    case 'legendary':
    case 'artifact':
      return 'text-rarity-legendary';
    default:
      return 'text-muted-foreground';
  }
}

export type ItemPickerLayout = 'list' | 'rail';

export interface ItemPickerProps {
  catalog: ReadonlyArray<ItemDefinition>;
  /** When set, LOCKS the picker to one rarity (Loot Wizard row hint) — the
   * interactive rarity filter is hidden. */
  rarityFilter?: Rarity | undefined;
  /** `'list'` (default) — search + rarity chips over a result list.
   * `'rail'` — a left rarity+category filter rail beside the list, for
   * DM-heavy browsing (Shop add-stock, R9.7). */
  layout?: ItemPickerLayout;
  onCancel: () => void;
  onPick: (def: ItemDefinition) => void;
}

/**
 * Modal catalog picker (R9.6 — ports `design-lab/src/catalog/ItemPickerList.tsx`
 * + `ItemPickerFilterRail.tsx`). Searches by name (R6.5 fuzzy ranker) with an
 * interactive rarity filter (chips in `list`, a left rail in `rail`). Each row
 * shows a rarity dot bar + name (+ attune / homebrew icons) + a
 * source · rarity · price subline + a Pick button.
 *
 * Callback-only: hands the chosen `ItemDefinition` back to the parent, which
 * decides what to dispatch. Distinct from `components/stash/CatalogPicker`,
 * which auto-dispatches an `acquire`. Use this when the parent needs to gather
 * extra fields (quantity, price override, target stash, …) first.
 *
 * When `rarityFilter` is supplied (Loot Wizard row hint), the picker is LOCKED
 * to that rarity and the interactive filter is hidden.
 *
 * Originally inline in `LootDistributionWizard` (R6.3); extracted for reuse in
 * the R6.2 shop add-stock flow.
 */
export function ItemPicker({
  catalog,
  rarityFilter,
  layout = 'list',
  onCancel,
  onPick,
}: ItemPickerProps): ReactElement {
  const [query, setQuery] = useState('');
  const [rarity, setRarity] = useState<Rarity | 'all'>('all');
  const [category, setCategory] = useState('All');

  // A locked `rarityFilter` prop wins over the interactive control.
  const effectiveRarity: Rarity | 'all' = rarityFilter ?? rarity;
  const locked = rarityFilter !== undefined;

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const d of catalog) set.add(d.category);
    return ['All', ...[...set].sort()];
  }, [catalog]);

  const results = useMemo(() => {
    const filtered = catalog.filter((d) => {
      if (effectiveRarity !== 'all' && (d.rarity as ItemRarity) !== effectiveRarity) return false;
      if (layout === 'rail' && category !== 'All' && d.category !== category) return false;
      return true;
    });
    const q = query.trim();
    if (q === '') {
      return [...filtered].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 30);
    }
    return searchCatalog(q, filtered)
      .map((r) => r.item)
      .slice(0, 30);
  }, [catalog, query, effectiveRarity, layout, category]);

  const heading = `Pick an item${locked ? ` (${RARITY_LABELS[rarityFilter]})` : ''}`;

  const resultList = (
    <div className="h-[50vh] overflow-y-auto">
      {results.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground">No matching catalog items.</p>
      ) : (
        <ul className="divide-y divide-border" role="list">
          {results.map((def) => (
            <li
              key={def.id}
              className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-surface-2/60"
            >
              <span
                className={cn(
                  'h-8 w-1 shrink-0 rounded-full',
                  def.rarity != null ? rarityDotClass(def.rarity) : 'bg-transparent',
                )}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{def.name}</span>
                  {def.requiresAttunement === true ? (
                    <Sparkles
                      className="h-3 w-3 shrink-0 text-primary"
                      aria-label="Requires attunement"
                    />
                  ) : null}
                  {def.source === 'homebrew' ? (
                    <FlaskConical className="h-3 w-3 shrink-0 text-primary" aria-label="Homebrew" />
                  ) : null}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {def.source} · {def.category}
                  {def.rarity != null ? (
                    <span className={cn('ml-1', rarityTextClass(def.rarity))}>
                      {def.rarity.replace('-', ' ')}
                    </span>
                  ) : null}
                  {def.cost !== undefined ? (
                    <span>
                      {' · '}
                      {pricing.formatPrice(
                        currency.toCopper({ [def.cost.currency]: def.cost.amount }),
                        def.cost.currency,
                      )}
                    </span>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onPick(def)}
                className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition hover:opacity-90"
              >
                Pick
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div
        className={cn(
          'flex w-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-e3',
          layout === 'rail' ? 'max-w-2xl' : 'max-w-lg',
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="font-display text-base font-semibold">{heading}</h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-surface-2"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search + (list-only) rarity chips */}
        <div className="space-y-3 border-b border-border px-5 py-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="wand, sword…"
              aria-label="Search"
              className="w-full rounded-md border border-border bg-surface py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {layout === 'list' && !locked ? (
            <div className="flex flex-wrap gap-1.5">
              {RARITY_FILTERS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  aria-pressed={rarity === r.value}
                  onClick={() => setRarity(r.value)}
                  className={cn(
                    'rounded-full px-2.5 py-1 text-xs font-medium transition',
                    rarity === r.value
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-border bg-surface text-muted-foreground hover:bg-surface-2',
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {layout === 'rail' ? (
          <div className="grid grid-cols-[10rem_1fr]">
            <aside className="h-[50vh] overflow-y-auto border-r border-border px-3 py-3">
              {!locked ? (
                <>
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Rarity
                  </div>
                  <ul className="mb-4 space-y-0.5">
                    {RARITY_FILTERS.map((r) => (
                      <li key={r.value}>
                        <button
                          type="button"
                          aria-pressed={rarity === r.value}
                          onClick={() => setRarity(r.value)}
                          className={cn(
                            'w-full rounded-md px-2 py-1 text-left text-sm transition',
                            rarity === r.value
                              ? 'bg-primary/10 font-medium text-primary'
                              : 'text-muted-foreground hover:bg-surface-2',
                          )}
                        >
                          {r.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Category
              </div>
              <ul className="space-y-0.5">
                {categories.map((c) => (
                  <li key={c}>
                    <button
                      type="button"
                      aria-pressed={category === c}
                      onClick={() => setCategory(c)}
                      className={cn(
                        'w-full rounded-md px-2 py-1 text-left text-sm capitalize transition',
                        category === c
                          ? 'bg-primary/10 font-medium text-primary'
                          : 'text-muted-foreground hover:bg-surface-2',
                      )}
                    >
                      {c === 'All' ? 'All' : c}
                    </button>
                  </li>
                ))}
              </ul>
            </aside>
            {resultList}
          </div>
        ) : (
          resultList
        )}
      </div>
    </div>
  );
}
