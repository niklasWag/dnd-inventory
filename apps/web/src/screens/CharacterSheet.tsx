import { useState, type ReactElement } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import { Moon, Pencil } from 'lucide-react';

import { charges as chargesRules } from '@app/rules';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CapacityBar } from '@/components/inventory/CapacityBar';
import { EquippedSlotsPanel } from '@/components/inventory/EquippedSlotsPanel';
import { RestRollModal } from '@/components/inventory/RestRollModal';
import { EditCharacterDialog } from '@/components/character/EditCharacterDialog';
import { AddItemModal } from '@/components/stash/AddItemModal';
import { CurrencyRow } from '@/components/stash/CurrencyRow';
import { StashItemsTable } from '@/components/stash/StashItemsTable';
import { StashSearchInput } from '@/components/stash/StashSearchInput';
import { StorageStashList } from '@/components/stash/StorageStashList';
import { useStore } from '@/store';
import { BATCH_TRIGGER_ORDER, batchTriggerLabel, type BatchRechargeTrigger } from '@/lib/charges';

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
      // R4.2.e — resolve Banker + DM context up-front so CurrencyRow /
      // StashItemsTable can render conditional affordances without
      // reaching back into the store themselves. `userIsBanker` uses
      // OUTLINE §3.14: banker is derived from `Party.bankerUserId`,
      // never from a membership row. `userIsDm` reads from the local
      // DM membership; §3.14 also bars the DM from being the Banker so
      // the two flags are mutually exclusive.
      const myUserId = s.appState.user.id;
      const bankerActive = s.appState.party.bankerUserId !== null;
      const userIsBanker = bankerActive && s.appState.party.bankerUserId === myUserId;
      const userIsDm = s.appState.memberships.some(
        (m) => m.userId === myUserId && m.role === 'dm' && m.leftAt === null,
      );
      // R4.5 — cross-character cue. When a DM is viewing another
      // player's character, surface a subtle "editing X's character"
      // banner so the mutation surface is unambiguous. Suppressed in
      // solo (§8.2 union-of-rights makes the DM/owner distinction
      // irrelevant) and for own-character views. The owner's display
      // name is resolved server-side via memberships → user rows; the
      // client doesn't have a user map in AppState, so we fall back to
      // the character name.
      const isCrossCharacterDmView =
        userIsDm && c.ownerUserId !== null && c.ownerUserId !== myUserId;
      // R6.0 — "Edit character" button visibility. Owner OR DM OR solo
      // (solo party of one — per §8.2 union-of-rights the sole member
      // acts as both). Non-DM viewers of someone else's character
      // never see the button. The dialog itself does per-field
      // disabled gating; this flag just controls whether the button
      // even appears.
      const activeMemberships = s.appState.memberships.filter((m) => m.leftAt === null);
      const distinctUserIds = new Set(activeMemberships.map((m) => m.userId));
      const isSolo = distinctUserIds.size === 1;
      const isOwner = c.ownerUserId === myUserId;
      const canEditCharacter = userIsDm || isOwner || isSolo;
      return {
        character: c,
        inventoryStashId: c.inventoryStashId,
        partyStashId: partyStash.id,
        recoveredLootStashId: s.appState.party.recoveredLootStashId,
        bankerActive,
        userIsBanker,
        userIsDm,
        isCrossCharacterDmView,
        canEditCharacter,
      };
    }),
  );
  const [tab, setTab] = useState<Tab>('inventory');
  const [adding, setAdding] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  // R7.5 — per-tab fuzzy search state. Kept independent so switching
  // tabs doesn't leak a filter from Inventory into Party Stash. Storage
  // has no `<StashItemsTable>` mount, so its slot is unused.
  const [searchByTab, setSearchByTab] = useState<Record<Tab, string>>({
    inventory: '',
    storage: '',
    party: '',
    'recovered-loot': '',
  });

  if (sheet === null) {
    return <Navigate to="/" replace />;
  }

  const {
    character,
    inventoryStashId,
    partyStashId,
    recoveredLootStashId,
    bankerActive,
    userIsBanker,
    userIsDm,
    isCrossCharacterDmView,
    canEditCharacter,
  } = sheet;
  const targetStash = stashForTab(tab, {
    inventoryStashId,
    partyStashId,
    recoveredLootStashId,
  });

  // R4.2.e — CurrencyRow banker context. Only meaningful for shared-
  // pool tabs (party / recovered-loot); Inventory / Storage get
  // `undefined` so the row renders the default control set.
  const currencyRowBankerContext =
    tab === 'party' || tab === 'recovered-loot'
      ? {
          userIsBanker,
          userIsDmWithBankerActive: bankerActive && userIsDm && !userIsBanker,
          userIsGatedFromPool: bankerActive && !userIsBanker && !userIsDm,
          isPartyStash: tab === 'party',
        }
      : undefined;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">{character.name}</h1>
          <p className="text-sm text-muted-foreground">
            Level {character.level} {character.species} {character.class}
            <span className="mx-2">•</span>
            STR {character.abilityScores.STR}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canEditCharacter ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
              Edit character
            </Button>
          ) : null}
          <RestMenu characterId={character.id} />
        </div>
      </header>

      {canEditCharacter ? (
        <EditCharacterDialog
          characterId={character.id}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      ) : null}

      {isCrossCharacterDmView ? (
        <div
          role="note"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200"
        >
          Editing {character.name}'s character as DM.
        </div>
      ) : null}

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
            <CurrencyRow
              stashId={targetStash}
              {...(currencyRowBankerContext !== undefined
                ? { bankerContext: currencyRowBankerContext }
                : {})}
            />
            {tab === 'inventory' ? <CapacityBar characterId={character.id} /> : null}
            {tab === 'inventory' ? <EquippedSlotsPanel characterId={character.id} /> : null}
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-muted-foreground">{labelForTab(tab)}</h2>
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
            <StashSearchInput
              value={searchByTab[tab]}
              onChange={(next) => setSearchByTab((prev) => ({ ...prev, [tab]: next }))}
              label={`Search ${labelForTab(tab)}`}
              idPrefix={`stash-search-${tab}`}
            />
            <StashItemsTable
              stashId={targetStash}
              {...(tab === 'inventory' ? { characterId: character.id } : {})}
              query={searchByTab[tab]}
            />
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

/**
 * R2.2 — Character Sheet header Rest dropdown. Four time-based batch
 * triggers fan out via the `recharge` reducer's `mode: 'batch'` case.
 * A fifth "Custom" item is rendered disabled with an R6 tooltip — it
 * signals the future DM force-recharge surface without shipping it.
 *
 * Toast count is derived BEFORE dispatch via the rules helper —
 * `eligibleForBatchRecharge` over the character's Inventory items
 * minus those already at full charges. This avoids coupling
 * CharacterSheet to the reducer's return shape (which the middleware
 * doesn't surface back to the caller).
 *
 * R2.2.1 — when any eligible item carries a `rechargeAmount` formula,
 * picking a trigger opens the `<RestRollModal>` so the user can enter
 * dice rolls instead of full-recharging. Triggers with no formula-
 * bearing eligible items dispatch immediately as in R2.2.
 */
function RestMenu({ characterId }: { characterId: string }): ReactElement {
  const dispatch = useStore((s) => s.dispatch);
  // R2.2.1 — when truthy, opens RestRollModal for the chosen trigger.
  // The modal handles its own dispatch + toast on Apply.
  const [pendingRoll, setPendingRoll] = useState<BatchRechargeTrigger | null>(null);

  // useShallow selects the raw primitives so the menu doesn't re-render
  // on every store mutation that doesn't touch items/catalog.
  const view = useStore(
    useShallow((s) => {
      if (s.appState === null) return { items: [], catalog: [], inventoryStashId: null } as const;
      const c = s.appState.characters.find((ch) => ch.id === characterId);
      if (c === undefined) return { items: [], catalog: [], inventoryStashId: null } as const;
      return {
        items: s.appState.items,
        catalog: s.appState.catalog,
        inventoryStashId: c.inventoryStashId,
      };
    }),
  );

  function eligibleStats(trigger: BatchRechargeTrigger): {
    total: number;
    formulaCount: number;
  } {
    if (view.inventoryStashId === null) return { total: 0, formulaCount: 0 };
    let total = 0;
    let formulaCount = 0;
    for (const row of view.items) {
      if (row.ownerId !== view.inventoryStashId) continue;
      const def = view.catalog.find((d) => d.id === row.definitionId);
      if (def?.charges === undefined) continue;
      if (!chargesRules.eligibleForBatchRecharge(def.charges, trigger)) continue;
      if ((row.currentCharges ?? 0) >= def.charges.max) continue;
      total += 1;
      if (def.charges.rechargeAmount !== undefined) formulaCount += 1;
    }
    return { total, formulaCount };
  }

  function onRest(trigger: BatchRechargeTrigger): void {
    const { total, formulaCount } = eligibleStats(trigger);
    // R2.2.1 — if any eligible row has a roll formula, defer to the
    // modal. The modal dispatches on Apply with the per-row amounts.
    if (formulaCount > 0) {
      setPendingRoll(trigger);
      return;
    }
    // No formula-bearing items: dispatch immediately (R2.2 behavior).
    try {
      dispatch({ type: 'recharge', payload: { mode: 'batch', characterId, trigger } });
      if (total === 0) {
        toast.info('No items needed recharging');
      } else {
        toast.success(`${total} item${total === 1 ? '' : 's'} recharged`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to recharge');
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="gap-1.5">
            <Moon className="h-4 w-4" aria-hidden="true" />
            Rest
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {BATCH_TRIGGER_ORDER.map((trigger) => (
            <DropdownMenuItem
              key={trigger}
              onSelect={() => {
                onRest(trigger);
              }}
            >
              {batchTriggerLabel(trigger)}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem
            disabled
            title="DM force-recharge — R6"
            aria-label="Custom (DM force-recharge — R6)"
          >
            Custom…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {pendingRoll !== null ? (
        <RestRollModal
          open={pendingRoll !== null}
          onOpenChange={(open) => {
            if (!open) setPendingRoll(null);
          }}
          characterId={characterId}
          trigger={pendingRoll}
        />
      ) : null}
    </>
  );
}
