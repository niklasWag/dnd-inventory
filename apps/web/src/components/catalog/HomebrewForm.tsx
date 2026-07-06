import { useEffect, useState, type ReactElement } from 'react';
import { useForm, useWatch } from 'react-hook-form';
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
import { useStore, dispatchMintingAction } from '@/store';
import type { HomebrewDefinitionInput, HomebrewDefinitionPatch } from '@/store/types';
import type { ItemCategory, ItemDefinition, Rarity } from '@app/shared';

/**
 * HomebrewForm (M6) — RHF + Zod form for create / edit / duplicate of
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
 * **Two render variants** so the same form logic + schema serves both
 * standalone and embedded use cases without duplication:
 *
 *   - **`variant: 'modal'`** (default) — wraps the form in `<Dialog>`
 *     with its own title/description. Used by `CatalogBrowser` for
 *     create / edit / duplicate as a top-level modal.
 *   - **`variant: 'inline'`** — renders just the fields + footer
 *     buttons (no Dialog chrome). The parent owns the modal shell.
 *     Used by `AddItemModal`'s Custom tab so the form lives **inside**
 *     the AddItemModal rather than as a nested modal on top.
 *
 * Inline mode ignores the `open` prop — render lifecycle is controlled
 * by the parent (typically by conditionally mounting the component or
 * showing/hiding the surrounding container). It still calls
 * `onOpenChange(false)` on Cancel + on successful submit so the parent
 * can react (e.g. switch back to the Catalog tab on cancel).
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
  { value: 'magic', label: 'Magic item' },
  { value: 'currency', label: 'Currency / gem' },
  { value: 'container', label: 'Container' },
  { value: 'other', label: 'Other' },
];

/**
 * BUG-012 (2026-07-06) — rarity options offered when `category === 'magic'`.
 * Kebab-case values match the shared `raritySchema` and the reducer's
 * `Rarity` type. The empty-string sentinel represents "no rarity picked
 * yet"; the cross-field refinement below rejects that combination when
 * category is magic.
 */
const RARITY_OPTIONS: { value: '' | Rarity; label: string }[] = [
  { value: '', label: '— pick a rarity —' },
  { value: 'common', label: 'Common' },
  { value: 'uncommon', label: 'Uncommon' },
  { value: 'rare', label: 'Rare' },
  { value: 'very-rare', label: 'Very rare' },
  { value: 'legendary', label: 'Legendary' },
  { value: 'artifact', label: 'Artifact' },
];

/**
 * Form schema. All fields are user-facing strings (RHF integrates with
 * `<input>` natively); coercion to the typed payload shape happens in
 * `formOutputToCreateInput` / `formOutputToEditPatch`. Optional fields
 * use empty-string sentinels rather than `undefined` because RHF's
 * `defaultValues` works most naturally with stable string types.
 */
const formSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(120, 'Name is too long (max 120 chars)'),
    category: z.enum([
      'weapon',
      'armor',
      'gear',
      'tool',
      'ammunition',
      'consumable',
      'magic',
      'currency',
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
    // BUG-012 — magic-item metadata. Kebab-case values match the shared
    // `raritySchema`. Empty string = "not picked"; enforced via the
    // cross-field `.superRefine` below when `category === 'magic'`.
    rarity: z.enum(['', 'common', 'uncommon', 'rare', 'very-rare', 'legendary', 'artifact']),
    requiresAttunement: z.boolean(),
    attunementPrereq: z.string().trim().max(200, 'Prereq is too long (max 200 chars)'),
  })
  .superRefine((values, ctx) => {
    // BUG-012 — rarity is required for magic items. Non-magic categories
    // accept `rarity: ''` (the reducer/wire layer will simply omit the
    // field). The refinement targets the `rarity` path so RHF surfaces
    // the message inline with the select.
    if (values.category === 'magic' && values.rarity === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['rarity'],
        message: 'Rarity is required for magic items',
      });
    }
  });

type FormValues = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

export type HomebrewFormMode = 'create' | 'edit' | 'duplicate';
export type HomebrewFormVariant = 'modal' | 'inline';

interface HomebrewFormProps {
  /** Required in `modal` variant; ignored in `inline` (parent controls
   * the lifecycle via conditional render). */
  open: boolean;
  /** Called when the user cancels OR after a successful submit. Parents
   * use this to close the surrounding modal, switch tabs, etc. */
  onOpenChange: (open: boolean) => void;
  mode: HomebrewFormMode;
  /** `'modal'` (default) wraps in `<Dialog>`; `'inline'` renders just
   * the form fields + buttons so the parent owns the modal shell. */
  variant?: HomebrewFormVariant;
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
    // BUG-012 — magic-item metadata. `rarity: null` collapses to `''`
    // (schema allows null; the form treats null / undefined / absent
    // identically as "not picked").
    rarity: def?.rarity ?? '',
    requiresAttunement: def?.requiresAttunement === true,
    attunementPrereq: def?.attunementPrereq ?? '',
  };
}

/**
 * Convert form output into a payload. Two helpers:
 *
 * - **create mode**: returns a clean `HomebrewDefinitionInput`.
 *   Empty-string optionals collapse to absent keys (the spread in
 *   `createHomebrew` then doesn't set them on the row).
 *
 * - **edit mode**: returns a `HomebrewDefinitionPatch` where every
 *   editable field is present, possibly as `undefined`. The reducer's
 *   diff loop reads `undefined` as "user explicitly cleared this
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
  // BUG-012 — surface magic-item metadata only when category=magic
  // (the form gates the inputs; non-magic categories don't collect
  // them). Rarity is required by the schema refinement above, so an
  // empty value here would only appear if magic is picked but the
  // refinement was bypassed — defensive branch keeps the payload
  // schema-clean.
  if (values.category === 'magic') {
    if (values.rarity !== '') result.rarity = values.rarity;
    if (values.requiresAttunement) result.requiresAttunement = true;
    if (values.requiresAttunement && values.attunementPrereq !== '') {
      result.attunementPrereq = values.attunementPrereq;
    }
  }
  return result;
}

function formOutputToEditPatch(values: FormOutput): HomebrewDefinitionPatch {
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
  // BUG-012 — magic-item metadata in patch context. `undefined` here
  // means "clear this optional field" per the reducer's diff loop.
  // When category flips AWAY from magic in edit mode, we EXPLICITLY
  // clear all three so the row stops advertising itself as a magic
  // item.
  if (values.category === 'magic') {
    result.rarity = values.rarity === '' ? undefined : values.rarity;
    result.requiresAttunement = values.requiresAttunement ? true : undefined;
    result.attunementPrereq =
      values.requiresAttunement && values.attunementPrereq !== ''
        ? values.attunementPrereq
        : undefined;
  } else {
    result.rarity = undefined;
    result.requiresAttunement = undefined;
    result.attunementPrereq = undefined;
  }
  return result;
}

export function HomebrewForm({
  open,
  onOpenChange,
  mode,
  variant = 'modal',
  definition,
  onCreated,
}: HomebrewFormProps): ReactElement | null {
  const dispatch = useStore((s) => s.dispatch);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: definitionToFormValues(definition),
  });

  // BUG-012 — reactive gates on `category` (reveal magic-item fields)
  // and `requiresAttunement` (reveal the nested prereq input).
  const watchedCategory = useWatch({ control, name: 'category' });
  const watchedRequiresAttunement = useWatch({ control, name: 'requiresAttunement' });
  const isMagicCategory = watchedCategory === 'magic';

  // In modal variant: reset on open or when the definition reference
  // changes (e.g. CatalogBrowser opens edit on a different row).
  // In inline variant: open is meaningless — reset on mount + when the
  // definition reference changes.
  useEffect(() => {
    if (variant === 'inline' || open) {
      reset(definitionToFormValues(definition));
      setSubmitError(null);
    }
  }, [open, variant, definition, reset]);

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
      dispatchMintingAction({
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
    mode === 'edit'
      ? 'Edit homebrew'
      : mode === 'duplicate'
        ? 'Duplicate to homebrew'
        : 'New homebrew item';

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

  // Shared form body — used by both variants. Keeping a single inline
  // form body is the whole point of the refactor: one schema, one set
  // of fields, one submit handler.
  const formBody = (
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
        <Input id="homebrew-tags" placeholder="e.g. light, underdark" {...register('tags')} />
        {errors.tags?.message !== undefined ? (
          <p className="text-sm text-destructive" role="alert">
            {errors.tags.message}
          </p>
        ) : null}
      </div>

      {/* BUG-012 (2026-07-06) — magic-item metadata. Gated by
          `category === 'magic'`: non-magic homebrew items don't need
          rarity or attunement info. Rarity is required when this
          section is visible (enforced by the schema refinement).
          The nested prereq input surfaces only when the user checks
          `Requires attunement`. */}
      {isMagicCategory ? (
        <div className="space-y-4 rounded-md border border-border p-3">
          <div className="grid grid-cols-[1fr_1fr] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="homebrew-rarity">Rarity</Label>
              <select
                id="homebrew-rarity"
                {...register('rarity')}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {RARITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {errors.rarity?.message !== undefined ? (
                <p className="text-sm text-destructive" role="alert">
                  {errors.rarity.message}
                </p>
              ) : null}
            </div>
            <div />
          </div>

          <div className="flex items-start gap-2">
            <input
              id="homebrew-requires-attunement"
              type="checkbox"
              {...register('requiresAttunement')}
              className="mt-1 h-4 w-4 rounded border-input"
            />
            <div className="space-y-1">
              <Label htmlFor="homebrew-requires-attunement" className="cursor-pointer">
                Requires attunement
              </Label>
              <p className="text-xs text-muted-foreground">
                When on, players must Attune the item in Inventory before its magical effects apply
                (subject to the character&apos;s attunement slot cap).
              </p>
            </div>
          </div>

          {watchedRequiresAttunement ? (
            <div className="space-y-1.5 pl-6">
              <Label htmlFor="homebrew-attunement-prereq">Attunement prerequisite (optional)</Label>
              <Input
                id="homebrew-attunement-prereq"
                placeholder="e.g. by a wizard, by a creature of good alignment"
                {...register('attunementPrereq')}
              />
              {errors.attunementPrereq?.message !== undefined ? (
                <p className="text-sm text-destructive" role="alert">
                  {errors.attunementPrereq.message}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {submitError !== null ? (
        <p className="text-sm text-destructive" role="alert">
          {submitError}
        </p>
      ) : null}

      {/* Footer button row. In modal variant DialogFooter handles
          layout; inline variant uses a plain flex container with the
          same right-aligned button arrangement. */}
      {variant === 'modal' ? (
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
      ) : (
        <div className="flex justify-end gap-2 pt-2">
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
        </div>
      )}
    </form>
  );

  if (variant === 'inline') {
    // Parent owns the modal shell; we render just the form body.
    // The parent is responsible for whether/when this component
    // is mounted at all — we don't gate on `open` here because
    // inline embeds rely on conditional mounting from the parent
    // (see AddItemModal's Custom tab).
    return formBody;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {formBody}
      </DialogContent>
    </Dialog>
  );
}
