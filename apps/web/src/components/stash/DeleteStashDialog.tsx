import { useState, type ReactElement } from 'react';
import { toast } from 'sonner';

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
import { useDispatch } from '@/lib/useDispatch';
import { useCanDispatch } from '@/lib/useCanDispatch';

interface DeleteStashDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stashId: string;
  stashName: string;
  /** Sum-of-quantities item count (matches the Storage card UI copy). */
  itemCount: number;
  /** Fired after a successful delete so the parent can navigate. */
  onDeleted: () => void;
}

/**
 * Confirm-then-delete affordance for Storage stashes (M3). The reducer
 * does the actual work — moves items to Recovered Loot, rolls currency
 * in, and emits the cascade. This dialog is purely confirmation UX.
 *
 * Simple two-button confirm (per M3 plan decision — no confirm-by-typing,
 * which would be overkill for MVP).
 */
export function DeleteStashDialog({
  open,
  onOpenChange,
  stashId,
  stashName,
  itemCount,
  onDeleted,
}: DeleteStashDialogProps): ReactElement {
  const dispatch = useDispatch();
  const canDispatch = useCanDispatch();
  const [submitError, setSubmitError] = useState<string | null>(null);

  function confirm(): void {
    setSubmitError(null);
    void dispatch(
      { type: 'delete-stash', payload: { stashId } },
      {
        onSuccess: () => {
          toast.success('Stash deleted');
          onOpenChange(false);
          onDeleted();
        },
        onRejection: (_code, message) => setSubmitError(message ?? 'Unknown error'),
      },
    );
  }

  const itemsCopy =
    itemCount === 0 ? 'no items' : `${itemCount.toString()} ${itemCount === 1 ? 'item' : 'items'}`;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {stashName}?</AlertDialogTitle>
          <AlertDialogDescription>
            This will move {itemsCopy} to Recovered Loot, then remove the stash. Currency (currently
            0 gp; M4 will surface real totals) rolls in too.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {submitError !== null ? (
          <p className="text-sm text-destructive" role="alert">
            {submitError}
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={confirm} disabled={!canDispatch}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
