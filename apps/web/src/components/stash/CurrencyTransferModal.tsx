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
import { useDispatch } from '@/lib/useDispatch';
import { currency } from '@app/rules';
import { buildStashLabels } from '@/lib/stashLabels';

interface CurrencyTransferModalProps {
  /** The pre-selected source stash (the `<CurrencyRow>` that opened the modal). */
  stashId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DENOMS = ['cp', 'sp', 'ep', 'gp', 'pp'] as const;
type Denom = (typeof DENOMS)[number];
const DENOM_LABEL: Record<Denom, string> = { cp: 'CP', sp: 'SP', ep: 'EP', gp: 'GP', pp: 'PP' };

const ZERO_HOLDING: Record<Denom, number> = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
const EMPTY_TARGETS: ReadonlyArray<{ id: string; label: string }> = [];

/**
 * Atomic currency transfer between two stashes (M5.5 / OUTLINE §4
 * `currency-transfer`). Five denomination inputs + a target stash
 * picker; the source is fixed (passed in by `<CurrencyRow>`).
 *
 * Validation:
 *   - At least one denomination > 0 (Zod refine — all-zero rejected).
 *   - Each denomination \u2264 source.holding[denom] (inline check; the
 *     reducer also re-validates via `currency.subtract`).
 *   - Source \u2260 target (Zod default-target excludes the source).
 *
 * Pattern: copies `ConvertCurrencyModal` for the same reasons —
 * plain `<select>` for jsdom-friendliness, static Zod schema with
 * inline upper-bound checks for the per-denomination max so RHF's
 * generics stay happy (the M5 SplitModal has the same pattern).
 */
const formSchema = z
  .object({
    toStashId: z.string().min(1, 'Pick a target stash'),
    cp: z.coerce.number().int().min(0),
    sp: z.coerce.number().int().min(0),
    ep: z.coerce.number().int().min(0),
    gp: z.coerce.number().int().min(0),
    pp: z.coerce.number().int().min(0),
  })
  .refine((v) => v.cp + v.sp + v.ep + v.gp + v.pp > 0, {
    message: 'Move at least one coin',
    path: ['cp'],
  });

type FormValues = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

export function CurrencyTransferModal({
  stashId,
  open,
  onOpenChange,
}: CurrencyTransferModalProps): ReactElement {
  const dispatch = useDispatch();
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Source's current holding — drives per-denom max bounds + the "insufficient"
  // disable state on submit.
  const holding = useStore(
    useShallow((s): Record<Denom, number> => {
      const c = s.appState?.currencies.find((row) => row.stashId === stashId);
      if (c === undefined) return ZERO_HOLDING;
      return { cp: c.cp, sp: c.sp, ep: c.ep, gp: c.gp, pp: c.pp };
    }),
  );

  // Candidate target stashes — every stash except the source. Labels via the
  // shared `buildStashLabels` helper so character-scope rows are prefixed.
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
      .filter((st) => st.id !== stashId)
      .map((st) => ({ id: st.id, label: labelById.get(st.id) ?? st.name }));
  }, [stashes, characters, log, stashId]);

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
    defaultValues: {
      toStashId: defaultTargetId,
      cp: 0,
      sp: 0,
      ep: 0,
      gp: 0,
      pp: 0,
    },
  });

  useEffect(() => {
    if (open) {
      reset({
        toStashId: defaultTargetId,
        cp: 0,
        sp: 0,
        ep: 0,
        gp: 0,
        pp: 0,
      });
      setSubmitError(null);
    }
  }, [open, defaultTargetId, reset]);

  // Watch every denom to compute "insufficient" / "all zero" state inline
  // (the upper-bound check can't live on a static Zod schema because the
  // bound depends on the live holding — same trick as M5's MoveItemModal).
  const watched = watch();
  const parsed: Record<Denom, number> = {
    cp: numericOrZero(watched.cp),
    sp: numericOrZero(watched.sp),
    ep: numericOrZero(watched.ep),
    gp: numericOrZero(watched.gp),
    pp: numericOrZero(watched.pp),
  };
  const insufficient = DENOMS.find((d) => parsed[d] > holding[d]);
  const totalCoinsRequested = parsed.cp + parsed.sp + parsed.ep + parsed.gp + parsed.pp;

  function onSubmit(values: FormOutput): void {
    const delta = { cp: values.cp, sp: values.sp, ep: values.ep, gp: values.gp, pp: values.pp };
    const over = DENOMS.find((d) => delta[d] > holding[d]);
    if (over !== undefined) {
      setSubmitError(
        `Insufficient ${DENOM_LABEL[over]}: have ${String(holding[over])}, requested ${String(delta[over])}`,
      );
      return;
    }
    setSubmitError(null);
    void dispatch(
      {
        type: 'currency-transfer',
        payload: {
          fromStashId: stashId,
          toStashId: values.toStashId,
          delta,
        },
      },
      {
        onSuccess: () => {
          toast.success('Currency transferred');
          onOpenChange(false);
        },
        onRejection: (_code, message) => setSubmitError(message ?? 'Unknown error'),
      },
    );
  }

  const totalGpEquivalent = currency.toGpEquivalent(parsed);
  const canSubmit = targets.length > 0 && insufficient === undefined && totalCoinsRequested > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transfer currency</DialogTitle>
          <DialogDescription>
            Move coins between stashes atomically. Enter how many of each denomination to send.
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
            <Label htmlFor="currency-transfer-target">Target stash</Label>
            <select
              id="currency-transfer-target"
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

          <div className="grid grid-cols-5 gap-2">
            {DENOMS.map((d) => (
              <div key={d} className="space-y-1.5">
                <Label htmlFor={`currency-transfer-${d}`}>{DENOM_LABEL[d]}</Label>
                <Input
                  id={`currency-transfer-${d}`}
                  type="number"
                  min={0}
                  max={holding[d]}
                  step={1}
                  {...register(d)}
                />
                <p className="text-xs text-muted-foreground tabular-nums">have {holding[d]}</p>
              </div>
            ))}
          </div>

          {errors.cp?.message !== undefined ? (
            <p className="text-sm text-destructive" role="alert">
              {errors.cp.message}
            </p>
          ) : null}

          <p className="text-sm text-muted-foreground" role="status">
            {totalCoinsRequested === 0
              ? 'Enter at least one coin to send.'
              : insufficient !== undefined
                ? `Insufficient ${DENOM_LABEL[insufficient]}: have ${String(holding[insufficient])}, requested ${String(parsed[insufficient])}`
                : `Sending ${String(totalGpEquivalent)} gp equivalent.`}
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
              {isSubmitting ? 'Transferring…' : 'Transfer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function numericOrZero(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}
