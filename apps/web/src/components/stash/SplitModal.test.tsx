import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { SplitModal } from './SplitModal';
import { Toaster } from '@/components/ui/sonner';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';
import { bootstrap } from '@/test/fixtures';
import { newUuidV7 } from '@app/shared';

/**
 * RH1.2 — id-injection helpers for direct `dispatch` sites. Fresh UUID
 * v7 per call keeps the fixture within the guard's clock-skew window
 * and hermetic per-test.
 */
function acquireIds() {
  return { newItemInstanceId: newUuidV7() };
}

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

interface SetupResult {
  itemInstanceId: string;
  inventoryStashId: string;
}

/**
 * Common setup: bootstrap + seed Inventory with `quantity` torches and
 * return the row id. Wrap the modal in a MemoryRouter so any nested
 * `useNavigate()` hooks (none yet, but matches the other suites) work.
 */
function setupWithStack(quantity: number, notes?: string): SetupResult {
  const { catalog, inventoryStashId } = bootstrap();
  const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
  useStore.getState().dispatch({
    type: 'acquire',
    payload: {
      stashId: inventoryStashId,
      definitionId: torch.id,
      quantity,
      source: 'catalog-add',
      ...(notes !== undefined ? { notes } : {}),
      ...acquireIds(),
    },
  });
  const itemInstanceId = useStore.getState().appState!.items[0]!.id;
  return { itemInstanceId, inventoryStashId };
}

function renderWith(
  open: boolean,
  itemInstanceId: string,
  onOpenChange: (next: boolean) => void = () => {
    /* noop */
  },
): void {
  render(
    <MemoryRouter>
      <SplitModal open={open} onOpenChange={onOpenChange} itemInstanceId={itemInstanceId} />
      <Toaster />
    </MemoryRouter>,
  );
}

describe('SplitModal (M5)', () => {
  it('does not render when open=false', () => {
    const { itemInstanceId } = setupWithStack(3);
    renderWith(false, itemInstanceId);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the form when open=true with default quantity of 1', () => {
    const { itemInstanceId } = setupWithStack(5);
    renderWith(true, itemInstanceId);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const input = screen.getByLabelText(/quantity to split off/i);
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue(1);
  });

  it('disables Split when source is a singleton', () => {
    const { itemInstanceId } = setupWithStack(1);
    renderWith(true, itemInstanceId);
    expect(screen.getByRole('button', { name: /^split$/i })).toBeDisabled();
  });

  it('shows validation error when quantity exceeds source.quantity - 1', async () => {
    const user = userEvent.setup();
    const { itemInstanceId } = setupWithStack(3);
    renderWith(true, itemInstanceId);
    const input = screen.getByLabelText(/quantity to split off/i);

    await user.clear(input);
    await user.type(input, '3'); // === source.quantity, must be strictly less

    await user.click(screen.getByRole('button', { name: /^split$/i }));
    // No new row created.
    expect(useStore.getState().appState!.items).toHaveLength(1);
    // Submit should be blocked by Zod max() or schema refine — either way no dispatch.
  });

  it('dispatches split on submit and closes the modal', async () => {
    const user = userEvent.setup();
    const { itemInstanceId, inventoryStashId } = setupWithStack(5);
    let openValue = true;
    const onOpenChange = (next: boolean): void => {
      openValue = next;
    };
    renderWith(true, itemInstanceId, onOpenChange);

    const input = screen.getByLabelText(/quantity to split off/i);
    await user.clear(input);
    await user.type(input, '2');
    await user.click(screen.getByRole('button', { name: /^split$/i }));

    const items = useStore.getState().appState!.items;
    expect(items).toHaveLength(2);
    const source = items.find((i) => i.id === itemInstanceId)!;
    const newRow = items.find((i) => i.id !== itemInstanceId)!;
    expect(source.quantity).toBe(3);
    expect(newRow.quantity).toBe(2);
    expect(newRow.ownerId).toBe(inventoryStashId); // same stash
    expect(openValue).toBe(false);
  });

  it('inherits notes onto the new row', async () => {
    const user = userEvent.setup();
    const { itemInstanceId } = setupWithStack(4, 'given by Volo');
    renderWith(true, itemInstanceId);

    const input = screen.getByLabelText(/quantity to split off/i);
    await user.clear(input);
    await user.type(input, '1');
    await user.click(screen.getByRole('button', { name: /^split$/i }));

    const items = useStore.getState().appState!.items;
    const newRow = items.find((i) => i.id !== itemInstanceId)!;
    expect(newRow.notes).toBe('given by Volo');
  });

  it('shows a "Stack split" toast on success', async () => {
    const user = userEvent.setup();
    const { itemInstanceId } = setupWithStack(3);
    renderWith(true, itemInstanceId);

    const input = screen.getByLabelText(/quantity to split off/i);
    await user.clear(input);
    await user.type(input, '1');
    await user.click(screen.getByRole('button', { name: /^split$/i }));

    expect(await screen.findByText(/stack split/i)).toBeInTheDocument();
  });

  it('preview line shows source-keeps-remaining math', async () => {
    const user = userEvent.setup();
    const { itemInstanceId } = setupWithStack(5);
    renderWith(true, itemInstanceId);

    const input = screen.getByLabelText(/quantity to split off/i);
    await user.clear(input);
    await user.type(input, '2');

    const status = screen.getByRole('status');
    expect(within(status).getByText(/splits/i)).toBeInTheDocument();
    expect(status.textContent).toMatch(/2/);
    expect(status.textContent).toMatch(/3/);
  });
});
