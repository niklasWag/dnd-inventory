import { useMemo, useState, type ReactElement } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useCurrentPartyId } from '@/lib/useCurrentPartyId';
import { AddItemModal } from '@/components/stash/AddItemModal';
import { CurrencyBreakdown } from '@/components/stash/CurrencyBreakdown';
import { CurrencyRow } from '@/components/stash/CurrencyRow';
import { InventoryPanel } from '@/components/stash/InventoryPanel';
import { RenameStashModal } from '@/components/stash/RenameStashModal';
import { DeleteStashDialog } from '@/components/stash/DeleteStashDialog';
import { useStore } from '@/store';

/**
 * StorageDetail (MVP §7 screen 3; R9.5 restyle).
 *
 * Renders one Storage stash's items list with rename + delete affordances
 * and an in-screen Back button (per the M2.5 UX principle: detail routes
 * own their own Back; `RootLayout` stays minimal).
 *
 * R9.5 — the items list now uses the shared `InventoryPanel` (framed card +
 * in-card toolbar: search + category select + quick-filter pills) so Storage
 * reads identically to the Inventory / Party Stash / Recovered Loot screens.
 * No `characterId` is passed — equip/attune are Inventory-only (§3.4), so the
 * panel shows only the base quick-filters. The panel owns its own search
 * state, retiring the former per-screen `StashSearchInput` + `query`.
 *
 * Guards:
 *   - Unknown stashId → `<Navigate to="/" replace />` (no record to show).
 *   - Non-Storage stash id (Inventory / Party / Recovered Loot) → same.
 *     Those stashes live on their own dedicated screens, not this route.
 *
 * Selector design (M2.5 + StorageOverview lesson): we pull the raw
 * primitives we need through `useShallow` and derive the rest in the
 * component body via `useMemo`. Returning freshly-built nested objects
 * from the selector triggers the infinite-update loop because
 * `useShallow` compares the outer container by shallow-equality but the
 * inner object references change each render.
 */
export function StorageDetail(): ReactElement {
  const { stashId } = useParams<{ stashId: string }>();
  const partyId = useCurrentPartyId();
  const navigate = useNavigate();

  const view = useStore(
    useShallow((s) => {
      if (s.appState === null || stashId === undefined) {
        return null;
      }
      const stash = s.appState.stashes.find((st) => st.id === stashId);
      if (stash === undefined) return null;
      // Only Storage stashes belong on this route. Inventory / Party /
      // Recovered Loot redirect.
      if (stash.scope !== 'character' || stash.isCarried) return null;
      const character = s.appState.characters.find((c) => c.id === stash.ownerCharacterId);
      if (character === undefined) return null;
      return {
        stashId: stash.id,
        stashName: stash.name,
        characterId: character.id,
      };
    }),
  );

  // Item count is a separate primitive selector so re-renders that only
  // touch other unrelated state don't re-evaluate it.
  const items = useStore(useShallow((s) => s.appState?.items ?? null));
  const itemCount = useMemo(() => {
    if (items === null || view === null) return 0;
    return items.filter((i) => i.ownerId === view.stashId).reduce((sum, i) => sum + i.quantity, 0);
  }, [items, view]);

  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [adding, setAdding] = useState(false);

  if (view === null) return <Navigate to="/" replace />;
  const { stashName, characterId } = view;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          void navigate(`/party/${partyId}/character/${characterId}/stashes`);
        }}
        className="-ml-2 h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Storage
      </Button>

      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-display text-3xl font-bold tracking-tight">{stashName}</h1>
          <p className="text-sm text-muted-foreground">
            Storage stash · {itemCount} {itemCount === 1 ? 'item' : 'items'} ·{' '}
            <CurrencyBreakdown stashId={view.stashId} />
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setRenaming(true);
            }}
          >
            <Pencil className="h-4 w-4" />
            Rename
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setDeleting(true);
            }}
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        </div>
      </header>

      <CurrencyRow stashId={view.stashId} />

      <InventoryPanel
        stashId={view.stashId}
        title="Items"
        action={
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setAdding(true);
            }}
          >
            Add item
          </Button>
        }
      />

      <AddItemModal
        open={adding}
        onOpenChange={setAdding}
        stashId={view.stashId}
        stashLabel={stashName}
      />
      <RenameStashModal
        open={renaming}
        onOpenChange={setRenaming}
        stashId={view.stashId}
        currentName={stashName}
      />
      <DeleteStashDialog
        open={deleting}
        onOpenChange={setDeleting}
        stashId={view.stashId}
        stashName={stashName}
        itemCount={itemCount}
        onDeleted={() => {
          void navigate(`/party/${partyId}/character/${characterId}/stashes`);
        }}
      />
    </div>
  );
}
