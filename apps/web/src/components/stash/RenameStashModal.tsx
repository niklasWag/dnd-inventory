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

interface RenameStashModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stashId: string;
  /** Current name — pre-filled into the input so the user can tweak. */
  currentName: string;
}

/**
 * Rename modal for Storage stashes (M3). RHF + Zod gate; on submit
 * dispatches `rename-stash`. The reducer rejects no-op renames, so we
 * also short-circuit a same-name submission UI-side to avoid a wasted
 * round trip.
 */
const formSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60, 'Name is too long (max 60 chars)'),
});

type FormValues = z.input<typeof formSchema>;
type FormOutput = z.output<typeof formSchema>;

export function RenameStashModal({
  open,
  onOpenChange,
  stashId,
  currentName,
}: RenameStashModalProps): ReactElement {
  const dispatch = useStore((s) => s.dispatch);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, FormOutput>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: currentName },
  });

  // When the modal opens, re-seed defaults with the latest currentName
  // (the parent may have rendered with a stale value the first time
  // this component mounted).
  useEffect(() => {
    if (open) {
      reset({ name: currentName });
      setSubmitError(null);
    }
  }, [open, currentName, reset]);

  function onSubmit(values: FormOutput): void {
    // Same name → close without dispatching (reducer would throw).
    if (values.name === currentName) {
      onOpenChange(false);
      return;
    }
    try {
      setSubmitError(null);
      dispatch({
        type: 'rename-stash',
        payload: { stashId, newName: values.name },
      });
      toast.success('Storage stash renamed');
      onOpenChange(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename Storage stash</DialogTitle>
          <DialogDescription>Pick a new name (1–60 characters).</DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            void handleSubmit(onSubmit)(e);
          }}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-1.5">
            <Label htmlFor="rename-stash-name">Name</Label>
            <Input id="rename-stash-name" autoFocus {...register('name')} />
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
              {isSubmitting ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
