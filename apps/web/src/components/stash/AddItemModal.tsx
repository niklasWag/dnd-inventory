import { type ReactElement, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

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
 *   - **Custom** — stubbed; the homebrew form lands in M6.
 *
 * Closing after add is deliberately the parent's decision (the user can
 * add multiple items in one sitting). `CatalogPicker` calls `onAdded` to
 * give the modal a chance to react, but we leave it open by default.
 */
export function AddItemModal({
  open,
  onOpenChange,
  stashId,
  stashLabel,
}: AddItemModalProps): ReactElement {
  const [tab, setTab] = useState<Tab>('catalog');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add item to {stashLabel}</DialogTitle>
          <DialogDescription>
            Pick from the catalog or, in M6, build a custom item.
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
          <p className="py-8 text-center text-sm text-muted-foreground">
            Custom item creation arrives in M6.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
