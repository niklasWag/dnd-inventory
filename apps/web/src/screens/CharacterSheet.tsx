import { useState, type ReactElement } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react';

import { charges as chargesRules } from '@app/rules';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { DeleteCharacterDialog } from '@/components/character/DeleteCharacterDialog';
import { AddItemModal } from '@/components/stash/AddItemModal';
import { CurrencyRow } from '@/components/stash/CurrencyRow';
import { InventoryPanel } from '@/components/stash/InventoryPanel';
import { useStore } from '@/store';
import { useDispatch } from '@/lib/useDispatch';
import { BATCH_TRIGGER_ORDER, batchTriggerLabel, type BatchRechargeTrigger } from '@/lib/charges';

/**
 * CharacterSheet (OUTLINE §5 screen 2) — R9.3 Combined layout.
 *
 * R9.3 dropped the old 4-tab model (Inventory / Storage / Party Stash /
 * Recovered Loot). Those are now separate sidebar-routed pages (Stashes
 * is per-character; Party Stash + Recovered Loot are party-wide — see the
 * router). This screen is now **Inventory-only**: the character header, a
 * prominent currency panel, the framed inventory table (`InventoryPanel`
 * with its in-card search/category/quick-filter toolbar), and a right rail
 * with the equipped/attuned loadout + encumbrance bar. Mirrors
 * `design-lab/src/character/CharacterCombined.tsx`.
 */
export function CharacterSheet(): ReactElement {
  const { id } = useParams<{ id: string }>();
  const sheet = useStore(
    useShallow((s) => {
      if (s.appState === null) return null;
      const c = s.appState.characters.find((ch) => ch.id === id);
      if (c === undefined) return null;
      // R4.5 — cross-character cue. When a DM is viewing another player's
      // character, surface a subtle "editing X's character" banner.
      // Suppressed in solo (§8.2) + for own-character views.
      const myUserId = s.appState.user.id;
      const userIsDm = s.appState.memberships.some(
        (m) => m.userId === myUserId && m.role === 'dm' && m.leftAt === null,
      );
      const isCrossCharacterDmView =
        userIsDm && c.ownerUserId !== null && c.ownerUserId !== myUserId;
      // R6.0 — "Edit character" visibility: owner OR DM OR solo (§8.2
      // union-of-rights). Non-DM viewers of another's character don't see it.
      const activeMemberships = s.appState.memberships.filter((m) => m.leftAt === null);
      const isSolo = new Set(activeMemberships.map((m) => m.userId)).size === 1;
      const isOwner = c.ownerUserId === myUserId;
      const canEditCharacter = userIsDm || isOwner || isSolo;
      return {
        character: c,
        inventoryStashId: c.inventoryStashId,
        isCrossCharacterDmView,
        canEditCharacter,
      };
    }),
  );
  const [adding, setAdding] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (sheet === null) {
    return <Navigate to="/" replace />;
  }

  const { character, inventoryStashId, isCrossCharacterDmView, canEditCharacter } = sheet;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge className="bg-primary/10 text-primary hover:bg-primary/10">
              Lv {character.level}
            </Badge>
            <span>
              {character.species} · {character.class}
            </span>
            <span className="text-muted-foreground/60">·</span>
            <span className="tabular-nums">STR {character.abilityScores.STR}</span>
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight">{character.name}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" onClick={() => setAdding(true)}>
            Add item
          </Button>
          <RestMenu characterId={character.id} />
          {canEditCharacter ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" aria-label="Character options">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setEditOpen(true)}>
                  <Pencil className="mr-2 h-4 w-4" aria-hidden="true" />
                  Edit character
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onSelect={() => setDeleteOpen(true)}
                >
                  <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                  Delete character
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </header>

      {canEditCharacter ? (
        <>
          <EditCharacterDialog
            characterId={character.id}
            open={editOpen}
            onOpenChange={setEditOpen}
          />
          <DeleteCharacterDialog
            characterId={character.id}
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
          />
        </>
      ) : null}

      {isCrossCharacterDmView ? (
        <div
          role="note"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200"
        >
          Editing {character.name}'s character as DM.
        </div>
      ) : null}

      <CurrencyRow stashId={inventoryStashId} />

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <InventoryPanel stashId={inventoryStashId} title="Inventory" characterId={character.id} />
        <aside className="space-y-4 lg:sticky lg:top-8 lg:self-start">
          <EquippedSlotsPanel characterId={character.id} />
          <CapacityBar characterId={character.id} />
        </aside>
      </div>

      <AddItemModal
        open={adding}
        onOpenChange={setAdding}
        stashId={inventoryStashId}
        stashLabel="Inventory"
      />
    </div>
  );
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
  const dispatch = useDispatch();
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
    void dispatch(
      { type: 'recharge', payload: { mode: 'batch', characterId, trigger } },
      {
        onSuccess: () => {
          if (total === 0) {
            toast.info('No items needed recharging');
          } else {
            toast.success(`${total} item${total === 1 ? '' : 's'} recharged`);
          }
        },
        onRejection: (_code, message) => toast.error(message ?? 'Failed to recharge'),
      },
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm">
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
