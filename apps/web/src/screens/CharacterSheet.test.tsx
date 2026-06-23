import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { CharacterSheet } from './CharacterSheet';
import { Welcome } from './Welcome';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';
import { PHB_SEED_VERSION, loadPhbSeed } from '@app/seeds';

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

/**
 * Component test for the M1 happy path: after dispatching create-character,
 * CharacterSheet renders the header from the store. Uses a memory router
 * pinned at /character/:id so we don't depend on jsdom history globals.
 */
function renderAt(path: string): void {
  const router = createMemoryRouter(
    [
      { path: '/', Component: Welcome },
      { path: '/character/:id', Component: CharacterSheet },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
}

/** Bootstrap to the M2 baseline: character created + catalog seeded. */
function bootstrap(): { id: string; inventoryStashId: string } {
  useStore.getState().dispatch({
    type: 'create-character',
    payload: { name: 'Thorin', species: 'Dwarf', class: 'Fighter', level: 3, str: 16 },
  });
  useStore.getState().dispatch({
    type: 'seed-catalog',
    payload: { seedVersion: PHB_SEED_VERSION, entries: loadPhbSeed() },
  });
  const s = useStore.getState().appState!;
  return { id: s.characters[0]!.id, inventoryStashId: s.characters[0]!.inventoryStashId };
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
    const { id } = bootstrap();
    renderAt(`/character/${id}`);

    expect(screen.getByText(/Nothing here yet/i)).toBeInTheDocument();
  });

  it('shows an acquired item row with the correct name and qty', () => {
    const { id, inventoryStashId } = bootstrap();
    const torch = useStore
      .getState()
      .appState!.catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 3,
        source: 'custom-create',
      },
    });

    renderAt(`/character/${id}`);

    const row = screen.getByText('Torch').closest('tr');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('3')).toBeInTheDocument();
  });

  it('auto-stacks: two acquires of the same item yield one row, qty 2', () => {
    const { id, inventoryStashId } = bootstrap();
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
        source: 'custom-create',
      },
    });
    dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'custom-create',
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
    const { id, inventoryStashId } = bootstrap();
    const torch = useStore
      .getState()
      .appState!.catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 2,
        source: 'custom-create',
      },
    });

    renderAt(`/character/${id}`);

    await user.click(screen.getByRole('button', { name: /Decrease Torch/ }));

    const row = screen.getByText('Torch').closest('tr');
    expect(within(row!).getByText('1')).toBeInTheDocument();
  });

  it('Storage tab still shows the M3 placeholder', async () => {
    const user = userEvent.setup();
    const { id } = bootstrap();
    renderAt(`/character/${id}`);

    await user.click(screen.getByRole('tab', { name: 'Storage' }));

    expect(screen.getByText(/Storage stash management arrives in M3/)).toBeInTheDocument();
  });
});
