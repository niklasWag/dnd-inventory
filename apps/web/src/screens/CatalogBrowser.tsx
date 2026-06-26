import { type ReactElement, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

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
import { HomebrewForm } from '@/components/catalog/HomebrewForm';
import { DeleteHomebrewDialog } from '@/components/catalog/DeleteHomebrewDialog';
import { useStore } from '@/store';
import { rarityClasses, rarityLabel } from '@/lib/rarity';
import type { ItemCategory, ItemDefinition, ItemInstance } from '@app/shared';

/**
 * Stable empty-catalog reference. The Zustand selector below falls back to
 * this when `appState === null` (no character yet) — using a fresh `[]`
 * literal would return a new array every render, triggering an infinite
 * re-render loop (Zustand uses Object.is for equality).
 */
const EMPTY_CATALOG: readonly ItemDefinition[] = [];
const EMPTY_ITEMS: readonly ItemInstance[] = [];

/**
 * Catalog Browser (MVP §7 screen 8) — a read-only view of every catalog
 * entry. PHB rows expose a "Duplicate" button that opens the HomebrewForm
 * in duplicate mode (clones into a homebrew row with `duplicatedFromId`).
 * Homebrew rows expose Edit (opens the form pre-filled) and Delete
 * (opens a confirmation dialog gated by the reference count — see M6
 * delete policy: reject when items still reference the definition).
 */
export function CatalogBrowser(): ReactElement {
  const { catalog, items } = useStore(
    useShallow((s) => ({
      catalog: s.appState?.catalog ?? EMPTY_CATALOG,
      items: s.appState?.items ?? EMPTY_ITEMS,
    })),
  );
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'all' | ItemCategory>('all');
  const [activeDef, setActiveDef] = useState<ItemDefinition | null>(null);
  const [formMode, setFormMode] = useState<'create' | 'edit' | 'duplicate' | null>(null);
  const [deleteDef, setDeleteDef] = useState<ItemDefinition | null>(null);

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

  // Reference count per definition: number of DISTINCT stashes holding
  // any instance. Used to gate the Delete dialog (rejected when > 0).
  function referenceStashCount(definitionId: string): number {
    const refs = items.filter((i) => i.definitionId === definitionId);
    return new Set(refs.map((i) => i.ownerId)).size;
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Catalog</h1>
          <p className="text-sm text-muted-foreground">
            PHB 2024 mundane items, DMG 2024 magic items, and homebrew. PHB / DMG rows
            are read-only — use Duplicate to create an editable homebrew copy.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            setActiveDef(null);
            setFormMode('create');
          }}
        >
          New homebrew
        </Button>
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
              <SelectItem value="magic">Magic items</SelectItem>
              <SelectItem value="currency">Currency &amp; gems</SelectItem>
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
                <th className="px-3 py-2 font-medium">Rarity</th>
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
                  <td className="px-3 py-2">
                    {d.rarity != null ? (
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${rarityClasses(d.rarity)}`}
                        aria-label={`Rarity: ${rarityLabel(d.rarity)}`}
                      >
                        {rarityLabel(d.rarity)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {d.weight !== undefined ? `${String(d.weight)} lb` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {d.cost !== undefined
                      ? `${String(d.cost.amount)} ${d.cost.currency}`
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {d.source === 'PHB' || d.source === 'DMG' ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label={`Duplicate ${d.name}`}
                        onClick={() => {
                          setActiveDef(d);
                          setFormMode('duplicate');
                        }}
                      >
                        Duplicate
                      </Button>
                    ) : (
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          aria-label={`Edit ${d.name}`}
                          onClick={() => {
                            setActiveDef(d);
                            setFormMode('edit');
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          aria-label={`Delete ${d.name}`}
                          onClick={() => {
                            setDeleteDef(d);
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {formMode !== null ? (
        <HomebrewForm
          open={true}
          onOpenChange={(open) => {
            if (!open) {
              setFormMode(null);
              setActiveDef(null);
            }
          }}
          mode={formMode}
          {...(activeDef !== null ? { definition: activeDef } : {})}
        />
      ) : null}

      {deleteDef !== null ? (
        <DeleteHomebrewDialog
          open={true}
          onOpenChange={(open) => {
            if (!open) setDeleteDef(null);
          }}
          definitionId={deleteDef.id}
          definitionName={deleteDef.name}
          referenceStashCount={referenceStashCount(deleteDef.id)}
        />
      ) : null}
    </div>
  );
}
