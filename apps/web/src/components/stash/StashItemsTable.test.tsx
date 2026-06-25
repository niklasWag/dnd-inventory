import { describe, expect, it, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { StashItemsTable } from './StashItemsTable';
import { Toaster } from '@/components/ui/sonner';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';
import { bootstrap } from '@/test/fixtures';

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

function setupWith(quantity: number): { stashId: string; itemInstanceId: string } {
  const { catalog, inventoryStashId } = bootstrap();
  const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
  useStore.getState().dispatch({
    type: 'acquire',
    payload: { stashId: inventoryStashId, definitionId: torch.id, quantity, source: 'catalog-add' },
  });
  const itemInstanceId = useStore.getState().appState!.items[0]!.id;
  return { stashId: inventoryStashId, itemInstanceId };
}

function renderTable(stashId: string): void {
  render(
    <MemoryRouter>
      <StashItemsTable stashId={stashId} />
      <Toaster />
    </MemoryRouter>,
  );
}

describe('StashItemsTable — M5 Move/Split buttons', () => {
  it('renders Split + Move buttons on each row', () => {
    const { stashId } = setupWith(3);
    renderTable(stashId);

    expect(screen.getByRole('button', { name: /^split torch/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^move torch/i })).toBeInTheDocument();
  });

  it('disables Split when the row is a singleton', () => {
    const { stashId } = setupWith(1);
    renderTable(stashId);
    expect(screen.getByRole('button', { name: /^split torch/i })).toBeDisabled();
  });

  it('enables Split when the row has qty >= 2', () => {
    const { stashId } = setupWith(2);
    renderTable(stashId);
    expect(screen.getByRole('button', { name: /^split torch/i })).toBeEnabled();
  });

  it('opens the SplitModal when Split is clicked', async () => {
    const user = userEvent.setup();
    const { stashId } = setupWith(3);
    renderTable(stashId);

    await user.click(screen.getByRole('button', { name: /^split torch/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/split stack/i)).toBeInTheDocument();
  });

  it('opens the MoveItemModal when Move is clicked', async () => {
    const user = userEvent.setup();
    const { stashId } = setupWith(2);
    renderTable(stashId);

    await user.click(screen.getByRole('button', { name: /^move torch/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/move item/i)).toBeInTheDocument();
  });
});

describe('StashItemsTable — R1.2 equip / attune toggles', () => {
  /**
   * Inventory-tab consumers pass `characterId` so the table renders the
   * Equip / Attune toggles. Reducer-rejection scenarios (attune over the
   * slot cap) must surface as a toast — never an uncaught throw — and
   * the Attune button must pre-disable when the cap is met.
   */

  function bootstrapWithTorches(count: number): {
    characterId: string;
    inventoryStashId: string;
  } {
    const { characterId, inventoryStashId, catalog } = bootstrap();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    for (let i = 0; i < count; i += 1) {
      useStore.getState().dispatch({
        type: 'acquire',
        payload: {
          stashId: inventoryStashId,
          definitionId: torch.id,
          quantity: 1,
          source: 'catalog-add',
          notes: `slot-${i}`,
        },
      });
    }
    return { characterId, inventoryStashId };
  }

  function renderInventory(stashId: string, characterId: string): void {
    render(
      <MemoryRouter>
        <StashItemsTable stashId={stashId} characterId={characterId} />
        <Toaster />
      </MemoryRouter>,
    );
  }

  it('disables the Attune button when maxAttunement is met', () => {
    const { characterId, inventoryStashId } = bootstrapWithTorches(4);
    // Attune the first three (default cap = 3).
    const ids = useStore
      .getState()
      .appState!.items.filter((i) => i.ownerId === inventoryStashId)
      .map((i) => i.id);
    for (let i = 0; i < 3; i += 1) {
      useStore
        .getState()
        .dispatch({ type: 'attune', payload: { characterId, itemInstanceId: ids[i]! } });
    }
    renderInventory(inventoryStashId, characterId);

    // The fourth row's Attune button must be disabled (cap met).
    const attuneButtons = screen.getAllByRole('button', { name: /^attune torch/i });
    expect(attuneButtons).toHaveLength(1); // only the un-attuned row shows "Attune"
    expect(attuneButtons[0]).toBeDisabled();
    // The three attuned rows show "Unattune" and remain enabled.
    expect(screen.getAllByRole('button', { name: /^unattune torch/i })).toHaveLength(3);
  });

  it('shows a toast (not an uncaught error) when the reducer rejects', async () => {
    // The pre-disable guard prevents the common over-cap click. To
    // exercise the toast path we simulate the race window: cap drops
    // mid-session AFTER the click is already in flight. `fireEvent.click`
    // (unlike userEvent) bypasses the `disabled` check so we can reach
    // the dispatch handler even though React has re-rendered with a
    // disabled button by the time the click lands.
    const { characterId, inventoryStashId } = bootstrapWithTorches(1);
    renderInventory(inventoryStashId, characterId);

    // Drop cap to 0 — re-render disables the Attune button.
    useStore
      .getState()
      .dispatch({ type: 'edit-character', payload: { characterId, patch: { maxAttunement: 0 } } });

    const button = screen.getByRole('button', { name: /^attune torch/i });
    fireEvent.click(button); // bypass `disabled` to hit the reducer

    expect(await screen.findByText(/no free attunement slot/i)).toBeInTheDocument();
  });

  it('Equip toggle dispatches equip and flips the button label', async () => {
    const user = userEvent.setup();
    const { characterId, inventoryStashId } = bootstrapWithTorches(1);
    renderInventory(inventoryStashId, characterId);

    await user.click(screen.getByRole('button', { name: /^equip torch/i }));
    // Label flipped to "Unequip".
    expect(screen.getByRole('button', { name: /^unequip torch/i })).toBeInTheDocument();
  });
});
