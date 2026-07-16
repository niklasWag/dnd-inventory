import { type ReactElement, useMemo } from 'react';
import { Navigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { Gift, Sparkles } from 'lucide-react';

import type { Character, ItemDefinition, WishlistEntry } from '@app/shared';

import { rarityPillClass } from '@/lib/rarity';
import { RARITY_LABELS } from '@/components/catalog/ItemPicker';
import { useStore } from '@/store';

/** Stable empty-array fallbacks (useShallow reference equality). */
const EMPTY_CHARACTERS: readonly Character[] = [];
const EMPTY_CATALOG: readonly ItemDefinition[] = [];

/**
 * R10.5 — DM Command Center → Wishlist Overview (§5.9, DmOnlyRoute-gated).
 *
 * A party-wide, read-only aggregate of every character's item wishlist so
 * the DM can see at a glance what players want when planning loot. Catalog
 * entries render with a rarity pill; free-text wishes render as-is. The
 * loot-matching hint lives in the Loot Distribution wizard; this screen is
 * the browse-everything companion.
 */
export function WishlistOverview(): ReactElement {
  const partyName = useStore((s) => s.appState?.party.name ?? 'Party');
  const characters = useStore(useShallow((s) => s.appState?.characters ?? EMPTY_CHARACTERS));
  const catalog = useStore(useShallow((s) => s.appState?.catalog ?? EMPTY_CATALOG));
  const loaded = useStore((s) => s.appState !== null);

  const catalogById = useMemo(() => {
    const m = new Map<string, ItemDefinition>();
    for (const d of catalog) m.set(d.id, d);
    return m;
  }, [catalog]);

  if (!loaded) return <Navigate to="/hub" replace />;

  function labelFor(entry: WishlistEntry): { name: string; rarity: string | null } {
    if (entry.kind === 'text') return { name: entry.text, rarity: null };
    const def = catalogById.get(entry.definitionId);
    if (def === undefined) return { name: 'Unknown item', rarity: null };
    const showPill = def.rarity != null && def.rarity !== 'common';
    return { name: def.name, rarity: showPill ? (def.rarity ?? null) : null };
  }

  const anyWishes = characters.some((c) => c.wishlist.length > 0);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">{partyName} · DM tools</p>
        <h1 className="font-display text-2xl font-bold tracking-tight">Wishlists</h1>
        <p className="text-sm text-muted-foreground">
          What each player is hoping for. Use it as a hint when generating hoards or handing out
          loot.
        </p>
      </header>

      {!anyWishes ? (
        <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-10 text-center text-sm text-muted-foreground">
          No one has wishlisted anything yet.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {characters.map((c) => (
            <section
              key={c.id}
              className="overflow-hidden rounded-lg border border-border bg-surface shadow-e1"
            >
              <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                <Gift className="h-4 w-4 text-primary" aria-hidden="true" />
                <h2 className="font-display text-sm font-semibold">{c.name}</h2>
                <span className="ml-auto text-xs text-muted-foreground">
                  {c.wishlist.length} {c.wishlist.length === 1 ? 'item' : 'items'}
                </span>
              </div>
              <div className="px-4 py-3">
                {c.wishlist.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing wishlisted.</p>
                ) : (
                  <ul className="space-y-1.5" aria-label={`${c.name} wishlist`}>
                    {c.wishlist.map((entry) => {
                      const { name, rarity } = labelFor(entry);
                      return (
                        <li key={entry.id} className="flex items-center gap-2 text-sm">
                          {entry.kind === 'text' ? (
                            <Sparkles
                              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                              aria-hidden="true"
                            />
                          ) : null}
                          <span className="truncate">{name}</span>
                          {rarity !== null ? (
                            <span
                              className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] ${rarityPillClass(
                                rarity as Parameters<typeof rarityPillClass>[0],
                              )}`}
                            >
                              {RARITY_LABELS[rarity as keyof typeof RARITY_LABELS]}
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
