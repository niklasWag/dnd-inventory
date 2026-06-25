import { describe, expect, it, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { StashItemsTable } from './StashItemsTable';
import { Toaster } from '@/components/ui/sonner';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';
import { bootstrap } from '@/test/fixtures';

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

function setupWith(quantity: number): { stashId: string; itemInstanceId: string } {
  const { catalog, inventoryStashId } = bootstrap();
  const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
  useStore.getState().dispatch({
    type: 'acquire',
    payload: { stashId: inventoryStashId, definitionId: torch.id, quantity, source: 'catalog-add' },
  });
  const itemInstanceId = useStore.getState().appState!.items[0]!.id;
  return { stashId: inventoryStashId, itemInstanceId };
}

function renderTable(stashId: string): void {
  render(
    <MemoryRouter>
      <StashItemsTable stashId={stashId} />
      <Toaster />
    </MemoryRouter>,
  );
}

describe('StashItemsTable — M5 Move/Split buttons', () => {
  it('renders Split + Move buttons on each row', () => {
    const { stashId } = setupWith(3);
    renderTable(stashId);

    expect(screen.getByRole('button', { name: /^split torch/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^move torch/i })).toBeInTheDocument();
  });

  it('disables Split when the row is a singleton', () => {
    const { stashId } = setupWith(1);
    renderTable(stashId);
    expect(screen.getByRole('button', { name: /^split torch/i })).toBeDisabled();
  });

  it('enables Split when the row has qty >= 2', () => {
    const { stashId } = setupWith(2);
    renderTable(stashId);
    expect(screen.getByRole('button', { name: /^split torch/i })).toBeEnabled();
  });

  it('opens the SplitModal when Split is clicked', async () => {
    const user = userEvent.setup();
    const { stashId } = setupWith(3);
    renderTable(stashId);

    await user.click(screen.getByRole('button', { name: /^split torch/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/split stack/i)).toBeInTheDocument();
  });

  it('opens the MoveItemModal when Move is clicked', async () => {
    const user = userEvent.setup();
    const { stashId } = setupWith(2);
    renderTable(stashId);

    await user.click(screen.getByRole('button', { name: /^move torch/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/move item/i)).toBeInTheDocument();
  });
});

describe('StashItemsTable — R1.2 equip / attune toggles', () => {
  /**
   * Inventory-tab consumers pass `characterId` so the table renders the
   * Equip / Attune toggles. Reducer-rejection scenarios (attune over the
   * slot cap) must surface as a toast — never an uncaught throw — and
   * the Attune button must pre-disable when the cap is met.
   *
   * R2.1 — `attune` rejects mundane rows, and the Attune toggle is
   * hidden on rows whose definition has `requiresAttunement !== true`.
   * Tests that exercise attune use a DMG magic item (Wand of Magic
   * Missiles); Equip-only tests keep using a Torch.
   */

  function bootstrapWithTorches(count: number): {
    characterId: string;
    inventoryStashId: string;
  } {
    const { characterId, inventoryStashId, catalog } = bootstrap();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    for (let i = 0; i < count; i += 1) {
      useStore.getState().dispatch({
        type: 'acquire',
        payload: {
          stashId: inventoryStashId,
          definitionId: torch.id,
          quantity: 1,
          source: 'catalog-add',
          notes: `slot-${i}`,
        },
      });
    }
    return { characterId, inventoryStashId };
  }

  function bootstrapWithMagicItems(count: number): {
    characterId: string;
    inventoryStashId: string;
  } {
    const { characterId, inventoryStashId, catalog } = bootstrap();
    const magic = catalog.find((d) => d.id === 'dmg-2024:cloak-of-protection')!;
    for (let i = 0; i < count; i += 1) {
      useStore.getState().dispatch({
        type: 'acquire',
        payload: {
          stashId: inventoryStashId,
          definitionId: magic.id,
          quantity: 1,
          source: 'catalog-add',
          notes: `slot-${i}`,
        },
      });
    }
    return { characterId, inventoryStashId };
  }

  function renderInventory(stashId: string, characterId: string): void {
    render(
      <MemoryRouter>
        <StashItemsTable stashId={stashId} characterId={characterId} />
        <Toaster />
      </MemoryRouter>,
    );
  }

  it('disables the Attune button when maxAttunement is met', () => {
    const { characterId, inventoryStashId } = bootstrapWithMagicItems(4);
    // Attune the first three (default cap = 3).
    const ids = useStore
      .getState()
      .appState!.items.filter((i) => i.ownerId === inventoryStashId)
      .map((i) => i.id);
    for (let i = 0; i < 3; i += 1) {
      useStore
        .getState()
        .dispatch({ type: 'attune', payload: { characterId, itemInstanceId: ids[i]! } });
    }
    renderInventory(inventoryStashId, characterId);

    // The fourth row's Attune button must be disabled (cap met).
    const attuneButtons = screen.getAllByRole('button', { name: /^attune cloak of protection/i });
    expect(attuneButtons).toHaveLength(1); // only the un-attuned row shows "Attune"
    expect(attuneButtons[0]).toBeDisabled();
    // The three attuned rows show "Unattune" and remain enabled.
    expect(screen.getAllByRole('button', { name: /^unattune cloak of protection/i })).toHaveLength(3);
  });

  it('shows a toast (not an uncaught error) when the reducer rejects', async () => {
    // The pre-disable guard prevents the common over-cap click. To
    // exercise the toast path we simulate the race window: cap drops
    // mid-session AFTER the click is already in flight. `fireEvent.click`
    // (unlike userEvent) bypasses the `disabled` check so we can reach
    // the dispatch handler even though React has re-rendered with a
    // disabled button by the time the click lands.
    const { characterId, inventoryStashId } = bootstrapWithMagicItems(1);
    renderInventory(inventoryStashId, characterId);

    // Drop cap to 0 — re-render disables the Attune button.
    useStore
      .getState()
      .dispatch({ type: 'edit-character', payload: { characterId, patch: { maxAttunement: 0 } } });

    const button = screen.getByRole('button', { name: /^attune cloak of protection/i });
    fireEvent.click(button); // bypass `disabled` to hit the reducer

    expect(await screen.findByText(/no free attunement slot/i)).toBeInTheDocument();
  });

  it('Equip toggle dispatches equip and flips the button label', async () => {
    const user = userEvent.setup();
    const { characterId, inventoryStashId } = bootstrapWithTorches(1);
    renderInventory(inventoryStashId, characterId);

    await user.click(screen.getByRole('button', { name: /^equip torch/i }));
    // Label flipped to "Unequip".
    expect(screen.getByRole('button', { name: /^unequip torch/i })).toBeInTheDocument();
  });
});

describe('StashItemsTable — R1.3 container view', () => {
  /**
   * One-level container nesting (OUTLINE §3.6): a row whose
   * `containerInstanceId` points at another row in the same stash
   * renders directly under that parent, with a visual indent. The R1.3
   * UI is a read-only display — packing items into a container lives in
   * a later milestone.
   */
  it('renders child rows directly after their parent with an indent marker', () => {
    const { characterId, inventoryStashId, catalog } = bootstrap();
    const backpack = catalog.find((d) => d.id === 'phb-2024:backpack')!;
    const rations = catalog.find((d) => d.id === 'phb-2024:rations-1day')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: { stashId: inventoryStashId, definitionId: backpack.id, quantity: 1, source: 'catalog-add' },
    });
    const backpackId = useStore.getState().appState!.items.find((i) => i.definitionId === backpack.id)!.id;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: rations.id,
        quantity: 1,
        source: 'catalog-add',
        notes: 'inside-pack',
      },
    });
    // Patch the rations row to live inside the backpack.
    useStore.setState((curr) => {
      if (curr.appState === null) return curr;
      return {
        ...curr,
        appState: {
          ...curr.appState,
          items: curr.appState.items.map((row) =>
            row.notes === 'inside-pack' ? { ...row, containerInstanceId: backpackId } : row,
          ),
        },
      };
    });

    render(
      <MemoryRouter>
        <StashItemsTable stashId={inventoryStashId} characterId={characterId} />
        <Toaster />
      </MemoryRouter>,
    );

    // Both rows render. The child's row should carry the indent marker (↳).
    expect(screen.getByText('Backpack')).toBeInTheDocument();
    expect(screen.getByText(/Rations/i)).toBeInTheDocument();
    // The indent glyph appears at least once (one child row).
    expect(screen.getAllByText('↳').length).toBeGreaterThanOrEqual(1);
  });
});

describe('StashItemsTable — R1.5 Pack / Take out buttons + container summary', () => {
  /**
   * R1.5 — same-stash pack / take-out UI. Pack button visibility hinges
   * on the stash having at least one free top-level container; Take out
   * shows up only on rows that ARE inside a container. The container
   * summary ("Backpack — 3 items inside") renders inline next to the
   * container's name.
   */

  it('hides the Pack button when no containers are in the stash', () => {
    const { stashId } = setupWith(1); // just a torch, no containers
    renderTable(stashId);
    expect(
      screen.queryByRole('button', { name: /^pack torch/i }),
    ).not.toBeInTheDocument();
  });

  it('shows the Pack button on free top-level items when a container exists', () => {
    const { inventoryStashId, catalog } = bootstrap();
    const backpack = catalog.find((d) => d.id === 'phb-2024:backpack')!;
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: { stashId: inventoryStashId, definitionId: backpack.id, quantity: 1, source: 'catalog-add' },
    });
    useStore.getState().dispatch({
      type: 'acquire',
      payload: { stashId: inventoryStashId, definitionId: torch.id, quantity: 1, source: 'catalog-add' },
    });
    renderTable(inventoryStashId);
    expect(screen.getByRole('button', { name: /^pack torch/i })).toBeInTheDocument();
  });

  it('hides Pack on the container row itself (no container-in-container per §3.6)', () => {
    const { inventoryStashId, catalog } = bootstrap();
    const backpack = catalog.find((d) => d.id === 'phb-2024:backpack')!;
    // Two backpacks so a candidate container exists in the stash, but
    // the container row itself shouldn't get a Pack button (avoids the
    // illegal "pack backpack into backpack" combo even though the
    // reducer would reject it).
    useStore.getState().dispatch({
      type: 'acquire',
      payload: { stashId: inventoryStashId, definitionId: backpack.id, quantity: 1, source: 'catalog-add' },
    });
    useStore.getState().dispatch({
      type: 'acquire',
      payload: { stashId: inventoryStashId, definitionId: backpack.id, quantity: 1, source: 'catalog-add' },
    });
    renderTable(inventoryStashId);
    expect(
      screen.queryByRole('button', { name: /^pack backpack/i }),
    ).not.toBeInTheDocument();
  });

  it('opens PackItemModal when Pack is clicked, dispatches transfer with toContainerInstanceId', async () => {
    const user = userEvent.setup();
    const { inventoryStashId, catalog } = bootstrap();
    const backpack = catalog.find((d) => d.id === 'phb-2024:backpack')!;
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: { stashId: inventoryStashId, definitionId: backpack.id, quantity: 1, source: 'catalog-add' },
    });
    useStore.getState().dispatch({
      type: 'acquire',
      payload: { stashId: inventoryStashId, definitionId: torch.id, quantity: 1, source: 'catalog-add' },
    });
    const backpackId = useStore.getState().appState!.items.find((i) => i.definitionId === backpack.id)!.id;
    const torchId = useStore.getState().appState!.items.find((i) => i.definitionId === torch.id)!.id;
    renderTable(inventoryStashId);

    await user.click(screen.getByRole('button', { name: /^pack torch/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/pack into container/i)).toBeInTheDocument();

    // Submit the form (the default-selected option is the backpack).
    await user.click(screen.getByRole('button', { name: /^pack$/i }));

    const torchRow = useStore.getState().appState!.items.find((i) => i.id === torchId)!;
    expect(torchRow.containerInstanceId).toBe(backpackId);
  });

  it('renders Take out only on contained rows and dispatches a take-out transfer', async () => {
    const user = userEvent.setup();
    const { characterId, inventoryStashId, catalog } = bootstrap();
    const backpack = catalog.find((d) => d.id === 'phb-2024:backpack')!;
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: { stashId: inventoryStashId, definitionId: backpack.id, quantity: 1, source: 'catalog-add' },
    });
    useStore.getState().dispatch({
      type: 'acquire',
      payload: { stashId: inventoryStashId, definitionId: torch.id, quantity: 1, source: 'catalog-add' },
    });
    const backpackId = useStore.getState().appState!.items.find((i) => i.definitionId === backpack.id)!.id;
    const torchId = useStore.getState().appState!.items.find((i) => i.definitionId === torch.id)!.id;
    // Pack via reducer so the UI test starts in "torch inside backpack" state.
    useStore.getState().dispatch({
      type: 'transfer',
      payload: { itemInstanceId: torchId, toStashId: inventoryStashId, quantity: 1, toContainerInstanceId: backpackId },
    });

    render(
      <MemoryRouter>
        <StashItemsTable stashId={inventoryStashId} characterId={characterId} />
        <Toaster />
      </MemoryRouter>,
    );

    // The torch row now has Take out; the backpack row doesn't.
    expect(screen.getByRole('button', { name: /take torch/i })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /take backpack/i }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /take torch/i }));
    const torchAfter = useStore.getState().appState!.items.find((i) => i.id === torchId)!;
    expect(torchAfter.containerInstanceId).toBeNull();
  });

  it('renders the "N items inside" summary on container rows with contents', () => {
    const { characterId, inventoryStashId, catalog } = bootstrap();
    const backpack = catalog.find((d) => d.id === 'phb-2024:backpack')!;
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: { stashId: inventoryStashId, definitionId: backpack.id, quantity: 1, source: 'catalog-add' },
    });
    useStore.getState().dispatch({
      type: 'acquire',
      payload: { stashId: inventoryStashId, definitionId: torch.id, quantity: 3, source: 'catalog-add' },
    });
    const backpackId = useStore.getState().appState!.items.find((i) => i.definitionId === backpack.id)!.id;
    const torchId = useStore.getState().appState!.items.find((i) => i.definitionId === torch.id)!.id;
    useStore.getState().dispatch({
      type: 'transfer',
      payload: { itemInstanceId: torchId, toStashId: inventoryStashId, quantity: 3, toContainerInstanceId: backpackId },
    });

    render(
      <MemoryRouter>
        <StashItemsTable stashId={inventoryStashId} characterId={characterId} />
        <Toaster />
      </MemoryRouter>,
    );

    // Summary reads "— 3 items inside" (sum of child quantities, not row count).
    expect(screen.getByText(/3 items inside/i)).toBeInTheDocument();
  });

  it('hides Take out when the parent is in a different stash (dangling reference)', () => {
    // Defensive UI filter: a row whose `containerInstanceId` points at
    // a row in a DIFFERENT stash is not actually contained from the
    // user's perspective — the parent isn't visible here, so a
    // "Take out" button would be confusing. The R1.5 reducer's
    // orphan-drop usually prevents this state, but partial states
    // (legacy JSON imports, manual DevTools pokes) could still trip it.
    const { characterId, inventoryStashId, partyStashId, catalog } = bootstrap();
    const backpack = catalog.find((d) => d.id === 'phb-2024:backpack')!;
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: { stashId: inventoryStashId, definitionId: backpack.id, quantity: 1, source: 'catalog-add' },
    });
    useStore.getState().dispatch({
      type: 'acquire',
      payload: { stashId: partyStashId, definitionId: torch.id, quantity: 1, source: 'catalog-add' },
    });
    const backpackId = useStore.getState().appState!.items.find((i) => i.definitionId === backpack.id)!.id;
    const torchId = useStore.getState().appState!.items.find((i) => i.definitionId === torch.id)!.id;
    // Force a dangling reference: torch in Party Stash points at a
    // backpack in Inventory. (The reducer would normally clear this on
    // a real cross-stash Move; we patch state directly here to simulate
    // a legacy / imported blob.)
    useStore.setState((curr) => {
      if (curr.appState === null) return curr;
      return {
        ...curr,
        appState: {
          ...curr.appState,
          items: curr.appState.items.map((row) =>
            row.id === torchId ? { ...row, containerInstanceId: backpackId } : row,
          ),
        },
      };
    });

    render(
      <MemoryRouter>
        <StashItemsTable stashId={partyStashId} characterId={characterId} />
        <Toaster />
      </MemoryRouter>,
    );

    // Torch renders top-level (no Take out, because the backpack isn't here).
    expect(screen.getByText('Torch')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /take torch/i }),
    ).not.toBeInTheDocument();
  });
});

describe('StashItemsTable — R2.1 magic-item display + Attune visibility', () => {
  /**
   * R2.1 — the Attune toggle is hidden on rows whose definition has
   * `requiresAttunement !== true`. The Equip toggle is unaffected — equip
   * applies to mundane armor / weapons / shields per PHB 2024.
   * A rarity dot prefix appears on the row name when `def.rarity != null`.
   */
  function renderInventory(stashId: string, characterId: string): void {
    render(
      <MemoryRouter>
        <StashItemsTable stashId={stashId} characterId={characterId} />
        <Toaster />
      </MemoryRouter>,
    );
  }

  it('hides the Attune button on a mundane PHB row (Torch) but shows Equip', () => {
    const { characterId, inventoryStashId, catalog } = bootstrap();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: { stashId: inventoryStashId, definitionId: torch.id, quantity: 1, source: 'catalog-add' },
    });

    renderInventory(inventoryStashId, characterId);

    expect(screen.getByRole('button', { name: /^equip torch/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^attune torch/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^unattune torch/i })).not.toBeInTheDocument();
  });

  it('shows both Equip and Attune on a DMG row with requiresAttunement:true', () => {
    const { characterId, inventoryStashId, catalog } = bootstrap();
    const magic = catalog.find((d) => d.id === 'dmg-2024:cloak-of-protection')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: { stashId: inventoryStashId, definitionId: magic.id, quantity: 1, source: 'catalog-add' },
    });

    renderInventory(inventoryStashId, characterId);

    expect(
      screen.getByRole('button', { name: /^equip cloak of protection/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^attune cloak of protection/i }),
    ).toBeInTheDocument();
  });

  it('renders the rarity dot prefix on a DMG row (Uncommon class)', () => {
    const { characterId, inventoryStashId, catalog } = bootstrap();
    const magic = catalog.find((d) => d.id === 'dmg-2024:cloak-of-protection')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: { stashId: inventoryStashId, definitionId: magic.id, quantity: 1, source: 'catalog-add' },
    });

    renderInventory(inventoryStashId, characterId);

    // The rarity dot is a small span labelled with the rarity name.
    expect(screen.getByLabelText('Rarity: Uncommon')).toBeInTheDocument();
  });
});

