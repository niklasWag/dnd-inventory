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
import { useStore } from '@/store';

interface DeleteHomebrewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  definitionId: string;
  definitionName: string;
  /** Number of distinct stashes currently holding any instance of this
   * definition. When > 0, the reducer rejects the delete; the dialog
   * disables the action button and shows a "remove items first" message. */
  referenceStashCount: number;
}

/**
 * Confirm-then-delete affordance for homebrew `ItemDefinition` rows
 * (M6). Mirrors `DeleteStashDialog`. The reducer's delete policy is
 * **reject when referenced** — this dialog disables the destructive
 * action when `referenceStashCount > 0` and explains why.
 */
export function DeleteHomebrewDialog({
  open,
  onOpenChange,
  definitionId,
  definitionName,
  referenceStashCount,
}: DeleteHomebrewDialogProps): ReactElement {
  const dispatch = useStore((s) => s.dispatch);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function confirm(): void {
    try {
      setSubmitError(null);
      dispatch({ type: 'delete-homebrew', payload: { definitionId } });
      toast.success('Homebrew deleted');
      onOpenChange(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  const inUse = referenceStashCount > 0;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {definitionName}?</AlertDialogTitle>
          <AlertDialogDescription>
            {inUse ? (
              <>
                <strong>
                  {referenceStashCount} stash
                  {referenceStashCount === 1 ? '' : 'es'} hold
                  {referenceStashCount === 1 ? 's' : ''} this item.
                </strong>{' '}
                Remove every instance from those stashes before deleting the definition. (We refuse
                to silently delete items in use.)
              </>
            ) : (
              'This removes the homebrew row from the catalog. PHB rows are unaffected.'
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {submitError !== null ? (
          <p className="text-sm text-destructive" role="alert">
            {submitError}
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={confirm} disabled={inUse} aria-disabled={inUse}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
