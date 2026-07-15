import { useMemo, useState, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useStore } from '@/store';
import { isCurrentUserDmOrSolo } from '@/lib/currentUserRole';
import { useCanDispatch } from '@/lib/useCanDispatch';
import { useDispatch, type DispatchFn } from '@/lib/useDispatch';

/**
 * R6.0 — Edit-character dialog. Single form covering all five
 * `edit-character` fields (species / class / level / str /
 * maxAttunement). Per-field disabled state derives from the actor's
 * OUTLINE §8.1 rights:
 *   - species / class / level / str: owner OR DM;
 *   - maxAttunement: DM (or solo per §8.2 union-of-rights).
 * Fields the actor can't edit still render (read-only) so the surface
 * consistently shows the character's full stats.
 *
 * Server-mode considerations: no schema / guard / persistor change.
 * `editCharacterGuard` (packages/shared/src/guards/map.ts:692) already
 * enforces the DM-vs-owner split; this dialog just avoids surfacing a
 * rejection round-trip. `useCanDispatch()` disables Save during a
 * multi-member offline window (R5.1.d).
 *
 * Over-cap confirm: when a submit lowers `maxAttunement` strictly
 * BELOW the character's currently-attuned count, a secondary
 * AlertDialog opens with the pending patch parked. Reducer accepts the
 * reduction (over-cap is a display flag, not an invariant), but the
 * confirm exists so the DM doesn't strand players over cap by
 * accident. Reductions where `newMax >= attunedCount` commit silently.
 *
 * No-op guard: RHF returns dirty fields; we build the patch from only
 * the changed keys and short-circuit when the patch is empty. Reducer
 * would otherwise throw `'edit-character: no fields changed'`.
 */

const formSchema = z.object({
  species: z.string().trim().min(1, 'Species is required').max(40),
  class: z.string().trim().min(1, 'Class is required').max(40),
  level: z.coerce.number().int().min(1, 'Level must be between 1 and 20').max(20),
  str: z.coerce.number().int().min(1, 'STR must be between 1 and 30').max(30),
  maxAttunement: z.coerce.number().int().min(0, 'maxAttunement must be zero or greater'),
});

type FormInput = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

interface EditCharacterDialogProps {
  characterId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditCharacterDialog({
  characterId,
  open,
  onOpenChange,
}: EditCharacterDialogProps): ReactElement | null {
  const view = useStore(
    useShallow((s) => {
      if (s.appState === null) return null;
      const character = s.appState.characters.find((c) => c.id === characterId);
      if (character === undefined) return null;
      const myUserId = s.appState.user.id;
      const isOwner = character.ownerUserId === myUserId;
      const attunedCount = s.appState.items.reduce(
        (n, it) => (it.ownerId === character.inventoryStashId && it.attuned ? n + 1 : n),
        0,
      );
      return { character, isOwner, attunedCount };
    }),
  );
  const isDmOrSolo = useStore(useShallow((s) => isCurrentUserDmOrSolo(s.appState)));
  const canDispatch = useCanDispatch();
  const dispatch = useDispatch();

  if (view === null) return null;
  const { character, isOwner, attunedCount } = view;

  // Owner OR DM may edit species/class/level/str. DM (or solo) may
  // also edit maxAttunement.
  const canEditOwnerFields = isOwner || isDmOrSolo;
  const canEditMaxAttunement = isDmOrSolo;

  return (
    <EditCharacterDialogInner
      key={character.id + open.toString()}
      open={open}
      onOpenChange={onOpenChange}
      character={character}
      attunedCount={attunedCount}
      canEditOwnerFields={canEditOwnerFields}
      canEditMaxAttunement={canEditMaxAttunement}
      canDispatch={canDispatch}
      dispatch={dispatch}
    />
  );
}

interface InnerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  character: {
    id: string;
    name: string;
    species: string;
    class: string;
    level: number;
    abilityScores: { STR: number };
    maxAttunement: number;
  };
  attunedCount: number;
  canEditOwnerFields: boolean;
  canEditMaxAttunement: boolean;
  canDispatch: boolean;
  dispatch: DispatchFn;
}

/**
 * Split from the outer so the `useForm` hook remounts (via `key`) each
 * time the dialog opens, seeding defaults from the current character.
 * Prevents a stale form value after another dispatch mutates the
 * character while the dialog is closed.
 */
function EditCharacterDialogInner({
  open,
  onOpenChange,
  character,
  attunedCount,
  canEditOwnerFields,
  canEditMaxAttunement,
  canDispatch,
  dispatch,
}: InnerProps): ReactElement {
  const defaults = useMemo<FormInput>(
    () => ({
      species: character.species,
      class: character.class,
      level: character.level,
      str: character.abilityScores.STR,
      maxAttunement: character.maxAttunement,
    }),
    [character],
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: defaults,
  });

  const [pendingOverCap, setPendingOverCap] = useState<FormOutput | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function buildPatch(values: FormOutput): {
    species?: string;
    class?: string;
    level?: number;
    str?: number;
    maxAttunement?: number;
  } {
    const patch: {
      species?: string;
      class?: string;
      level?: number;
      str?: number;
      maxAttunement?: number;
    } = {};
    if (canEditOwnerFields) {
      if (values.species !== character.species) patch.species = values.species;
      if (values.class !== character.class) patch.class = values.class;
      if (values.level !== character.level) patch.level = values.level;
      if (values.str !== character.abilityScores.STR) patch.str = values.str;
    }
    if (canEditMaxAttunement && values.maxAttunement !== character.maxAttunement) {
      patch.maxAttunement = values.maxAttunement;
    }
    return patch;
  }

  function commit(patch: ReturnType<typeof buildPatch>): void {
    setSubmitError(null);
    void dispatch(
      {
        type: 'edit-character',
        payload: { characterId: character.id, patch },
      },
      {
        onSuccess: () => {
          toast.success('Character updated');
          onOpenChange(false);
        },
        onRejection: (_code, message) => setSubmitError(message ?? 'Unknown error'),
      },
    );
  }

  function onSubmit(values: FormOutput): void {
    const patch = buildPatch(values);
    if (Object.keys(patch).length === 0) {
      // Silent no-op close — mirrors RenameField / RenameStashModal
      // pattern and dodges the reducer's `no fields changed` throw.
      onOpenChange(false);
      return;
    }
    // Over-cap guard: only when the DM is actually LOWERING maxAttunement
    // below the current attuned count. Reducer accepts the reduction
    // (R1.2 line 865 — over-cap is a display flag, not an invariant),
    // but we want an explicit confirm so it isn't an accidental strand.
    if (patch.maxAttunement !== undefined && patch.maxAttunement < attunedCount) {
      setPendingOverCap(values);
      return;
    }
    commit(patch);
  }

  const ownerFieldDisabled = !canEditOwnerFields;
  const maxAttunementDisabled = !canEditMaxAttunement;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Edit {character.name}</DialogTitle>
            <DialogDescription>
              {canEditMaxAttunement
                ? 'Update any field. Max attunement is DM-only.'
                : 'Update your character. Max attunement is DM-only.'}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              void handleSubmit(onSubmit)(e);
            }}
            className="grid gap-4"
            noValidate
          >
            <div className="grid gap-1.5">
              <Label htmlFor="edit-character-species">Species</Label>
              <Input
                id="edit-character-species"
                {...register('species')}
                disabled={ownerFieldDisabled}
                readOnly={ownerFieldDisabled}
              />
              {errors.species?.message !== undefined ? (
                <p className="text-sm text-destructive" role="alert">
                  {errors.species.message}
                </p>
              ) : null}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="edit-character-class">Class</Label>
              <Input
                id="edit-character-class"
                {...register('class')}
                disabled={ownerFieldDisabled}
                readOnly={ownerFieldDisabled}
              />
              {errors.class?.message !== undefined ? (
                <p className="text-sm text-destructive" role="alert">
                  {errors.class.message}
                </p>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="edit-character-level">Level</Label>
                <Input
                  id="edit-character-level"
                  type="number"
                  min={1}
                  max={20}
                  {...register('level')}
                  disabled={ownerFieldDisabled}
                  readOnly={ownerFieldDisabled}
                />
                {errors.level?.message !== undefined ? (
                  <p className="text-sm text-destructive" role="alert">
                    {errors.level.message}
                  </p>
                ) : null}
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="edit-character-str">STR</Label>
                <Input
                  id="edit-character-str"
                  type="number"
                  min={1}
                  max={30}
                  {...register('str')}
                  disabled={ownerFieldDisabled}
                  readOnly={ownerFieldDisabled}
                />
                {errors.str?.message !== undefined ? (
                  <p className="text-sm text-destructive" role="alert">
                    {errors.str.message}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="edit-character-maxAttunement">Max attunement</Label>
              <Input
                id="edit-character-maxAttunement"
                type="number"
                min={0}
                {...register('maxAttunement')}
                disabled={maxAttunementDisabled}
                readOnly={maxAttunementDisabled}
                aria-describedby="edit-character-maxAttunement-hint"
              />
              <p id="edit-character-maxAttunement-hint" className="text-xs text-muted-foreground">
                {maxAttunementDisabled ? 'DM-only edit.' : `Currently attuned: ${attunedCount}.`}
              </p>
              {errors.maxAttunement?.message !== undefined ? (
                <p className="text-sm text-destructive" role="alert">
                  {errors.maxAttunement.message}
                </p>
              ) : null}
            </div>

            {submitError !== null ? (
              <p className="text-sm text-destructive" role="alert">
                {submitError}
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting || !canDispatch}>
                {isSubmitting ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingOverCap !== null}
        onOpenChange={(next) => {
          if (!next) setPendingOverCap(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave {character.name} over cap?</AlertDialogTitle>
            <AlertDialogDescription>
              {character.name} is attuned to {attunedCount} item
              {attunedCount === 1 ? '' : 's'}. Reducing max attunement to{' '}
              {pendingOverCap?.maxAttunement ?? ''} will leave them over cap. Existing attunements
              are kept. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingOverCap === null) return;
                const patch = buildPatch(pendingOverCap);
                setPendingOverCap(null);
                commit(patch);
              }}
            >
              Reduce anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
