import { type ReactElement, useMemo } from 'react';
import { Navigate, Outlet, useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { Coins, Package, Users } from 'lucide-react';

import { currency } from '@app/rules';
import type { Character, CurrencyHolding, ItemInstance, Stash } from '@app/shared';
import { useStore } from '@/store';
import { isCurrentUserDmOrSolo } from '@/lib/currentUserRole';
import { useCurrentPartyId } from '@/lib/useCurrentPartyId';

/** Stable empty-array references for the Zustand selector fallback when
 * `appState === null`. Fresh `[]` literals would defeat `useShallow`'s
 * reference equality and infinite-loop the render (same pattern as
 * `CatalogBrowser.tsx`'s `EMPTY_CATALOG`). */
const EMPTY_CHARACTERS: readonly Character[] = [];
const EMPTY_STASHES: readonly Stash[] = [];
const EMPTY_CURRENCIES: readonly CurrencyHolding[] = [];
const EMPTY_ITEMS: readonly ItemInstance[] = [];

/**
 * R4.5 — Route guard for the DM Dashboard (§5.9).
 *
 * Renders `<Outlet />` when the current user has a DM membership row OR
 * is solo (§8.2 union-of-rights). Otherwise redirects to `/hub`.
 *
 * No AppState = redirect. This route is only meaningful when a party is
 * loaded; the Hub itself is the correct landing when nothing is loaded.
 */
export function DmOnlyRoute(): ReactElement {
  const allowed = useStore(useShallow((s) => isCurrentUserDmOrSolo(s.appState)));
  if (!allowed) return <Navigate to="/hub" replace />;
  return <Outlet />;
}

/**
 * R4.5 — DM Dashboard (OUTLINE §5.9).
 *
 * At-a-glance grid of every character in the party (name + class + level
 * + Inventory GP-equivalent) with click-through to `/character/:id`, plus
 * summary cards for Party Stash + Recovered Loot (currency + distinct
 * item count) and a total party gold figure summing all character
 * Inventories + both shared pools.
 *
 * Access is gated by `DmOnlyRoute`; solo users see it too per §8.2.
 * Desktop-only per §5 form factor — on narrow viewports the character
 * table overflows horizontally rather than reflowing into cards.
 */
export function DmDashboard(): ReactElement {
  const navigate = useNavigate();
  const partyId = useCurrentPartyId();
  const { characters, stashes, currencies, items } = useStore(
    useShallow((s) => ({
      characters: s.appState?.characters ?? EMPTY_CHARACTERS,
      stashes: s.appState?.stashes ?? EMPTY_STASHES,
      currencies: s.appState?.currencies ?? EMPTY_CURRENCIES,
      items: s.appState?.items ?? EMPTY_ITEMS,
    })),
  );

  const partyStash = stashes.find((s) => s.scope === 'party');
  const recoveredLootStash = stashes.find((s) => s.scope === 'recovered-loot');

  const partyStashHolding = partyStash
    ? currencies.find((c) => c.stashId === partyStash.id)
    : undefined;
  const recoveredLootHolding = recoveredLootStash
    ? currencies.find((c) => c.stashId === recoveredLootStash.id)
    : undefined;

  const partyStashItems = partyStash ? items.filter((i) => i.ownerId === partyStash.id) : [];
  const recoveredLootItems = recoveredLootStash
    ? items.filter((i) => i.ownerId === recoveredLootStash.id)
    : [];

  // Per-character Inventory GP-equivalent + total.
  const characterRows = useMemo(
    () =>
      characters.map((c) => {
        const holding = currencies.find((h) => h.stashId === c.inventoryStashId);
        const gp = holding !== undefined ? currency.toGpEquivalent(holding) : 0;
        return { character: c, gp };
      }),
    [characters, currencies],
  );

  const totalPartyGp = useMemo(() => {
    const perCharacter = characterRows.reduce((sum, r) => sum + r.gp, 0);
    const partyGp = partyStashHolding ? currency.toGpEquivalent(partyStashHolding) : 0;
    const recoveredGp = recoveredLootHolding ? currency.toGpEquivalent(recoveredLootHolding) : 0;
    return perCharacter + partyGp + recoveredGp;
  }, [characterRows, partyStashHolding, recoveredLootHolding]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">DM Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          At-a-glance view of every character, shared pools, and total party wealth.
        </p>
      </header>

      <section
        role="region"
        aria-label="Total party gold"
        className="rounded-md border border-border bg-muted/20 p-4"
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Coins className="h-4 w-4" aria-hidden />
          Total party gold
        </div>
        <div className="mt-1 text-2xl font-semibold tabular-nums">{formatGp(totalPartyGp)}</div>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SummaryCard
          label="Party Stash"
          gp={partyStashHolding ? currency.toGpEquivalent(partyStashHolding) : 0}
          itemCount={partyStashItems.length}
        />
        <SummaryCard
          label="Recovered Loot"
          gp={recoveredLootHolding ? currency.toGpEquivalent(recoveredLootHolding) : 0}
          itemCount={recoveredLootItems.length}
        />
      </div>

      <section className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Users className="h-4 w-4" aria-hidden />
          Characters
        </div>
        {characterRows.length === 0 ? (
          <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">
            No characters yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Class</th>
                  <th className="px-3 py-2 font-medium">Level</th>
                  <th className="px-3 py-2 text-right font-medium">Inventory GP</th>
                </tr>
              </thead>
              <tbody>
                {characterRows.map(({ character, gp }) => (
                  <tr
                    key={character.id}
                    className="cursor-pointer border-b border-border/50 last:border-0 hover:bg-muted/40"
                  >
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => {
                          void navigate(`/party/${partyId}/character/${character.id}`);
                        }}
                        aria-label={`Open ${character.name}`}
                        className="text-left font-medium underline-offset-2 hover:underline"
                      >
                        {character.name}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{character.class}</td>
                    <td className="px-3 py-2 tabular-nums">{character.level}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatGp(gp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  gp,
  itemCount,
}: {
  label: string;
  gp: number;
  itemCount: number;
}): ReactElement {
  return (
    <section role="region" aria-label={label} className="rounded-md border border-border p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Package className="h-4 w-4" aria-hidden />
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{formatGp(gp)}</div>
      <div className="text-xs text-muted-foreground">
        {itemCount} {itemCount === 1 ? 'item' : 'items'}
      </div>
    </section>
  );
}

function formatGp(gp: number): string {
  // Preserve up to one decimal (e.g. "15.2 gp") but drop trailing .0.
  const rounded = Math.round(gp * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded} gp` : `${rounded.toFixed(1)} gp`;
}
