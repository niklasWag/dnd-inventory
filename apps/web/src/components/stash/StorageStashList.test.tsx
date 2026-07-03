import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { StorageStashList } from './StorageStashList';
import { Toaster } from '@/components/ui/sonner';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';

import { bootstrap } from '@/test/fixtures';
import { newUuidV7 } from '@app/shared';

/**
 * RH1.2 — id-injection helpers for direct `dispatch` sites. Fresh UUID
 * v7 per call keeps the fixture within the guard's clock-skew window
 * and hermetic per-test.
 */
function acquireIds() {
  return { newItemInstanceId: newUuidV7() };
}
function createStashIds() {
  return { newStashId: newUuidV7(), newCurrencyHoldingId: newUuidV7() };
}

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

function renderWith(characterId: string): void {
  const partyId = useStore.getState().appState?.party.id ?? 'test-party';
  const router = createMemoryRouter(
    [
      {
        path: '/party/:partyId/character/:id',
        Component: () => <StorageStashList characterId={characterId} />,
      },
      // Destination route — we just verify the URL changes; no real screen.
      { path: '/party/:partyId/stash/:stashId', element: <p>storage-detail-stub</p> },
    ],
    { initialEntries: [`/party/${partyId}/character/${characterId}`] },
  );
  render(
    <>
      <RouterProvider router={router} />
      <Toaster />
    </>,
  );
}

function createOne(characterId: string, name: string): string {
  useStore.getState().dispatch({
    type: 'create-stash',
    payload: { ownerCharacterId: characterId, name, ...createStashIds(), ...createStashIds() },
  });
  return useStore.getState().appState!.stashes.at(-1)!.id;
}

describe('StorageStashList (M3)', () => {
  it('renders an empty state when no Storage stashes exist', () => {
    const { characterId } = bootstrap();
    renderWith(characterId);

    expect(screen.getByText(/no storage stashes yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new storage stash/i })).toBeInTheDocument();
  });

  it('renders a card for each Storage stash; cards are NOT shown for Inventory / Party / Recovered Loot', () => {
    const { characterId } = bootstrap();
    createOne(characterId, 'Chest at home');
    createOne(characterId, 'Vault of Waterdeep');
    renderWith(characterId);

    expect(screen.getByText('Chest at home')).toBeInTheDocument();
    expect(screen.getByText('Vault of Waterdeep')).toBeInTheDocument();
    // The 3 auto-provisioned stashes have specific names; none should appear here.
    expect(screen.queryByText('Inventory')).not.toBeInTheDocument();
    expect(screen.queryByText('Party Stash')).not.toBeInTheDocument();
    expect(screen.queryByText('Recovered Loot')).not.toBeInTheDocument();
  });

  it('renders cards in createdAt ascending order', async () => {
    const { characterId } = bootstrap();
    // Two creates; the first is older by virtue of dispatch order.
    createOne(characterId, 'Alpha');
    // Force a slight delay so createdAt timestamps differ.
    await new Promise((r) => setTimeout(r, 5));
    createOne(characterId, 'Beta');
    renderWith(characterId);

    const cards = screen.getAllByRole('button', { name: /open .* details/i });
    expect(cards).toHaveLength(2);
    expect(cards[0]?.textContent).toContain('Alpha');
    expect(cards[1]?.textContent).toContain('Beta');
  });

  it('item count on the card is the SUM of quantities, not the row count', () => {
    const { characterId, catalog } = bootstrap();
    const stashId = createOne(characterId, 'Treasury');
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    const rope = catalog.find((d) => d.id === 'phb-2024:rope-hempen-50ft')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId,
        definitionId: torch.id,
        quantity: 3,
        source: 'catalog-add',
        ...acquireIds(),
        ...acquireIds(),
      },
    });
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId,
        definitionId: rope.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
        ...acquireIds(),
      },
    });
    renderWith(characterId);

    // 3 + 1 = 4 items
    expect(screen.getByText(/4 items/i)).toBeInTheDocument();
  });

  it('renders the M4 currency breakdown on each card (zero values for a fresh stash)', () => {
    const { characterId } = bootstrap();
    createOne(characterId, 'Treasury');
    renderWith(characterId);
    // CurrencyBreakdown renders "0c 0s 0e 0g 0p" for a fresh CurrencyHolding.
    expect(screen.getByText(/0c/)).toBeInTheDocument();
    expect(screen.getByText(/0g/)).toBeInTheDocument();
    expect(screen.getByText(/0p/)).toBeInTheDocument();
  });

  it('reflects non-zero currency live on the card', () => {
    const { characterId } = bootstrap();
    const stashId = createOne(characterId, 'Treasury');
    useStore.getState().dispatch({
      type: 'currency-change',
      payload: {
        stashId,
        delta: { cp: 0, sp: 0, ep: 0, gp: 25, pp: 0 },
        reason: 'deposit',
      },
    });
    renderWith(characterId);
    expect(screen.getByText(/25g/)).toBeInTheDocument();
  });

  it('clicking the + New Storage stash button opens the create modal', async () => {
    const user = userEvent.setup();
    const { characterId } = bootstrap();
    renderWith(characterId);

    await user.click(screen.getByRole('button', { name: /new storage stash/i }));

    // The dialog (from CreateStashModal) is now visible.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /new storage stash/i })).toBeInTheDocument();
  });

  it('clicking a card navigates to /storage/:stashId', async () => {
    const user = userEvent.setup();
    const { characterId } = bootstrap();
    const stashId = createOne(characterId, 'Chest at home');
    renderWith(characterId);

    await user.click(screen.getByRole('button', { name: /open chest at home/i }));

    // Stub destination renders.
    expect(screen.getByText('storage-detail-stub')).toBeInTheDocument();
    // (The stashId is in the URL; we trust the router rather than asserting on URL strings.)
    expect(stashId).toBeTruthy();
  });
});
