import { useEffect, useState, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDispatch } from '@/lib/useDispatch';

/**
 * M7 inline rename form for Character and Party (Settings §7 screen 9).
 *
 * One component handles both flows via the `target` prop:
 *   - `target: 'character'` — dispatches `rename-character` with
 *     `{ characterId, newName }`. The reducer captures `oldName`.
 *   - `target: 'party'` — dispatches `rename-party`.
 *
 * Same RHF + Zod + reset-on-currentName-change + try/catch + toast
 * pattern as `RenameStashModal`, but inline (no Dialog shell) because
 * Settings already provides its own card layout.
 *
 * The reducer rejects empty + same-name dispatches, so we mirror those
 * guards UI-side: empty input shows a Zod error from the schema; the
 * Save button is disabled when input matches the current name after
 * trim, so an over-eager submit can't trigger the no-op reject.
 */
const formSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60, 'Name is too long (max 60 chars)'),
});

type FormValues = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

interface RenameFieldProps {
  target: 'character' | 'party';
  /** Target entity id. For character it's the characterId; for party,
   *  the partyId. */
  entityId: string;
  /** Current name — pre-fills input + powers the no-op detection. */
  currentName: string;
  label: string;
}

export function RenameField({
  target,
  entityId,
  currentName,
  label,
}: RenameFieldProps): ReactElement {
  const dispatch = useDispatch();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: currentName },
  });

  // Re-seed defaults when the upstream `currentName` changes (e.g.
  // after a successful rename round-trips back through the store).
  useEffect(() => {
    reset({ name: currentName });
    setSubmitError(null);
  }, [currentName, reset]);

  const liveValue = watch('name') ?? '';
  const trimmed = liveValue.trim();
  const isNoOp = trimmed === currentName || trimmed.length === 0;

  function onSubmit(values: FormOutput): void {
    if (values.name === currentName) {
      // No-op short-circuit (reducer would throw). Same pattern as
      // RenameStashModal's `onSubmit` guard.
      return;
    }
    setSubmitError(null);
    if (target === 'character') {
      void dispatch(
        {
          type: 'rename-character',
          payload: { characterId: entityId, newName: values.name },
        },
        {
          onSuccess: () => toast.success('Character renamed'),
          onRejection: (_code, message) => setSubmitError(message ?? 'Unknown error'),
        },
      );
    } else {
      void dispatch(
        {
          type: 'rename-party',
          payload: { partyId: entityId, newName: values.name },
        },
        {
          onSuccess: () => toast.success('Party renamed'),
          onRejection: (_code, message) => setSubmitError(message ?? 'Unknown error'),
        },
      );
    }
  }

  const inputId = `rename-${target}-name`;

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(onSubmit)(e);
      }}
      className="space-y-2"
      noValidate
    >
      <Label htmlFor={inputId}>{label}</Label>
      <div className="flex gap-2">
        <Input id={inputId} {...register('name')} />
        <Button type="submit" disabled={isSubmitting || isNoOp}>
          {isSubmitting ? 'Saving…' : 'Save'}
        </Button>
      </div>
      {errors.name?.message !== undefined ? (
        <p className="text-sm text-destructive" role="alert">
          {errors.name.message}
        </p>
      ) : null}
      {submitError !== null ? (
        <p className="text-sm text-destructive" role="alert">
          {submitError}
        </p>
      ) : null}
    </form>
  );
}
