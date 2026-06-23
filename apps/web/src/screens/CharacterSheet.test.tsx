import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { CharacterSheet } from './CharacterSheet';
import { Welcome } from './Welcome';
import { ItemDetail } from './ItemDetail';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';

import { bootstrap } from '@/test/fixtures';

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

/**
 * Component test for the M1 happy path: after dispatching create-character,
 * CharacterSheet renders the header from the store. Uses a memory router
 * pinned at /character/:id so we don't depend on jsdom history globals.
 *
 * ItemDetail is registered too so the M2.5 "row name → /item/:id"
 * navigation test can verify the destination renders.
 */
function renderAt(path: string): void {
  const router = createMemoryRouter(
    [
      { path: '/', Component: Welcome },
      { path: '/character/:id', Component: CharacterSheet },
      { path: '/item/:itemInstanceId', Component: ItemDetail },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
}

describe('CharacterSheet (M1)', () => {
  it('renders the character header after create-character', () => {
    useStore.getState().dispatch({
      type: 'create-character',
      payload: { name: 'Thorin', species: 'Dwarf', class: 'Fighter', level: 3, str: 16 },
    });
    const id = useStore.getState().appState!.characters[0]!.id;

    renderAt(`/character/${id}`);

    expect(screen.getByRole('heading', { name: 'Thorin' })).toBeInTheDocument();
    expect(screen.getByText(/Level 3 Dwarf Fighter/)).toBeInTheDocument();
    expect(screen.getByText(/STR 16/)).toBeInTheDocument();
  });

  it('renders all four tabs', () => {
    useStore.getState().dispatch({
      type: 'create-character',
      payload: { name: 'A', species: 'B', class: 'C', level: 1, str: 10 },
    });
    const id = useStore.getState().appState!.characters[0]!.id;

    renderAt(`/character/${id}`);

    expect(screen.getByRole('tab', { name: 'Inventory' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Storage' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Party Stash' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Recovered Loot' })).toBeInTheDocument();
  });

  it('redirects to / when the character id is unknown', () => {
    renderAt('/character/does-not-exist');
    // Welcome renders an h1 with that text; CharacterSheet renders the character name.
    expect(screen.getByRole('heading', { name: /welcome, adventurer/i })).toBeInTheDocument();
  });
});

describe('CharacterSheet (M2)', () => {
  it('renders an empty-state for the Inventory tab when nothing has been acquired', () => {
    const { characterId: id } = bootstrap();
    renderAt(`/character/${id}`);

    expect(screen.getByText(/Nothing here yet/i)).toBeInTheDocument();
  });

  it('shows an acquired item row with the correct name and qty', () => {
    const { characterId: id, inventoryStashId } = bootstrap();
    const torch = useStore
      .getState()
      .appState!.catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 3,
        source: 'catalog-add',
      },
    });

    renderAt(`/character/${id}`);

    const row = screen.getByText('Torch').closest('tr');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('3')).toBeInTheDocument();
  });

  it('auto-stacks: two acquires of the same item yield one row, qty 2', () => {
    const { characterId: id, inventoryStashId } = bootstrap();
    const torch = useStore
      .getState()
      .appState!.catalog.find((d) => d.id === 'phb-2024:torch')!;
    const { dispatch } = useStore.getState();
    dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });

    renderAt(`/character/${id}`);

    const torchRows = screen.getAllByText('Torch');
    expect(torchRows).toHaveLength(1);
    const row = torchRows[0]!.closest('tr');
    expect(within(row!).getByText('2')).toBeInTheDocument();
  });

  it('clicking − dispatches consume and updates the DOM', async () => {
    const user = userEvent.setup();
    const { characterId: id, inventoryStashId } = bootstrap();
    const torch = useStore
      .getState()
      .appState!.catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 2,
        source: 'catalog-add',
      },
    });

    renderAt(`/character/${id}`);

    await user.click(screen.getByRole('button', { name: /Decrease Torch/ }));

    const row = screen.getByText('Torch').closest('tr');
    expect(within(row!).getByText('1')).toBeInTheDocument();
  });

  it('Storage tab renders the empty-state when no Storage stashes exist (M3)', async () => {
    const user = userEvent.setup();
    const { characterId: id } = bootstrap();
    renderAt(`/character/${id}`);

    await user.click(screen.getByRole('tab', { name: 'Storage' }));

    expect(screen.getByText(/no storage stashes yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new storage stash/i })).toBeInTheDocument();
  });

  it('Storage tab lists a Storage stash card after one is created (M3)', async () => {
    const user = userEvent.setup();
    const { characterId: id } = bootstrap();
    useStore.getState().dispatch({
      type: 'create-stash',
      payload: { ownerCharacterId: id, name: 'Vault of Waterdeep' },
    });
    renderAt(`/character/${id}`);

    await user.click(screen.getByRole('tab', { name: 'Storage' }));

    expect(screen.getByText('Vault of Waterdeep')).toBeInTheDocument();
  });

  it('clicking a row name navigates to /item/:id (M2.5)', async () => {
    const user = userEvent.setup();
    const { characterId: id, inventoryStashId } = bootstrap();
    const torch = useStore
      .getState()
      .appState!.catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });

    renderAt(`/character/${id}`);

    // The row name renders as a button — click it.
    await user.click(screen.getByRole('button', { name: /open details for torch/i }));

    // After navigation the ItemDetail screen renders the same name as an h1.
    expect(screen.getByRole('heading', { name: 'Torch' })).toBeInTheDocument();
  });
});
