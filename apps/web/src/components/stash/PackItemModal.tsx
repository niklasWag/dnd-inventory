import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useStore, dispatchMintingAction } from '@/store';
import type { ItemDefinition, ItemInstance } from '@app/shared';

interface PackItemModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemInstanceId: string;
}

interface TargetOption {
  id: string;
  label: string;
}

const EMPTY_ITEMS: readonly ItemInstance[] = [];
const EMPTY_CATALOG: readonly ItemDefinition[] = [];

/**
 * R1.5 — pack a free top-level item into a container in the SAME stash.
 *
 * The modal lists every container row that lives in the source row's
 * stash (matched via `definitionId` → `ItemDefinition.category ===
 * 'container'`), excluding the source row itself. Submit dispatches a
 * `transfer` with `toContainerInstanceId` set to the selected parent;
 * quantity is always the full stack (partial pack adds split semantics
 * that the v1 R1.5 scope deliberately skips — the user splits first
 * via the existing M5 SplitModal, then packs one of the resulting rows).
 *
 * Reducer-side guards (self-ref / one-level-deep / same-stash / unknown
 * id) are mirrored at the UI level by filtering the target list down to
 * legal candidates only — the user shouldn't see options that would
 * reject, but a try/catch around dispatch surfaces any race.
 *
 * Cross-stash packing ("move into the chest's backpack in one dispatch")
 * is intentionally out of v1 scope; users do a 2-step transfer-then-pack.
 *
 * Implementation note on selectors: `targets` is derived in `useMemo`
 * over raw `items` + `catalog` slices, NOT in a `useShallow` selector,
 * because a fresh `.map(...)` result fails shallow comparison and causes
 * an infinite render loop under React 19 + Zustand's `useSyncExternal-
 * Store`. Mirrors the R1.1 CapacityBar fix.
 */
export function PackItemModal({
  open,
  onOpenChange,
  itemInstanceId,
}: PackItemModalProps): ReactElement {
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Source row snapshot — primitives only, so `useShallow` short-circuits.
  const source = useStore(
    useShallow((s) => {
      const row = s.appState?.items.find((i) => i.id === itemInstanceId);
      if (row === undefined) return null;
      return {
        ownerId: row.ownerId,
        quantity: row.quantity,
        definitionId: row.definitionId,
      };
    }),
  );

  // Raw store slices — stable identities (Zustand returns the same array
  // reference until the underlying data actually changes).
  const items = useStore((s) => s.appState?.items ?? EMPTY_ITEMS);
  const catalog = useStore((s) => s.appState?.catalog ?? EMPTY_CATALOG);

  // Candidate containers in the SAME stash, excluding the source row.
  // One-level-deep is enforced reducer-side; we ALSO filter here so the
  // dropdown stays clean.
  const targets = useMemo<ReadonlyArray<TargetOption>>(() => {
    if (source === null) return [];
    const defsById = new Map(catalog.map((d) => [d.id, d]));
    return items
      .filter((row) => {
        if (row.ownerId !== source.ownerId) return false;
        if (row.id === itemInstanceId) return false;
        if (row.containerInstanceId !== null) return false; // would create two-level nesting
        const def = defsById.get(row.definitionId);
        return def?.category === 'container';
      })
      .map((row) => {
        const def = defsById.get(row.definitionId);
        const baseName = row.customName ?? def?.name ?? '(unknown container)';
        const suffix = row.notes !== undefined ? ` (${row.notes})` : '';
        return { id: row.id, label: `${baseName}${suffix}` };
      });
  }, [items, catalog, source, itemInstanceId]);

  const [selected, setSelected] = useState<string>('');
  const defaultTargetId = targets[0]?.id ?? '';

  useEffect(() => {
    if (open) {
      setSelected(defaultTargetId);
      setSubmitError(null);
    }
  }, [open, defaultTargetId]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (source === null || selected === '') return;
    setSubmitError(null);
    const outcome = await dispatchMintingAction({
      type: 'transfer',
      payload: {
        itemInstanceId,
        toStashId: source.ownerId,
        quantity: source.quantity,
        toContainerInstanceId: selected,
      },
    });
    if (!outcome.ok) {
      setSubmitError(outcome.message ?? 'Unknown error');
      return;
    }
    toast.success('Item packed');
    onOpenChange(false);
  }

  const canSubmit = source !== null && selected !== '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pack into container</DialogTitle>
          <DialogDescription>
            Choose a container in this stash. The item moves inside; you can take it back out
            anytime.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            void onSubmit(e);
          }}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-1.5">
            <Label htmlFor="pack-target">Target container</Label>
            <select
              id="pack-target"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
              }}
            >
              {targets.length === 0 ? (
                <option value="" disabled>
                  No containers in this stash
                </option>
              ) : (
                targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))
              )}
            </select>
          </div>

          {submitError !== null ? (
            <p className="text-sm text-destructive" role="alert">
              {submitError}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              Pack
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
