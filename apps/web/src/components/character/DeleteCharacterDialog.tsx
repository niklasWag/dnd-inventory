import { type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';

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
import { useCurrentPartyId } from '@/lib/useCurrentPartyId';
import { useCanDispatch } from '@/lib/useCanDispatch';
import { useDispatch } from '@/lib/useDispatch';

/**
 * R9.2 — Delete-character confirm dialog. The Character Sheet's net-new
 * UI entry for the `delete-character` action (reducer + schema shipped
 * in R4.1.b; no UI existed until this slice).
 *
 * The dialog spells out the OUTLINE §8.3 cascade the reducer performs
 * (`cascadeCharacterToRecoveredLoot`): every item + all currency the
 * character held rolls into the party's Recovered Loot, and the owning
 * user keeps their party seat so they can create a fresh character.
 *
 * On success it navigates to the party's settings screen — the
 * "create your character" landing (mirrors Hub's post-delete routing:
 * a seat with `characterId: null` lands on settings, not a character
 * sheet). `useCanDispatch()` disables Confirm during the R5.1.d
 * multi-member offline window.
 *
 * Visibility is the caller's concern — CharacterSheet only mounts this
 * when the actor may edit the character (owner / DM / solo, per §8.1 +
 * §8.2 union-of-rights).
 */
interface DeleteCharacterDialogProps {
  characterId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeleteCharacterDialog({
  characterId,
  open,
  onOpenChange,
}: DeleteCharacterDialogProps): ReactElement | null {
  const navigate = useNavigate();
  const partyId = useCurrentPartyId();
  const canDispatch = useCanDispatch();
  const dispatch = useDispatch();

  const name = useStore(
    useShallow((s) => s.appState?.characters.find((c) => c.id === characterId)?.name ?? null),
  );

  if (name === null) return null;

  function onConfirm(): void {
    void dispatch(
      { type: 'delete-character', payload: { characterId } },
      {
        onSuccess: () => {
          toast.success(`${name} deleted`);
          onOpenChange(false);
          void navigate(`/party/${partyId}/settings`);
        },
      },
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Everything {name} is carrying — every item and all currency, across their Inventory and
            any Storage stashes — rolls into the party&apos;s Recovered Loot. Equipped and attuned
            items are released. You keep your seat in the party, so you can create a new character
            afterwards. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!canDispatch}
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete character
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
