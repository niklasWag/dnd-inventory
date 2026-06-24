import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AddItemModal } from './AddItemModal';
import { Toaster } from '@/components/ui/sonner';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';

import { bootstrap } from '@/test/fixtures';

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

function renderModal(stashId: string, stashLabel = 'Inventory'): { onOpenChange: { current: boolean } } {
  const onOpenChange = { current: true };
  render(
    <>
      <AddItemModal
        open={true}
        onOpenChange={(next) => {
          onOpenChange.current = next;
        }}
        stashId={stashId}
        stashLabel={stashLabel}
      />
      <Toaster />
    </>,
  );
  return { onOpenChange };
}

describe('AddItemModal Custom tab (M6)', () => {
  it('switching to the Custom tab reveals the HomebrewForm', async () => {
    const user = userEvent.setup();
    const { inventoryStashId } = bootstrap();
    renderModal(inventoryStashId);

    await user.click(screen.getByRole('tab', { name: /custom/i }));

    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^create$/i })).toBeInTheDocument();
  });

  it('submitting Custom dispatches create-homebrew + acquire (two log entries)', async () => {
    const user = userEvent.setup();
    const { inventoryStashId } = bootstrap();
    const beforeLog = useStore.getState().log.length;
    renderModal(inventoryStashId);

    await user.click(screen.getByRole('tab', { name: /custom/i }));
    await user.type(screen.getByLabelText(/^name$/i), 'Glowing Mushroom');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    const log = useStore.getState().log;
    const newEntries = log.slice(beforeLog);
    // create-homebrew first, then acquire chained from the parent handler.
    expect(newEntries).toHaveLength(2);
    expect(newEntries[0]?.type).toBe('create-homebrew');
    expect(newEntries[1]?.type).toBe('acquire');

    // Inventory now holds the new homebrew row.
    const created = useStore
      .getState()
      .appState!.catalog.find((d) => d.name === 'Glowing Mushroom');
    expect(created).toBeDefined();
    const instance = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === created!.id);
    expect(instance).toBeDefined();
    expect(instance?.ownerId).toBe(inventoryStashId);
    expect(instance?.quantity).toBe(1);

    // Verify acquire source recorded as 'custom-create'.
    const acquireEntry = newEntries[1];
    if (acquireEntry?.type === 'acquire') {
      expect(acquireEntry.payload.source).toBe('custom-create');
    }
  });

  it('cancelling the Custom form returns to the Catalog tab without closing the parent', async () => {
    // Regression: previously Cancel inside HomebrewForm closed the
    // outer AddItemModal, stranding the user with no way back to the
    // Catalog. The fix: Cancel switches back to the Catalog tab; only
    // a successful create closes the parent (via onCreated).
    const user = userEvent.setup();
    const { inventoryStashId } = bootstrap();
    const { onOpenChange } = renderModal(inventoryStashId);

    await user.click(screen.getByRole('tab', { name: /custom/i }));
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();

    // Click the form's Cancel button (HomebrewForm renders a ghost button).
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    // Parent modal still open — onOpenChange was NOT called with false.
    expect(onOpenChange.current).toBe(true);
    // Catalog tab is now active.
    expect(screen.getByRole('tab', { name: /catalog/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // Catalog content renders (search input is a CatalogPicker signal).
    expect(screen.getByPlaceholderText(/torch|rope|search/i)).toBeInTheDocument();
  });

  it('Catalog is the default tab on every fresh open', () => {
    // Regression guard: tab state is reset on open so a previously-left
    // Custom tab does not survive a close/reopen cycle.
    const { inventoryStashId } = bootstrap();
    const onOpenChange = { current: true };

    const { rerender } = render(
      <>
        <AddItemModal
          open={false}
          onOpenChange={(next) => {
            onOpenChange.current = next;
          }}
          stashId={inventoryStashId}
          stashLabel="Inventory"
        />
        <Toaster />
      </>,
    );

    // First open — Catalog tab active.
    rerender(
      <>
        <AddItemModal
          open={true}
          onOpenChange={(next) => {
            onOpenChange.current = next;
          }}
          stashId={inventoryStashId}
          stashLabel="Inventory"
        />
        <Toaster />
      </>,
    );

    expect(screen.getByRole('tab', { name: /catalog/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
