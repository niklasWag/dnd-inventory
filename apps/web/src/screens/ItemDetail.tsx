import { useEffect, useState, type ReactElement } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';
import { ArrowLeft, EyeOff, Package, Pencil, RotateCcw, Sparkles, Zap } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { ItemHistory } from '@/components/item/ItemHistory';
import { useCurrentPartyId } from '@/lib/useCurrentPartyId';
import { useDispatch } from '@/lib/useDispatch';
import { useStore, dispatchMintingAction } from '@/store';
import { attunement } from '@app/rules';
import { rarityPillClass, rarityLabel } from '@/lib/rarity';
import { rechargeRuleLabel } from '@/lib/charges';
import { displayName as computeDisplayName } from '@/lib/identify';
import { getOwnCharacter } from '@/lib/ownCharacter';
import { isCurrentUserDmOrSolo } from '@/lib/currentUserRole';

/**
 * Item Detail screen (OUTLINE §5 screen 4). R9.4 — Two-column page,
 * ported from `design-lab/src/item/ItemDetailTwoColumn.tsx` (verified
 * against `drawings/item-details.png`): read-forward content (Description,
 * Charges, Notes) on the LEFT; manageable state (Equipped / Attuned /
 * Identified toggles, DM hint) + per-item History on the RIGHT rail.
 *
 * Editing notes here may produce a row whose `(definitionId, notes)`
 * collides with another row in the same stash. M2.5 decision: rows stay
 * separate (auto-stack is `acquire`-only). Empty-string notes is
 * preserved as distinct from `undefined` (auto-stack key collapses both
 * to "", so this is invisible to `acquire`).
 */
const formSchema = z.object({
  customName: z.string().trim().max(60).or(z.literal('')),
  notes: z.string().max(500).or(z.literal('')),
});

type FormValues = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

/**
 * State-panel toggle row (mockup `StateToggle`). A labelled pill with a
 * mini switch; accent-tinted when `on`. Used for Equipped / Attuned /
 * Identified. `role="switch"` + `aria-checked` keep it queryable by the
 * accessible-role tests.
 */
function StateToggle({
  label,
  on,
  onClick,
  hint,
  disabled = false,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  hint?: string | undefined;
  disabled?: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
        on ? 'border-primary/40 bg-primary/10' : 'border-border bg-surface hover:bg-surface-2'
      }`}
    >
      <span>
        <span className={on ? 'font-medium text-primary' : 'font-medium'}>{label}</span>
        {hint !== undefined ? (
          <span className="ml-1 text-[11px] text-muted-foreground">{hint}</span>
        ) : null}
      </span>
      <span
        className={`h-4 w-7 rounded-full p-0.5 transition ${on ? 'bg-primary' : 'bg-surface-2'}`}
      >
        <span
          className={`block h-3 w-3 rounded-full bg-surface transition ${on ? 'translate-x-3' : ''}`}
        />
      </span>
    </button>
  );
}

export function ItemDetail(): ReactElement {
  const { itemInstanceId } = useParams<{ itemInstanceId: string }>();
  const partyId = useCurrentPartyId();
  const navigate = useNavigate();

  // Single shallow-equal selector: row, definition, stash, characterId.
  // useShallow is mandatory — fresh object literals would otherwise
  // re-trigger Zustand's equality check on every store change.
  //
  // `characterId` is the back-button destination + the equip/attune
  // action target. For character-scope stashes it's the owner; for
  // party / recovered-loot stashes it's the lone character.
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

  // R4.5 — DM cap-override eligibility. When the current user is a DM (or
  // solo per §8.2 union-of-rights) AND the target character's slots are
  // full, the Attune toggle routes through a confirm dialog rather than
  // being pre-disabled.
  const userIsDmOrSolo = useStore(useShallow((s) => isCurrentUserDmOrSolo(s.appState)));

  // R1.2 — attunement cap state so the Attune toggle can pre-disable when
  // full (rather than letting a reducer-rejection throw bubble). Only
  // meaningful for carried-Inventory items with a known owner.
  const attunementState = useStore(
    useShallow((s) => {
      if (view.characterId === null || s.appState === null) return null;
      const character = s.appState.characters.find((c) => c.id === view.characterId);
      if (character === undefined) return null;
      let attunedCount = 0;
      for (const it of s.appState.items) {
        if (it.ownerId === character.inventoryStashId && it.attuned) attunedCount += 1;
      }
      return {
        hasFreeSlot: attunement.hasFreeSlot(attunedCount, character.maxAttunement),
        attunedCount,
        maxAttunement: character.maxAttunement,
      };
    }),
  );

  const dispatch = useDispatch();
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Notes/custom-name inline edit — the form is collapsed behind the
  // Notes-card "Edit" affordance until the user opens it.
  const [editingNotes, setEditingNotes] = useState(false);
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
  // when the input is empty). The Identified toggle is a separate control.
  const [hintInput, setHintInput] = useState('');

  // R4.5 — attune cap-override dialog state. Holds the target item id when
  // the DM confirms bypassing the slot cap; null when idle.
  const [capOverrideOpen, setCapOverrideOpen] = useState(false);

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
    if (Object.keys(patch).length === 0) {
      setEditingNotes(false);
      return; // belt-and-braces no-op guard
    }

    setSubmitError(null);
    void dispatch(
      { type: 'edit-item-instance', payload: { itemInstanceId: row.id, patch } },
      {
        onSuccess: () => {
          toast.success('Item updated');
          setEditingNotes(false);
        },
        onRejection: (_code, message) => setSubmitError(message ?? 'Unknown error'),
      },
    );
  }

  const displayName = computeDisplayName(row, def ?? undefined);
  const isIdentified = row.identified;
  const weightLabel = def?.weight !== undefined ? `${String(def.weight)} lb` : '—';

  // R2.3 — `customName` placeholder is hidden when unidentified to avoid
  // leaking the real name into the form's placeholder text.
  const customNamePlaceholder = isIdentified ? (def?.name ?? '') : '';

  // R2.2 — charges UI is meaningful only when the definition carries a
  // `charges` block AND the row lives in the character's Inventory
  // (currentCharges stays null elsewhere per OUTLINE §3.4). R2.3 —
  // additionally gated on `identified === true` (an unidentified wand
  // should not expose its charge count — spoiler protection).
  const inInventory = stash !== null && stash.scope === 'character' && stash.isCarried === true;
  const defCharges = def?.charges;
  const showCharges = defCharges !== undefined && inInventory && isIdentified;
  const canUseCharge = showCharges && (row.currentCharges ?? 0) > 0;
  const canRecharge =
    showCharges && row.currentCharges !== null && row.currentCharges < defCharges.max;

  function onUseCharge(): void {
    if (row === null || characterId === null) return;
    void dispatch(
      { type: 'use-charge', payload: { itemInstanceId: row.id, characterId, amount: 1 } },
      {
        onSuccess: () => toast.success('Charge used'),
        onRejection: (_code, message) => toast.error(message ?? 'Failed to use charge'),
      },
    );
  }

  function onRecharge(): void {
    if (row === null || characterId === null) return;
    // R2.2.1 — items with a `rechargeAmount` formula open the inline roll
    // input instead of immediately dispatching a full recharge. Items
    // without a formula (e.g. Decanter of Endless Water) keep the R2.2
    // behavior: click = full recharge to def.max.
    if (defCharges?.rechargeAmount !== undefined) {
      setRollOpen(true);
      setRollValue('');
      setRollError(null);
      return;
    }
    void dispatch(
      { type: 'recharge', payload: { mode: 'manual', itemInstanceId: row.id, characterId } },
      {
        onSuccess: () => toast.success('Item recharged'),
        onRejection: (_code, message) => toast.error(message ?? 'Failed to recharge'),
      },
    );
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
    void dispatch(
      {
        type: 'recharge',
        payload: { mode: 'manual', itemInstanceId: row.id, characterId, amount: n },
      },
      {
        onSuccess: () => {
          toast.success(`Recharged ${n} ${n === 1 ? 'charge' : 'charges'}`);
          setRollOpen(false);
          setRollValue('');
          setRollError(null);
        },
        onRejection: (_code, message) => setRollError(message ?? 'Failed to recharge'),
      },
    );
  }

  function onRollCancel(): void {
    setRollOpen(false);
    setRollValue('');
    setRollError(null);
  }

  // R9.4 — Equipped / Attuned toggles. The equip + attune directions mint
  // via `dispatchMintingAction` (BUG-008 — an over-cap attune on a stacked
  // row must auto-split, which needs the minted `newItemInstanceId`);
  // unequip + unattune are plain dispatches. Errors surface as toasts.
  function onToggleEquipped(): void {
    if (row === null || characterId === null) return;
    if (row.equipped) {
      dispatchOrToast(
        { type: 'unequip', payload: { characterId, itemInstanceId: row.id } },
        'Could not unequip',
      );
    } else {
      dispatchMintingOrToast(
        { type: 'equip', payload: { characterId, itemInstanceId: row.id } },
        'Could not equip',
      );
    }
  }

  function onToggleAttuned(): void {
    if (row === null || characterId === null) return;
    // R4.5 — DM cap-override branch: when attuning into a full cap as
    // DM/solo, open the confirm dialog instead of dispatching directly.
    if (
      !row.attuned &&
      attunementState !== null &&
      !attunementState.hasFreeSlot &&
      userIsDmOrSolo
    ) {
      setCapOverrideOpen(true);
      return;
    }
    if (row.attuned) {
      dispatchOrToast(
        { type: 'unattune', payload: { characterId, itemInstanceId: row.id } },
        'Could not unattune',
      );
    } else {
      dispatchMintingOrToast(
        { type: 'attune', payload: { characterId, itemInstanceId: row.id } },
        'Could not attune',
      );
    }
  }

  // R2.3 — identification toggle. Preserves the hint across the flip so a
  // flip-back keeps the context the DM established earlier. The reducer
  // captures the bidirectional transition + emits the log entry.
  function onToggleIdentified(): void {
    if (row === null) return;
    const nextIdentified = !row.identified;
    const payload: { itemInstanceId: string; identified: boolean; hint?: string } = {
      itemInstanceId: row.id,
      identified: nextIdentified,
    };
    if (row.hint !== undefined) payload.hint = row.hint;
    void dispatch(
      { type: 'identify', payload },
      {
        onSuccess: () =>
          toast.success(nextIdentified ? 'Item identified' : 'Item marked unidentified'),
        onRejection: (_code, message) => toast.error(message ?? 'Failed to update identification'),
      },
    );
  }

  function onSaveHint(): void {
    if (row === null) return;
    const trimmed = hintInput.trim();
    const next = trimmed.length > 0 ? trimmed : undefined;
    // Local no-op guard — defends against double-clicks even though the
    // reducer also rejects (which would surface as an unwanted error toast).
    if ((row.hint ?? undefined) === next) return;
    void dispatch(
      {
        type: 'identify',
        payload: { itemInstanceId: row.id, identified: row.identified, hint: next },
      },
      {
        onSuccess: () => toast.success(next === undefined ? 'Hint cleared' : 'Hint updated'),
        onRejection: (_code, message) => toast.error(message ?? 'Failed to update hint'),
      },
    );
  }

  function dispatchOrToast(action: Parameters<typeof dispatch>[0], fallback: string): void {
    void dispatch(action, {
      onRejection: (_code, message) => toast.error(message ?? fallback),
    });
  }

  function dispatchMintingOrToast(
    action: Parameters<typeof dispatchMintingAction>[0],
    fallback: string,
  ): void {
    try {
      void dispatchMintingAction(action);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : fallback);
    }
  }

  const hintTrimmed = hintInput.trim();
  const currentHint = row.hint ?? '';
  const hintDirty = hintTrimmed !== currentHint;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          void navigate(backHref);
        }}
        className="-ml-2 h-8 gap-1.5 px-2 text-muted-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {backLabel}
      </Button>

      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Package className="h-3.5 w-3.5" />
            <span>{def?.category ?? '—'}</span>
            <span>·</span>
            <span>{stash?.name ?? '—'}</span>
          </div>
          <h1
            className={`font-display text-3xl font-bold tracking-tight ${
              isIdentified ? '' : 'italic text-muted-foreground'
            }`}
          >
            {displayName}
          </h1>
          {/*
           * R9.4 — the mockup conveys the unidentified state purely via
           * the italic-muted name (no badge chrome). Keep an sr-only
           * marker so the state is still announced to assistive tech and
           * the identify-invariant tests can assert it.
           */}
          {!isIdentified ? (
            <span className="sr-only" aria-label="Unidentified">
              Unidentified
            </span>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {isIdentified && def?.rarity != null && def.rarity !== 'common' ? (
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${rarityPillClass(def.rarity)}`}
                aria-label={`Rarity: ${rarityLabel(def.rarity)}`}
              >
                {rarityLabel(def.rarity)}
              </span>
            ) : null}
            {isIdentified && def?.requiresAttunement === true ? (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                aria-label="Requires attunement"
              >
                <Sparkles className="h-3 w-3" /> Requires attunement
                {def.attunementPrereq !== undefined && def.attunementPrereq.length > 0 ? (
                  <span className="font-normal italic">{def.attunementPrereq}</span>
                ) : null}
              </span>
            ) : null}
          </div>
        </div>
        <div className="text-right text-sm text-muted-foreground">
          <div>
            Qty <span className="font-semibold tabular-nums text-foreground">{row.quantity}</span>
          </div>
          <div>
            Weight <span className="tabular-nums text-foreground">{weightLabel}</span>
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        {/* LEFT — read-forward content */}
        <main className="space-y-4">
          {/*
           * R2.3 — DM hint block. Shown while the item is unidentified;
           * the editor input is inline here (restyled from the former
           * standalone Identification section). In MVP solo this is always
           * visible; R4 gates edit on DM role once multi-member lands.
           */}
          {!isIdentified ? (
            <div className="rounded-lg border border-dashed border-border bg-surface-2/40 px-4 py-3 text-sm">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <EyeOff className="h-3.5 w-3.5" /> DM hint
              </div>
              {row.hint !== undefined && row.hint.length > 0 ? (
                <p className="mb-2 italic text-muted-foreground" aria-label="Unidentified hint">
                  &ldquo;{row.hint}&rdquo;
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor="hint" className="sr-only">
                  Unidentified hint (DM only)
                </Label>
                <Input
                  id="hint"
                  placeholder="e.g. 'radiates evil'"
                  value={hintInput}
                  onChange={(e) => {
                    setHintInput(e.target.value);
                  }}
                  className="max-w-xs bg-surface"
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
          ) : null}

          <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-e1">
            <div className="border-b border-border px-4 py-3">
              <h2 className="font-display text-sm font-semibold uppercase tracking-wide">
                Description
              </h2>
            </div>
            <p className="px-4 py-3 text-sm leading-relaxed text-foreground/90">
              {isIdentified
                ? (def?.description ?? 'No description.')
                : 'This item has not been identified. Its properties are unknown until a Detect Magic or Identify effect (or the DM) reveals them.'}
            </p>
          </section>

          {showCharges ? (
            <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-e1">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 className="flex items-center gap-1.5 font-display text-sm font-semibold uppercase tracking-wide">
                  <Zap className="h-4 w-4 text-primary" /> Charges
                </h2>
                <span className="text-[11px] text-muted-foreground">
                  {rechargeRuleLabel(defCharges.rechargeRule)}
                  {defCharges.rechargeAmount !== undefined && defCharges.rechargeAmount.length > 0
                    ? ` (${defCharges.rechargeAmount})`
                    : ''}
                </span>
              </div>
              <div className="space-y-2 px-4 py-3">
                <div className="flex items-center gap-4">
                  <div
                    className="font-display text-2xl font-bold tabular-nums"
                    aria-label="Charges"
                  >
                    {row.currentCharges ?? '—'}
                    <span className="text-base font-semibold text-muted-foreground">
                      {' '}
                      / {defCharges.max}
                    </span>
                  </div>
                  <div className="ml-auto flex gap-2">
                    <Button
                      type="button"
                      variant="default"
                      size="sm"
                      onClick={onUseCharge}
                      disabled={!canUseCharge || rollOpen}
                      className="gap-1"
                    >
                      <Zap className="h-3.5 w-3.5" /> Use
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={onRecharge}
                      disabled={!canRecharge || rollOpen}
                      className="gap-1"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Recharge
                    </Button>
                  </div>
                </div>
                {rollOpen && defCharges.rechargeAmount !== undefined ? (
                  <div
                    role="group"
                    aria-label="Recharge roll input"
                    className="flex flex-wrap items-center gap-2 rounded-md bg-surface-2/60 p-2 text-sm"
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
            </section>
          ) : null}

          <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-e1">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="font-display text-sm font-semibold uppercase tracking-wide">Notes</h2>
              {!editingNotes ? (
                <button
                  type="button"
                  onClick={() => setEditingNotes(true)}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                >
                  <Pencil className="h-3 w-3" /> Edit
                </button>
              ) : null}
            </div>
            {!editingNotes ? (
              <p className="px-4 py-3 text-sm text-foreground/90">
                {row.notes !== undefined && row.notes.length > 0 ? (
                  row.notes
                ) : (
                  <span className="text-muted-foreground">No notes.</span>
                )}
              </p>
            ) : (
              <form
                onSubmit={(e) => {
                  void handleSubmit(onSubmit)(e);
                }}
                className="space-y-4 px-4 py-3"
                noValidate
              >
                <div className="space-y-1.5">
                  <Label htmlFor="customName">Custom name</Label>
                  <Input
                    id="customName"
                    placeholder={customNamePlaceholder}
                    {...register('customName')}
                  />
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingNotes(false);
                      setSubmitError(null);
                      reset({
                        customName: row.customName ?? '',
                        notes: row.notes ?? '',
                      });
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={!isDirty || isSubmitting}>
                    {isSubmitting ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </form>
            )}
          </section>
        </main>

        {/* RIGHT — state + history */}
        <aside className="space-y-4 lg:sticky lg:top-8 lg:self-start">
          <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-e1">
            <div className="border-b border-border px-4 py-3">
              <h2 className="font-display text-sm font-semibold uppercase tracking-wide">State</h2>
            </div>
            <div className="space-y-2 px-3 py-3">
              {inInventory ? (
                <>
                  <StateToggle label="Equipped" on={row.equipped} onClick={onToggleEquipped} />
                  {/*
                   * Attunement is only meaningful for items that require it
                   * (D&D 5e §7). Non-attunement gear shows just the Equipped
                   * toggle — the reducer would reject an attune anyway.
                   */}
                  {def?.requiresAttunement === true ? (
                    <StateToggle
                      label="Attuned"
                      on={row.attuned}
                      onClick={onToggleAttuned}
                      hint={
                        attunementState !== null
                          ? `${attunementState.attunedCount} of ${attunementState.maxAttunement} slots`
                          : undefined
                      }
                      // Pre-disable the "Attune" direction when slots are full —
                      // cheaper UX than a reject toast. Unattune stays enabled.
                      // R4.5 — DM/solo skip the disable + route through the
                      // cap-override confirm dialog instead.
                      disabled={
                        !row.attuned &&
                        attunementState !== null &&
                        !attunementState.hasFreeSlot &&
                        !userIsDmOrSolo
                      }
                    />
                  ) : null}
                </>
              ) : (
                <p className="px-1 text-[11px] text-muted-foreground">
                  Equip / attune available only in a carried Inventory.
                </p>
              )}
              {/*
               * R2.3 — Identified toggle. In MVP solo the user wears both
               * hats; R4 gates this on `actorRole === 'dm'` once multi-
               * member parties land.
               */}
              <StateToggle label="Identified" on={isIdentified} onClick={onToggleIdentified} />
            </div>
          </section>

          {/*
           * History card. `ItemHistory` owns its own "History" heading +
           * the "Show all events" toggle + the R5.3.b permission-hidden
           * footer, so the card frame here is chrome-only (no duplicate
           * heading). The leading icon lives in the shared component's
           * header via the `icon` slot below.
           */}
          <section className="overflow-hidden rounded-xl border border-border bg-surface shadow-e1">
            <div className="px-4 py-3">
              <ItemHistory itemInstanceId={row.id} />
            </div>
          </section>
        </aside>
      </div>

      {/* R4.5 — Attune cap-override confirm dialog. Only reachable by DM
       * (or solo) users. Confirms bypass of the maxAttunement cap and
       * dispatches `attune` with `overrideCap: true` per OUTLINE §3.8. */}
      <AlertDialog
        open={capOverrideOpen}
        onOpenChange={(open) => {
          if (!open) setCapOverrideOpen(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Bypass attunement cap?</AlertDialogTitle>
            <AlertDialogDescription>
              {attunementState !== null
                ? `This character is already attuned to ${attunementState.attunedCount} of ${attunementState.maxAttunement} items. `
                : ''}
              As DM you can override the cap for this attunement. The log entry will record the
              override for the party audit trail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (characterId === null) return;
                // BUG-008 — DM cap-override also routes through the minting
                // dispatch so an over-cap attune on a stacked row still
                // auto-splits correctly.
                dispatchMintingOrToast(
                  {
                    type: 'attune',
                    payload: { characterId, itemInstanceId: row.id, overrideCap: true },
                  },
                  'Could not attune',
                );
                setCapOverrideOpen(false);
              }}
            >
              Override cap
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
