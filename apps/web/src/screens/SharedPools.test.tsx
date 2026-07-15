import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { PartyStash, RecoveredLoot } from './SharedPools';
import { Toaster } from '@/components/ui/sonner';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';

import { bootstrap } from '@/test/fixtures';

/**
 * R9.5 — Party Stash + Recovered Loot are the party-wide shared-pool screens
 * that replace the R9.3 `StashPlaceholder`. This suite covers the screen-level
 * wiring (title + shared CurrencyRow + InventoryPanel + Add item) and the
 * banker-context defaults. The per-flag CurrencyRow rendering is exhaustively
 * covered in `CurrencyRow.test.tsx`; here we verify the SCREEN computes the
 * right context (solo → not gated).
 */
beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

function renderScreen(which: 'party' | 'recovered', partyId: string): void {
  const path = which === 'party' ? 'party-stash' : 'recovered-loot';
  const Component = which === 'party' ? PartyStash : RecoveredLoot;
  const router = createMemoryRouter([{ path: `/party/:partyId/${path}`, Component }], {
    initialEntries: [`/party/${partyId}/${path}`],
  });
  render(
    <>
      <RouterProvider router={router} />
      <Toaster />
    </>,
  );
}

describe('PartyStash (R9.5)', () => {
  it('renders the title, currency panel, and item panel with Add item', () => {
    const { partyId } = bootstrap();
    renderScreen('party', partyId);

    expect(screen.getByRole('heading', { name: /^party stash$/i })).toBeInTheDocument();
    // Shared CurrencyRow present (Currency heading).
    expect(screen.getByRole('heading', { name: /^currency$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add item/i })).toBeInTheDocument();
  });

  it('solo party (no Banker) is NOT gated — the full currency control set shows', () => {
    const { partyId } = bootstrap();
    renderScreen('party', partyId);
    // Not gated: Transfer + Convert are visible (they hide only when gated
    // or DM-with-Banker). Split Evenly is Party-Stash + Banker-only, so it
    // is absent here (no banker in a solo party).
    expect(screen.getByRole('button', { name: /^transfer$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^convert$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^split evenly$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^drain$/i })).not.toBeInTheDocument();
  });
});

describe('RecoveredLoot (R9.5)', () => {
  it('renders the title, currency panel, and item panel with Add item', () => {
    const { partyId } = bootstrap();
    renderScreen('recovered', partyId);

    expect(screen.getByRole('heading', { name: /^recovered loot$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^currency$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add item/i })).toBeInTheDocument();
  });
});
