import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { LootDistributionWizard } from './LootDistributionWizard';
import { Toaster } from '@/components/ui/sonner';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';
import { bootstrap } from '@/test/fixtures';
import type { HoardGeneratorRouteState } from './HoardGenerator';

/**
 * R6.3 — Loot Distribution Wizard tests.
 */

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

function renderWizard(routeState: HoardGeneratorRouteState | null = null): void {
  const partyId = useStore.getState().appState!.party.id;
  const router = createMemoryRouter(
    [
      { path: '/party/:partyId/loot/distribute', Component: LootDistributionWizard },
      { path: '/party/:partyId/hub', element: <div>Hub</div> },
      { path: '/party/:partyId/loot/generate', element: <div>Generator</div> },
      { path: '*', element: null },
    ],
    {
      initialEntries: [
        {
          pathname: `/party/${partyId}/loot/distribute`,
          state: routeState,
        },
      ],
    },
  );
  render(
    <>
      <RouterProvider router={router} />
      <Toaster />
    </>,
  );
}

describe('LootDistributionWizard (R6.3)', () => {
  it('renders the empty-state when opened without route state', () => {
    bootstrap();
    renderWizard(null);
    expect(screen.getByRole('heading', { name: /loot distribution/i })).toBeInTheDocument();
    expect(screen.getByText(/no rows yet/i)).toBeInTheDocument();
  });

  it('populates rows from a hoard roll passed in route state', () => {
    bootstrap();
    renderWizard({
      band: '5-10',
      includeHomebrew: true,
      roll: {
        coins: { cp: 0, sp: 0, ep: 0, gp: 100, pp: 5 },
        magicItemsByRarity: {
          common: 0,
          uncommon: 1,
          rare: 0,
          'very-rare': 0,
          legendary: 0,
        },
        gemsByTier: {
          '10': 0,
          '50': 2,
          '100': 0,
          '500': 0,
          '1000': 0,
          '5000': 0,
        },
      },
    });
    // 2 coin rows + 1 magic-item placeholder + 2 gem placeholders = 5 rows.
    const rows = screen.getAllByRole('row');
    // Header row + 5 data rows = 6.
    expect(rows).toHaveLength(6);
    // Amount inputs present per row (excluding header).
    expect(screen.getAllByRole('spinbutton')).toHaveLength(5);
  });

  it('deleting a row removes it from the table', async () => {
    const user = userEvent.setup();
    bootstrap();
    renderWizard({
      band: '0-4',
      includeHomebrew: true,
      roll: {
        coins: { cp: 0, sp: 0, ep: 0, gp: 100, pp: 0 },
        magicItemsByRarity: {
          common: 0,
          uncommon: 0,
          rare: 0,
          'very-rare': 0,
          legendary: 0,
        },
        gemsByTier: { '10': 0, '50': 0, '100': 0, '500': 0, '1000': 0, '5000': 0 },
      },
    });
    // 1 gp coin row present.
    expect(screen.getAllByRole('spinbutton')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: /delete row/i }));
    expect(screen.queryByRole('spinbutton')).toBeNull();
    expect(screen.getByText(/no rows yet/i)).toBeInTheDocument();
  });

  it('Distribute with a coin row dispatches currency-change into Party Stash', async () => {
    const user = userEvent.setup();
    const b = bootstrap();
    renderWizard({
      band: '0-4',
      includeHomebrew: true,
      roll: {
        coins: { cp: 0, sp: 0, ep: 0, gp: 50, pp: 0 },
        magicItemsByRarity: {
          common: 0,
          uncommon: 0,
          rare: 0,
          'very-rare': 0,
          legendary: 0,
        },
        gemsByTier: { '10': 0, '50': 0, '100': 0, '500': 0, '1000': 0, '5000': 0 },
      },
    });

    const before = useStore.getState().log.length;
    await user.click(screen.getByRole('button', { name: /^distribute$/i }));

    const after = useStore.getState().log;
    // At least one new log slice appended.
    expect(after.length).toBeGreaterThan(before);
    // Latest entry: currency-change into party stash with +50 gp.
    const latestCurrencyEntry = [...after].reverse().find((e) => e.type === 'currency-change');
    expect(latestCurrencyEntry).toBeDefined();
    if (latestCurrencyEntry !== undefined && latestCurrencyEntry.type === 'currency-change') {
      expect(latestCurrencyEntry.payload.stashId).toBe(b.partyStashId);
      expect(latestCurrencyEntry.payload.delta.gp).toBe(50);
    }
  });

  it('Distribute with no rows is disabled', () => {
    bootstrap();
    renderWizard(null);
    const btn = screen.getByRole('button', { name: /^distribute$/i });
    expect(btn).toBeDisabled();
  });

  it('shows Party Stash and character Inventory in the target picker', () => {
    bootstrap();
    renderWizard({
      band: '0-4',
      includeHomebrew: true,
      roll: {
        coins: { cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 },
        magicItemsByRarity: {
          common: 0,
          uncommon: 0,
          rare: 0,
          'very-rare': 0,
          legendary: 0,
        },
        gemsByTier: { '10': 0, '50': 0, '100': 0, '500': 0, '1000': 0, '5000': 0 },
      },
    });
    const targetSelect = screen.getByLabelText(/^target$/i);
    const options = within(targetSelect as HTMLSelectElement).getAllByRole('option');
    expect(options.length).toBeGreaterThanOrEqual(2);
    // Party Stash is first, then the character's Inventory.
    expect((options[0] as HTMLOptionElement).text).toMatch(/party stash/i);
  });
});
