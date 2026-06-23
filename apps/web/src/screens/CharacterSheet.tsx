import { useState, type ReactElement } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';

import { Button } from '@/components/ui/button';
import { AddItemModal } from '@/components/stash/AddItemModal';
import { CurrencyRow } from '@/components/stash/CurrencyRow';
import { StashItemsTable } from '@/components/stash/StashItemsTable';
import { StorageStashList } from '@/components/stash/StorageStashList';
import { useStore } from '@/store';

type Tab = 'inventory' | 'storage' | 'party' | 'recovered-loot';

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'inventory', label: 'Inventory' },
  { id: 'storage', label: 'Storage' },
  { id: 'party', label: 'Party Stash' },
  { id: 'recovered-loot', label: 'Recovered Loot' },
];

/**
 * CharacterSheet (MVP §7 screen 2). Header + 4 tabs.
 *
 * M2 wires three of the four tabs (Inventory / Party Stash / Recovered
 * Loot) to the shared `StashItemsTable` + `AddItemModal`. M3 shipped the
 * Storage tab card list. M4 adds the `<CurrencyRow>` above the items
 * table on the three non-Storage tabs (Storage cards show their own
 * `<CurrencyBreakdown>` per card).
 *
 * Remaining placeholders that future milestones fill in:
 *   - Move / Split per row → M5
 */
export function CharacterSheet(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const sheet = useStore(
    useShallow((s) => {
      if (s.appState === null) return null;
      const c = s.appState.characters.find((ch) => ch.id === id);
      if (c === undefined) return null;
      const partyStash = s.appState.stashes.find((st) => st.scope === 'party');
      if (partyStash === undefined) return null;
      return {
        character: c,
        inventoryStashId: c.inventoryStashId,
        partyStashId: partyStash.id,
        recoveredLootStashId: s.appState.party.recoveredLootStashId,
      };
    }),
  );
  const [tab, setTab] = useState<Tab>('inventory');
  const [adding, setAdding] = useState(false);

  if (sheet === null) {
    return <Navigate to="/" replace />;
  }

  const { character, inventoryStashId, partyStashId, recoveredLootStashId } = sheet;
  const targetStash = stashForTab(tab, {
    inventoryStashId,
    partyStashId,
    recoveredLootStashId,
  });

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">{character.name}</h1>
        <p className="text-sm text-muted-foreground">
          Level {character.level} {character.species} {character.class}
          <span className="mx-2">•</span>
          STR {character.abilityScores.STR}
        </p>
      </header>

      <div className="border-b border-border">
        <nav className="-mb-px flex gap-1" aria-label="Tabs">
          {TABS.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={
                  'border-b-2 px-3 py-2 text-sm font-medium transition-colors ' +
                  (active
                    ? 'border-foreground text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground')
                }
              >
                {t.label}
              </button>
            );
          })}
        </nav>
      </div>

      <section>
        {tab === 'storage' ? (
          <StorageStashList characterId={character.id} />
        ) : (
          <div className="space-y-4">
            <CurrencyRow stashId={targetStash} />
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-muted-foreground">
                {labelForTab(tab)}
              </h2>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setAdding(true);
                }}
              >
                + Add item
              </Button>
            </div>
            <StashItemsTable stashId={targetStash} />
          </div>
        )}
      </section>

      {tab !== 'storage' ? (
        <AddItemModal
          open={adding}
          onOpenChange={setAdding}
          stashId={targetStash}
          stashLabel={labelForTab(tab)}
        />
      ) : null}
    </div>
  );
}

function labelForTab(tab: Exclude<Tab, 'storage'>): string {
  switch (tab) {
    case 'inventory':
      return 'Inventory';
    case 'party':
      return 'Party Stash';
    case 'recovered-loot':
      return 'Recovered Loot';
  }
}

function stashForTab(
  tab: Tab,
  ids: { inventoryStashId: string; partyStashId: string; recoveredLootStashId: string },
): string {
  switch (tab) {
    case 'inventory':
      return ids.inventoryStashId;
    case 'party':
      return ids.partyStashId;
    case 'recovered-loot':
      return ids.recoveredLootStashId;
    case 'storage':
      // Unused — the Storage tab renders the M3 placeholder instead of the
      // StashItemsTable. Return Inventory's id to satisfy the type; the
      // modal is also hidden when `tab === 'storage'`.
      return ids.inventoryStashId;
  }
}
