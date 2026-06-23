import { useState, type ReactElement } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useStore } from '@/store';
import { seedCatalogIfNeeded } from '@/store/seed';

/**
 * Form schema (M1). Mirrors the subset of fields the UI collects; the
 * reducer fills in everything else (party, memberships, stashes…).
 *
 * STR is stored but not enforced in MVP (encumbrance lands in R1) — we
 * still validate the typical 1-30 range to keep the form honest.
 */
const formSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  species: z.string().trim().min(1, 'Species is required').max(40),
  class: z.string().trim().min(1, 'Class is required').max(40),
  level: z.coerce.number().int().min(1, 'Level must be at least 1').max(20),
  str: z.coerce.number().int().min(1).max(30),
});

type FormValues = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

export function CreateCharacter(): ReactElement {
  const navigate = useNavigate();
  const dispatch = useStore((s) => s.dispatch);
  const hasCharacter = useStore((s) => (s.appState ? s.appState.characters.length > 0 : false));
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      species: '',
      class: '',
      level: 1,
      str: 10,
    },
  });

  // Defensive: if a character already exists, route back to it. MVP §6
  // invariant is "exactly one Character" — the reducer also rejects.
  // Declarative redirect via <Navigate> avoids the "setState during render"
  // warning that an imperative navigate() call would produce here.
  if (hasCharacter) {
    const id = useStore.getState().appState?.characters[0]?.id;
    if (id !== undefined) {
      return <Navigate to={`/character/${id}`} replace />;
    }
  }

  function onSubmit(values: FormOutput): void {
    try {
      dispatch({ type: 'create-character', payload: values });
      // Seed the catalog right after the first create so the user sees a
      // populated AddItemModal without having to refresh. Idempotent
      // (no-op on subsequent boots once seedVersion has caught up).
      seedCatalogIfNeeded();
      const id = useStore.getState().appState?.characters[0]?.id;
      if (id !== undefined) void navigate(`/character/${id}`, { replace: true });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Create your character</h1>
        <p className="text-sm text-muted-foreground">
          Just the basics. You can flesh out the rest from the Character Sheet.
        </p>
      </header>

      <form
        onSubmit={(e) => {
          void handleSubmit(onSubmit)(e);
        }}
        className="space-y-5"
        noValidate
      >
        <Field id="name" label="Name" error={errors.name?.message}>
          <Input id="name" autoFocus {...register('name')} />
        </Field>

        <Field id="species" label="Species" error={errors.species?.message}>
          <Input id="species" placeholder="e.g. Dwarf" {...register('species')} />
        </Field>

        <Field id="class" label="Class" error={errors.class?.message}>
          <Input id="class" placeholder="e.g. Fighter" {...register('class')} />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field id="level" label="Level" error={errors.level?.message}>
            <Input id="level" type="number" min={1} max={20} {...register('level')} />
          </Field>

          <Field id="str" label="STR" error={errors.str?.message}>
            <Input id="str" type="number" min={1} max={30} {...register('str')} />
          </Field>
        </div>

        {submitError !== null ? (
          <p className="text-sm text-destructive" role="alert">
            {submitError}
          </p>
        ) : null}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void navigate('/');
            }}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Creating…' : 'Create character'}
          </Button>
        </div>
      </form>
    </div>
  );
}

interface FieldProps {
  id: string;
  label: string;
  error: string | undefined;
  children: ReactElement;
}

function Field({ id, label, error, children }: FieldProps): ReactElement {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error !== undefined ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
