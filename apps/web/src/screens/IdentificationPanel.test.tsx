import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { IdentificationPanel } from './IdentificationPanel';
import { Toaster } from '@/components/ui/sonner';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';
import { bootstrap } from '@/test/fixtures';
import { newUuidV7 } from '@app/shared';

/**
 * R6.4 — Identification Panel UI tests.
 */

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

function renderAt(): void {
  const partyId = useStore.getState().appState!.party.id;
  const router = createMemoryRouter(
    [
      { path: '/party/:partyId/identify', Component: IdentificationPanel },
      { path: '*', element: null },
    ],
    { initialEntries: [`/party/${partyId}/identify`] },
  );
  render(
    <>
      <RouterProvider router={router} />
      <Toaster />
    </>,
  );
}

/**
 * Seed N unidentified copies of the Cloak of Protection in inventory
 * and return the definitionId + created instance ids.
 */
function seedUnidentifiedCloaks(n: number): { definitionId: string; ids: string[] } {
  const base = bootstrap();
  const cloak = base.catalog.find((d) => /cloak of protection/i.test(d.name));
  if (cloak === undefined) throw new Error('Cloak of Protection not in DMG seed');
  const created: string[] = [];
  for (let i = 0; i < n; i += 1) {
    void useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: base.inventoryStashId,
        definitionId: cloak.id,
        quantity: 1,
        source: 'catalog-add',
        notes: `copy-${String(i)}`,
        newItemInstanceId: newUuidV7(),
      },
    });
    const row = useStore
      .getState()
      .appState!.items.find(
        (it) => it.definitionId === cloak.id && it.notes === `copy-${String(i)}`,
      );
    if (row === undefined) throw new Error('seed: acquire did not create a row');
    created.push(row.id);
  }
  // Flip all to unidentified so the panel shows them.
  for (const id of created) {
    void useStore.getState().dispatch({
      type: 'identify',
      payload: { itemInstanceId: id, identified: false },
    });
  }
  return { definitionId: cloak.id, ids: created };
}

describe('IdentificationPanel (R6.4)', () => {
  it('renders the empty state when nothing is unidentified', () => {
    bootstrap();
    renderAt();
    expect(screen.getByRole('heading', { name: /identification/i })).toBeInTheDocument();
    expect(screen.getByText(/nothing to identify/i)).toBeInTheDocument();
  });

  it('lists one group per definitionId with unidentified count and batch button', () => {
    seedUnidentifiedCloaks(3);
    renderAt();
    // "3 copies" appears in the group header.
    expect(screen.getByText(/3 copies/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /identify all 3/i })).toBeInTheDocument();
  });

  it('single-identify from the expanded row flips one instance and emits an identify entry', async () => {
    const user = userEvent.setup();
    const { ids } = seedUnidentifiedCloaks(2);
    renderAt();
    // Expand the group.
    await user.click(screen.getByRole('button', { name: /^expand$/i }));
    const logBefore = useStore.getState().log.length;
    // Click the first per-row Identify button (there are 2 rows).
    const identifyButtons = screen.getAllByRole('button', { name: /^identify$/i });
    await user.click(identifyButtons[0]!);

    const added = useStore.getState().log.slice(logBefore);
    expect(added).toHaveLength(1);
    expect(added[0]!.type).toBe('identify');
    // One of the seeded instances is now identified.
    const identifiedIds = useStore
      .getState()
      .appState!.items.filter((it) => ids.includes(it.id) && it.identified === true)
      .map((it) => it.id);
    expect(identifiedIds).toHaveLength(1);
  });

  it('batch dialog confirm dispatches identify-batch for all copies', async () => {
    const user = userEvent.setup();
    const { definitionId, ids } = seedUnidentifiedCloaks(3);
    renderAt();

    await user.click(screen.getByRole('button', { name: /identify all 3/i }));
    // Dialog opens.
    expect(screen.getByRole('dialog', { name: /identify all 3 copies/i })).toBeInTheDocument();

    const logBefore = useStore.getState().log.length;
    await user.click(screen.getByRole('button', { name: /^identify 3$/i }));

    const added = useStore.getState().log.slice(logBefore);
    // One identify log entry per affected instance.
    expect(added).toHaveLength(3);
    for (const entry of added) {
      expect(entry.type).toBe('identify');
    }
    // Every seeded instance is now identified.
    for (const id of ids) {
      const row = useStore.getState().appState!.items.find((it) => it.id === id)!;
      expect(row.identified).toBe(true);
    }
    // Sanity: the reducer stored the target definitionId across all rows.
    for (const id of ids) {
      const row = useStore.getState().appState!.items.find((it) => it.id === id)!;
      expect(row.definitionId).toBe(definitionId);
    }
  });

  it('batch dialog with a shared hint applies it to every affected instance', async () => {
    const user = userEvent.setup();
    const { ids } = seedUnidentifiedCloaks(2);
    renderAt();
    await user.click(screen.getByRole('button', { name: /identify all 2/i }));
    const hintInput = screen.getByLabelText(/shared hint/i);
    await user.type(hintInput, 'radiates protection');
    await user.click(screen.getByRole('button', { name: /^identify 2$/i }));

    for (const id of ids) {
      const row = useStore.getState().appState!.items.find((it) => it.id === id)!;
      expect(row.hint).toBe('radiates protection');
    }
  });

  it('"Show identified" reveals identified magic items with a Revoke button', async () => {
    const user = userEvent.setup();
    const { ids } = seedUnidentifiedCloaks(1);
    // Identify the one copy first so it lands in the identified section.
    void useStore.getState().dispatch({
      type: 'identify',
      payload: { itemInstanceId: ids[0]!, identified: true },
    });
    renderAt();
    // Primary section is empty now.
    expect(screen.getByText(/nothing to identify/i)).toBeInTheDocument();
    // Toggle "Show identified".
    await user.click(screen.getByRole('button', { name: /show identified/i }));
    expect(screen.getByText(/1 copy/i)).toBeInTheDocument();
    // Expand.
    await user.click(screen.getByRole('button', { name: /^expand$/i }));
    // Revoke button flips it back.
    const logBefore = useStore.getState().log.length;
    await user.click(screen.getByRole('button', { name: /^revoke$/i }));
    const added = useStore.getState().log.slice(logBefore);
    expect(added).toHaveLength(1);
    expect(added[0]!.type).toBe('identify');
    const row = useStore.getState().appState!.items.find((it) => it.id === ids[0]!)!;
    expect(row.identified).toBe(false);
  });
});
