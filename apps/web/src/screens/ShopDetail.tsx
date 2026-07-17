import { type ReactElement, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Coins,
  Minus,
  Plus,
  Settings2,
  ShoppingCart,
  Store,
  Tag,
  Trash2,
  TrendingUp,
  X,
} from 'lucide-react';

import { pricing, currency } from '@app/rules';
import { newUuidV7 } from '@app/shared';
import type { ItemDefinition, ItemInstance, Shop, ShopStockEntry } from '@app/shared';

import { Button } from '@/components/ui/button';
import { DesktopOnlyNotice } from '@/components/nav/DesktopOnlyNotice';
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
import { useDispatch, type DispatchFn } from '@/lib/useDispatch';
import { useCanDispatch } from '@/lib/useCanDispatch';
import { useCurrentPartyId } from '@/lib/useCurrentPartyId';
import { isCurrentUserDmOrSolo } from '@/lib/currentUserRole';
import { rarityPillClass, rarityLabel } from '@/lib/rarity';

/**
 * R6.2 / R9.7 — Shop Detail (`/party/:partyId/shops/:shopId`).
 *
 * Two role-branched surfaces (ports of `design-lab/src/shops/{ShopStorefront,
 * ShopManage}.tsx`, verified against `drawings/shop-{player,dm}.png`):
 *   - **DM / solo → `ShopManage`**: settings panel (open toggle + editable
 *     price modifier + sell rate), an editable stock table with the
 *     ItemPicker **rail** for add-stock, and a delete-shop danger zone.
 *   - **Player → `ShopStorefront`**: a gradient banner + a browsable stock
 *     card grid (per-card qty stepper + Buy), and a Sell-items modal.
 *
 * Non-DM players reach a shop only when `shop.isOpen === true` (route guard
 * redirects otherwise); Buy/Sell target their own Inventory.
 *
 * Pricing displayed via `pricing.buyPrice + pricing.formatPrice` — the same
 * code path the reducer uses at dispatch time.
 */

interface ShopView {
  shop: Shop;
  catalog: ReadonlyArray<ItemDefinition>;
  items: ReadonlyArray<ItemInstance>;
  partyModifier: number;
  baseCurrency: 'cp' | 'sp' | 'ep' | 'gp' | 'pp';
  myInventoryStashId: string | null;
}

export function ShopDetail(): ReactElement {
  const partyId = useCurrentPartyId();
  const dispatch = useDispatch();
  const { shopId } = useParams<{ shopId: string }>();
  const isDmOrSolo = useStore(useShallow((s) => isCurrentUserDmOrSolo(s.appState)));
  // R9.7 — DM/solo can flip between the Manage surface and the player
  // Storefront (so a solo user can also buy/sell). Players never see the
  // toggle; they always get the Storefront.
  const [dmMode, setDmMode] = useState<'manage' | 'storefront'>('manage');

  const view = useStore(
    useShallow((s): ShopView | null => {
      if (s.appState === null) return null;
      const shop = s.appState.shops.find((sh) => sh.id === shopId);
      if (shop === undefined) return null;
      const myUserId = s.appState.user.id;
      const myCharacter = s.appState.characters.find((c) => c.ownerUserId === myUserId);
      return {
        shop,
        catalog: s.appState.catalog,
        items: s.appState.items,
        partyModifier: s.appState.party.priceModifier,
        baseCurrency: s.appState.party.baseCurrency,
        myInventoryStashId: myCharacter?.inventoryStashId ?? null,
      };
    }),
  );

  if (view === null) {
    return <Navigate to={`/party/${partyId}/shops`} replace />;
  }
  // Route-guard: non-DM viewer of a closed shop → redirect.
  if (!view.shop.isOpen && !isDmOrSolo) {
    return <Navigate to={`/party/${partyId}/hub`} replace />;
  }

  if (!isDmOrSolo) {
    return <ShopStorefront view={view} partyId={partyId} dispatch={dispatch} />;
  }

  // DM / solo: a Manage ⇄ Storefront segmented toggle above the chosen surface.
  return (
    <div>
      <div className="mx-auto flex max-w-5xl justify-end px-4 pt-6">
        <div
          role="group"
          aria-label="Shop view"
          className="inline-flex h-8 overflow-hidden rounded-md border border-border"
        >
          {(['manage', 'storefront'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={dmMode === m}
              onClick={() => setDmMode(m)}
              className={
                'px-3 text-xs font-medium capitalize transition ' +
                (dmMode === m
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-surface-2')
              }
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      {dmMode === 'manage' ? (
        <DesktopOnlyNotice>
          <ShopManage view={view} partyId={partyId} dispatch={dispatch} />
        </DesktopOnlyNotice>
      ) : (
        <ShopStorefront view={view} partyId={null} dispatch={dispatch} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared pricing helpers                                             */
/* ------------------------------------------------------------------ */

/** Effective per-unit buy price (cp) for a stock entry. `priceOverride`
 * short-circuits the seed-price math; a no-cost def with no override → null. */
function stockUnitCp(view: ShopView, entry: ShopStockEntry): number | null {
  if (entry.priceOverride !== undefined) return entry.priceOverride;
  const def = view.catalog.find((d) => d.id === entry.itemDefinitionId);
  if (def === undefined || def.cost === undefined) return null;
  const baseCp = currency.toCopper({ [def.cost.currency]: def.cost.amount });
  return pricing.buyPrice(baseCp, def.source, {
    partyModifier: view.partyModifier,
    shopModifier: view.shop.priceModifier,
  });
}

/** Default per-unit buy price (cp) for a picked def (no stock entry, so no
 * override short-circuit). Null when the def has no `cost` (DMG magic). BUG-013. */
function defDefaultCp(view: ShopView, def: ItemDefinition | null): number | null {
  if (def === null || def.cost === undefined) return null;
  const baseCp = currency.toCopper({ [def.cost.currency]: def.cost.amount });
  return pricing.buyPrice(baseCp, def.source, {
    partyModifier: view.partyModifier,
    shopModifier: view.shop.priceModifier,
  });
}

function defNameOf(view: ShopView, id: string): string {
  return view.catalog.find((d) => d.id === id)?.name ?? id.slice(0, 12);
}

/** Per-unit merchant payout (cp) for selling `it` to this shop. Null when
 * the def has no `cost` (DMG magic) — mirrors `sellable`'s cost filter and
 * the `sale` reducer's payout math via `pricing.sellPrice`. */
function sellUnitCp(view: ShopView, it: ItemInstance): number | null {
  const def = view.catalog.find((d) => d.id === it.definitionId);
  if (def === undefined || def.cost === undefined) return null;
  const baseCp = currency.toCopper({ [def.cost.currency]: def.cost.amount });
  return pricing.sellPrice(
    baseCp,
    def.source,
    { partyModifier: view.partyModifier, shopModifier: view.shop.priceModifier },
    view.shop.sellToMerchantRate,
  );
}

function defRarityOf(view: ShopView, id: string): ItemDefinition['rarity'] {
  return view.catalog.find((d) => d.id === id)?.rarity;
}

/* ------------------------------------------------------------------ */
/* Storefront (player)                                                */
/* ------------------------------------------------------------------ */

function ShopStorefront({
  view,
  partyId,
  dispatch,
}: {
  view: ShopView;
  partyId: string | null;
  dispatch: DispatchFn;
}): ReactElement {
  const navigate = useNavigate();
  const { shop, baseCurrency, myInventoryStashId } = view;
  const [sellOpen, setSellOpen] = useState(false);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {partyId !== null ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            void navigate(`/party/${partyId}/shops`);
          }}
          className="-ml-2 mb-4 h-8 gap-1.5 px-2 text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Shops
        </Button>
      ) : null}

      {/* Storefront banner */}
      <div className="mb-6 overflow-hidden rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-surface shadow-e2">
        <div className="flex flex-wrap items-center justify-between gap-4 p-6">
          <div className="flex items-center gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-full bg-primary/15 text-primary">
              <Store className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display text-2xl font-bold tracking-tight">{shop.name}</h1>
                <OpenBadge isOpen={shop.isOpen} />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium">
              <TrendingUp className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              Buy ×{shop.priceModifier}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium">
              <Coins className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              Sells at {Math.round(shop.sellToMerchantRate * 100)}%
            </span>
            <Button type="button" size="sm" onClick={() => setSellOpen(true)}>
              <Tag className="h-3.5 w-3.5" aria-hidden="true" />
              Sell items
            </Button>
          </div>
        </div>
      </div>

      {/* Stock grid */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          On the shelves
        </h2>
        <span className="text-xs text-muted-foreground">
          {shop.stock.length} {shop.stock.length === 1 ? 'item' : 'items'}
        </span>
      </div>
      {shop.stock.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface-2/40 p-10 text-center text-sm text-muted-foreground">
          The shelves are empty right now.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {shop.stock.map((entry) => (
            <StockCard
              key={entry.id}
              view={view}
              entry={entry}
              dispatch={dispatch}
              canBuy={myInventoryStashId !== null}
              baseCurrency={baseCurrency}
            />
          ))}
        </div>
      )}

      {sellOpen ? (
        <SellModal view={view} dispatch={dispatch} onClose={() => setSellOpen(false)} />
      ) : null}
    </div>
  );
}

function StockCard({
  view,
  entry,
  dispatch,
  canBuy,
  baseCurrency,
}: {
  view: ShopView;
  entry: ShopStockEntry;
  dispatch: DispatchFn;
  canBuy: boolean;
  baseCurrency: ShopView['baseCurrency'];
}): ReactElement {
  const [qty, setQty] = useState(1);
  const name = defNameOf(view, entry.itemDefinitionId);
  const rarity = defRarityOf(view, entry.itemDefinitionId);
  const priceCp = stockUnitCp(view, entry);
  const unlimited = entry.quantity === -1;
  const max = unlimited ? Infinity : entry.quantity;
  const inStock = unlimited || entry.quantity >= 1;
  const canDispatch = useCanDispatch();
  const buyable = canBuy && priceCp !== null && inStock && canDispatch;

  function onBuy(): void {
    if (view.myInventoryStashId === null) {
      toast.error('No inventory to buy into');
      return;
    }
    const n = qty;
    void dispatch(
      {
        type: 'purchase',
        payload: {
          shopId: view.shop.id,
          stockEntryId: entry.id,
          targetStashId: view.myInventoryStashId,
          quantity: n,
          newItemInstanceId: newUuidV7(),
        },
      },
      {
        onSuccess: () => {
          toast.success(`Bought ${n}`);
          setQty(1);
        },
      },
    );
  }

  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface p-4 shadow-e1 transition hover:border-primary/40 hover:shadow-e2">
      <div className="min-w-0">
        <div className="font-medium">{name}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {rarity != null && rarity !== 'common' ? (
            <span
              className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${rarityPillClass(rarity)}`}
              aria-label={`Rarity: ${rarityLabel(rarity)}`}
            >
              {rarityLabel(rarity)}
            </span>
          ) : null}
          <span className="text-[11px] text-muted-foreground">
            {unlimited ? 'unlimited' : `${entry.quantity} in stock`}
          </span>
        </div>
      </div>

      <div className="mt-3 flex items-end justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Price</div>
          <div className="font-display text-lg font-bold tabular-nums">
            {priceCp !== null ? pricing.formatPrice(priceCp, baseCurrency) : '—'}
          </div>
        </div>
        <div className="inline-flex items-center overflow-hidden rounded-md border border-border">
          <button
            type="button"
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            disabled={qty <= 1}
            aria-label="Decrease quantity"
            className="grid h-8 w-8 place-items-center text-muted-foreground transition hover:bg-surface-2 disabled:opacity-40"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="w-8 text-center text-sm font-medium tabular-nums">{qty}</span>
          <button
            type="button"
            onClick={() => setQty((q) => Math.min(max, q + 1))}
            disabled={qty >= max}
            aria-label="Increase quantity"
            className="grid h-8 w-8 place-items-center text-muted-foreground transition hover:bg-surface-2 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <Button
        type="button"
        className="mt-3 gap-2"
        disabled={!buyable}
        onClick={onBuy}
        aria-label={`Buy ${name}`}
        title={priceCp === null ? 'No price set for this item' : undefined}
      >
        <ShoppingCart className="h-3.5 w-3.5" aria-hidden="true" />
        Buy {qty}
      </Button>
    </div>
  );
}

function OpenBadge({ isOpen }: { isOpen: boolean }): ReactElement {
  return (
    <span
      className={
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ' +
        (isOpen
          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : 'bg-surface-2 text-muted-foreground')
      }
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${isOpen ? 'bg-emerald-500' : 'bg-muted-foreground'}`}
      />
      {isOpen ? 'Open' : 'Closed'}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Sell modal (player)                                                */
/* ------------------------------------------------------------------ */

function SellModal({
  view,
  dispatch,
  onClose,
}: {
  view: ShopView;
  dispatch: DispatchFn;
  onClose: () => void;
}): ReactElement {
  const [query, setQuery] = useState('');
  const [qtyById, setQtyById] = useState<Record<string, number>>({});
  const canDispatch = useCanDispatch();

  // Items in the current user's Inventory that have a catalog cost — `sale`
  // throws on a missing cost, so filter them out here.
  const sellable = useMemo(() => {
    const inv = view.myInventoryStashId;
    if (inv === null) return [];
    return view.items.filter((it) => {
      if (it.ownerId !== inv) return false;
      const def = view.catalog.find((d) => d.id === it.definitionId);
      return def?.cost !== undefined;
    });
  }, [view]);

  const q = query.trim().toLowerCase();
  const matches =
    q === ''
      ? sellable
      : sellable.filter((it) => defNameOf(view, it.definitionId).toLowerCase().includes(q));

  const qtyOf = (id: string): number => qtyById[id] ?? 1;
  const setQty = (id: string, n: number): void => setQtyById((m) => ({ ...m, [id]: n }));

  function onSell(it: ItemInstance): void {
    const n = qtyOf(it.id);
    void dispatch(
      {
        type: 'sale',
        payload: {
          shopId: view.shop.id,
          itemInstanceId: it.id,
          quantity: n,
          newStockEntryId: newUuidV7(),
        },
      },
      {
        onSuccess: () => {
          toast.success(`Sold ${n}`);
          setQty(it.id, 1);
        },
      },
    );
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-start justify-center bg-black/40 px-4 py-16">
      <div className="flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-e3 sm:min-w-[28rem]">
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-semibold">Sell to {view.shop.name}</h2>
            <p className="text-xs text-muted-foreground">
              Merchant pays {Math.round(view.shop.sellToMerchantRate * 100)}% of value.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-surface-2"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-border px-5 py-3">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter your inventory…"
            aria-label="Filter your inventory"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {matches.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              {sellable.length === 0
                ? 'No inventory items available to sell.'
                : `Nothing matches “${query}”.`}
            </p>
          ) : (
            <div className="divide-y divide-border">
              {matches.map((it) => {
                const qty = qtyOf(it.id);
                const unitCp = sellUnitCp(view, it);
                const totalCp = unitCp === null ? null : unitCp * qty;
                return (
                  <div key={it.id} className="flex items-center gap-3 px-5 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{defNameOf(view, it.definitionId)}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {it.quantity} owned
                        {totalCp !== null ? (
                          <>
                            {' · '}
                            <span className="text-primary">
                              +{pricing.formatPrice(totalCp, view.baseCurrency)}
                            </span>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div className="inline-flex items-center overflow-hidden rounded-md border border-border">
                      <button
                        type="button"
                        onClick={() => setQty(it.id, Math.max(1, qty - 1))}
                        disabled={qty <= 1}
                        aria-label="Decrease quantity"
                        className="grid h-7 w-7 place-items-center text-muted-foreground transition hover:bg-surface-2 disabled:opacity-40"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="w-7 text-center text-sm tabular-nums">{qty}</span>
                      <button
                        type="button"
                        onClick={() => setQty(it.id, Math.min(it.quantity, qty + 1))}
                        disabled={qty >= it.quantity}
                        aria-label="Increase quantity"
                        className="grid h-7 w-7 place-items-center text-muted-foreground transition hover:bg-surface-2 disabled:opacity-40"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onSell(it)}
                      disabled={!canDispatch}
                      aria-label={`Sell ${defNameOf(view, it.definitionId)}`}
                    >
                      <Tag className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                      Sell {qty}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* DM manage                                                          */
/* ------------------------------------------------------------------ */

function ShopManage({
  view,
  partyId,
  dispatch,
}: {
  view: ShopView;
  partyId: string;
  dispatch: DispatchFn;
}): ReactElement {
  const navigate = useNavigate();
  const { shop, baseCurrency } = view;

  const canDispatch = useCanDispatch();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickedDef, setPickedDef] = useState<ItemDefinition | null>(null);
  const [addStockQty, setAddStockQty] = useState('1');
  const [addStockOverride, setAddStockOverride] = useState('');
  // Local editable copies of the scalar settings — committed on blur via
  // `edit-shop` (only when the value actually changes).
  const [modifierInput, setModifierInput] = useState(String(shop.priceModifier));
  const [sellRateInput, setSellRateInput] = useState(String(shop.sellToMerchantRate));

  function toggleOpen(): void {
    void dispatch(
      { type: 'set-shop-open', payload: { shopId: shop.id, isOpen: !shop.isOpen } },
      { onSuccess: () => toast.success(shop.isOpen ? 'Shop closed' : 'Shop opened') },
    );
  }

  function commitScalar(patch: { priceModifier?: number; sellToMerchantRate?: number }): void {
    void dispatch(
      { type: 'edit-shop', payload: { shopId: shop.id, patch } },
      { onSuccess: () => toast.success('Shop updated') },
    );
  }

  function onModifierBlur(): void {
    const n = Number(modifierInput);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error('Price modifier must be a positive number');
      setModifierInput(String(shop.priceModifier));
      return;
    }
    if (n === shop.priceModifier) return;
    commitScalar({ priceModifier: n });
  }

  function onSellRateBlur(): void {
    const n = Number(sellRateInput);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error('Sell rate must be a positive number');
      setSellRateInput(String(shop.sellToMerchantRate));
      return;
    }
    if (n === shop.sellToMerchantRate) return;
    commitScalar({ sellToMerchantRate: n });
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
    // explicit override. Short-circuit here for a friendly pre-flight message.
    if (override === undefined && defDefaultCp(view, pickedDef) === null) {
      toast.error('This item has no catalog price — set a price override');
      return;
    }
    void dispatch(
      {
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
      },
      {
        onSuccess: () => {
          toast.success('Stock added');
          setPickedDef(null);
          setAddStockQty('1');
          setAddStockOverride('');
        },
      },
    );
  }

  function onRemoveStock(stockEntryId: string): void {
    void dispatch(
      {
        type: 'edit-shop-stock',
        payload: { shopId: shop.id, operation: { kind: 'remove', stockEntryId } },
      },
      { onSuccess: () => toast.success('Stock removed') },
    );
  }

  function onDelete(): void {
    void dispatch(
      { type: 'delete-shop', payload: { shopId: shop.id } },
      {
        onSuccess: () => {
          toast.success('Shop deleted');
          void navigate(`/party/${partyId}/shops`);
        },
      },
    );
  }

  const pickedDefaultCp = defDefaultCp(view, pickedDef);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => {
          void navigate(`/party/${partyId}/shops`);
        }}
        className="-ml-2 h-8 gap-1.5 px-2 text-muted-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Shops
      </Button>

      <header className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-full bg-primary/15 text-primary">
          <Store className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Manage shop</p>
          <h1 className="font-display text-2xl font-bold tracking-tight">{shop.name}</h1>
        </div>
      </header>

      {/* Settings panel */}
      <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-e1">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Settings2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide">
            Shop settings
          </h2>
        </div>
        <div className="divide-y divide-border px-4">
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium">Storefront status</div>
              <div className="text-xs text-muted-foreground">
                {shop.isOpen ? 'Players can buy and sell.' : 'Hidden from players.'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                {shop.isOpen ? 'Open' : 'Closed'}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={shop.isOpen}
                aria-label="Storefront status"
                onClick={toggleOpen}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
                  shop.isOpen ? 'bg-primary' : 'bg-surface-2 ring-1 ring-inset ring-border'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-surface shadow-e1 transition ${
                    shop.isOpen ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between py-3">
            <div>
              <Label htmlFor="shop-price-modifier" className="text-sm font-medium">
                Price modifier
              </Label>
              <div className="text-xs text-muted-foreground">Buy price = seed × modifier.</div>
            </div>
            <div className="flex items-center gap-2">
              <Input
                id="shop-price-modifier"
                type="number"
                step={0.1}
                min={0}
                value={modifierInput}
                onChange={(e) => setModifierInput(e.target.value)}
                onBlur={onModifierBlur}
                className="w-20 text-right tabular-nums"
              />
              <span className="text-xs text-muted-foreground">×</span>
            </div>
          </div>

          <div className="flex items-center justify-between py-3">
            <div>
              <Label htmlFor="shop-sell-rate" className="text-sm font-medium">
                Sell rate
              </Label>
              <div className="text-xs text-muted-foreground">
                Merchant pays this fraction of value.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Input
                id="shop-sell-rate"
                type="number"
                step={0.05}
                min={0}
                value={sellRateInput}
                onChange={(e) => setSellRateInput(e.target.value)}
                onBlur={onSellRateBlur}
                className="w-20 text-right tabular-nums"
              />
              <span className="w-8 text-xs text-muted-foreground">
                {Math.round(shop.sellToMerchantRate * 100)}%
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Stock table */}
      <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-e1">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide">Stock</h2>
          <span className="text-xs text-muted-foreground">
            {shop.stock.length} {shop.stock.length === 1 ? 'item' : 'items'}
          </span>
        </div>
        <table className="w-full text-sm" aria-label="Shop stock">
          <thead>
            <tr className="border-b border-border bg-surface-2/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 font-medium">Item</th>
              <th className="px-4 py-2 font-medium">Rarity</th>
              <th className="px-4 py-2 text-right font-medium">Qty</th>
              <th className="px-4 py-2 text-right font-medium">Buy price</th>
              <th className="px-4 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shop.stock.map((entry) => {
              const name = defNameOf(view, entry.itemDefinitionId);
              const rarity = defRarityOf(view, entry.itemDefinitionId);
              const priceCp = stockUnitCp(view, entry);
              return (
                <tr key={entry.id} className="hover:bg-surface-2/40">
                  <td className="px-4 py-2.5 font-medium">{name}</td>
                  <td className="px-4 py-2.5">
                    {rarity != null && rarity !== 'common' ? (
                      <span
                        className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${rarityPillClass(rarity)}`}
                        aria-label={`Rarity: ${rarityLabel(rarity)}`}
                      >
                        {rarityLabel(rarity)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">mundane</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {entry.quantity === -1 ? 'unlimited' : String(entry.quantity)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {priceCp !== null ? pricing.formatPrice(priceCp, baseCurrency) : '—'}
                    {entry.priceOverride !== undefined ? (
                      <span className="ml-1 text-xs text-muted-foreground">(override)</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => onRemoveStock(entry.id)}
                      aria-label={`Remove ${name}`}
                      className="rounded-md p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}

            {/* Add-stock row — item comes from the ItemPicker rail. All
             * cells are top-aligned so the optional no-price hint under the
             * item cell grows the row downward without shifting the sibling
             * controls out of alignment. */}
            <tr className="bg-surface-2/30 align-top">
              <td className="px-4 py-2">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {pickedDef !== null ? (
                      pickedDef.name
                    ) : (
                      <span className="text-muted-foreground">No item selected</span>
                    )}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setPickerOpen(true)}
                  >
                    Pick item
                  </Button>
                </div>
                {pickedDef !== null &&
                pickedDefaultCp === null &&
                addStockOverride.trim() === '' ? (
                  <p className="mt-1 text-xs text-destructive">
                    No catalog price — set an override.
                  </p>
                ) : null}
              </td>
              <td className="px-4 py-2 text-xs text-muted-foreground">
                {pickedDef?.rarity != null ? rarityLabel(pickedDef.rarity) : 'mundane'}
              </td>
              <td className="px-4 py-2 text-right">
                <Input
                  aria-label="Quantity"
                  type="number"
                  value={addStockQty}
                  onChange={(e) => setAddStockQty(e.target.value)}
                  className="w-16 text-right tabular-nums"
                />
              </td>
              <td className="px-4 py-2 text-right">
                <Input
                  aria-label="Price override (cp)"
                  type="number"
                  min={0}
                  value={addStockOverride}
                  onChange={(e) => setAddStockOverride(e.target.value)}
                  placeholder={
                    pickedDefaultCp !== null
                      ? pricing.formatPrice(pickedDefaultCp, baseCurrency)
                      : 'e.g. 15'
                  }
                  className="w-24 text-right tabular-nums"
                />
              </td>
              <td className="px-4 py-2 text-right">
                <Button type="button" size="sm" onClick={onAddStock} disabled={!canDispatch}>
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Add
                </Button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Danger zone */}
      <section className="rounded-lg border border-destructive/40 bg-surface shadow-e1">
        <div className="border-b border-border px-4 py-3">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-destructive">
            Danger zone
          </h2>
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <div className="text-sm font-medium">Delete this shop</div>
            <div className="text-xs text-muted-foreground">
              Removes the storefront and its stock. This cannot be undone.
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            className="shrink-0 gap-2 border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
            aria-label="Delete shop"
            onClick={() => setDeleteConfirmOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
            Delete shop
          </Button>
        </div>
      </section>

      {pickerOpen ? (
        <ItemPicker
          catalog={view.catalog}
          layout="rail"
          onCancel={() => setPickerOpen(false)}
          onPick={(def) => {
            setPickedDef(def);
            setPickerOpen(false);
          }}
        />
      ) : null}

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &quot;{shop.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the shop and all its stock rows. Cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} disabled={!canDispatch}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
