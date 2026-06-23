import { useEffect, useState, type ReactElement } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ItemHistory } from '@/components/item/ItemHistory';
import { useStore } from '@/store';

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

  // Single shallow-equal selector: row, definition, stash, dispatch.
  // useShallow is mandatory — fresh object literals would otherwise
  // re-trigger Zustand's equality check on every store change.
  const view = useStore(
    useShallow((s) => {
      if (s.appState === null || itemInstanceId === undefined) {
        return { row: null, def: null, stash: null } as const;
      }
      const row = s.appState.items.find((i) => i.id === itemInstanceId) ?? null;
      const def = row !== null
        ? s.appState.catalog.find((d) => d.id === row.definitionId) ?? null
        : null;
      const stash = row !== null
        ? s.appState.stashes.find((st) => st.id === row.ownerId) ?? null
        : null;
      return { row, def, stash };
    }),
  );

  const dispatch = useStore((s) => s.dispatch);
  const [submitError, setSubmitError] = useState<string | null>(null);

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

  if (view.row === null) return <Navigate to="/" replace />;
  const { row, def, stash } = view;

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

  const displayName = row.customName ?? def?.name ?? '(unknown item)';
  const costLabel =
    def?.cost !== undefined ? `${String(def.cost.amount)} ${def.cost.currency}` : '—';
  const weightLabel = def?.weight !== undefined ? `${String(def.weight)} lb` : '—';

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">{displayName}</h1>
        <p className="text-sm text-muted-foreground">
          {def?.source ?? '—'} · {def?.category ?? '—'} · {stash?.name ?? '—'}
        </p>
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
        <p className="col-span-2 text-xs text-muted-foreground">
          Adjust quantity from the stash table (the +/− buttons there).
          {/* R1: equipped / attuned toggles. R2: identified, currentCharges, conditionOverrides. */}
        </p>
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
          <Input id="customName" placeholder={def?.name ?? ''} {...register('customName')} />
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
