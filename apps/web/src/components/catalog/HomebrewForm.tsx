import { useEffect, useState, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';

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
import type { HomebrewDefinitionInput, HomebrewDefinitionPatch } from '@/store/types';
import type { ItemCategory, ItemDefinition } from '@app/shared';

/**
 * HomebrewForm (M6) — RHF + Zod modal for create / edit / duplicate of
 * homebrew `ItemDefinition` rows. Three modes:
 *
 *   - **create** — fresh defaults; submit dispatches `create-homebrew`.
 *   - **edit** — pre-fills from `definition`; submit dispatches
 *     `edit-homebrew` with `{ definitionId, patch }`.
 *   - **duplicate** — pre-fills from a PHB `definition`, sets
 *     `duplicatedFromId: definition.id` on the resulting homebrew row.
 *
 * On successful create, calls `onCreated(definitionId)` (if provided)
 * with the new id so the parent can chain a follow-up dispatch (e.g.
 * AddItemModal's Custom tab acquires the freshly-created definition).
 *
 * UI conventions follow the M3+ modal pattern documented in
 * `CreateStashModal` / `RenameStashModal`: reset-on-open, try/catch
 * around dispatch, toast on success, surface reducer errors inline.
 */

const CATEGORY_OPTIONS: { value: ItemCategory; label: string }[] = [
  { value: 'weapon', label: 'Weapon' },
  { value: 'armor', label: 'Armor' },
  { value: 'gear', label: 'Adventuring gear' },
  { value: 'tool', label: 'Tool' },
  { value: 'ammunition', label: 'Ammunition' },
  { value: 'consumable', label: 'Consumable' },
  { value: 'container', label: 'Container' },
  { value: 'other', label: 'Other' },
];

/**
 * Form schema. All fields are user-facing strings (RHF integrates with
 * `<input>` natively); coercion to the typed payload shape happens in
 * `toDispatchPayload`. Optional fields use empty-string sentinels rather
 * than `undefined` because RHF's `defaultValues` works most naturally
 * with stable string types.
 */
const formSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(120, 'Name is too long (max 120 chars)'),
  category: z.enum([
    'weapon',
    'armor',
    'gear',
    'tool',
    'ammunition',
    'consumable',
    'container',
    'other',
  ]),
  weight: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || (!isNaN(Number(v)) && Number(v) >= 0),
      'Weight must be 0 or higher',
    ),
  costAmount: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || (!isNaN(Number(v)) && Number(v) >= 0 && Number.isInteger(Number(v))),
      'Cost must be a non-negative whole number',
    ),
  costCurrency: z.enum(['cp', 'sp', 'ep', 'gp', 'pp']),
  description: z.string().trim().max(2000, 'Description is too long (max 2000 chars)'),
  tags: z.string().trim().max(200, 'Tags string is too long (max 200 chars)'),
});

type FormValues = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

export type HomebrewFormMode = 'create' | 'edit' | 'duplicate';

interface HomebrewFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: HomebrewFormMode;
  /** Required for `edit` (the row being edited) and `duplicate` (the
   * source row whose values pre-fill the form + whose id becomes
   * `duplicatedFromId` on the created homebrew). Ignored in `create`. */
  definition?: ItemDefinition;
  /** Fired with the new definitionId after a successful create or
   * duplicate. Not fired on edit (the definitionId is unchanged). Lets
   * AddItemModal chain a follow-up `acquire` dispatch. */
  onCreated?: (definitionId: string) => void;
}

function definitionToFormValues(def: ItemDefinition | undefined): FormValues {
  return {
    name: def?.name ?? '',
    category: def?.category ?? 'gear',
    weight: def?.weight !== undefined ? String(def.weight) : '',
    costAmount: def?.cost !== undefined ? String(def.cost.amount) : '',
    costCurrency: def?.cost?.currency ?? 'gp',
    description: def?.description ?? '',
    tags: def?.tags !== undefined ? def.tags.join(', ') : '',
  };
}

/**
 * Convert form output into a payload. Two modes:
 *
 * - **create mode (`forEdit=false`)**: returns a clean `HomebrewDefinitionInput`.
 *   Empty-string optionals collapse to absent keys (the spread in
 *   `createHomebrew` then doesn't set them on the row).
 *
 * - **edit mode (`forEdit=true`)**: returns a `HomebrewDefinitionPatch`
 *   where empty-string optionals become `{ key: undefined }` — the
 *   reducer's diff loop reads this as "user explicitly cleared this
 *   optional field" and removes it from the stored row.
 */
function formOutputToCreateInput(values: FormOutput): HomebrewDefinitionInput {
  const result: HomebrewDefinitionInput = {
    name: values.name,
    category: values.category,
  };
  if (values.weight !== '') result.weight = Number(values.weight);
  if (values.costAmount !== '') {
    result.cost = { amount: Number(values.costAmount), currency: values.costCurrency };
  }
  if (values.description !== '') result.description = values.description;
  if (values.tags !== '') {
    const tags = values.tags
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
    if (tags.length > 0) result.tags = tags;
  }
  return result;
}

function formOutputToEditPatch(values: FormOutput): HomebrewDefinitionPatch {
  // Every field is present (possibly as `undefined`) so the reducer's
  // diff sees both "set to X" and "explicitly cleared" cases.
  const result: HomebrewDefinitionPatch = {
    name: values.name,
    category: values.category,
    weight: values.weight === '' ? undefined : Number(values.weight),
    cost:
      values.costAmount === ''
        ? undefined
        : { amount: Number(values.costAmount), currency: values.costCurrency },
    description: values.description === '' ? undefined : values.description,
  };
  const tagsList =
    values.tags === ''
      ? undefined
      : values.tags
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0);
  result.tags = tagsList !== undefined && tagsList.length > 0 ? tagsList : undefined;
  return result;
}

export function HomebrewForm({
  open,
  onOpenChange,
  mode,
  definition,
  onCreated,
}: HomebrewFormProps): ReactElement {
  const dispatch = useStore((s) => s.dispatch);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: definitionToFormValues(definition),
  });

  // Reset on open OR when the underlying definition reference changes
  // (e.g. CatalogBrowser opens edit on a different row).
  useEffect(() => {
    if (open) {
      reset(definitionToFormValues(definition));
      setSubmitError(null);
    }
  }, [open, definition, reset]);

  function onSubmit(values: FormOutput): void {
    try {
      setSubmitError(null);

      if (mode === 'edit') {
        if (definition === undefined) {
          throw new Error('HomebrewForm: edit mode requires a definition prop');
        }
        const patch = formOutputToEditPatch(values);
        dispatch({
          type: 'edit-homebrew',
          payload: { definitionId: definition.id, patch },
        });
        toast.success('Homebrew updated');
        onOpenChange(false);
        return;
      }

      // create OR duplicate
      const input = formOutputToCreateInput(values);
      const duplicatedFromId = mode === 'duplicate' ? definition?.id : undefined;
      dispatch({
        type: 'create-homebrew',
        payload: {
          ...input,
          ...(duplicatedFromId !== undefined ? { duplicatedFromId } : {}),
        },
      });
      const newDefId = useStore.getState().appState!.catalog.at(-1)!.id;
      toast.success(mode === 'duplicate' ? 'Homebrew duplicated' : 'Homebrew created');
      onOpenChange(false);
      onCreated?.(newDefId);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  const title =
    mode === 'edit' ? 'Edit homebrew' : mode === 'duplicate' ? 'Duplicate to homebrew' : 'New homebrew item';

  const description =
    mode === 'edit'
      ? 'Update the homebrew definition. Changes propagate to every stash holding this item.'
      : mode === 'duplicate'
        ? 'Create an editable homebrew copy. The original PHB row stays read-only.'
        : 'Build your own item. It joins the catalog as a homebrew entry.';

  const submitLabel = isSubmitting
    ? 'Saving…'
    : mode === 'edit'
      ? 'Save'
      : mode === 'duplicate'
        ? 'Duplicate'
        : 'Create';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            void handleSubmit(onSubmit)(e);
          }}
          className="space-y-4"
          noValidate
        >
          <div className="grid grid-cols-[2fr_1fr] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="homebrew-name">Name</Label>
              <Input id="homebrew-name" autoFocus {...register('name')} />
              {errors.name?.message !== undefined ? (
                <p className="text-sm text-destructive" role="alert">
                  {errors.name.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="homebrew-category">Category</Label>
              <select
                id="homebrew-category"
                {...register('category')}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-[1fr_1fr_1fr] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="homebrew-weight">Weight (lb)</Label>
              <Input
                id="homebrew-weight"
                inputMode="decimal"
                placeholder="optional"
                {...register('weight')}
              />
              {errors.weight?.message !== undefined ? (
                <p className="text-sm text-destructive" role="alert">
                  {errors.weight.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="homebrew-cost-amount">Cost (amount)</Label>
              <Input
                id="homebrew-cost-amount"
                inputMode="numeric"
                placeholder="optional"
                {...register('costAmount')}
              />
              {errors.costAmount?.message !== undefined ? (
                <p className="text-sm text-destructive" role="alert">
                  {errors.costAmount.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="homebrew-cost-currency">Currency</Label>
              <select
                id="homebrew-cost-currency"
                {...register('costCurrency')}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="cp">cp</option>
                <option value="sp">sp</option>
                <option value="ep">ep</option>
                <option value="gp">gp</option>
                <option value="pp">pp</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="homebrew-description">Description</Label>
            <textarea
              id="homebrew-description"
              rows={4}
              placeholder="optional"
              {...register('description')}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            {errors.description?.message !== undefined ? (
              <p className="text-sm text-destructive" role="alert">
                {errors.description.message}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="homebrew-tags">Tags (comma-separated)</Label>
            <Input
              id="homebrew-tags"
              placeholder="e.g. light, underdark"
              {...register('tags')}
            />
            {errors.tags?.message !== undefined ? (
              <p className="text-sm text-destructive" role="alert">
                {errors.tags.message}
              </p>
            ) : null}
          </div>

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
            <Button type="submit" disabled={isSubmitting}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
