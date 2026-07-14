import { type ReactElement, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import { ChevronRight, Plus, Store } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useStore } from '@/store';
import { useDispatch } from '@/lib/useDispatch';
import { useCurrentPartyId } from '@/lib/useCurrentPartyId';
import { isCurrentUserDmOrSolo } from '@/lib/currentUserRole';
import { newUuidV7 } from '@app/shared';

/**
 * R6.2 — Shops list screen (`/party/:partyId/shops`).
 *
 * DM/solo view: full list of every shop in the party with open/closed
 * indicator, item count, and a "New shop" affordance. Click-through
 * navigates to the individual shop detail.
 *
 * Player view: read-only list of currently-open shops only. Players get
 * here from the header Shops button, which itself only appears when at
 * least one shop is open (see `Layout.tsx`). Clicking a row lands on
 * `ShopDetail`, which already handles the player-can-see-open-shops
 * rule via its own route guard.
 */
export function ShopsList(): ReactElement {
  const navigate = useNavigate();
  const partyId = useCurrentPartyId();
  const shops = useStore(useShallow((s) => s.appState?.shops ?? []));
  const isDmOrSolo = useStore(useShallow((s) => isCurrentUserDmOrSolo(s.appState)));
  const dispatch = useDispatch();
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const visibleShops = isDmOrSolo ? shops : shops.filter((sh) => sh.isOpen);

  function onCreate(): void {
    if (newName.trim().length === 0) {
      setSubmitError('Name is required');
      return;
    }
    setSubmitError(null);
    const newShopId = newUuidV7();
    void dispatch(
      {
        type: 'create-shop',
        payload: { newShopId, name: newName.trim() },
      },
      {
        onSuccess: () => {
          toast.success('Shop created');
          setCreatingOpen(false);
          setNewName('');
          void navigate(`/party/${partyId}/shops/${newShopId}`);
        },
        onRejection: (_code, message) => setSubmitError(message ?? 'Unknown error'),
      },
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-8">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Shops</h1>
          <p className="text-sm text-muted-foreground">
            {isDmOrSolo
              ? 'Manage per-party shops. Only DMs see the full list; players see open shops.'
              : 'Shops currently open in this party.'}
          </p>
        </div>
        {isDmOrSolo ? (
          <Button
            type="button"
            size="sm"
            className="shrink-0 shadow-e1"
            onClick={() => setCreatingOpen(true)}
          >
            <Plus className="h-4 w-4" />
            New shop
          </Button>
        ) : null}
      </div>

      {visibleShops.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface-2/40 p-10 text-center text-sm text-muted-foreground">
          {isDmOrSolo ? (
            <>
              No shops yet. Click <span className="font-semibold text-foreground">New shop</span> to
              stock a merchant, a black-market fence, or a wandering pedlar.
            </>
          ) : (
            'No shops are open right now.'
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-e1">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-surface-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Name</th>
                <th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 text-right font-semibold">Modifier</th>
                <th className="px-4 py-2.5 text-right font-semibold">Sell rate</th>
                <th className="px-4 py-2.5 text-right font-semibold">Stock</th>
                <th className="px-4 py-2.5 text-right font-semibold">
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleShops.map((shop) => (
                <tr
                  key={shop.id}
                  className="group cursor-pointer transition hover:bg-surface-2/60"
                  onClick={() => {
                    void navigate(`/party/${partyId}/shops/${shop.id}`);
                  }}
                >
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-2 font-medium">
                      <Store className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      {shop.name}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={
                        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ' +
                        (shop.isOpen
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : 'bg-surface-2 text-muted-foreground')
                      }
                    >
                      {shop.isOpen ? 'Open' : 'Closed'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {String(shop.priceModifier)}×
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {String(shop.sellToMerchantRate)}×
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{shop.stock.length}</td>
                  <td className="px-4 py-2.5 text-right">
                    <ChevronRight
                      className="ml-auto h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={isDmOrSolo && creatingOpen}
        onOpenChange={(next) => {
          setCreatingOpen(next);
          if (!next) {
            setNewName('');
            setSubmitError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">New shop</DialogTitle>
            <DialogDescription>
              Pick a name. You can edit modifiers, stock, and visibility on the shop's page.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="new-shop-name">Name</Label>
            <Input
              id="new-shop-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') onCreate();
              }}
            />
            {submitError !== null ? (
              <p className="text-sm text-destructive" role="alert">
                {submitError}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreatingOpen(false)}>
              Cancel
            </Button>
            <Button onClick={onCreate}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
