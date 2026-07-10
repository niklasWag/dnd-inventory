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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useStore } from '@/store';
import { useDispatch } from '@/lib/useDispatch';

interface DrainCurrencyModalProps {
  /** Shared-pool stash id (Party Stash or Recovered Loot). */
  stashId: string;
  /** Human-readable stash name for the dialog copy. */
  stashLabel: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DENOMS = ['cp', 'sp', 'ep', 'gp', 'pp'] as const;
type Denom = (typeof DENOMS)[number];
const DENOM_LABEL: Record<Denom, string> = { cp: 'CP', sp: 'SP', ep: 'EP', gp: 'GP', pp: 'PP' };
const ZERO: Record<Denom, number> = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };

/**
 * R4.2.e — DM "Drain for gameplay reasons" modal. Only relevant when
 * a Banker is active (otherwise the DM can just use the normal
 * `<CurrencyRow>` −/+ inline controls). Emits a `currency-change`
 * entry with `reason: 'gameplay-drain'` — the R4.2.d Banker gate
 * bypass permits this even when non-DM shared-pool withdrawals are
 * rejected.
 *
 * Pattern: mirrors the confirm-dialog shape of the leave/kick
 * confirmations rather than the freeform-input shape of
 * `<CurrencyTransferModal>`. Per-denom inputs are still needed
 * (a drain is quantitative), but the framing is intentionally
 * heavier than a normal withdraw — the label reads "Drain X for
 * gameplay reasons" so the DM confirms world-level intent
 * (magical drain, NPC tax, theft — see OUTLINE §8.1 row 464).
 *
 * The dialog's Confirm button dispatches immediately; there's no
 * separate preview because the amounts entered ARE the preview.
 * If a denomination would go negative on the pool, the reducer's
 * `currency.subtract` throws and the toast surfaces the error.
 */
export function DrainCurrencyModal({
  stashId,
  stashLabel,
  open,
  onOpenChange,
}: DrainCurrencyModalProps): ReactElement {
  const dispatch = useDispatch();
  const holding = useStore(
    useShallow((s) => {
      const c = s.appState?.currencies.find((row) => row.stashId === stashId);
      if (c === undefined) return ZERO;
      return { cp: c.cp, sp: c.sp, ep: c.ep, gp: c.gp, pp: c.pp };
    }),
  );

  const [amounts, setAmounts] = useState<Record<Denom, number>>({ ...ZERO });
  useEffect(() => {
    if (open) setAmounts({ ...ZERO });
  }, [open]);

  const someNonZero = useMemo(() => DENOMS.some((d) => amounts[d] > 0), [amounts]);
  const overspending = useMemo(
    () => DENOMS.some((d) => amounts[d] > holding[d]),
    [amounts, holding],
  );

  const setDenom = (d: Denom, raw: string): void => {
    const n = Number(raw);
    setAmounts((prev) => ({ ...prev, [d]: Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0 }));
  };

  function handleConfirm(): void {
    if (!someNonZero || overspending) return;
    // Delta is the NEGATIVE of the entered amounts (drain = subtract).
    // The reducer + persistor treat currency-change delta as signed.
    // Use `-x || 0` to avoid JS's negative-zero (`-0`) leaking into the
    // log payload; equality-by-value tests would still pass but the
    // shape reads oddly.
    const delta = {
      cp: -amounts.cp || 0,
      sp: -amounts.sp || 0,
      ep: -amounts.ep || 0,
      gp: -amounts.gp || 0,
      pp: -amounts.pp || 0,
    };
    void dispatch(
      {
        type: 'currency-change',
        payload: { stashId, delta, reason: 'gameplay-drain' },
      },
      {
        onSuccess: () => {
          toast.success('Drained.');
          onOpenChange(false);
        },
        onRejection: (_code, message) => toast.error(message ?? 'Could not drain currency.'),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Drain from {stashLabel}</DialogTitle>
          <DialogDescription>
            Remove currency for gameplay reasons (magical drain, NPC tax, theft, etc.). This
            bypasses the Banker gate — use it only for world-level effects, not to distribute
            currency to a specific player.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-5 gap-2">
          {DENOMS.map((d) => (
            <div key={d} className="flex flex-col gap-1">
              <Label htmlFor={`drain-${d}`} className="text-xs">
                {DENOM_LABEL[d]}
              </Label>
              <Input
                id={`drain-${d}`}
                type="number"
                min={0}
                max={holding[d]}
                value={amounts[d]}
                onChange={(e) => setDenom(d, e.target.value)}
                aria-label={`Drain ${DENOM_LABEL[d]}`}
              />
              <span className="text-xs text-muted-foreground tabular-nums">/ {holding[d]}</span>
            </div>
          ))}
        </div>

        {overspending ? (
          <p className="text-xs text-destructive">Amount exceeds available in this pool.</p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={!someNonZero || overspending}
            onClick={handleConfirm}
          >
            Drain
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
