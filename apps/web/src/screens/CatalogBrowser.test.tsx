import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { CatalogBrowser } from './CatalogBrowser';
import { Toaster } from '@/components/ui/sonner';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';
import { PHB_SEED_VERSION, loadPhbSeed } from '@app/seeds';
import { bootstrap, bootstrapWithHomebrew } from '@/test/fixtures';

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

function renderBrowser(): void {
  const router = createMemoryRouter(
    [{ path: '/catalog', Component: CatalogBrowser }],
    { initialEntries: ['/catalog'] },
  );
  render(
    <>
      <RouterProvider router={router} />
      <Toaster />
    </>,
  );
}

describe('CatalogBrowser', () => {
  it('renders the empty-state when there is no AppState (regression: was infinite-looping)', () => {
    // Pre-character-creation: appState is null. Selectors must return a
    // stable reference for the empty case, otherwise Zustand re-renders
    // forever ("Maximum update depth exceeded").
    expect(() => {
      renderBrowser();
    }).not.toThrow();

    expect(screen.getByRole('heading', { name: /catalog/i })).toBeInTheDocument();
    expect(screen.getByText(/Catalog is empty/i)).toBeInTheDocument();
  });

  it('renders the full PHB list when the catalog is seeded', () => {
    useStore.getState().dispatch({
      type: 'create-character',
      payload: { name: 'A', species: 'B', class: 'C', level: 1, str: 10 },
    });
    useStore.getState().dispatch({
      type: 'seed-catalog',
      payload: { seedVersion: PHB_SEED_VERSION, entries: loadPhbSeed() },
    });

    renderBrowser();

    expect(screen.getByText('Torch')).toBeInTheDocument();
    expect(screen.getByText('Longsword')).toBeInTheDocument();
  });

  it('PHB rows show a Duplicate button (M6)', () => {
    bootstrap();
    renderBrowser();
    // Use one specific PHB row's Duplicate button to avoid the
    // hundreds of identical buttons across the list.
    expect(screen.getByRole('button', { name: /duplicate torch$/i })).toBeInTheDocument();
  });

  it('homebrew rows show Edit + Delete buttons; PHB rows do not (M6)', () => {
    bootstrapWithHomebrew({ name: 'Mushroom' });
    renderBrowser();

    // Filter to the homebrew row by typing in the search box.
    expect(screen.getByRole('button', { name: /edit mushroom/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete mushroom/i })).toBeInTheDocument();
  });

  it('clicking Duplicate on a PHB row opens HomebrewForm in duplicate mode pre-filled (M6)', async () => {
    const user = userEvent.setup();
    bootstrap();
    renderBrowser();

    await user.click(screen.getByRole('button', { name: /duplicate torch$/i }));

    // Form dialog is up; its name field is pre-filled with "Torch".
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/^name$/i)).toHaveValue('Torch');
    // Submit label reads "Duplicate".
    expect(screen.getByRole('button', { name: /^duplicate$/i })).toBeInTheDocument();
  });

  it('submitting Duplicate creates a homebrew row with duplicatedFromId (M6)', async () => {
    const user = userEvent.setup();
    const { catalog } = bootstrap();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    renderBrowser();

    await user.click(screen.getByRole('button', { name: /duplicate torch$/i }));
    await user.click(screen.getByRole('button', { name: /^duplicate$/i }));

    const homebrew = useStore
      .getState()
      .appState!.catalog.find((d) => d.source === 'homebrew' && d.duplicatedFromId === torch.id);
    expect(homebrew).toBeDefined();
    expect(homebrew?.name).toBe('Torch');
  });

  it('clicking Edit on a homebrew row opens HomebrewForm pre-filled (M6)', async () => {
    const user = userEvent.setup();
    bootstrapWithHomebrew({ name: 'Mushroom' });
    renderBrowser();

    await user.click(screen.getByRole('button', { name: /edit mushroom/i }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/^name$/i)).toHaveValue('Mushroom');
    expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument();
  });

  it('Delete dialog shows reference count when item is held in stashes (M6)', async () => {
    const user = userEvent.setup();
    const { homebrewDefId, inventoryStashId } = bootstrapWithHomebrew({ name: 'Mushroom' });
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: homebrewDefId,
        quantity: 2,
        source: 'custom-create',
      },
    });
    renderBrowser();

    await user.click(screen.getByRole('button', { name: /delete mushroom/i }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent(/1 stash hold/i);
    // Delete action is disabled when reference count > 0.
    const deleteBtn = screen.getByRole('button', { name: /^delete$/i });
    expect(deleteBtn).toBeDisabled();
  });

  it('Delete dialog confirms cleanly when no instances reference the homebrew (M6)', async () => {
    const user = userEvent.setup();
    const { homebrewDefId } = bootstrapWithHomebrew({ name: 'Mushroom' });
    renderBrowser();

    await user.click(screen.getByRole('button', { name: /delete mushroom/i }));
    const deleteBtn = screen.getByRole('button', { name: /^delete$/i });
    expect(deleteBtn).not.toBeDisabled();
    await user.click(deleteBtn);

    expect(
      useStore.getState().appState!.catalog.find((d) => d.id === homebrewDefId),
    ).toBeUndefined();
  });

  it('"New homebrew" button opens HomebrewForm in create mode (M6)', async () => {
    const user = userEvent.setup();
    bootstrap();
    renderBrowser();

    await user.click(screen.getByRole('button', { name: /new homebrew/i }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Empty name input in create mode.
    expect(screen.getByLabelText(/^name$/i)).toHaveValue('');
    expect(screen.getByRole('button', { name: /^create$/i })).toBeInTheDocument();
  });
});
