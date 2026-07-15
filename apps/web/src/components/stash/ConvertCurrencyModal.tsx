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
import { useStore } from '@/store';
import { useDispatch } from '@/lib/useDispatch';
import { useCanDispatch } from '@/lib/useCanDispatch';
import { currency } from '@app/rules';

interface ConvertCurrencyModalProps {
  stashId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DENOMS = ['cp', 'sp', 'ep', 'gp', 'pp'] as const;
type Denom = (typeof DENOMS)[number];
const DENOM_LABEL: Record<Denom, string> = { cp: 'CP', sp: 'SP', ep: 'EP', gp: 'GP', pp: 'PP' };
const ZERO_HOLDING = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } as const;

/**
 * Convert between denominations on a single stash (M4 / MVP §5 flow #11).
 *
 * Form: qty + source + target. The reducer dispatches a single
 * `currency-change` with `reason: 'convert'` and a mixed delta (source
 * goes negative, target goes positive). Three guards block submit:
 *
 *   1. `source === target` — no-op (the form enforces this; Zod refine).
 *   2. `qty > holding[source]` — insufficient funds.
 *   3. Lossy result (e.g. 1 sp → 0.1 gp) — refuse rather than round.
 *      `currency.convert` would throw too; the UI disables submit so
 *      the user gets immediate feedback.
 *
 * Preview line ("100 sp = 10 gp") renders the calculated target qty so
 * the user sees the result before committing.
 *
 * Uses plain `<select>` elements rather than the Radix Select primitive
 * — works just as well visually inside a Dialog, much easier to test in
 * jsdom (Radix Select relies on portals + complex keyboard navigation
 * that's brittle in vitest).
 */
const formSchema = z
  .object({
    qty: z.coerce.number().int().positive(),
    source: z.enum(['cp', 'sp', 'ep', 'gp', 'pp']),
    target: z.enum(['cp', 'sp', 'ep', 'gp', 'pp']),
  })
  .refine((v) => v.source !== v.target, {
    message: 'Source and target must differ',
    path: ['target'],
  });

type FormValues = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

export function ConvertCurrencyModal({
  stashId,
  open,
  onOpenChange,
}: ConvertCurrencyModalProps): ReactElement {
  const dispatch = useDispatch();
  const canDispatch = useCanDispatch();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const holding = useStore(
    useShallow((s) => {
      const c = s.appState?.currencies.find((row) => row.stashId === stashId);
      if (c === undefined) return ZERO_HOLDING;
      return { cp: c.cp, sp: c.sp, ep: c.ep, gp: c.gp, pp: c.pp };
    }),
  );

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { isSubmitting },
  } = useForm<FormValues, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    mode: 'onChange',
    defaultValues: { qty: 1, source: 'sp', target: 'gp' },
  });

  // Re-seed defaults whenever the modal opens.
  useEffect(() => {
    if (open) {
      reset({ qty: 1, source: 'sp', target: 'gp' });
      setSubmitError(null);
    }
  }, [open, reset]);

  const qtyRaw: unknown = watch('qty');
  const qty = typeof qtyRaw === 'number' ? qtyRaw : Number(qtyRaw);
  const source = watch('source') as Denom | undefined;
  const target = watch('target') as Denom | undefined;

  // Compute the preview + the submit-disabled state without ever
  // throwing. `currency.convert` throws on the lossy/same/<=0 cases so
  // we mirror its checks inline here to keep render pure.
  let previewLine: string | null = null;
  let disableReason: string | null = null;

  if (Number.isInteger(qty) && qty > 0 && source !== undefined && target !== undefined) {
    if (source === target) {
      disableReason = 'Source and target must differ';
    } else if (qty > holding[source]) {
      disableReason = `Insufficient ${DENOM_LABEL[source]}: have ${String(holding[source])}, need ${String(qty)}`;
    } else {
      // Compute via currency.toCopper to detect lossiness without throwing.
      const cpEquivalent = currency.toCopper({ [source]: qty });
      const targetMultiplier = currency.toCopper({ [target]: 1 });
      if (cpEquivalent % targetMultiplier !== 0) {
        disableReason = `Lossy conversion: ${String(qty)} ${DENOM_LABEL[source]} cannot be expressed in whole ${DENOM_LABEL[target]}`;
      } else {
        const targetQty = cpEquivalent / targetMultiplier;
        previewLine = `${String(qty)} ${source} = ${String(targetQty)} ${target}`;
      }
    }
  } else if (!Number.isInteger(qty) || qty <= 0) {
    disableReason = 'Quantity must be a positive integer';
  }

  const canSubmit = previewLine !== null;

  function onSubmit(values: FormOutput): void {
    setSubmitError(null);
    const delta = currency.convert(values.source, values.qty, values.target);
    void dispatch(
      {
        type: 'currency-change',
        payload: { stashId, delta, reason: 'convert' },
      },
      {
        onSuccess: () => {
          toast.success('Currency converted');
          onOpenChange(false);
        },
        onRejection: (_code, message) => setSubmitError(message ?? 'Unknown error'),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Convert currency</DialogTitle>
          <DialogDescription>
            Convert one denomination into another. Lossy conversions (e.g. 1 sp → 0.1 gp) are
            refused; the result must be a whole-number target.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            void handleSubmit(onSubmit)(e);
          }}
          className="space-y-4"
          noValidate
        >
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="convert-qty">Quantity</Label>
              <Input id="convert-qty" type="number" min={1} step={1} {...register('qty')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="convert-source">Source</Label>
              <select
                id="convert-source"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                {...register('source')}
              >
                {DENOMS.map((d) => (
                  <option key={d} value={d}>
                    {DENOM_LABEL[d]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="convert-target">Target</Label>
              <select
                id="convert-target"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                {...register('target')}
              >
                {DENOMS.map((d) => (
                  <option key={d} value={d}>
                    {DENOM_LABEL[d]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <p className="text-sm text-muted-foreground" role="status">
            {previewLine ?? disableReason ?? 'Pick source, target, and a positive quantity.'}
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
            <Button type="submit" disabled={!canSubmit || isSubmitting || !canDispatch}>
              {isSubmitting ? 'Converting…' : 'Convert'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
