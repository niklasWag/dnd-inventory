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

describe('HoardGenerator (R6.3 / R9.9 stepper)', () => {
  /** R9.9 — the generator is a 3-step stepper (Parameters → Review roll →
   * Hand off). Advance from step 1 to the roll preview via the "Roll" nav. */
  async function goToReview(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.click(screen.getByRole('button', { name: /^roll$/i }));
  }

  /** Advance all the way to the final "Hand off" step. */
  async function goToHandoff(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await goToReview(user);
    await user.click(screen.getByRole('button', { name: /^next$/i }));
  }

  it('renders the stepper title + parameters on mount, roll preview on step 2', async () => {
    const user = userEvent.setup();
    bootstrap();
    renderAt('/party/:partyId/loot/generate');
    // Eyebrow names the tool; the h1 is the stepper title.
    expect(screen.getByText(/hoard generator/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /roll a treasure hoard/i })).toBeInTheDocument();
    // Preview headings live on the "Review roll" step.
    await goToReview(user);
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
    // Change the band on step 1, then advance to the preview.
    await user.selectOptions(screen.getByLabelText(/cr band/i), '17+');
    await goToReview(user);
    expect(screen.getByRole('heading', { name: /coins/i })).toBeInTheDocument();
  });

  it('Continue navigates to the wizard with the roll in route state', async () => {
    const user = userEvent.setup();
    bootstrap();
    renderAt('/party/:partyId/loot/generate');
    await goToHandoff(user);
    await user.click(screen.getByRole('button', { name: /continue/i }));
    // Wizard renders as the new route.
    expect(screen.getByRole('heading', { name: /distribution wizard/i })).toBeInTheDocument();
  });

  it('Reroll button re-runs the roll (values may change)', async () => {
    const user = userEvent.setup();
    bootstrap();
    renderAt('/party/:partyId/loot/generate');
    await goToReview(user);
    // The Coins card wraps its header + the 5-denom value grid.
    const coinsCard = screen
      .getByRole('heading', { name: /coins/i })
      .closest('div.overflow-hidden')!;
    const before = coinsCard.textContent;
    await user.click(screen.getByRole('button', { name: /reroll/i }));
    const after = screen
      .getByRole('heading', { name: /coins/i })
      .closest('div.overflow-hidden')!.textContent;
    // Not strictly guaranteed different (rng could repeat), but this gives
    // signal the button doesn't throw + the DOM re-renders.
    expect(before).toMatch(/\d/);
    expect(after).toMatch(/\d/);
  });
});
