import { type ReactElement, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';

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
import { useCurrentPartyId } from '@/lib/useCurrentPartyId';
import { newUuidV7 } from '@app/shared';

/**
 * R6.2 — Shops list screen (`/party/:partyId/shops`). DM-only route
 * (guarded by `DmOnlyRoute` in the router table).
 *
 * Header + "New shop" button. Table lists every shop in the party with
 * open/closed indicator, item count, and click-through to the detail
 * route. New-shop dispatches `create-shop` with a client-minted
 * `newShopId` per RH1.2.
 *
 * Non-DM players never reach this route (route guard redirects); they
 * navigate to individual open shops via a party-visible directory
 * shipped in R6.3+ (for now, discoverable by URL).
 */
export function ShopsList(): ReactElement {
  const navigate = useNavigate();
  const partyId = useCurrentPartyId();
  const shops = useStore(useShallow((s) => s.appState?.shops ?? []));
  const dispatch = useStore((s) => s.dispatch);
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);

  function onCreate(): void {
    if (newName.trim().length === 0) {
      setSubmitError('Name is required');
      return;
    }
    try {
      setSubmitError(null);
      const newShopId = newUuidV7();
      dispatch({
        type: 'create-shop',
        payload: { newShopId, name: newName.trim() },
      });
      toast.success('Shop created');
      setCreatingOpen(false);
      setNewName('');
      void navigate(`/party/${partyId}/shops/${newShopId}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Shops</h1>
          <p className="text-sm text-muted-foreground">
            Manage per-party shops. Only DMs see this list; players see individual open shops by
            their share link.
          </p>
        </div>
        <Button type="button" onClick={() => setCreatingOpen(true)}>
          New shop
        </Button>
      </header>

      {shops.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No shops yet. Click <span className="font-semibold">New shop</span> to create one.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Modifier</th>
                <th className="px-3 py-2 text-right font-medium">Sell rate</th>
                <th className="px-3 py-2 text-right font-medium">Stock</th>
              </tr>
            </thead>
            <tbody>
              {shops.map((shop) => (
                <tr
                  key={shop.id}
                  className="cursor-pointer border-t border-border hover:bg-muted/20"
                  onClick={() => {
                    void navigate(`/party/${partyId}/shops/${shop.id}`);
                  }}
                >
                  <td className="px-3 py-2 font-medium">{shop.name}</td>
                  <td className="px-3 py-2">
                    <span
                      className={
                        'inline-flex items-center rounded-full px-2 py-0.5 text-xs ' +
                        (shop.isOpen
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          : 'bg-muted text-muted-foreground')
                      }
                    >
                      {shop.isOpen ? 'Open' : 'Closed'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {String(shop.priceModifier)}×
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {String(shop.sellToMerchantRate)}×
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{shop.stock.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={creatingOpen}
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
            <DialogTitle>New shop</DialogTitle>
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
