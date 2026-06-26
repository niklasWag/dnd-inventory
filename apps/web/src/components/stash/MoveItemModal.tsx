import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useStore } from '@/store';
import { buildStashLabels } from '@/lib/stashLabels';

interface MoveItemModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemInstanceId: string;
}

interface SourceSnapshot {
  ownerId: string;
  quantity: number;
  // R1.3 — used to render a "this will lose equipped/attuned state"
  // warning before the user confirms a leave-Inventory transfer.
  equipped: boolean;
  attuned: boolean;
  /** True when the source row lives in a character's Inventory stash. */
  isInInventory: boolean;
}

const EMPTY_TARGETS: ReadonlyArray<{ id: string; label: string }> = [];

/**
 * Move an item (or part of it) between any two stashes (M5 / OUTLINE §3.4
 * "Move item between any two stashes the actor has permission for").
 *
 * Fields:
 *   - **Target stash**: native `<select>` populated with every stash
 *     except the source's current stash. Labels follow the
 *     `{Character} \u2014 {Stash}` convention for character-scope rows;
 *     party/recovered-loot get bare names (`buildStashLabels` is the
 *     single source of truth, shared with `<ItemHistory>`).
 *   - **Quantity**: defaults to the full stack quantity; the Zod schema
 *     enforces a positive integer. The upper-bound check
 *     (`qty <= source.quantity`) is done inline below the form so the
 *     schema shape stays static — see ConvertCurrencyModal for the same
 *     trick.
 *
 * Auto-stack-on-arrival is handled by the reducer; the UI is unaware
 * (the success toast just says "Item moved").
 *
 * Uses plain `<select>` rather than the Radix Select primitive for the
 * same reason `ConvertCurrencyModal` does: works visually in a Dialog,
 * far easier to test in jsdom.
 */
const formSchema = z.object({
  toStashId: z.string().min(1, 'Pick a target stash'),
  quantity: z.coerce.number().int().min(1, 'Quantity must be at least 1'),
});

type FormValues = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

export function MoveItemModal({
  open,
  onOpenChange,
  itemInstanceId,
}: MoveItemModalProps): ReactElement {
  const dispatch = useStore((s) => s.dispatch);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Source row snapshot.
  const source = useStore(
    useShallow((s): SourceSnapshot | null => {
      const row = s.appState?.items.find((i) => i.id === itemInstanceId);
      if (row === undefined) return null;
      const stash = s.appState?.stashes.find((st) => st.id === row.ownerId);
      const isInInventory =
        stash !== undefined && stash.scope === 'character' && stash.isCarried === true;
      return {
        ownerId: row.ownerId,
        quantity: row.quantity,
        equipped: row.equipped,
        attuned: row.attuned,
        isInInventory,
      };
    }),
  );
  const sourceQty = source?.quantity ?? 0;
  const sourceStashId = source?.ownerId ?? '';
  // R1.3 — surfaces the §3.4 cascade about to fire: a leave-Inventory
  // transfer auto-clears equipped/attuned on the moved row. We tell the
  // user *before* they confirm so they're not surprised when the row
  // comes back un-equipped after a round trip.
  const willLoseFlags =
    source !== null && source.isInInventory === true && (source.equipped || source.attuned);
  const lostFlagNames: string[] = [];
  if (source?.equipped) lostFlagNames.push('equipped');
  if (source?.attuned) lostFlagNames.push('attuned');

  // Build the candidate target list. Excludes the source's current stash.
  // Labels via the shared `buildStashLabels` helper.
  const { stashes, characters, log } = useStore(
    useShallow((s) => ({
      stashes: s.appState?.stashes ?? null,
      characters: s.appState?.characters ?? null,
      log: s.log,
    })),
  );
  const targets = useMemo<ReadonlyArray<{ id: string; label: string }>>(() => {
    if (stashes === null) return EMPTY_TARGETS;
    const labelById = buildStashLabels(stashes, characters, log);
    return stashes
      .filter((st) => st.id !== sourceStashId)
      .map((st) => ({
        id: st.id,
        label: labelById.get(st.id) ?? st.name,
      }));
  }, [stashes, characters, log, sourceStashId]);

  const defaultTargetId = targets[0]?.id ?? '';

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    mode: 'onChange',
    defaultValues: { toStashId: defaultTargetId, quantity: sourceQty || 1 },
  });

  useEffect(() => {
    if (open) {
      reset({ toStashId: defaultTargetId, quantity: sourceQty || 1 });
      setSubmitError(null);
    }
  }, [open, defaultTargetId, sourceQty, reset]);

  const rawQty: unknown = watch('quantity');
  const parsedQty = typeof rawQty === 'number' ? rawQty : Number(rawQty);
  const overQuantity =
    Number.isInteger(parsedQty) && parsedQty > sourceQty
      ? `Quantity must not exceed the stack size (${String(sourceQty)})`
      : null;

  function onSubmit(values: FormOutput): void {
    if (values.quantity > sourceQty) {
      setSubmitError(`Quantity exceeds stack size (${String(sourceQty)})`);
      return;
    }
    try {
      setSubmitError(null);
      dispatch({
        type: 'transfer',
        payload: {
          itemInstanceId,
          toStashId: values.toStashId,
          quantity: values.quantity,
        },
      });
      toast.success('Item moved');
      onOpenChange(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  const canSubmit =
    targets.length > 0 &&
    sourceQty >= 1 &&
    Number.isInteger(parsedQty) &&
    parsedQty >= 1 &&
    parsedQty <= sourceQty;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move item</DialogTitle>
          <DialogDescription>
            Move this stack (or part of it) into another stash. Matching rows on the destination
            auto-stack.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            void handleSubmit(onSubmit)(e);
          }}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-1.5">
            <Label htmlFor="move-target">Target stash</Label>
            <select
              id="move-target"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              {...register('toStashId')}
            >
              {targets.length === 0 ? (
                <option value="" disabled>
                  No other stashes available
                </option>
              ) : (
                targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))
              )}
            </select>
            {errors.toStashId?.message !== undefined ? (
              <p className="text-sm text-destructive" role="alert">
                {errors.toStashId.message}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="move-qty">Quantity</Label>
            <Input
              id="move-qty"
              type="number"
              min={1}
              max={sourceQty}
              step={1}
              {...register('quantity')}
            />
            {errors.quantity?.message !== undefined ? (
              <p className="text-sm text-destructive" role="alert">
                {errors.quantity.message}
              </p>
            ) : overQuantity !== null ? (
              <p className="text-sm text-destructive" role="alert">
                {overQuantity}
              </p>
            ) : null}
          </div>

          {willLoseFlags ? (
            <p
              className="rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
              role="status"
            >
              <span className="font-medium">Heads up:</span> this item is{' '}
              {lostFlagNames.join(' and ')}. Moving it out of Inventory will clear{' '}
              {lostFlagNames.length === 1 ? 'that' : 'those'} state
              {lostFlagNames.length === 1 ? '' : 's'}.
            </p>
          ) : null}

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
            <Button type="submit" disabled={!canSubmit || isSubmitting}>
              {isSubmitting ? 'Moving…' : 'Move'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
