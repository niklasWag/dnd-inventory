import { type ReactElement, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import { Trash2, ArrowLeft } from 'lucide-react';

import { pricing, currency } from '@app/rules';
import { newUuidV7 } from '@app/shared';
import type { ItemDefinition } from '@app/shared';

import { Button } from '@/components/ui/button';
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
import { ItemPicker } from '@/components/catalog/ItemPicker';
import { useStore } from '@/store';
import { useCurrentPartyId } from '@/lib/useCurrentPartyId';
import { isCurrentUserDmOrSolo } from '@/lib/currentUserRole';

/**
 * R6.2 — Shop Detail screen (`/party/:partyId/shops/:shopId`).
 *
 * DM sees the full surface: Open/Close toggle, Delete, Add-stock form,
 * Buy button (transacts on behalf of any character), Sell panel. Non-DM
 * players are allowed here only when `shop.isOpen === true` (route
 * guard redirects otherwise); they see Buy/Sell buttons that target
 * their own Inventory.
 *
 * Pricing displayed via `pricing.buyPrice + pricing.formatPrice` — the
 * same code path the reducer uses at dispatch time.
 */
export function ShopDetail(): ReactElement {
  const partyId = useCurrentPartyId();
  const navigate = useNavigate();
  const { shopId } = useParams<{ shopId: string }>();
  const dispatch = useStore((s) => s.dispatch);
  const isDmOrSolo = useStore(useShallow((s) => isCurrentUserDmOrSolo(s.appState)));

  const view = useStore(
    useShallow((s) => {
      if (s.appState === null) return null;
      const shop = s.appState.shops.find((sh) => sh.id === shopId);
      if (shop === undefined) return null;
      const myUserId = s.appState.user.id;
      const myCharacter = s.appState.characters.find((c) => c.ownerUserId === myUserId);
      const myInventoryStashId = myCharacter?.inventoryStashId ?? null;
      return {
        shop,
        catalog: s.appState.catalog,
        items: s.appState.items,
        stashes: s.appState.stashes,
        characters: s.appState.characters,
        partyModifier: s.appState.party.priceModifier,
        baseCurrency: s.appState.party.baseCurrency,
        myInventoryStashId,
      };
    }),
  );

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pickedDef, setPickedDef] = useState<ItemDefinition | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [addStockQty, setAddStockQty] = useState('1');
  const [addStockOverride, setAddStockOverride] = useState('');
  const [sellItemId, setSellItemId] = useState('');
  const [sellQty, setSellQty] = useState('1');

  // Items in the current user's Inventory that have a catalog cost
  // (required for `sale` — the reducer throws on missing cost). Kept
  // above the early return so React's hook order stays stable.
  const sellableItems = useMemo(() => {
    if (view === null) return [];
    const inv = view.myInventoryStashId;
    if (inv === null) return [];
    return view.items.filter((it) => {
      if (it.ownerId !== inv) return false;
      const def = view.catalog.find((d) => d.id === it.definitionId);
      return def?.cost !== undefined;
    });
  }, [view]);

  if (view === null) {
    return <Navigate to={`/party/${partyId}/shops`} replace />;
  }
  const {
    shop,
    catalog,
    items: _items,
    stashes,
    characters,
    partyModifier,
    baseCurrency,
    myInventoryStashId,
  } = view;
  void _items;

  // Route-guard: non-DM viewer of a closed shop → redirect.
  if (!shop.isOpen && !isDmOrSolo) {
    return <Navigate to={`/party/${partyId}/hub`} replace />;
  }

  function unitCostCp(stockEntry: (typeof shop.stock)[number]): number | null {
    if (stockEntry.priceOverride !== undefined) return stockEntry.priceOverride;
    const def = catalog.find((d) => d.id === stockEntry.itemDefinitionId);
    if (def === undefined || def.cost === undefined) return null;
    const baseCp = currency.toCopper({ [def.cost.currency]: def.cost.amount });
    return pricing.buyPrice(baseCp, def.source, {
      partyModifier,
      shopModifier: shop.priceModifier,
    });
  }

  /**
   * Compute the effective default buy price for a picked `ItemDefinition`
   * — same math as `unitCostCp` but without a stock entry (so no
   * `priceOverride` short-circuit). Returns null when the def has no
   * `cost` (canonical for DMG magic rows). BUG-013.
   */
  function defaultCostCp(def: ItemDefinition | null): number | null {
    if (def === null || def.cost === undefined) return null;
    const baseCp = currency.toCopper({ [def.cost.currency]: def.cost.amount });
    return pricing.buyPrice(baseCp, def.source, {
      partyModifier,
      shopModifier: shop.priceModifier,
    });
  }

  function defNameOf(id: string): string {
    return catalog.find((d) => d.id === id)?.name ?? id.slice(0, 12);
  }

  function toggleOpen(): void {
    try {
      dispatch({
        type: 'set-shop-open',
        payload: { shopId: shop.id, isOpen: !shop.isOpen },
      });
      toast.success(shop.isOpen ? 'Shop closed' : 'Shop opened');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  function onDelete(): void {
    try {
      dispatch({ type: 'delete-shop', payload: { shopId: shop.id } });
      toast.success('Shop deleted');
      void navigate(`/party/${partyId}/shops`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  function onAddStock(): void {
    if (pickedDef === null) {
      toast.error('Pick an item first');
      return;
    }
    const qty = Number.parseInt(addStockQty, 10);
    if (!Number.isFinite(qty) || (qty !== -1 && qty < 0)) {
      toast.error('Quantity must be -1 (unlimited) or non-negative');
      return;
    }
    const override =
      addStockOverride.trim() === '' ? undefined : Number.parseInt(addStockOverride, 10);
    if (override !== undefined && (!Number.isFinite(override) || override < 0)) {
      toast.error('Price override must be non-negative integer CP');
      return;
    }
    // BUG-013 — mirror the reducer guard: no-cost catalog rows need an
    // explicit override. Short-circuit here so the DM sees a friendly
    // message before the round-trip.
    if (override === undefined && defaultCostCp(pickedDef) === null) {
      toast.error('This item has no catalog price — set a price override');
      return;
    }
    try {
      dispatch({
        type: 'edit-shop-stock',
        payload: {
          shopId: shop.id,
          operation: {
            kind: 'add',
            newStockEntryId: newUuidV7(),
            itemDefinitionId: pickedDef.id,
            quantity: qty,
            ...(override !== undefined ? { priceOverride: override } : {}),
          },
        },
      });
      toast.success('Stock added');
      setPickedDef(null);
      setAddStockQty('1');
      setAddStockOverride('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  function onRemoveStock(stockEntryId: string): void {
    try {
      dispatch({
        type: 'edit-shop-stock',
        payload: {
          shopId: shop.id,
          operation: { kind: 'remove', stockEntryId },
        },
      });
      toast.success('Stock removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  function onBuy(stockEntryId: string): void {
    if (myInventoryStashId === null) {
      toast.error('No inventory to buy into');
      return;
    }
    try {
      dispatch({
        type: 'purchase',
        payload: {
          shopId: shop.id,
          stockEntryId,
          targetStashId: myInventoryStashId,
          quantity: 1,
          newItemInstanceId: newUuidV7(),
        },
      });
      toast.success('Bought 1');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  // Items in the current user's Inventory that have a catalog cost
  // (required for `sale` — the reducer throws on missing cost).
  // `sellableItems` is derived above the early return so React's hook
  // order stays stable across renders where `view === null`.

  function onSell(): void {
    const qty = Number.parseInt(sellQty, 10);
    if (!Number.isFinite(qty) || qty < 1) {
      toast.error('Quantity must be a positive integer');
      return;
    }
    if (sellItemId.trim().length === 0) {
      toast.error('Item is required');
      return;
    }
    try {
      dispatch({
        type: 'sale',
        payload: {
          shopId: shop.id,
          itemInstanceId: sellItemId,
          quantity: qty,
          newStockEntryId: newUuidV7(),
        },
      });
      toast.success(`Sold ${String(qty)}`);
      setSellItemId('');
      setSellQty('1');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unknown error');
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {isDmOrSolo ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  void navigate(`/party/${partyId}/shops`);
                }}
              >
                <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
                Shops
              </Button>
            ) : null}
            <h1 className="text-3xl font-bold tracking-tight">{shop.name}</h1>
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
          </div>
          <p className="text-sm text-muted-foreground">
            Modifier {String(shop.priceModifier)}× · Sell rate {String(shop.sellToMerchantRate)}× ·{' '}
            {shop.stock.length} stock rows
          </p>
        </div>
        {isDmOrSolo ? (
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" onClick={toggleOpen}>
              {shop.isOpen ? 'Close shop' : 'Open shop'}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="icon"
              aria-label="Delete shop"
              onClick={() => setDeleteConfirmOpen(true)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
      </header>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Stock</h2>
        {shop.stock.length === 0 ? (
          <p className="text-sm text-muted-foreground">Empty stock.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Item</th>
                  <th className="px-3 py-2 text-right font-medium">Price</th>
                  <th className="px-3 py-2 text-right font-medium">Quantity</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shop.stock.map((entry) => {
                  const priceCp = unitCostCp(entry);
                  const canBuyForSelf =
                    myInventoryStashId !== null &&
                    priceCp !== null &&
                    (entry.quantity === -1 || entry.quantity >= 1);
                  return (
                    <tr key={entry.id} className="border-t border-border">
                      <td className="px-3 py-2">{defNameOf(entry.itemDefinitionId)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {priceCp !== null ? pricing.formatPrice(priceCp, baseCurrency) : '—'}
                        {entry.priceOverride !== undefined ? (
                          <span className="ml-1 text-xs text-muted-foreground">(override)</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {entry.quantity === -1 ? 'unlimited' : String(entry.quantity)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={!canBuyForSelf}
                            onClick={() => onBuy(entry.id)}
                            aria-label={`Buy ${defNameOf(entry.itemDefinitionId)}`}
                            title={priceCp === null ? 'No price set for this item' : undefined}
                          >
                            Buy 1
                          </Button>
                          {isDmOrSolo ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => onRemoveStock(entry.id)}
                              aria-label={`Remove ${defNameOf(entry.itemDefinitionId)}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isDmOrSolo ? (
        <section className="space-y-2 rounded-lg border border-border p-4">
          <h2 className="text-lg font-semibold">Add stock (DM)</h2>
          <p className="text-sm text-muted-foreground">
            Pick an item from the catalog. Quantity <code>-1</code> = unlimited. Price override is
            optional (integer CP; bypasses modifiers).
          </p>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5 sm:col-span-2">
              <span className="text-sm font-medium leading-none">Item</span>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 truncate rounded-md border border-input bg-background px-3 py-2 text-sm">
                  {pickedDef !== null ? (
                    pickedDef.name
                  ) : (
                    <span className="text-muted-foreground">No item selected</span>
                  )}
                </div>
                <Button type="button" variant="outline" onClick={() => setPickerOpen(true)}>
                  Pick item
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-stock-qty">Quantity</Label>
              <Input
                id="add-stock-qty"
                type="number"
                value={addStockQty}
                onChange={(e) => setAddStockQty(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-stock-override">Price override (cp)</Label>
              <Input
                id="add-stock-override"
                type="number"
                min={0}
                value={addStockOverride}
                onChange={(e) => setAddStockOverride(e.target.value)}
                placeholder="leave blank"
              />
              {pickedDef !== null ? (
                defaultCostCp(pickedDef) !== null ? (
                  <p className="text-xs text-muted-foreground">
                    Default: {pricing.formatPrice(defaultCostCp(pickedDef)!, baseCurrency)} — leave
                    blank to use.
                  </p>
                ) : (
                  <p className="text-xs text-destructive">
                    No default price. Set an override to sell this item.
                  </p>
                )
              ) : null}
            </div>
          </div>
          <div>
            <Button type="button" onClick={onAddStock}>
              Add
            </Button>
          </div>
        </section>
      ) : null}

      {pickerOpen ? (
        <ItemPicker
          catalog={catalog}
          onCancel={() => setPickerOpen(false)}
          onPick={(def) => {
            setPickedDef(def);
            setPickerOpen(false);
          }}
        />
      ) : null}

      <section className="space-y-2 rounded-lg border border-border p-4">
        <h2 className="text-lg font-semibold">Sell to shop</h2>
        {sellableItems.length === 0 ? (
          <p className="text-sm text-muted-foreground">No inventory items available to sell.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="sell-item">Item</Label>
              <select
                id="sell-item"
                value={sellItemId}
                onChange={(e) => setSellItemId(e.target.value)}
                className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <option value="">— select —</option>
                {sellableItems.map((it) => (
                  <option key={it.id} value={it.id}>
                    {defNameOf(it.definitionId)} (qty {String(it.quantity)})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sell-qty">Quantity</Label>
              <Input
                id="sell-qty"
                type="number"
                min={1}
                value={sellQty}
                onChange={(e) => setSellQty(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button type="button" onClick={onSell} disabled={sellItemId === ''}>
                Sell
              </Button>
            </div>
          </div>
        )}
      </section>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={(next) => setDeleteConfirmOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{shop.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the shop and all its stock rows. Cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Silences unused-var lint; stashes+characters kept in the selector shape
       * for parity with other party-scoped screens even though this page
       * doesn't need per-character drill-down yet. */}
      <span className="hidden" aria-hidden="true">
        {stashes.length}
        {characters.length}
      </span>
    </div>
  );
}
