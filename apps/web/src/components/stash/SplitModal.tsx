import { useEffect, useState, type ReactElement } from 'react';
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
import { useStore, dispatchMintingAction } from '@/store';

interface SplitModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemInstanceId: string;
}

/**
 * Split a stack into two rows in the same stash (M5). The new row
 * inherits `notes` and `customName` from the source; the user can then
 * edit those via Item Detail (M2.5) to differentiate the two rows.
 *
 * Validation: `1 \u2264 quantity < source.quantity`. The form's Zod
 * resolver gates `quantity >= 1`; the upper-bound check (`qty < sourceQty`)
 * is done inline below the form so the schema shape stays static (RHF's
 * generics don't play well with a per-render Zod schema; see
 * ConvertCurrencyModal for the same pattern).
 *
 * If `itemInstanceId` doesn't resolve (the row was just consumed in a
 * race), the modal closes silently when opened.
 */
const formSchema = z.object({
  quantity: z.coerce.number().int().min(1, 'Quantity must be at least 1'),
});

type FormValues = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

export function SplitModal({ open, onOpenChange, itemInstanceId }: SplitModalProps): ReactElement {
  const [submitError, setSubmitError] = useState<string | null>(null);

  const source = useStore(
    useShallow((s) => {
      const row = s.appState?.items.find((i) => i.id === itemInstanceId);
      if (row === undefined) return null;
      return { quantity: row.quantity };
    }),
  );
  const sourceQty = source?.quantity ?? 0;
  const max = Math.max(sourceQty - 1, 0);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    mode: 'onChange',
    defaultValues: { quantity: 1 },
  });

  useEffect(() => {
    if (open) {
      reset({ quantity: 1 });
      setSubmitError(null);
    }
  }, [open, reset]);

  const rawQty: unknown = watch('quantity');
  const parsedQty = typeof rawQty === 'number' ? rawQty : Number(rawQty);
  const previewSplitQty =
    Number.isInteger(parsedQty) && parsedQty >= 1 && parsedQty <= max ? parsedQty : null;
  const remaining = previewSplitQty !== null ? sourceQty - previewSplitQty : null;

  // Range guard separate from the Zod schema (see header comment).
  const outOfRange =
    Number.isInteger(parsedQty) && parsedQty >= 1 && parsedQty > max
      ? `Quantity must be less than the stack size (${String(sourceQty)})`
      : null;

  function onSubmit(values: FormOutput): void {
    if (values.quantity > max) {
      // Belt-and-braces; the Split button is also disabled in this state.
      setSubmitError(`Quantity must be less than ${String(sourceQty)}`);
      return;
    }
    try {
      setSubmitError(null);
      dispatchMintingAction({
        type: 'split',
        payload: { itemInstanceId, quantity: values.quantity },
      });
      toast.success('Stack split');
      onOpenChange(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  const canSubmit = max >= 1 && previewSplitQty !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Split stack</DialogTitle>
          <DialogDescription>
            Move some of this stack into a new row in the same stash. The new row inherits notes and
            custom name — edit them via Item Detail afterwards.
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
            <Label htmlFor="split-qty">Quantity to split off</Label>
            <Input
              id="split-qty"
              type="number"
              min={1}
              max={max}
              step={1}
              autoFocus
              {...register('quantity')}
            />
            {errors.quantity?.message !== undefined ? (
              <p className="text-sm text-destructive" role="alert">
                {errors.quantity.message}
              </p>
            ) : outOfRange !== null ? (
              <p className="text-sm text-destructive" role="alert">
                {outOfRange}
              </p>
            ) : null}
          </div>

          <p className="text-sm text-muted-foreground" role="status">
            {previewSplitQty !== null && remaining !== null
              ? `Splits \u00d7${String(previewSplitQty)} into a new row; original keeps \u00d7${String(remaining)}.`
              : `Stack has \u00d7${String(sourceQty)}. Pick a quantity between 1 and ${String(max)}.`}
          </p>

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
              {isSubmitting ? 'Splitting…' : 'Split'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
