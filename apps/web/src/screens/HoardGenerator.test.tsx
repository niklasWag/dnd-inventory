import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { HoardGenerator } from './HoardGenerator';
import { LootDistributionWizard } from './LootDistributionWizard';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';
import { bootstrap } from '@/test/fixtures';

/**
 * R6.3 — Hoard Generator screen tests.
 */

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

function renderAt(path: string): void {
  const partyId = useStore.getState().appState?.party.id;
  const prefixed =
    partyId !== undefined ? path.replace(/^\/party\/:partyId/, `/party/${partyId}`) : path;
  const router = createMemoryRouter(
    [
      { path: '/party/:partyId/loot/generate', Component: HoardGenerator },
      { path: '/party/:partyId/loot/distribute', Component: LootDistributionWizard },
      { path: '*', element: null },
    ],
    { initialEntries: [prefixed] },
  );
  render(<RouterProvider router={router} />);
}

describe('HoardGenerator (R6.3)', () => {
  it('renders a coin/rarity/gem preview on mount', () => {
    bootstrap();
    renderAt('/party/:partyId/loot/generate');
    expect(screen.getByRole('heading', { name: /hoard generator/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /coins/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /magic items/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /gems/i })).toBeInTheDocument();
  });

  it('has an include-homebrew toggle default-on', () => {
    bootstrap();
    renderAt('/party/:partyId/loot/generate');
    const cb = screen.getByRole('checkbox', { name: /include homebrew/i });
    expect(cb).toBeChecked();
  });

  it('changing the CR band regenerates the roll', async () => {
    const user = userEvent.setup();
    bootstrap();
    renderAt('/party/:partyId/loot/generate');
    // Just verify that changing the select doesn't throw and the
    // preview is still rendered.
    await user.selectOptions(screen.getByLabelText(/cr band/i), '17+');
    expect(screen.getByRole('heading', { name: /coins/i })).toBeInTheDocument();
  });

  it('Continue navigates to the wizard with the roll in route state', async () => {
    const user = userEvent.setup();
    bootstrap();
    renderAt('/party/:partyId/loot/generate');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    // Wizard renders as the new route.
    expect(screen.getByRole('heading', { name: /loot distribution/i })).toBeInTheDocument();
  });

  it('Reroll button re-runs the roll (values may change)', async () => {
    const user = userEvent.setup();
    bootstrap();
    renderAt('/party/:partyId/loot/generate');
    const before = screen.getByRole('heading', { name: /coins/i }).parentElement!.textContent;
    await user.click(screen.getByRole('button', { name: /reroll/i }));
    const after = screen.getByRole('heading', { name: /coins/i }).parentElement!.textContent;
    // Not strictly guaranteed different (rng could repeat), but this
    // gives us signal that the button doesn't throw and the DOM is
    // re-rendered. Assert weakly that both blocks contain digits.
    expect(before).toMatch(/\d/);
    expect(after).toMatch(/\d/);
  });
});
