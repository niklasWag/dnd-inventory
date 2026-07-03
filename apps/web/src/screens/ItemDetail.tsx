import { useEffect, useState, type ReactElement } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import { ArrowLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useCurrentPartyId } from '@/lib/useCurrentPartyId';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ItemHistory } from '@/components/item/ItemHistory';
import { useStore } from '@/store';
import { rarityClasses, rarityLabel } from '@/lib/rarity';
import { formatChargesLong } from '@/lib/charges';
import { displayName as computeDisplayName } from '@/lib/identify';
import { getOwnCharacter } from '@/lib/ownCharacter';

/**
 * Item Detail screen (MVP §7 screen 4 / OUTLINE §5 screen 4).
 *
 * MVP-mutable fields are just `customName` and `notes` because the
 * `itemInstance` schema hard-codes the rest as Zod literals. R1 unlocks
 * `equipped`/`attuned`; R2 unlocks `identified`/`currentCharges`/
 * `conditionOverrides`. The OUTLINE-blessed `edit-item-instance` action
 * already names those fields in its `changedFields` enum — we'll widen
 * the schema enum + add UI controls in those milestones.
 *
 * Editing notes here may produce a row whose `(definitionId, notes)`
 * collides with another row in the same stash. M2.5 decision: rows stay
 * separate (auto-stack is `acquire`-only). See `editItemInstance` reducer
 * docs for the M5 follow-up.
 *
 * Empty-string notes is preserved as distinct from `undefined` (auto-stack
 * key collapses both to "", so this is invisible to `acquire`).
 */
const formSchema = z.object({
  customName: z.string().trim().max(60).or(z.literal('')),
  notes: z.string().max(500).or(z.literal('')),
});

type FormValues = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

export function ItemDetail(): ReactElement {
  const { itemInstanceId } = useParams<{ itemInstanceId: string }>();
  const partyId = useCurrentPartyId();
  const navigate = useNavigate();

  // Single shallow-equal selector: row, definition, stash, characterId.
  // useShallow is mandatory — fresh object literals would otherwise
  // re-trigger Zustand's equality check on every store change.
  //
  // `characterId` is the back-button destination. For character-scope
  // stashes it's the owner; for party / recovered-loot stashes (MVP §6:
  // exactly one character) it's the lone character.
  const view = useStore(
    useShallow((s) => {
      if (s.appState === null || itemInstanceId === undefined) {
        return { row: null, def: null, stash: null, characterId: null } as const;
      }
      const row = s.appState.items.find((i) => i.id === itemInstanceId) ?? null;
      const def =
        row !== null ? (s.appState.catalog.find((d) => d.id === row.definitionId) ?? null) : null;
      const stash =
        row !== null ? (s.appState.stashes.find((st) => st.id === row.ownerId) ?? null) : null;
      const characterId =
        stash?.scope === 'character' && stash.ownerCharacterId !== null
          ? stash.ownerCharacterId
          : (getOwnCharacter(s.appState)?.id ?? null);
      return { row, def, stash, characterId };
    }),
  );

  const dispatch = useStore((s) => s.dispatch);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // R2.2.1 — inline roll input for charged items with a `rechargeAmount`
  // formula. Toggling Recharge opens the input; submitting dispatches a
  // partial-recharge action. `rollOpen` toggles the inline UI;
  // `rollValue` is the controlled input string (`''` until typed).
  const [rollOpen, setRollOpen] = useState(false);
  const [rollValue, setRollValue] = useState('');
  const [rollError, setRollError] = useState<string | null>(null);

  // R2.3 — DM hint editor input. Controlled string bound to the row's
  // current hint; "Save hint" dispatches an identify action that preserves
  // the current `identified` state and writes the new hint (or clears it
  // when the input is empty). The Identified toggle is a separate button.
  const [hintInput, setHintInput] = useState('');

  // Hooks must run unconditionally — guard via Navigate after.
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      customName: view.row?.customName ?? '',
      notes: view.row?.notes ?? '',
    },
  });

  // After a successful save the row changes — reset form defaults so the
  // next `isDirty` calc is correct. Without this, saving twice would not
  // re-disable the Save button until the user typed something.
  useEffect(() => {
    if (view.row !== null) {
      reset({
        customName: view.row.customName ?? '',
        notes: view.row.notes ?? '',
      });
    }
  }, [view.row, reset]);

  // R2.3 — sync the hint editor input with the row's current hint so the
  // Save button's no-op detection works after each successful save.
  useEffect(() => {
    setHintInput(view.row?.hint ?? '');
  }, [view.row?.hint]);

  if (view.row === null) return <Navigate to="/" replace />;
  const { row, def, stash, characterId } = view;

  const backHref = characterId !== null ? `/party/${partyId}/character/${characterId}` : '/';
  const backLabel = stash?.name !== undefined ? `Back to ${stash.name}` : 'Back';

  function onSubmit(values: FormOutput): void {
    if (row === null) return;
    // Sparse patch: only fields that diverge from the current row.
    // Empty string is preserved as a distinct value (M2.5 decision #4).
    const patch: { customName?: string; notes?: string } = {};
    if (values.customName !== (row.customName ?? '')) {
      patch.customName = values.customName;
    }
    if (values.notes !== (row.notes ?? '')) {
      patch.notes = values.notes;
    }
    if (Object.keys(patch).length === 0) return; // belt-and-braces no-op guard

    try {
      setSubmitError(null);
      dispatch({ type: 'edit-item-instance', payload: { itemInstanceId: row.id, patch } });
      toast.success('Item updated');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  const displayName = computeDisplayName(row, def ?? undefined);
  const isIdentified = row.identified;
  const costLabel =
    def?.cost !== undefined ? `${String(def.cost.amount)} ${def.cost.currency}` : '—';
  const weightLabel = def?.weight !== undefined ? `${String(def.weight)} lb` : '—';

  // R2.3 — `customName` placeholder is hidden when unidentified to avoid
  // leaking the real name into the form's placeholder text. The form
  // itself stays editable (the DM may still want to set a nickname for
  // an unidentified item).
  const customNamePlaceholder = isIdentified ? (def?.name ?? '') : '';

  // R2.2 — charges UI is meaningful only when:
  //   1. the definition carries a `charges` block, AND
  //   2. the row lives in the character's Inventory (currentCharges
  //      stays null in Storage / Party Stash / Recovered Loot per
  //      OUTLINE §3.4).
  // R2.3 — additionally gated on `identified === true`. An unidentified
  // wand should not expose its charge count (spoiler protection;
  // OUTLINE §8 only specifies the name swap but the charge count is
  // similarly a magic-item tell).
  // `inInventory` is a single check the buttons + line both read.
  const inInventory = stash !== null && stash.scope === 'character' && stash.isCarried === true;
  const defCharges = def?.charges;
  const showCharges = defCharges !== undefined && inInventory && isIdentified;
  const chargesLine = showCharges ? formatChargesLong(row.currentCharges, defCharges) : null;
  const canUseCharge = showCharges && (row.currentCharges ?? 0) > 0;
  const canRecharge =
    showCharges && row.currentCharges !== null && row.currentCharges < defCharges.max;

  function onUseCharge(): void {
    if (row === null || characterId === null) return;
    try {
      dispatch({
        type: 'use-charge',
        payload: { itemInstanceId: row.id, characterId, amount: 1 },
      });
      toast.success('Charge used');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to use charge');
    }
  }

  function onRecharge(): void {
    if (row === null || characterId === null) return;
    // R2.2.1 — items with a `rechargeAmount` formula open the inline
    // roll input instead of immediately dispatching a full recharge.
    // Items without a formula (e.g. Decanter of Endless Water) keep
    // the original R2.2 behavior: click = full recharge to def.max.
    if (defCharges?.rechargeAmount !== undefined) {
      setRollOpen(true);
      setRollValue('');
      setRollError(null);
      return;
    }
    try {
      dispatch({
        type: 'recharge',
        payload: { mode: 'manual', itemInstanceId: row.id, characterId },
      });
      toast.success('Item recharged');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to recharge');
    }
  }

  function onRollSubmit(): void {
    if (row === null || characterId === null || defCharges === undefined) return;
    const deficit = defCharges.max - (row.currentCharges ?? 0);
    const n = Number.parseInt(rollValue, 10);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
      setRollError('Enter a positive integer');
      return;
    }
    if (n > deficit) {
      setRollError(`Cannot exceed deficit (${deficit})`);
      return;
    }
    try {
      dispatch({
        type: 'recharge',
        payload: { mode: 'manual', itemInstanceId: row.id, characterId, amount: n },
      });
      toast.success(`Recharged ${n} ${n === 1 ? 'charge' : 'charges'}`);
      setRollOpen(false);
      setRollValue('');
      setRollError(null);
    } catch (err) {
      setRollError(err instanceof Error ? err.message : 'Failed to recharge');
    }
  }

  function onRollCancel(): void {
    setRollOpen(false);
    setRollValue('');
    setRollError(null);
  }

  // R2.3 — identification handlers. Both dispatch `identify` actions; the
  // reducer captures the bidirectional transition and emits the log entry.
  // Toast messages mirror the R2.2 charge UX vocabulary.
  function onToggleIdentified(): void {
    if (row === null) return;
    const nextIdentified = !row.identified;
    try {
      // Preserve the hint across the toggle so a flip-back keeps the
      // context the DM established earlier. The reducer's no-op gate is
      // satisfied because `identified` is changing.
      const payload: { itemInstanceId: string; identified: boolean; hint?: string } = {
        itemInstanceId: row.id,
        identified: nextIdentified,
      };
      if (row.hint !== undefined) payload.hint = row.hint;
      dispatch({ type: 'identify', payload });
      toast.success(nextIdentified ? 'Item identified' : 'Item marked unidentified');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update identification');
    }
  }

  function onSaveHint(): void {
    if (row === null) return;
    const trimmed = hintInput.trim();
    const next = trimmed.length > 0 ? trimmed : undefined;
    // Local no-op guard — defends against double-clicks even though the
    // reducer also rejects. (Reducer throws on exact no-op, which would
    // surface as an unwanted error toast otherwise.)
    if ((row.hint ?? undefined) === next) return;
    try {
      dispatch({
        type: 'identify',
        payload: { itemInstanceId: row.id, identified: row.identified, hint: next },
      });
      toast.success(next === undefined ? 'Hint cleared' : 'Hint updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update hint');
    }
  }

  const hintTrimmed = hintInput.trim();
  const currentHint = row.hint ?? '';
  const hintDirty = hintTrimmed !== currentHint;

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          void navigate(backHref);
        }}
        className="-ml-2 h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {backLabel}
      </Button>

      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">{displayName}</h1>
        <p className="text-sm text-muted-foreground">
          {def?.source ?? '—'} · {def?.category ?? '—'} · {stash?.name ?? '—'}
        </p>
        {!isIdentified ? (
          <div className="space-y-1 pt-1">
            <span
              className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium italic text-slate-700 ring-1 ring-inset ring-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700"
              aria-label="Unidentified"
            >
              Unidentified
            </span>
            {row.hint !== undefined && row.hint.length > 0 ? (
              <p className="text-sm italic text-muted-foreground" aria-label="Unidentified hint">
                &ldquo;{row.hint}&rdquo;
              </p>
            ) : null}
          </div>
        ) : null}
        {isIdentified && (def?.rarity != null || def?.requiresAttunement === true) ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {def?.rarity != null ? (
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${rarityClasses(def.rarity)}`}
                aria-label={`Rarity: ${rarityLabel(def.rarity)}`}
              >
                {rarityLabel(def.rarity)}
              </span>
            ) : null}
            {def?.requiresAttunement === true ? (
              <span
                className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-inset ring-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:ring-amber-800"
                aria-label="Requires attunement"
              >
                Requires attunement
              </span>
            ) : null}
          </div>
        ) : null}
        {isIdentified && def?.attunementPrereq !== undefined && def.attunementPrereq.length > 0 ? (
          <p className="text-xs italic text-muted-foreground">{def.attunementPrereq}</p>
        ) : null}
      </header>

      <section className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-md border border-border p-4 text-sm">
        <div>
          <span className="text-muted-foreground">Quantity:</span>{' '}
          <span className="tabular-nums">{row.quantity}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Weight:</span>{' '}
          <span className="tabular-nums">{weightLabel}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Cost:</span>{' '}
          <span className="tabular-nums">{costLabel}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Definition:</span>{' '}
          <span className="font-mono text-xs">{def?.name ?? '—'}</span>
        </div>
        {def?.description !== undefined ? (
          <div className="col-span-2">
            <span className="text-muted-foreground">Description:</span> {def.description}
          </div>
        ) : null}
        {showCharges ? (
          <div className="col-span-2 space-y-2 border-t border-border pt-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm tabular-nums" aria-label="Charges">
                {chargesLine}
              </span>
              <div className="ml-auto flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={onUseCharge}
                  disabled={!canUseCharge || rollOpen}
                >
                  Use
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onRecharge}
                  disabled={!canRecharge || rollOpen}
                >
                  Recharge
                </Button>
              </div>
            </div>
            {rollOpen && defCharges?.rechargeAmount !== undefined ? (
              <div
                role="group"
                aria-label="Recharge roll input"
                className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 p-2 text-sm"
              >
                <Label htmlFor="rechargeRoll" className="text-xs text-muted-foreground">
                  Roll {defCharges.rechargeAmount}:
                </Label>
                <Input
                  id="rechargeRoll"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={defCharges.max - (row.currentCharges ?? 0)}
                  value={rollValue}
                  onChange={(e) => {
                    setRollValue(e.target.value);
                    setRollError(null);
                  }}
                  className="w-24"
                  aria-label={`Roll result (1 to ${defCharges.max - (row.currentCharges ?? 0)})`}
                  autoFocus
                />
                <Button type="button" size="sm" onClick={onRollSubmit}>
                  Apply
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={onRollCancel}>
                  Cancel
                </Button>
                {rollError !== null ? (
                  <span className="text-xs text-destructive" role="alert">
                    {rollError}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        <p className="col-span-2 text-xs text-muted-foreground">
          Adjust quantity from the stash table (the +/− buttons there).
          {/* R6: conditionOverrides editor lands here. */}
        </p>
      </section>

      {/*
       * R2.3 — Identification Panel. In MVP solo this panel is always
       * visible (the user wears both hats). R4 will gate visibility on
       * `actorRole === 'dm'` once multi-member parties land. The toggle
       * + hint editor each dispatch their own `identify` action; the
       * reducer captures the bidirectional transition + log entry.
       */}
      <section
        aria-label="Identification (DM)"
        className="space-y-3 rounded-md border border-border p-4"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Identification</h2>
            <p className="text-xs text-muted-foreground">DM-only in multi-member parties (R4).</p>
          </div>
          <Button
            type="button"
            variant={isIdentified ? 'outline' : 'default'}
            size="sm"
            role="switch"
            aria-checked={isIdentified}
            aria-label="Identified"
            onClick={onToggleIdentified}
          >
            {isIdentified ? 'Identified' : 'Mark identified'}
          </Button>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hint" className="text-xs text-muted-foreground">
            Unidentified hint (DM only)
          </Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="hint"
              placeholder="e.g. 'radiates evil'"
              value={hintInput}
              onChange={(e) => {
                setHintInput(e.target.value);
              }}
              className="max-w-xs"
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={onSaveHint}
              disabled={!hintDirty}
            >
              {hintTrimmed.length === 0 && currentHint.length > 0 ? 'Clear' : 'Save hint'}
            </Button>
          </div>
        </div>
      </section>

      <form
        onSubmit={(e) => {
          void handleSubmit(onSubmit)(e);
        }}
        className="space-y-5"
        noValidate
      >
        <div className="space-y-1.5">
          <Label htmlFor="customName">Custom name</Label>
          <Input id="customName" placeholder={customNamePlaceholder} {...register('customName')} />
          {errors.customName?.message !== undefined ? (
            <p className="text-sm text-destructive" role="alert">
              {errors.customName.message}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="notes">Notes</Label>
          <Input id="notes" placeholder="e.g. given by Volo" {...register('notes')} />
          {errors.notes?.message !== undefined ? (
            <p className="text-sm text-destructive" role="alert">
              {errors.notes.message}
            </p>
          ) : null}
        </div>

        {submitError !== null ? (
          <p className="text-sm text-destructive" role="alert">
            {submitError}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={!isDirty || isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>

      <ItemHistory itemInstanceId={row.id} />
    </div>
  );
}
