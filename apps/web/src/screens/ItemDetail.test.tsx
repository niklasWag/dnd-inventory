import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { ItemDetail } from './ItemDetail';
import { Welcome } from './Welcome';
import { CharacterSheet } from './CharacterSheet';
import { Toaster } from '@/components/ui/sonner';
import { useStore, flushPendingPersist } from '@/store';
import { loadAppState } from '@/db/load';
import { wipeAll } from '@/db/wipe';
import { appStateSchema } from '@app/shared';

import { bootstrapWithItem } from '@/test/fixtures';

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

function renderAt(path: string): void {
  const router = createMemoryRouter(
    [
      { path: '/', Component: Welcome },
      { path: '/character/:id', Component: CharacterSheet },
      { path: '/item/:itemInstanceId', Component: ItemDetail },
    ],
    { initialEntries: [path] },
  );
  // Toaster mounted so toast.success calls land in the DOM (tests can assert).
  render(
    <>
      <RouterProvider router={router} />
      <Toaster />
    </>,
  );
}

/** Bootstrap to the M2.5 baseline for ItemDetail tests: 1 Torch acquired. */
function bootstrapWithTorch(): { itemInstanceId: string; inventoryStashId: string } {
  const r = bootstrapWithItem();
  return { itemInstanceId: r.itemInstanceId, inventoryStashId: r.inventoryStashId };
}

describe('ItemDetail (M2.5)', () => {
  it('redirects to / when itemInstanceId does not resolve', () => {
    renderAt('/item/does-not-exist');
    expect(screen.getByRole('heading', { name: /welcome, adventurer/i })).toBeInTheDocument();
  });

  it('renders the definition name in the header when customName is unset', () => {
    const { itemInstanceId } = bootstrapWithTorch();
    renderAt(`/item/${itemInstanceId}`);
    expect(screen.getByRole('heading', { name: 'Torch' })).toBeInTheDocument();
  });

  it('renders customName in the header when set, overriding the definition name', () => {
    const { itemInstanceId } = bootstrapWithTorch();
    useStore.getState().dispatch({
      type: 'edit-item-instance',
      payload: { itemInstanceId, patch: { customName: 'Eternal Flame' } },
    });
    renderAt(`/item/${itemInstanceId}`);
    expect(screen.getByRole('heading', { name: 'Eternal Flame' })).toBeInTheDocument();
  });

  it('Save is disabled when the form is pristine', () => {
    const { itemInstanceId } = bootstrapWithTorch();
    renderAt(`/item/${itemInstanceId}`);
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  it('editing customName + Save dispatches edit-item-instance, then form is pristine again', async () => {
    const user = userEvent.setup();
    const { itemInstanceId } = bootstrapWithTorch();
    renderAt(`/item/${itemInstanceId}`);

    await user.type(screen.getByLabelText(/custom name/i), 'Sting');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    // Reducer state mutated, log entry recorded, form re-pristine.
    const row = useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!;
    expect(row.customName).toBe('Sting');
    const last = useStore.getState().log.at(-1);
    expect(last?.type).toBe('edit-item-instance');
    // Defaults reset via useEffect, so Save is disabled again.
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  it('editing notes persists through a simulated reload', async () => {
    const user = userEvent.setup();
    const { itemInstanceId } = bootstrapWithTorch();
    renderAt(`/item/${itemInstanceId}`);

    await user.type(screen.getByLabelText(/notes/i), 'made of moonsilver');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    // Reducer applied the patch.
    expect(
      useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!.notes,
    ).toBe('made of moonsilver');

    // Force the debounced persist to land in Dexie, then simulate a reload.
    await flushPendingPersist();
    const persisted = (await loadAppState()) as {
      appState: unknown;
      log: unknown[];
    } | null;
    expect(persisted).not.toBeNull();
    const parsed = appStateSchema.parse(persisted!.appState);
    expect(parsed.items.find((i) => i.id === itemInstanceId)!.notes).toBe('made of moonsilver');
  });

  it('shows a "Item updated" toast on successful save', async () => {
    const user = userEvent.setup();
    const { itemInstanceId } = bootstrapWithTorch();
    renderAt(`/item/${itemInstanceId}`);

    await user.type(screen.getByLabelText(/notes/i), 'fragile');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText(/item updated/i)).toBeInTheDocument();
  });

  it('surfaces reducer errors via role="alert"', async () => {
    const user = userEvent.setup();
    const { itemInstanceId } = bootstrapWithTorch();
    renderAt(`/item/${itemInstanceId}`);

    // Stub dispatch to throw. Wrap in vi.spyOn so we can restore.
    const dispatchSpy = vi
      .spyOn(useStore.getState(), 'dispatch')
      .mockImplementation(() => {
        throw new Error('mock reducer failure');
      });

    await user.type(screen.getByLabelText(/notes/i), 'x');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/mock reducer failure/i);
    dispatchSpy.mockRestore();
  });

  it('renders the history section with the original acquire entry', () => {
    const { itemInstanceId } = bootstrapWithTorch();
    renderAt(`/item/${itemInstanceId}`);
    expect(screen.getByText(/source: catalog-add/i)).toBeInTheDocument();
  });

  it('renders a Back link that returns to the owning character sheet', async () => {
    const user = userEvent.setup();
    const { itemInstanceId } = bootstrapWithTorch();
    renderAt(`/item/${itemInstanceId}`);

    // Label includes the stash name for context.
    const back = screen.getByRole('button', { name: /back to inventory/i });
    expect(back).toBeInTheDocument();

    await user.click(back);

    // CharacterSheet renders the character name as an h1.
    expect(screen.getByRole('heading', { name: 'Thorin' })).toBeInTheDocument();
  });
});
