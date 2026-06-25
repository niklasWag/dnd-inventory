import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PackItemModal } from './PackItemModal';
import { Toaster } from '@/components/ui/sonner';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';
import { bootstrap } from '@/test/fixtures';

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

interface Fixture {
  inventoryStashId: string;
  backpackId: string;
  torchId: string;
}

function setupTorchAndBackpack(): Fixture {
  const { inventoryStashId, catalog } = bootstrap();
  const backpack = catalog.find((d) => d.id === 'phb-2024:backpack')!;
  const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
  useStore.getState().dispatch({
    type: 'acquire',
    payload: {
      stashId: inventoryStashId,
      definitionId: backpack.id,
      quantity: 1,
      source: 'catalog-add',
    },
  });
  useStore.getState().dispatch({
    type: 'acquire',
    payload: {
      stashId: inventoryStashId,
      definitionId: torch.id,
      quantity: 1,
      source: 'catalog-add',
    },
  });
  const backpackId = useStore
    .getState()
    .appState!.items.find((i) => i.definitionId === backpack.id)!.id;
  const torchId = useStore
    .getState()
    .appState!.items.find((i) => i.definitionId === torch.id)!.id;
  return { inventoryStashId, backpackId, torchId };
}

describe('PackItemModal', () => {
  it('renders containers in the same stash as target options', () => {
    const { torchId, backpackId } = setupTorchAndBackpack();
    render(
      <>
        <PackItemModal open onOpenChange={() => {}} itemInstanceId={torchId} />
        <Toaster />
      </>,
    );
    // The select should have the backpack as a selectable option.
    const select = screen.getByLabelText(/target container/i);
    expect(select).toBeInTheDocument();
    // Option text includes "Backpack". The synthesized notes from Approach
    // B mean it'll read "Backpack (#1)" — match the prefix.
    if (!(select instanceof HTMLSelectElement)) throw new Error('expected <select>');
    expect(select.value).toBe(backpackId);
  });

  it('excludes the source row from the target list (no self-reference)', () => {
    const { inventoryStashId, catalog } = bootstrap();
    const backpack = catalog.find((d) => d.id === 'phb-2024:backpack')!;
    // Two backpacks — one will be the "source", the other a candidate.
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: backpack.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: backpack.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    const backpacks = useStore
      .getState()
      .appState!.items.filter((i) => i.definitionId === backpack.id);
    const sourceId = backpacks[0]!.id;
    const otherId = backpacks[1]!.id;

    render(
      <>
        <PackItemModal open onOpenChange={() => {}} itemInstanceId={sourceId} />
        <Toaster />
      </>,
    );

    const select = screen.getByLabelText(/target container/i);
    if (!(select instanceof HTMLSelectElement)) throw new Error('expected <select>');
    // The only legal target is the OTHER backpack, not the source.
    expect(select.value).toBe(otherId);
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).not.toContain(sourceId);
  });

  it('renders an empty-state hint when no containers exist', () => {
    const { inventoryStashId, catalog } = bootstrap();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    const torchId = useStore.getState().appState!.items[0]!.id;

    render(
      <>
        <PackItemModal open onOpenChange={() => {}} itemInstanceId={torchId} />
        <Toaster />
      </>,
    );

    expect(screen.getByText(/no containers in this stash/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^pack$/i })).toBeDisabled();
  });

  it('successful submit dispatches transfer with toContainerInstanceId set', async () => {
    const user = userEvent.setup();
    const { torchId, backpackId } = setupTorchAndBackpack();
    let closed = false;

    render(
      <>
        <PackItemModal
          open
          onOpenChange={(next) => {
            if (!next) closed = true;
          }}
          itemInstanceId={torchId}
        />
        <Toaster />
      </>,
    );

    await user.click(screen.getByRole('button', { name: /^pack$/i }));

    const torchAfter = useStore.getState().appState!.items.find((i) => i.id === torchId)!;
    expect(torchAfter.containerInstanceId).toBe(backpackId);
    expect(closed).toBe(true);
  });
});
