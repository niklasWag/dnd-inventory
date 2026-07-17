import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { WishlistOverview } from './WishlistOverview';
import { newUuidV7 } from '@app/shared';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';
import { bootstrap } from '@/test/fixtures';

/**
 * R10.5 — WishlistOverview (DM Command Center → Wishlists). Party-wide
 * read-only aggregate of every character's wishlist.
 */

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

function renderOverview(partyId: string): void {
  render(
    <MemoryRouter initialEntries={[`/party/${partyId}/wishlists`]}>
      <Routes>
        <Route path="/party/:partyId/wishlists" element={<WishlistOverview />} />
        <Route path="/hub" element={<div>hub</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('WishlistOverview (R10.5)', () => {
  it('aggregates catalog + free-text wishes per character', () => {
    const base = bootstrap();
    const def = base.catalog[0]!;
    void useStore.getState().dispatch({
      type: 'wishlist-add',
      payload: {
        characterId: base.characterId,
        entry: { id: newUuidV7(), kind: 'catalog', definitionId: def.id },
      },
    });
    void useStore.getState().dispatch({
      type: 'wishlist-add',
      payload: {
        characterId: base.characterId,
        entry: { id: newUuidV7(), kind: 'text', text: 'anything shiny' },
      },
    });

    renderOverview(base.partyId);

    const name = useStore.getState().appState!.characters[0]!.name;
    const list = screen.getByLabelText(new RegExp(`${name} wishlist`, 'i'));
    expect(within(list).getByText(def.name)).toBeInTheDocument();
    expect(within(list).getByText('anything shiny')).toBeInTheDocument();
  });

  it('shows an empty state when no one has wishlisted anything', () => {
    const base = bootstrap();
    renderOverview(base.partyId);
    expect(screen.getByText(/no one has wishlisted anything/i)).toBeInTheDocument();
  });

  it('redirects to /hub when no AppState is loaded', () => {
    renderOverview('p-unloaded');
    expect(screen.getByText('hub')).toBeInTheDocument();
  });
});
