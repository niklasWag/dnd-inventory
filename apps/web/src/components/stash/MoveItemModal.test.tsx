import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { MoveItemModal } from './MoveItemModal';
import { Toaster } from '@/components/ui/sonner';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';
import { bootstrap } from '@/test/fixtures';

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

interface SetupResult {
  itemInstanceId: string;
  inventoryStashId: string;
  partyStashId: string;
  recoveredLootStashId: string;
  storageStashId: string;
}

/**
 * Common setup: bootstrap + create a Storage stash + acquire `quantity`
 * torches into Inventory. Returns every stash id the MoveItemModal could
 * navigate to. Wrap in MemoryRouter so nested `useNavigate()` hooks work.
 */
function setupWithStacks(quantity: number): SetupResult {
  const base = bootstrap();
  useStore.getState().dispatch({
    type: 'create-stash',
    payload: { ownerCharacterId: base.characterId, name: 'Chest at home' },
  });
  const storageStashId = useStore.getState().appState!.stashes.at(-1)!.id;
  const torch = base.catalog.find((d) => d.id === 'phb-2024:torch')!;
  useStore.getState().dispatch({
    type: 'acquire',
    payload: { stashId: base.inventoryStashId, definitionId: torch.id, quantity, source: 'catalog-add' },
  });
  const itemInstanceId = useStore.getState().appState!.items[0]!.id;
  return {
    itemInstanceId,
    inventoryStashId: base.inventoryStashId,
    partyStashId: base.partyStashId,
    recoveredLootStashId: base.recoveredLootStashId,
    storageStashId,
  };
}

function renderWith(
  open: boolean,
  itemInstanceId: string,
  onOpenChange: (next: boolean) => void = () => {
    /* noop */
  },
): void {
  render(
    <MemoryRouter>
      <MoveItemModal open={open} onOpenChange={onOpenChange} itemInstanceId={itemInstanceId} />
      <Toaster />
    </MemoryRouter>,
  );
}

describe('MoveItemModal (M5)', () => {
  it('does not render when open=false', () => {
    const { itemInstanceId } = setupWithStacks(3);
    renderWith(false, itemInstanceId);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders dialog with target select + qty input when open=true', () => {
    const { itemInstanceId } = setupWithStacks(3);
    renderWith(true, itemInstanceId);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/target stash/i)).toBeInTheDocument();
    const qty = screen.getByLabelText(/^quantity$/i);
    expect(qty).toHaveValue(3); // defaults to full stack
  });

  it('lists every stash except the source as a target option', () => {
    const { itemInstanceId, inventoryStashId, partyStashId, recoveredLootStashId, storageStashId } =
      setupWithStacks(2);
    renderWith(true, itemInstanceId);

    const select = screen.getByLabelText(/target stash/i);
    const optionIds = Array.from(select.querySelectorAll('option')).map((o) => o.value);
    expect(optionIds).toContain(partyStashId);
    expect(optionIds).toContain(recoveredLootStashId);
    expect(optionIds).toContain(storageStashId);
    expect(optionIds).not.toContain(inventoryStashId); // source excluded
  });

  it('dispatches transfer (full move) when submitted with default qty', async () => {
    const user = userEvent.setup();
    const { itemInstanceId, partyStashId } = setupWithStacks(2);
    let openValue = true;
    const onOpenChange = (next: boolean): void => {
      openValue = next;
    };
    renderWith(true, itemInstanceId, onOpenChange);

    const select = screen.getByLabelText(/target stash/i);
    await user.selectOptions(select, partyStashId);
    await user.click(screen.getByRole('button', { name: /^move$/i }));

    const items = useStore.getState().appState!.items;
    expect(items).toHaveLength(1);
    expect(items[0]!.ownerId).toBe(partyStashId);
    expect(items[0]!.quantity).toBe(2);
    expect(openValue).toBe(false);
  });

  it('dispatches transfer (partial move) when qty < source.quantity', async () => {
    const user = userEvent.setup();
    const { itemInstanceId, partyStashId, inventoryStashId } = setupWithStacks(5);
    renderWith(true, itemInstanceId);

    const select = screen.getByLabelText(/target stash/i);
    await user.selectOptions(select, partyStashId);
    const qty = screen.getByLabelText(/^quantity$/i);
    await user.clear(qty);
    await user.type(qty, '2');
    await user.click(screen.getByRole('button', { name: /^move$/i }));

    const items = useStore.getState().appState!.items;
    expect(items).toHaveLength(2);
    const source = items.find((i) => i.id === itemInstanceId)!;
    const dest = items.find((i) => i.id !== itemInstanceId)!;
    expect(source.quantity).toBe(3);
    expect(source.ownerId).toBe(inventoryStashId);
    expect(dest.quantity).toBe(2);
    expect(dest.ownerId).toBe(partyStashId);
  });

  it('rejects qty > source.quantity (Zod gate, no dispatch)', async () => {
    const user = userEvent.setup();
    const { itemInstanceId, partyStashId } = setupWithStacks(2);
    renderWith(true, itemInstanceId);

    const select = screen.getByLabelText(/target stash/i);
    await user.selectOptions(select, partyStashId);
    const qty = screen.getByLabelText(/^quantity$/i);
    await user.clear(qty);
    await user.type(qty, '5');
    await user.click(screen.getByRole('button', { name: /^move$/i }));

    // No change to items — Zod gate blocked submit.
    const items = useStore.getState().appState!.items;
    expect(items).toHaveLength(1);
    expect(items[0]!.quantity).toBe(2);
  });

  it('shows an "Item moved" toast on success', async () => {
    const user = userEvent.setup();
    const { itemInstanceId, partyStashId } = setupWithStacks(2);
    renderWith(true, itemInstanceId);

    await user.selectOptions(screen.getByLabelText(/target stash/i), partyStashId);
    await user.click(screen.getByRole('button', { name: /^move$/i }));

    expect(await screen.findByText(/item moved/i)).toBeInTheDocument();
  });

  it('renders character-prefixed labels for character-scope stashes', () => {
    const { itemInstanceId, storageStashId } = setupWithStacks(2);
    renderWith(true, itemInstanceId);

    const select = screen.getByLabelText(/target stash/i);
    const opt = Array.from(select.querySelectorAll('option')).find((o) => o.value === storageStashId);
    expect(opt).toBeDefined();
    // The bootstrap fixture uses name "Thorin" by default → "Thorin — Chest at home".
    expect(opt!.textContent).toMatch(/Thorin/);
    expect(opt!.textContent).toMatch(/Chest at home/);
  });
});

describe('MoveItemModal — R1.3 leave-Inventory warning', () => {
  /**
   * The §3.4 cascade auto-clears equipped/attuned on a leave-Inventory
   * transfer. The modal must surface this BEFORE the user confirms so
   * the row coming back un-equipped after a round trip isn't a surprise.
   * Warning shows only when (a) source row lives in Inventory AND
   * (b) at least one of `equipped` / `attuned` is true.
   */
  it('renders a warning when an equipped Inventory row is being moved', () => {
    const { characterId, itemInstanceId } = (() => {
      const setup = setupWithStacks(1);
      // Source row is in Inventory; equip it before opening the modal.
      const charId = useStore.getState().appState!.characters[0]!.id;
      useStore
        .getState()
        .dispatch({ type: 'equip', payload: { characterId: charId, itemInstanceId: setup.itemInstanceId } });
      return { characterId: charId, itemInstanceId: setup.itemInstanceId };
    })();
    expect(characterId).toBeTruthy();

    renderWith(true, itemInstanceId);
    expect(screen.getByRole('status').textContent).toMatch(/equipped/i);
    expect(screen.getByRole('status').textContent).toMatch(/clear/i);
  });

  it('renders a warning naming both flags when row is equipped AND attuned', () => {
    const setup = setupWithStacks(1);
    const charId = useStore.getState().appState!.characters[0]!.id;
    useStore
      .getState()
      .dispatch({ type: 'equip', payload: { characterId: charId, itemInstanceId: setup.itemInstanceId } });
    useStore
      .getState()
      .dispatch({ type: 'attune', payload: { characterId: charId, itemInstanceId: setup.itemInstanceId } });

    renderWith(true, setup.itemInstanceId);
    const status = screen.getByRole('status').textContent ?? '';
    expect(status).toMatch(/equipped/i);
    expect(status).toMatch(/attuned/i);
  });

  it('does NOT render a warning for an un-equipped, un-attuned row', () => {
    const { itemInstanceId } = setupWithStacks(1);
    renderWith(true, itemInstanceId);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
