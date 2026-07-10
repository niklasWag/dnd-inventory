import { type ReactElement, useEffect, useState } from 'react';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { HomebrewForm } from '@/components/catalog/HomebrewForm';
import { dispatchMintingAction } from '@/store';

import { CatalogPicker } from './CatalogPicker';

interface AddItemModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stashId: string;
  stashLabel: string;
}

type Tab = 'catalog' | 'custom';

/**
 * Modal for adding items to a stash (MVP §7 screen 5). Two tabs:
 *   - **Catalog** — search PHB + homebrew, set qty, "Add to [stash]". M2.
 *   - **Custom** — opens the M6 HomebrewForm in create mode. On save, the
 *     newly-created homebrew row is immediately acquired into the
 *     current stash (`source: 'custom-create'`).
 *
 * Closing after add is deliberately the parent's decision (the user can
 * add multiple items in one sitting). `CatalogPicker` calls `onAdded` to
 * give the modal a chance to react, but we leave it open by default.
 *
 * **Tab navigation invariants:**
 *   - Every fresh open resets to the Catalog tab — Catalog is the
 *     default. A previously-open Custom tab state does not survive
 *     a close/reopen cycle.
 *   - Cancelling out of the Custom tab's HomebrewForm switches back to
 *     the Catalog tab (it does NOT close the parent modal). Only a
 *     successful homebrew create closes the parent, via `onCreated`.
 */
export function AddItemModal({
  open,
  onOpenChange,
  stashId,
  stashLabel,
}: AddItemModalProps): ReactElement {
  const [tab, setTab] = useState<Tab>('catalog');

  // Reset to Catalog every time the modal opens. Without this, a user
  // who left on the Custom tab last time would see it again — confusing
  // because Catalog is the canonical default per MVP §7 screen 5.
  useEffect(() => {
    if (open) {
      setTab('catalog');
    }
  }, [open]);

  function handleHomebrewCreated(definitionId: string): void {
    // Custom tab semantics (MVP §5 flow #5): saves to catalog AND adds
    // to the current stash. Two log entries result (create-homebrew +
    // acquire) — that's the desired audit trail per OUTLINE §3.4.
    // R1.4 — the acquire half can be reducer-rejected when hard-mode
    // encumbrance would be tripped; surface as a toast so the homebrew
    // creation still survives but the add doesn't silently fail.
    try {
      void dispatchMintingAction({
        type: 'acquire',
        payload: {
          stashId,
          definitionId,
          quantity: 1,
          source: 'custom-create',
        },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add item');
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add item to {stashLabel}</DialogTitle>
          <DialogDescription>
            Pick from the catalog or build a custom homebrew item.
          </DialogDescription>
        </DialogHeader>

        <div className="border-b border-border">
          <nav className="-mb-px flex gap-1" aria-label="Add item source">
            {(['catalog', 'custom'] as const).map((id) => {
              const active = id === tab;
              const label = id === 'catalog' ? 'Catalog' : 'Custom';
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(id)}
                  className={
                    'border-b-2 px-3 py-2 text-sm font-medium transition-colors ' +
                    (active
                      ? 'border-foreground text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground')
                  }
                >
                  {label}
                </button>
              );
            })}
          </nav>
        </div>

        {tab === 'catalog' ? (
          <CatalogPicker stashId={stashId} stashLabel={stashLabel} />
        ) : (
          <div className="py-2 text-sm text-muted-foreground">
            <p className="mb-3">
              Build a homebrew item. It joins the catalog and is added to{' '}
              <strong>{stashLabel}</strong>.
            </p>
            <HomebrewForm
              open={true}
              variant="inline"
              onOpenChange={(formOpen) => {
                // Cancelling the inline HomebrewForm returns the user
                // to the Catalog tab — NOT close the parent
                // AddItemModal. A successful create closes the parent
                // via `onCreated -> handleHomebrewCreated`; cancellation
                // is the only path through this branch.
                if (!formOpen) setTab('catalog');
              }}
              mode="create"
              onCreated={handleHomebrewCreated}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
