import { type ReactElement, useMemo, useState } from 'react';

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

/**
 * Stable empty-catalog reference. The Zustand selector below falls back to
 * this when `appState === null` (no character yet) — using a fresh `[]`
 * literal would return a new array every render, triggering an infinite
 * re-render loop (Zustand uses Object.is for equality).
 */
const EMPTY_CATALOG: readonly ItemDefinition[] = [];

/**
 * Catalog Browser (MVP §7 screen 8) — a read-only view of every catalog
 * entry. PHB rows show a disabled "Duplicate" button as an M6 affordance;
 * M6 wires the action. Homebrew rows would carry Edit / Delete, but M2
 * has no homebrew sources yet (the create-homebrew action lands in M6),
 * so the column is unused for now.
 */
export function CatalogBrowser(): ReactElement {
  const catalog = useStore((s) => s.appState?.catalog ?? EMPTY_CATALOG);
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
      });
  }, [catalog, query, category]);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Catalog</h1>
        <p className="text-sm text-muted-foreground">
          PHB 2024 mundane items + homebrew. PHB rows are read-only — use Duplicate (M6) to
          create an editable homebrew copy.
        </p>
      </header>

      <div className="grid grid-cols-[2fr_1fr] gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="catalog-browser-search">Search</Label>
          <Input
            id="catalog-browser-search"
            placeholder="rope, longsword, torch…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="catalog-browser-category">Category</Label>
          <Select
            value={category}
            onValueChange={(v) => setCategory(v as 'all' | ItemCategory)}
          >
            <SelectTrigger id="catalog-browser-category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              <SelectItem value="weapon">Weapons</SelectItem>
              <SelectItem value="armor">Armor</SelectItem>
              <SelectItem value="gear">Adventuring gear</SelectItem>
              <SelectItem value="tool">Tools</SelectItem>
              <SelectItem value="ammunition">Ammunition</SelectItem>
              <SelectItem value="consumable">Consumables</SelectItem>
              <SelectItem value="container">Containers</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {results.length} of {catalog.length} entries
      </p>

      <div className="rounded-md border border-border">
        {results.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            {catalog.length === 0
              ? 'Catalog is empty — the PHB seed will load on next boot.'
              : 'No items match your search.'}
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 text-right font-medium">Weight</th>
                <th className="px-3 py-2 text-right font-medium">Cost</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {results.map((d) => (
                <tr key={d.id} className="border-b border-border/50 last:border-0">
                  <td className="px-3 py-2 font-medium">{d.name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{d.source}</td>
                  <td className="px-3 py-2 text-muted-foreground">{d.category}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {d.weight !== undefined ? `${String(d.weight)} lb` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {d.cost !== undefined
                      ? `${String(d.cost.amount)} ${d.cost.currency}`
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {d.source === 'PHB' ? (
                      <Button type="button" size="sm" variant="outline" disabled title="Duplicate-to-edit lands in M6">
                        Duplicate
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">M6: Edit / Delete</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
