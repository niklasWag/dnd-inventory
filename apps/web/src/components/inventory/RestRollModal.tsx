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
import { useCanDispatch } from '@/lib/useCanDispatch';
import { batchTriggerLabel, type BatchRechargeTrigger } from '@/lib/charges';

interface RestRollModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  characterId: string;
  trigger: BatchRechargeTrigger;
}

interface FormulaEligibleRow {
  itemInstanceId: string;
  displayName: string;
  rechargeAmount: string;
  deficit: number;
  max: number;
  current: number;
}

interface NonFormulaEligibleRow {
  itemInstanceId: string;
  displayName: string;
}

/**
 * R2.2.1 — Rest dropdown follow-up modal. When the user picks a batch
 * trigger from the Character Sheet Rest menu, this modal opens IF at
 * least one eligible item carries a `rechargeAmount` formula. The
 * user enters one rolled value per formula-bearing item; Apply
 * dispatches a single `recharge` action with `mode: 'batch'` and an
 * `amounts` map. Items without formulas full-recharge automatically
 * (the reducer treats absence from `amounts` as "full recharge").
 *
 * Bounds per input: positive integer ≤ current deficit
 * (`def.charges.max - row.currentCharges`). User just types the
 * physical dice result; the modal doesn't try to parse formula
 * strings or roll randomly (per R2.2.1 plan decision — let the DM
 * roll real dice).
 *
 * Closed without Apply = no dispatch. The non-formula items are NOT
 * recharged in that case either — the user backed out of the whole
 * Rest action.
 */
export function RestRollModal({
  open,
  onOpenChange,
  characterId,
  trigger,
}: RestRollModalProps): ReactElement | null {
  const dispatch = useDispatch();
  const canDispatch = useCanDispatch();

  // Snapshot of eligible items at modal-open time. Captured once via
  // `useMemo` keyed on `open` so the inputs don't shift if state
  // mutates while the modal is up (defensive — there's no other UI
  // path to mutate currentCharges while the modal is open).
  const view = useStore(
    useShallow((s) => {
      if (s.appState === null) {
        return { items: [], catalog: [], stashes: [], inventoryStashId: null } as const;
      }
      const c = s.appState.characters.find((ch) => ch.id === characterId);
      if (c === undefined) {
        return { items: [], catalog: [], stashes: [], inventoryStashId: null } as const;
      }
      return {
        items: s.appState.items,
        catalog: s.appState.catalog,
        stashes: s.appState.stashes,
        inventoryStashId: c.inventoryStashId,
      };
    }),
  );

  const { formulaRows, nonFormulaRows } = useMemo(() => {
    const formulaRows: FormulaEligibleRow[] = [];
    const nonFormulaRows: NonFormulaEligibleRow[] = [];
    if (view.inventoryStashId === null) return { formulaRows, nonFormulaRows };
    for (const row of view.items) {
      if (row.ownerId !== view.inventoryStashId) continue;
      const def = view.catalog.find((d) => d.id === row.definitionId);
      if (def?.charges === undefined) continue;
      if (def.charges.rechargeRule !== trigger) continue;
      const current = row.currentCharges ?? 0;
      if (current >= def.charges.max) continue; // no-op skip
      const displayName = row.customName ?? def.name;
      if (def.charges.rechargeAmount !== undefined) {
        formulaRows.push({
          itemInstanceId: row.id,
          displayName,
          rechargeAmount: def.charges.rechargeAmount,
          deficit: def.charges.max - current,
          max: def.charges.max,
          current,
        });
      } else {
        nonFormulaRows.push({
          itemInstanceId: row.id,
          displayName,
        });
      }
    }
    return { formulaRows, nonFormulaRows };
  }, [open, view.items, view.catalog, view.inventoryStashId, trigger]); // eslint-disable-line react-hooks/exhaustive-deps

  // Per-row input state (string for controlled input; parsed at submit).
  const [rolls, setRolls] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset state every time the modal opens.
  useEffect(() => {
    if (open) {
      setRolls({});
      setErrors({});
    }
  }, [open]);

  if (!open) return null;

  function onChange(id: string, value: string): void {
    setRolls((prev) => ({ ...prev, [id]: value }));
    setErrors((prev) => {
      if (prev[id] === undefined) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function onApply(): void {
    const amounts: Record<string, number> = {};
    const nextErrors: Record<string, string> = {};
    for (const row of formulaRows) {
      const raw = rolls[row.itemInstanceId] ?? '';
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
        nextErrors[row.itemInstanceId] = 'Enter a positive integer';
        continue;
      }
      if (n > row.deficit) {
        nextErrors[row.itemInstanceId] = `Max ${row.deficit}`;
        continue;
      }
      amounts[row.itemInstanceId] = n;
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const total = formulaRows.length + nonFormulaRows.length;
    void dispatch(
      {
        type: 'recharge',
        payload: { mode: 'batch', characterId, trigger, amounts },
      },
      {
        onSuccess: () => {
          toast.success(`${total} item${total === 1 ? '' : 's'} recharged`);
          onOpenChange(false);
        },
        onRejection: (_code, message) => toast.error(message ?? 'Failed to recharge'),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">
            {batchTriggerLabel(trigger)} — roll for recharge
          </DialogTitle>
          <DialogDescription>
            Enter your dice roll for each item below. Items without a formula will fully recharge
            automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {formulaRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No formula-bearing items eligible — close to apply default recharges.
            </p>
          ) : (
            formulaRows.map((row) => (
              <div key={row.itemInstanceId} className="space-y-1">
                <Label htmlFor={`roll-${row.itemInstanceId}`} className="text-sm font-medium">
                  {row.displayName}{' '}
                  <span className="text-xs text-muted-foreground tabular-nums">
                    ({row.current}/{row.max}, roll {row.rechargeAmount}, max +{row.deficit})
                  </span>
                </Label>
                <Input
                  id={`roll-${row.itemInstanceId}`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={row.deficit}
                  value={rolls[row.itemInstanceId] ?? ''}
                  onChange={(e) => {
                    onChange(row.itemInstanceId, e.target.value);
                  }}
                  className="w-28"
                  aria-label={`Roll result for ${row.displayName}`}
                />
                {errors[row.itemInstanceId] !== undefined ? (
                  <p className="text-xs text-destructive" role="alert">
                    {errors[row.itemInstanceId]}
                  </p>
                ) : null}
              </div>
            ))
          )}
          {nonFormulaRows.length > 0 ? (
            <div className="rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
              <p className="font-medium">Auto full-recharge:</p>
              <ul className="list-inside list-disc">
                {nonFormulaRows.map((row) => (
                  <li key={row.itemInstanceId}>{row.displayName}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

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
          <Button
            type="button"
            onClick={onApply}
            disabled={formulaRows.length === 0 || !canDispatch}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
