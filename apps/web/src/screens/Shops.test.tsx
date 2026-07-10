import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { ShopsList } from './ShopsList';
import { ShopDetail } from './ShopDetail';
import { Toaster } from '@/components/ui/sonner';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';
import { bootstrap } from '@/test/fixtures';
import { newUuidV7 } from '@app/shared';

/**
 * R6.2 — Shop Manager UI tests.
 *
 * Covers happy-path create-shop flow, isOpen toggle, buy from an open
 * shop, and the empty-state rendering.
 */

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

function renderAt(path: string): void {
  const partyId = useStore.getState().appState?.party.id;
  const prefixed =
    partyId !== undefined ? path.replace(/^\/party\/:partyId/, `/party/${partyId}`) : path;
  const router = createMemoryRouter(
    [
      { path: '/party/:partyId/shops', Component: ShopsList },
      { path: '/party/:partyId/shops/:shopId', Component: ShopDetail },
      { path: '*', element: null },
    ],
    { initialEntries: [prefixed] },
  );
  render(
    <>
      <RouterProvider router={router} />
      <Toaster />
    </>,
  );
}

describe('ShopsList (R6.2)', () => {
  it('shows the empty-state when no shops exist', () => {
    bootstrap();
    renderAt('/party/:partyId/shops');
    expect(screen.getByText(/no shops yet/i)).toBeInTheDocument();
  });

  it('creating a shop dispatches create-shop and adds a row', async () => {
    const user = userEvent.setup();
    bootstrap();
    renderAt('/party/:partyId/shops');

    await user.click(screen.getByRole('button', { name: /^new shop$/i }));
    const input = screen.getByLabelText(/^name$/i);
    await user.type(input, 'The Cauldron');
    // The "Create" button is inside the dialog.
    const dialogCreate = screen.getAllByRole('button', { name: /^create$/i }).at(-1)!;
    await user.click(dialogCreate);

    const shops = useStore.getState().appState!.shops;
    expect(shops).toHaveLength(1);
    expect(shops[0]!.name).toBe('The Cauldron');
  });
});

describe('ShopDetail (R6.2)', () => {
  function seedShop(opts: { isOpen: boolean; withStock?: boolean }): {
    shopId: string;
    stockEntryId: string;
  } {
    const shopId = newUuidV7();
    const stockEntryId = newUuidV7();
    void useStore
      .getState()
      .dispatch({ type: 'create-shop', payload: { newShopId: shopId, name: 'Cauldron' } });
    if (opts.isOpen) {
      void useStore
        .getState()
        .dispatch({ type: 'set-shop-open', payload: { shopId, isOpen: true } });
    }
    if (opts.withStock === true) {
      void useStore.getState().dispatch({
        type: 'edit-shop-stock',
        payload: {
          shopId,
          operation: {
            kind: 'add',
            newStockEntryId: stockEntryId,
            itemDefinitionId: 'phb-2024:rope-hempen-50ft',
            quantity: 5,
          },
        },
      });
    }
    return { shopId, stockEntryId };
  }

  it('DM sees Open/Close toggle + Add stock section on a closed shop', () => {
    bootstrap();
    const { shopId } = seedShop({ isOpen: false });
    renderAt(`/party/:partyId/shops/${shopId}`);
    expect(screen.getByRole('button', { name: /^open shop$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /add stock/i })).toBeInTheDocument();
  });

  it('DM buys 1 from a stocked shop — item lands + stock decrements', async () => {
    const user = userEvent.setup();
    const b = bootstrap();
    // Give DM some gold to spend.
    void useStore.getState().dispatch({
      type: 'currency-change',
      payload: {
        stashId: b.inventoryStashId,
        delta: { cp: 0, sp: 0, ep: 0, gp: 100, pp: 0 },
        reason: 'deposit',
      },
    });
    const { shopId, stockEntryId } = seedShop({ isOpen: true, withStock: true });
    renderAt(`/party/:partyId/shops/${shopId}`);

    await user.click(screen.getByRole('button', { name: /^buy rope, hempen/i }));

    const shop = useStore.getState().appState!.shops.find((sh) => sh.id === shopId)!;
    expect(shop.stock.find((e) => e.id === stockEntryId)!.quantity).toBe(4);
    const inv = useStore
      .getState()
      .appState!.items.filter((it) => it.ownerId === b.inventoryStashId);
    expect(inv).toHaveLength(1);
    expect(inv[0]!.quantity).toBe(1);
  });

  it('toggling open flips the status pill', async () => {
    const user = userEvent.setup();
    bootstrap();
    const { shopId } = seedShop({ isOpen: false });
    renderAt(`/party/:partyId/shops/${shopId}`);
    expect(screen.getByText(/^Closed$/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^open shop$/i }));
    expect(screen.getByText(/^Open$/)).toBeInTheDocument();
  });

  it('add-stock has no raw id input — DM picks item via the catalog picker', async () => {
    const user = userEvent.setup();
    bootstrap();
    const { shopId } = seedShop({ isOpen: false });
    renderAt(`/party/:partyId/shops/${shopId}`);

    // Old raw-id input is gone.
    expect(screen.queryByLabelText(/item definition id/i)).not.toBeInTheDocument();

    // Pick a hempen rope from the catalog picker.
    await user.click(screen.getByRole('button', { name: /^pick item$/i }));
    const search = await screen.findByLabelText(/^search$/i);
    await user.type(search, 'rope, hempen');
    const pickBtns = await screen.findAllByRole('button', { name: /^pick$/i });
    // First match wins — searchCatalog ranks name-exact highest.
    await user.click(pickBtns[0]!);

    // Confirm the selection is reflected in the read-only display.
    expect(screen.getByText(/rope, hempen/i)).toBeInTheDocument();

    // Set qty=5, submit.
    const qty = screen.getByLabelText(/^quantity$/i);
    await user.clear(qty);
    await user.type(qty, '5');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    const shop = useStore.getState().appState!.shops.find((sh) => sh.id === shopId)!;
    expect(shop.stock).toHaveLength(1);
    expect(shop.stock[0]!.itemDefinitionId).toBe('phb-2024:rope-hempen-50ft');
    expect(shop.stock[0]!.quantity).toBe(5);
    expect(shop.stock[0]!.priceOverride).toBeUndefined();
  });

  it('clicking Add with no item picked toasts an error and does not dispatch', async () => {
    const user = userEvent.setup();
    bootstrap();
    const { shopId } = seedShop({ isOpen: false });
    renderAt(`/party/:partyId/shops/${shopId}`);

    await user.click(screen.getByRole('button', { name: /^add$/i }));

    expect(await screen.findByText(/pick an item first/i)).toBeInTheDocument();
    const shop = useStore.getState().appState!.shops.find((sh) => sh.id === shopId)!;
    expect(shop.stock).toHaveLength(0);
  });

  // BUG-013 — DMG magic items (and every other DMG entry with no
  // catalog cost) can't be added to a shop without an explicit price
  // override. The reducer rejects the dispatch; the UI shows a hint
  // under the price field; the Buy button is disabled for legacy rows
  // that still lack a price.
  it('shows a "no default price" hint when picking a no-cost item', async () => {
    const user = userEvent.setup();
    bootstrap();
    const { shopId } = seedShop({ isOpen: false });
    renderAt(`/party/:partyId/shops/${shopId}`);

    await user.click(screen.getByRole('button', { name: /^pick item$/i }));
    const search = await screen.findByLabelText(/^search$/i);
    await user.type(search, 'cloak of the bat');
    const pickBtns = await screen.findAllByRole('button', { name: /^pick$/i });
    await user.click(pickBtns[0]!);

    expect(
      screen.getByText(/no default price\. set an override to sell this item/i),
    ).toBeInTheDocument();
  });

  it('shows the default price hint when picking an item with cost', async () => {
    const user = userEvent.setup();
    bootstrap();
    const { shopId } = seedShop({ isOpen: false });
    renderAt(`/party/:partyId/shops/${shopId}`);

    await user.click(screen.getByRole('button', { name: /^pick item$/i }));
    const search = await screen.findByLabelText(/^search$/i);
    await user.type(search, 'rope, hempen');
    const pickBtns = await screen.findAllByRole('button', { name: /^pick$/i });
    await user.click(pickBtns[0]!);

    expect(screen.getByText(/default: .+ — leave blank to use\./i)).toBeInTheDocument();
  });

  it('blocks Add for a no-cost item when the price override is blank', async () => {
    const user = userEvent.setup();
    bootstrap();
    const { shopId } = seedShop({ isOpen: false });
    renderAt(`/party/:partyId/shops/${shopId}`);

    await user.click(screen.getByRole('button', { name: /^pick item$/i }));
    const search = await screen.findByLabelText(/^search$/i);
    await user.type(search, 'cloak of the bat');
    const pickBtns = await screen.findAllByRole('button', { name: /^pick$/i });
    await user.click(pickBtns[0]!);

    await user.click(screen.getByRole('button', { name: /^add$/i }));

    expect(await screen.findByText(/no catalog price/i)).toBeInTheDocument();
    const shop = useStore.getState().appState!.shops.find((sh) => sh.id === shopId)!;
    expect(shop.stock).toHaveLength(0);
  });

  it('accepts Add for a no-cost item when a price override is set', async () => {
    const user = userEvent.setup();
    bootstrap();
    const { shopId } = seedShop({ isOpen: false });
    renderAt(`/party/:partyId/shops/${shopId}`);

    await user.click(screen.getByRole('button', { name: /^pick item$/i }));
    const search = await screen.findByLabelText(/^search$/i);
    await user.type(search, 'cloak of the bat');
    const pickBtns = await screen.findAllByRole('button', { name: /^pick$/i });
    await user.click(pickBtns[0]!);

    const overrideInput = screen.getByLabelText(/price override/i);
    await user.type(overrideInput, '50000');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    const shop = useStore.getState().appState!.shops.find((sh) => sh.id === shopId)!;
    expect(shop.stock).toHaveLength(1);
    expect(shop.stock[0]!.itemDefinitionId).toBe('dmg-2024:cloak-of-the-bat');
    expect(shop.stock[0]!.priceOverride).toBe(50000);
  });

  it('disables the Buy button for a stock row that has no price', () => {
    bootstrap();
    const { shopId } = seedShop({ isOpen: true });
    // Bypass the reducer guard (which we just added) to seed a pre-fix
    // broken row: no-cost def, no priceOverride. Mirrors the on-disk
    // state a user might still have from before the fix landed.
    const brokenEntryId = newUuidV7();
    useStore.setState((s) => {
      if (s.appState === null) return s;
      return {
        ...s,
        appState: {
          ...s.appState,
          shops: s.appState.shops.map((sh) =>
            sh.id === shopId
              ? {
                  ...sh,
                  stock: [
                    {
                      id: brokenEntryId,
                      itemDefinitionId: 'dmg-2024:cloak-of-the-bat',
                      quantity: 1,
                    },
                  ],
                }
              : sh,
          ),
        },
      };
    });
    renderAt(`/party/:partyId/shops/${shopId}`);

    const buyBtn = screen.getByRole('button', { name: /^buy cloak of the bat$/i });
    expect(buyBtn).toBeDisabled();
    expect(buyBtn).toHaveAttribute('title', 'No price set for this item');
  });
});

describe('ShopsList — player view (R6.2 follow-up)', () => {
  /**
   * Turn the fresh bootstrap solo party into a 2-member party where the
   * current user (`u0`) reads as a plain player, not solo-bypass DM.
   * Bootstrap seeds BOTH a `dm` and a `player` row for the creator per the
   * outline's composite-key invariant — we strip the DM row and graft a
   * second user as the DM.
   */
  function makeCurrentUserPlayer(): void {
    useStore.setState((s) => {
      if (s.appState === null) return s;
      const myId = s.appState.user.id;
      const partyId = s.appState.party.id;
      return {
        ...s,
        appState: {
          ...s.appState,
          memberships: [
            // Keep u0's player row only — drop the bootstrap DM row.
            ...s.appState.memberships.filter((m) => !(m.userId === myId && m.role === 'dm')),
            {
              userId: 'u-other-dm',
              partyId,
              role: 'dm',
              characterId: null,
              joinedAt: '2026-01-01T00:00:00.000Z',
              leftAt: null,
            },
          ],
        },
      };
    });
  }

  it('lists only open shops and hides the New shop button', () => {
    bootstrap();
    // Seed one open and one closed shop while the user is still solo-DM,
    // then flip membership so the user reads as a player.
    const openId = newUuidV7();
    const closedId = newUuidV7();
    void useStore
      .getState()
      .dispatch({ type: 'create-shop', payload: { newShopId: openId, name: 'Open Shop' } });
    void useStore
      .getState()
      .dispatch({ type: 'set-shop-open', payload: { shopId: openId, isOpen: true } });
    void useStore
      .getState()
      .dispatch({ type: 'create-shop', payload: { newShopId: closedId, name: 'Closed Shop' } });
    makeCurrentUserPlayer();

    renderAt('/party/:partyId/shops');

    expect(screen.getByText(/^Open Shop$/)).toBeInTheDocument();
    expect(screen.queryByText(/^Closed Shop$/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^new shop$/i })).not.toBeInTheDocument();
  });

  it('shows the player empty-state when no shops are open', () => {
    bootstrap();
    const closedId = newUuidV7();
    void useStore
      .getState()
      .dispatch({ type: 'create-shop', payload: { newShopId: closedId, name: 'Closed Shop' } });
    makeCurrentUserPlayer();

    renderAt('/party/:partyId/shops');

    expect(screen.getByText(/no shops are open right now/i)).toBeInTheDocument();
  });
});
