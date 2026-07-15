import { useState, type ReactElement, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Dumbbell, Swords, User, type LucideIcon } from 'lucide-react';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * Shared character-creation form (R3.5).
 *
 * Extracted from the (now-removed) `screens/CreateCharacter.tsx` so the
 * Hub dialogs (Create solo + Create party-with-character) can both use
 * it. The reducer's `create-character` action accepts these fields and
 * mints everything else (party, user, memberships, stashes,
 * currencies).
 *
 * The submit callback owns the dispatch; the form just collects values
 * + handles RHF state. Lets the parent dialog decide what to do on
 * success (navigate to character page after the queue flushes in server
 * mode; navigate immediately in local mode).
 */
const formSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  species: z.string().trim().min(1, 'Species is required').max(40),
  size: z.enum(['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan']),
  class: z.string().trim().min(1, 'Class is required').max(40),
  level: z.coerce.number().int().min(1, 'Level must be at least 1').max(20),
  str: z.coerce.number().int().min(1).max(30),
});

type FormValues = z.input<typeof formSchema>;
export type CharacterFormOutput = z.output<typeof formSchema>;

export interface CharacterFormProps {
  defaultValues?: Partial<FormValues>;
  /**
   * Submit handler. May return a promise; the button stays disabled
   * while it resolves so the user can't submit twice.
   */
  onSubmit: (values: CharacterFormOutput) => Promise<void> | void;
  /**
   * Optional cancel callback. When undefined the cancel button is
   * omitted (e.g. when the form is hosted inside a modal that has its
   * own close affordance).
   */
  onCancel?: () => void;
  /** Form-level submit error (e.g. server rejection). */
  submitError?: string | null;
}

export function CharacterForm({
  defaultValues,
  onSubmit,
  onCancel,
  submitError,
}: CharacterFormProps): ReactElement {
  const [internalError, setInternalError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, CharacterFormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      species: '',
      size: 'medium',
      class: '',
      level: 1,
      str: 10,
      ...defaultValues,
    },
  });

  const errorMessage = submitError ?? internalError;

  async function handle(values: CharacterFormOutput): Promise<void> {
    setInternalError(null);
    try {
      await onSubmit(values);
    } catch (err) {
      setInternalError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  return (
    <form
      onSubmit={(e) => {
        void handleSubmit(handle)(e);
      }}
      className="space-y-4"
      noValidate
    >
      <Group icon={User} title="Identity">
        <Field id="name" label="Name" error={errors.name?.message}>
          <Input id="name" autoFocus {...register('name')} />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field id="species" label="Species" error={errors.species?.message}>
            <Input id="species" placeholder="e.g. Dwarf" {...register('species')} />
          </Field>

          <Field id="size" label="Size" error={errors.size?.message}>
            <select
              id="size"
              {...register('size')}
              className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              <option value="tiny">Tiny (× 0.5 capacity)</option>
              <option value="small">Small (× 0.5 capacity)</option>
              <option value="medium">Medium (× 1 capacity)</option>
              <option value="large">Large (× 2 capacity)</option>
              <option value="huge">Huge (× 4 capacity)</option>
              <option value="gargantuan">Gargantuan (× 8 capacity)</option>
            </select>
          </Field>
        </div>
      </Group>

      <Group icon={Swords} title="Class & level">
        <div className="grid grid-cols-[1fr_5rem] gap-3">
          <Field id="class" label="Class" error={errors.class?.message}>
            <Input id="class" placeholder="e.g. Fighter" {...register('class')} />
          </Field>

          <Field id="level" label="Level" error={errors.level?.message}>
            <Input id="level" type="number" min={1} max={20} {...register('level')} />
          </Field>
        </div>
      </Group>

      <Group icon={Dumbbell} title="Ability">
        <Field
          id="str"
          label="STR"
          error={errors.str?.message}
          hint="Drives carrying capacity together with size (§3.6). Range 1–30."
        >
          <Input id="str" type="number" min={1} max={30} {...register('str')} />
        </Field>
      </Group>

      {errorMessage !== null && errorMessage !== undefined ? (
        <p className="text-sm text-destructive" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <div className="flex justify-end gap-2 pt-2">
        {onCancel !== undefined ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Creating…' : 'Create character'}
        </Button>
      </div>
    </form>
  );
}

/**
 * R9.12b — labelled sub-section grouping the character fields
 * (Identity / Class & level / Ability), ported from the design-lab
 * `character/CharacterFormGrouped` mockup. Framed `surface-2` block with a
 * `font-display` uppercase eyebrow + icon.
 */
function Group({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 font-display text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {title}
      </h3>
      <div className="space-y-3 rounded-lg border border-border bg-surface-2/30 p-3">
        {children}
      </div>
    </section>
  );
}

interface FieldProps {
  id: string;
  label: string;
  error: string | undefined;
  hint?: string;
  children: ReactElement;
}

function Field({ id, label, error, hint, children }: FieldProps): ReactElement {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint !== undefined ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
      {error !== undefined ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
