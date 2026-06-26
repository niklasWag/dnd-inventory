import { useEffect, useState, type ReactElement } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useStore } from '@/store';
import type { EncumbranceRule } from '@app/shared';

interface EncumbranceRuleFieldProps {
  characterId: string;
  currentRule: EncumbranceRule;
  currentEnforce: boolean;
}

/**
 * R1.1 inline form for a Character's encumbrance configuration
 * (Settings §17 screen). Two orthogonal controls in one form:
 *
 *   - `<select>` — the rule (off | phb | variant). Native element rather
 *     than the shadcn Radix Select because three options fit cleanly in
 *     the OS dropdown and Radix Select uses a portal that's awkward to
 *     drive under jsdom.
 *   - `<input type="checkbox">` — `enforceEncumbrance`. Hidden when
 *     `rule === 'off'` (nothing to enforce). R1.1 stores the flag and
 *     surfaces it in the CapacityBar; R1.4 wires the actual reducer
 *     rejection on `acquire` / `transfer`.
 *
 * Save dispatches a single `set-encumbrance` covering both fields. The
 * button is disabled when the draft matches the current row on BOTH
 * fields. `useEffect` re-seeds the draft when either prop changes (e.g.
 * after a successful round-trip back through the store, or after an
 * Import).
 */
export function EncumbranceRuleField({
  characterId,
  currentRule,
  currentEnforce,
}: EncumbranceRuleFieldProps): ReactElement {
  const dispatch = useStore((s) => s.dispatch);
  const [draftRule, setDraftRule] = useState<EncumbranceRule>(currentRule);
  const [draftEnforce, setDraftEnforce] = useState<boolean>(currentEnforce);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    setDraftRule(currentRule);
    setDraftEnforce(currentEnforce);
    setSubmitError(null);
  }, [currentRule, currentEnforce]);

  // When the user picks 'off', enforcement is moot — coerce the draft
  // to false so the checkbox state stays coherent with what'll be
  // dispatched.
  const effectiveEnforce = draftRule === 'off' ? false : draftEnforce;
  const isNoOp = draftRule === currentRule && effectiveEnforce === currentEnforce;
  const selectId = 'encumbrance-rule';
  const checkboxId = 'encumbrance-enforce';

  function onSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    if (isNoOp) return;
    try {
      setSubmitError(null);
      dispatch({
        type: 'set-encumbrance',
        payload: { characterId, rule: draftRule, enforce: effectiveEnforce },
      });
      toast.success(`Encumbrance: ${draftRule}${effectiveEnforce ? ' (enforced)' : ''}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <div className="space-y-2">
        <Label htmlFor={selectId}>Encumbrance rule</Label>
        <select
          id={selectId}
          value={draftRule}
          onChange={(e) => {
            setDraftRule(e.target.value as EncumbranceRule);
          }}
          className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <option value="off">Off — no display</option>
          <option value="phb">PHB default — capacity = STR × 15</option>
          <option value="variant">Variant — encumbered at 5×STR, heavy at 10×STR</option>
        </select>
        <p className="text-xs text-muted-foreground">
          {draftRule === 'off'
            ? 'Capacity bar hidden on the Inventory tab.'
            : draftRule === 'phb'
              ? 'Standard rule: at-or-under STR × 15 is fine; above is over-capacity.'
              : 'Variant rule (PHB 2024 sidebar): warns at 5×STR and 10×STR.'}
        </p>
      </div>

      {/* Enforce checkbox only matters when a rule is active. Under
          `off` there's nothing to enforce — hide rather than disable so
          the UI stays uncluttered. */}
      {draftRule !== 'off' ? (
        <div className="flex items-start gap-2">
          <input
            id={checkboxId}
            type="checkbox"
            checked={draftEnforce}
            onChange={(e) => {
              setDraftEnforce(e.target.checked);
            }}
            className="mt-1 h-4 w-4 rounded border-input"
          />
          <div className="space-y-1">
            <Label htmlFor={checkboxId} className="cursor-pointer">
              Enforce encumbrance
            </Label>
            <p className="text-xs text-muted-foreground">
              When on, the reducer rejects acquires and transfers that would push your Inventory
              weight over the rule's limit.
            </p>
          </div>
        </div>
      ) : null}

      <Button type="submit" disabled={isNoOp}>
        Save
      </Button>

      {submitError !== null ? (
        <p className="text-sm text-destructive" role="alert">
          {submitError}
        </p>
      ) : null}
    </form>
  );
}
