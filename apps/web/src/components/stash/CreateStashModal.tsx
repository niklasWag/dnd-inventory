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
import { dispatchMintingAction } from '@/store';

interface CreateStashModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The character whose Storage stash is being created. */
  ownerCharacterId: string;
}

/**
 * Modal for creating a Storage stash (M3 / MVP §7 screen 2 Storage tab).
 * RHF + Zod gating mirrors `CreateCharacter`. On submit, dispatches
 * `create-stash` and closes the modal. Reducer is the source of truth
 * for invariants (rejects empty / whitespace-only names) — this form's
 * Zod schema is the user-facing gate.
 */
const formSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60, 'Name is too long (max 60 chars)'),
});

type FormValues = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

export function CreateStashModal({
  open,
  onOpenChange,
  ownerCharacterId,
}: CreateStashModalProps): ReactElement {
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '' },
  });

  // Reset the form (clear name + errors) every time the modal opens.
  // Without this the previous name persists if the user opens → cancels
  // → opens again.
  useEffect(() => {
    if (open) {
      reset({ name: '' });
      setSubmitError(null);
    }
  }, [open, reset]);

  function onSubmit(values: FormOutput): void {
    try {
      setSubmitError(null);
      dispatchMintingAction({
        type: 'create-stash',
        payload: { ownerCharacterId, name: values.name },
      });
      toast.success('Storage stash created');
      onOpenChange(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Storage stash</DialogTitle>
          <DialogDescription>
            Pick a name like &ldquo;Chest at home&rdquo; or &ldquo;Bag of holding&rdquo;.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            void handleSubmit(onSubmit)(e);
          }}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-1.5">
            <Label htmlFor="storage-stash-name">Name</Label>
            <Input id="storage-stash-name" autoFocus {...register('name')} />
            {errors.name?.message !== undefined ? (
              <p className="text-sm text-destructive" role="alert">
                {errors.name.message}
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
              {isSubmitting ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
