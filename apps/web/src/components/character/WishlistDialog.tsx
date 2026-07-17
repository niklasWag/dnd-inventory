import { useState, type ReactElement } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { newUuidV7, type ItemDefinition, type WishlistEntry } from '@app/shared';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ItemPicker } from '@/components/catalog/ItemPicker';
import { rarityPillClass } from '@/lib/rarity';
import { useDispatch } from '@/lib/useDispatch';
import { useCanDispatch } from '@/lib/useCanDispatch';
import { useStore } from '@/store';

/**
 * R10.5 — per-character item wishlist, hosted in a dialog opened from the
 * Character Sheet header (chosen over an always-on rail card so the sheet
 * stays uncluttered — the wishlist is a deliberate side-task).
 *
 * The character's owner (or the DM / solo) curates a list of items they're
 * hoping for; the DM sees it read-only as a loot hint (Loot Distribution
 * wizard + the DM Command Center Wishlist Overview). Two entry kinds:
 * catalog items (picked via the shared `ItemPicker`) + free-text wishes.
 *
 * `canEdit` mirrors the sheet's `canEditCharacter` (owner / DM / solo). When
 * false the dialog is read-only (a non-owner viewing another's sheet).
 */
export function WishlistDialog({
  characterId,
  canEdit,
  open,
  onOpenChange,
}: {
  characterId: string;
  canEdit: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const dispatch = useDispatch();
  const canDispatch = useCanDispatch();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [textInput, setTextInput] = useState('');

  const view = useStore(
    useShallow((s) => {
      if (s.appState === null) return null;
      const c = s.appState.characters.find((ch) => ch.id === characterId);
      if (c === undefined) return null;
      return { wishlist: c.wishlist, catalog: s.appState.catalog, name: c.name };
    }),
  );

  function labelFor(entry: WishlistEntry): { name: string; rarityPill: string | null } {
    if (view === null) return { name: '', rarityPill: null };
    if (entry.kind === 'text') return { name: entry.text, rarityPill: null };
    const def = view.catalog.find((d) => d.id === entry.definitionId);
    if (def === undefined) return { name: 'Unknown item', rarityPill: null };
    const showPill = def.rarity != null && def.rarity !== 'common';
    return { name: def.name, rarityPill: showPill ? rarityPillClass(def.rarity) : null };
  }

  function addCatalog(def: ItemDefinition): void {
    setPickerOpen(false);
    if (
      view !== null &&
      view.wishlist.some((e) => e.kind === 'catalog' && e.definitionId === def.id)
    ) {
      toast.info(`${def.name} is already on the wishlist`);
      return;
    }
    void dispatch(
      {
        type: 'wishlist-add',
        payload: { characterId, entry: { id: newUuidV7(), kind: 'catalog', definitionId: def.id } },
      },
      {
        onSuccess: () => toast.success(`Added ${def.name} to wishlist`),
        onRejection: (_c, m) => toast.error(m ?? 'Could not add to wishlist'),
      },
    );
  }

  function addText(): void {
    const text = textInput.trim();
    if (text.length === 0) return;
    setTextInput('');
    void dispatch(
      {
        type: 'wishlist-add',
        payload: { characterId, entry: { id: newUuidV7(), kind: 'text', text } },
      },
      {
        onSuccess: () => toast.success('Wish added'),
        onRejection: (_c, m) => toast.error(m ?? 'Could not add wish'),
      },
    );
  }

  function remove(entryId: string): void {
    void dispatch(
      { type: 'wishlist-remove', payload: { characterId, entryId } },
      { onRejection: (_c, m) => toast.error(m ?? 'Could not remove') },
    );
  }

  const wishlist = view?.wishlist ?? [];
  const catalog = view?.catalog ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Wishlist</DialogTitle>
          <DialogDescription>
            Items {view?.name ?? 'this character'} is hoping for. Your DM sees this as a hint when
            handing out loot.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {wishlist.length === 0 ? (
            <p className="text-sm text-muted-foreground">No items wishlisted yet.</p>
          ) : (
            <ul className="space-y-2" aria-label="Wishlist items">
              {wishlist.map((entry) => {
                const { name, rarityPill } = labelFor(entry);
                return (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-2 px-3 py-2"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {rarityPill !== null ? (
                        <span
                          className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] ${rarityPill}`}
                        >
                          &nbsp;
                        </span>
                      ) : null}
                      <span className="truncate text-sm">{name}</span>
                    </span>
                    {canEdit ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
                        aria-label={`Remove ${name}`}
                        disabled={!canDispatch}
                        onClick={() => remove(entry.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          {canEdit ? (
            <div className="space-y-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                disabled={!canDispatch}
                onClick={() => setPickerOpen(true)}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add item
              </Button>
              <div className="flex gap-2">
                <Input
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder="…or wish for anything"
                  aria-label="Free-text wish"
                  maxLength={200}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addText();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canDispatch || textInput.trim().length === 0}
                  onClick={addText}
                >
                  Add
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        {pickerOpen ? (
          <ItemPicker catalog={catalog} onCancel={() => setPickerOpen(false)} onPick={addCatalog} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
