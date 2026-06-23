import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { CatalogBrowser } from './CatalogBrowser';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';
import { PHB_SEED_VERSION, loadPhbSeed } from '@app/seeds';

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

function renderBrowser(): void {
  const router = createMemoryRouter(
    [{ path: '/catalog', Component: CatalogBrowser }],
    { initialEntries: ['/catalog'] },
  );
  render(<RouterProvider router={router} />);
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
});
