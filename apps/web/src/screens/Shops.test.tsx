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
    useStore
      .getState()
      .dispatch({ type: 'create-shop', payload: { newShopId: shopId, name: 'Cauldron' } });
    if (opts.isOpen) {
      useStore.getState().dispatch({ type: 'set-shop-open', payload: { shopId, isOpen: true } });
    }
    if (opts.withStock === true) {
      useStore.getState().dispatch({
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
    useStore.getState().dispatch({
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
});
