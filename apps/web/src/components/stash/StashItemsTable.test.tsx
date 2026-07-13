import { describe, expect, it, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { StashItemsTable } from './StashItemsTable';
import { newUuidV7 } from '@app/shared';
import type { PartyMembership } from '@app/shared';
import { Toaster } from '@/components/ui/sonner';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';
import { bootstrap } from '@/test/fixtures';

/**
 * RH1.2 — id-injection helpers for direct `dispatch` sites. Fresh UUID
 * v7 per call keeps the fixture within the guard's clock-skew window
 * and hermetic per-test.
 */
function acquireIds() {
  return { newItemInstanceId: newUuidV7() };
}
function transferIds() {
  return { newItemInstanceId: newUuidV7() };
}

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

function setupWith(quantity: number): { stashId: string; itemInstanceId: string } {
  const { catalog, inventoryStashId } = bootstrap();
  const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
  void useStore.getState().dispatch({
    type: 'acquire',
    payload: {
      stashId: inventoryStashId,
      definitionId: torch.id,
      quantity,
      source: 'catalog-add',
      ...acquireIds(),
      ...acquireIds(),
    },
  });
  const itemInstanceId = useStore.getState().appState!.items[0]!.id;
  return { stashId: inventoryStashId, itemInstanceId };
}

function renderTable(stashId: string): void {
  const partyId = useStore.getState().appState?.party.id ?? 'test-party';
  render(
    <MemoryRouter initialEntries={[`/party/${partyId}/character/test`]}>
      <Routes>
        <Route
          path="/party/:partyId/character/:id"
          element={
            <>
              <StashItemsTable stashId={stashId} />
              <Toaster />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * R9.3 — the per-row actions (Split / Equip / Attune / Pack / Take out /
 * Move / Remove) moved into a kebab DropdownMenu. Open the row's menu (by
 * the item's display name) so its `menuitem`s are queryable. If no name is
 * given, opens the first/only row's menu.
 */
async function openRowMenu(user: ReturnType<typeof userEvent.setup>, name?: RegExp): Promise<void> {
  const trigger = name
    ? screen.getByRole('button', { name })
    : screen.getByRole('button', { name: /actions for/i });
  await user.click(trigger);
}

describe('StashItemsTable — M5 Move/Split buttons', () => {
  it('renders Split + Move actions in the row menu', async () => {
    const user = userEvent.setup();
    const { stashId } = setupWith(3);
    renderTable(stashId);

    await openRowMenu(user);
    expect(screen.getByRole('menuitem', { name: /^split torch/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /^move torch/i })).toBeInTheDocument();
  });

  it('disables Split when the row is a singleton', async () => {
    const user = userEvent.setup();
    const { stashId } = setupWith(1);
    renderTable(stashId);
    await openRowMenu(user);
    expect(screen.getByRole('menuitem', { name: /^split torch/i })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('enables Split when the row has qty >= 2', async () => {
    const user = userEvent.setup();
    const { stashId } = setupWith(2);
    renderTable(stashId);
    await openRowMenu(user);
    expect(screen.getByRole('menuitem', { name: /^split torch/i })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('opens the SplitModal when Split is clicked', async () => {
    const user = userEvent.setup();
    const { stashId } = setupWith(3);
    renderTable(stashId);

    await openRowMenu(user);
    await user.click(screen.getByRole('menuitem', { name: /^split torch/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/split stack/i)).toBeInTheDocument();
  });

  it('opens the MoveItemModal when Move is clicked', async () => {
    const user = userEvent.setup();
    const { stashId } = setupWith(2);
    renderTable(stashId);

    await openRowMenu(user);
    await user.click(screen.getByRole('menuitem', { name: /^move torch/i }));
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
      void useStore.getState().dispatch({
        type: 'acquire',
        payload: {
          stashId: inventoryStashId,
          definitionId: torch.id,
          quantity: 1,
          source: 'catalog-add',
          notes: `slot-${i}`,
          ...acquireIds(),
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
      void useStore.getState().dispatch({
        type: 'acquire',
        payload: {
          stashId: inventoryStashId,
          definitionId: magic.id,
          quantity: 1,
          source: 'catalog-add',
          notes: `slot-${i}`,
          ...acquireIds(),
        },
      });
    }
    return { characterId, inventoryStashId };
  }

  function renderInventory(stashId: string, characterId: string): void {
    render(
      <MemoryRouter
        initialEntries={[
          `/party/${useStore.getState().appState?.party.id ?? 'test-party'}/character/test`,
        ]}
      >
        <Routes>
          <Route
            path="/party/:partyId/character/:id"
            element={
              <>
                <StashItemsTable stashId={stashId} characterId={characterId} />
                <Toaster />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('disables the Attune menu item when maxAttunement is met (non-DM path)', async () => {
    const user = userEvent.setup();
    const { characterId, inventoryStashId } = bootstrapWithMagicItems(4);
    // Attune the first three (default cap = 3).
    const ids = useStore
      .getState()
      .appState!.items.filter((i) => i.ownerId === inventoryStashId)
      .map((i) => i.id);
    for (let i = 0; i < 3; i += 1) {
      void useStore
        .getState()
        .dispatch({ type: 'attune', payload: { characterId, itemInstanceId: ids[i]! } });
    }
    // R4.5 — the disable-when-full behavior only applies to non-DM
    // actors. Solo bootstrap grants DM rights via §8.2, so force a
    // multi-member party where the current user is a plain player.
    const state = useStore.getState().appState!;
    useStore.setState({
      appState: {
        ...state,
        memberships: [
          ...state.memberships.filter((m) => m.role !== 'dm'),
          {
            userId: 'other-dm',
            partyId: state.party.id,
            role: 'dm' as const,
            characterId: null,
            joinedAt: '2026-01-01T00:00:00.000Z',
            leftAt: null,
          } satisfies PartyMembership,
        ],
      },
    });
    renderInventory(inventoryStashId, characterId);

    // R9.3 — actions are in per-row kebab menus. All four rows share the
    // display name "Cloak of Protection", so their triggers are ambiguous
    // by name; index the trigger array. The fourth row (index 3) is the
    // un-attuned one and its Attune item must be aria-disabled (cap met +
    // player). Only one Radix menu can be open at a time, so open each
    // row's menu separately and Escape-close before the next.
    const triggers = screen.getAllByRole('button', {
      name: /actions for cloak of protection/i,
    });
    expect(triggers).toHaveLength(4);

    // Un-attuned row (index 3): shows a disabled "Attune" item.
    await user.click(triggers[3]!);
    const attuneItem = screen.getByRole('menuitem', { name: /^attune cloak of protection/i });
    expect(attuneItem).toHaveAttribute('aria-disabled', 'true');
    expect(
      screen.queryByRole('menuitem', { name: /^unattune cloak of protection/i }),
    ).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    // The three attuned rows (indexes 0-2) each show an "Unattune" item.
    for (let i = 0; i < 3; i += 1) {
      await user.click(triggers[i]!);
      expect(
        screen.getByRole('menuitem', { name: /^unattune cloak of protection/i }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('menuitem', { name: /^attune cloak of protection/i }),
      ).not.toBeInTheDocument();
      await user.keyboard('{Escape}');
    }
  });

  it('shows a toast (not an uncaught error) when the reducer rejects', async () => {
    // The pre-disable guard prevents the common over-cap click. To
    // exercise the toast path we simulate the race window: the row's
    // Attune menu item is opened while a free slot still exists (item
    // enabled), THEN the cap drops to 0 mid-session. `fireEvent.click`
    // (unlike userEvent) fires the already-mounted menu item's handler
    // even though React has re-rendered it as aria-disabled, so we reach
    // the dispatch and the reducer's reject surfaces as a toast.
    // R9.3 — the Attune toggle now lives in the row's kebab menu, so we
    // open the menu first (while still enabled) before firing the click.
    // R4.5 — force a non-DM actor so the click routes through the
    // reducer (not the cap-override dialog).
    const { characterId, inventoryStashId } = bootstrapWithMagicItems(1);
    const state = useStore.getState().appState!;
    useStore.setState({
      appState: {
        ...state,
        memberships: [
          ...state.memberships.filter((m) => m.role !== 'dm'),
          {
            userId: 'other-dm',
            partyId: state.party.id,
            role: 'dm' as const,
            characterId: null,
            joinedAt: '2026-01-01T00:00:00.000Z',
            leftAt: null,
          } satisfies PartyMembership,
        ],
      },
    });
    renderInventory(inventoryStashId, characterId);

    // Open the row menu while a slot is still free (item enabled).
    const user = userEvent.setup();
    await openRowMenu(user);
    const item = screen.getByRole('menuitem', { name: /^attune cloak of protection/i });
    expect(item).not.toHaveAttribute('aria-disabled', 'true');

    // Drop cap to 0 — re-render marks the (still-mounted) menu item
    // aria-disabled, but `fireEvent.click` bypasses that and reaches the
    // reducer, which rejects with the "no free attunement slot" message.
    void useStore
      .getState()
      .dispatch({ type: 'edit-character', payload: { characterId, patch: { maxAttunement: 0 } } });

    fireEvent.click(item); // bypass aria-disabled to hit the reducer

    expect(await screen.findByText(/no free attunement slot/i)).toBeInTheDocument();
  });

  it('Equip toggle dispatches equip and flips the menu item label', async () => {
    const user = userEvent.setup();
    const { characterId, inventoryStashId } = bootstrapWithTorches(1);
    renderInventory(inventoryStashId, characterId);

    // R9.3 — Equip is a menu item now: open the row menu, click Equip
    // (which closes the menu), then re-open and assert the label flipped
    // to "Unequip".
    await openRowMenu(user);
    await user.click(screen.getByRole('menuitem', { name: /^equip torch/i }));
    await openRowMenu(user);
    expect(screen.getByRole('menuitem', { name: /^unequip torch/i })).toBeInTheDocument();
  });

  // -------------------- R4.5 — attune cap-override for DMs --------------------

  it('R4.5 — DM sees a confirm dialog (not a disabled button) when cap is full, and confirming dispatches with overrideCap', async () => {
    // Solo bootstrap grants DM rights via §8.2. The Attune button on
    // the fourth row must remain clickable for DMs; clicking opens a
    // confirm dialog; confirming dispatches attune with overrideCap.
    const user = userEvent.setup();
    const { characterId, inventoryStashId } = bootstrapWithMagicItems(4);
    const ids = useStore
      .getState()
      .appState!.items.filter((i) => i.ownerId === inventoryStashId)
      .map((i) => i.id);
    for (let i = 0; i < 3; i += 1) {
      void useStore
        .getState()
        .dispatch({ type: 'attune', payload: { characterId, itemInstanceId: ids[i]! } });
    }
    renderInventory(inventoryStashId, characterId);

    // R9.3 — open the un-attuned row's kebab menu (index 3; all four rows
    // share the display name so triggers are ambiguous by name).
    const triggers = screen.getAllByRole('button', {
      name: /actions for cloak of protection/i,
    });
    await user.click(triggers[3]!);
    const attuneItem = screen.getByRole('menuitem', {
      name: /^attune cloak of protection/i,
    });
    // R4.5 flip: no longer disabled for DMs.
    expect(attuneItem).not.toHaveAttribute('aria-disabled', 'true');

    await user.click(attuneItem);
    // Confirm dialog appears.
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/attunement cap/i);
    expect(dialog).toHaveTextContent(/override/i);

    // Confirm.
    await user.click(screen.getByRole('button', { name: /confirm override/i }));

    // The fourth cloak is now attuned; log entry recorded overrideCap.
    const attunedCount = useStore
      .getState()
      .appState!.items.filter((i) => i.ownerId === inventoryStashId && i.attuned).length;
    expect(attunedCount).toBe(4);
    const lastAttuneEntry = useStore
      .getState()
      .log.filter((e) => e.type === 'attune')
      .slice(-1)[0];
    expect(lastAttuneEntry).toBeDefined();
    if (lastAttuneEntry?.type === 'attune') {
      expect(lastAttuneEntry.payload.overrideCap).toBe(true);
    }
  });

  it('R4.5 — cancelling the confirm dialog does NOT dispatch attune', async () => {
    const user = userEvent.setup();
    const { characterId, inventoryStashId } = bootstrapWithMagicItems(4);
    const ids = useStore
      .getState()
      .appState!.items.filter((i) => i.ownerId === inventoryStashId)
      .map((i) => i.id);
    for (let i = 0; i < 3; i += 1) {
      void useStore
        .getState()
        .dispatch({ type: 'attune', payload: { characterId, itemInstanceId: ids[i]! } });
    }
    renderInventory(inventoryStashId, characterId);

    // R9.3 — open the un-attuned row's kebab menu (index 3) and click Attune.
    const triggers = screen.getAllByRole('button', {
      name: /actions for cloak of protection/i,
    });
    await user.click(triggers[3]!);
    await user.click(screen.getByRole('menuitem', { name: /^attune cloak of protection/i }));
    await screen.findByRole('alertdialog');
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    // Still 3 attuned (unchanged).
    const attunedCount = useStore
      .getState()
      .appState!.items.filter((i) => i.ownerId === inventoryStashId && i.attuned).length;
    expect(attunedCount).toBe(3);
  });

  it('R4.5 — non-DM player in a 2+-member party still sees a disabled Attune menu item (no dialog)', async () => {
    const user = userEvent.setup();
    const { characterId, inventoryStashId } = bootstrapWithMagicItems(4);
    const ids = useStore
      .getState()
      .appState!.items.filter((i) => i.ownerId === inventoryStashId)
      .map((i) => i.id);
    for (let i = 0; i < 3; i += 1) {
      void useStore
        .getState()
        .dispatch({ type: 'attune', payload: { characterId, itemInstanceId: ids[i]! } });
    }
    // Force a 2-member party where the current user is a plain player
    // (drop their DM membership, add a second user's DM membership so
    // there's a DM elsewhere and the party is no longer solo).
    const state = useStore.getState().appState!;
    useStore.setState({
      appState: {
        ...state,
        memberships: [
          ...state.memberships.filter((m) => m.role !== 'dm'),
          {
            userId: 'other-dm',
            partyId: state.party.id,
            role: 'dm' as const,
            characterId: null,
            joinedAt: '2026-01-01T00:00:00.000Z',
            leftAt: null,
          } satisfies PartyMembership,
        ],
      },
    });
    renderInventory(inventoryStashId, characterId);

    // R9.3 — open the un-attuned row's kebab menu (index 3). The Attune
    // item is aria-disabled for a plain player at cap, and no dialog opens.
    const triggers = screen.getAllByRole('button', {
      name: /actions for cloak of protection/i,
    });
    await user.click(triggers[3]!);
    const attuneItem = screen.getByRole('menuitem', {
      name: /^attune cloak of protection/i,
    });
    expect(attuneItem).toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByRole('alertdialog')).toBeNull();
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
    void useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: backpack.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    const backpackId = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === backpack.id)!.id;
    void useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: rations.id,
        quantity: 1,
        source: 'catalog-add',
        notes: 'inside-pack',
        ...acquireIds(),
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
      <MemoryRouter
        initialEntries={[
          `/party/${useStore.getState().appState?.party.id ?? 'test-party'}/character/test`,
        ]}
      >
        <Routes>
          <Route
            path="/party/:partyId/character/:id"
            element={
              <>
                <StashItemsTable stashId={inventoryStashId} characterId={characterId} />
                <Toaster />
              </>
            }
          />
        </Routes>
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

  it('hides the Pack menu item when no containers are in the stash', async () => {
    const user = userEvent.setup();
    const { stashId } = setupWith(1); // just a torch, no containers
    renderTable(stashId);
    await openRowMenu(user);
    expect(screen.queryByRole('menuitem', { name: /^pack torch/i })).not.toBeInTheDocument();
  });

  it('shows the Pack menu item on free top-level items when a container exists', async () => {
    const user = userEvent.setup();
    const { inventoryStashId, catalog } = bootstrap();
    const backpack = catalog.find((d) => d.id === 'phb-2024:backpack')!;
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    void useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: backpack.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    void useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    renderTable(inventoryStashId);
    // R9.3 — Pack is a menu item on the Torch row's kebab menu.
    await openRowMenu(user, /actions for torch/i);
    expect(screen.getByRole('menuitem', { name: /^pack torch/i })).toBeInTheDocument();
  });

  it('hides Pack on the container row itself (no container-in-container per §3.6)', async () => {
    const user = userEvent.setup();
    const { inventoryStashId, catalog } = bootstrap();
    const backpack = catalog.find((d) => d.id === 'phb-2024:backpack')!;
    // Two backpacks so a candidate container exists in the stash, but
    // the container row itself shouldn't get a Pack action (avoids the
    // illegal "pack backpack into backpack" combo even though the
    // reducer would reject it).
    void useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: backpack.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    void useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: backpack.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    renderTable(inventoryStashId);
    // Both rows share the "Backpack" display name — open the first row's
    // menu and assert no Pack item.
    const triggers = screen.getAllByRole('button', { name: /actions for backpack/i });
    await user.click(triggers[0]!);
    expect(screen.queryByRole('menuitem', { name: /^pack backpack/i })).not.toBeInTheDocument();
  });

  it('opens PackItemModal when Pack is clicked, dispatches transfer with toContainerInstanceId', async () => {
    const user = userEvent.setup();
    const { inventoryStashId, catalog } = bootstrap();
    const backpack = catalog.find((d) => d.id === 'phb-2024:backpack')!;
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    void useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: backpack.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    void useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    const backpackId = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === backpack.id)!.id;
    const torchId = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === torch.id)!.id;
    renderTable(inventoryStashId);

    // R9.3 — Pack is a menu item; open the Torch row's menu then click it.
    await openRowMenu(user, /actions for torch/i);
    await user.click(screen.getByRole('menuitem', { name: /^pack torch/i }));
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
    void useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: backpack.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    void useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    const backpackId = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === backpack.id)!.id;
    const torchId = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === torch.id)!.id;
    // Pack via reducer so the UI test starts in "torch inside backpack" state.
    void useStore.getState().dispatch({
      type: 'transfer',
      payload: {
        itemInstanceId: torchId,
        toStashId: inventoryStashId,
        quantity: 1,
        toContainerInstanceId: backpackId,
        ...transferIds(),
      },
    });

    render(
      <MemoryRouter
        initialEntries={[
          `/party/${useStore.getState().appState?.party.id ?? 'test-party'}/character/test`,
        ]}
      >
        <Routes>
          <Route
            path="/party/:partyId/character/:id"
            element={
              <>
                <StashItemsTable stashId={inventoryStashId} characterId={characterId} />
                <Toaster />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    // R9.3 — Take out is a menu item. The backpack row's menu has none;
    // the torch row's menu has one, and clicking it dispatches the
    // take-out transfer.
    await openRowMenu(user, /actions for backpack/i);
    expect(screen.queryByRole('menuitem', { name: /take backpack/i })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');

    await openRowMenu(user, /actions for torch/i);
    expect(screen.getByRole('menuitem', { name: /take torch/i })).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: /take torch/i }));
    const torchAfter = useStore.getState().appState!.items.find((i) => i.id === torchId)!;
    expect(torchAfter.containerInstanceId).toBeNull();
  });

  it('renders the "N items inside" summary on container rows with contents', () => {
    const { characterId, inventoryStashId, catalog } = bootstrap();
    const backpack = catalog.find((d) => d.id === 'phb-2024:backpack')!;
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    void useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: backpack.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    void useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 3,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    const backpackId = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === backpack.id)!.id;
    const torchId = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === torch.id)!.id;
    void useStore.getState().dispatch({
      type: 'transfer',
      payload: {
        itemInstanceId: torchId,
        toStashId: inventoryStashId,
        quantity: 3,
        toContainerInstanceId: backpackId,
        ...transferIds(),
      },
    });

    render(
      <MemoryRouter
        initialEntries={[
          `/party/${useStore.getState().appState?.party.id ?? 'test-party'}/character/test`,
        ]}
      >
        <Routes>
          <Route
            path="/party/:partyId/character/:id"
            element={
              <>
                <StashItemsTable stashId={inventoryStashId} characterId={characterId} />
                <Toaster />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    // Summary reads "— 3 items inside" (sum of child quantities, not row count).
    expect(screen.getByText(/3 items inside/i)).toBeInTheDocument();
  });

  it('hides Take out when the parent is in a different stash (dangling reference)', async () => {
    // Defensive UI filter: a row whose `containerInstanceId` points at
    // a row in a DIFFERENT stash is not actually contained from the
    // user's perspective — the parent isn't visible here, so a
    // "Take out" action would be confusing. The R1.5 reducer's
    // orphan-drop usually prevents this state, but partial states
    // (legacy JSON imports, manual DevTools pokes) could still trip it.
    const user = userEvent.setup();
    const { characterId, inventoryStashId, partyStashId, catalog } = bootstrap();
    const backpack = catalog.find((d) => d.id === 'phb-2024:backpack')!;
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    void useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: backpack.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    void useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: partyStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    const backpackId = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === backpack.id)!.id;
    const torchId = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === torch.id)!.id;
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
      <MemoryRouter
        initialEntries={[
          `/party/${useStore.getState().appState?.party.id ?? 'test-party'}/character/test`,
        ]}
      >
        <Routes>
          <Route
            path="/party/:partyId/character/:id"
            element={
              <>
                <StashItemsTable stashId={partyStashId} characterId={characterId} />
                <Toaster />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    // Torch renders top-level (no Take out, because the backpack isn't here).
    expect(screen.getByText('Torch')).toBeInTheDocument();
    await openRowMenu(user, /actions for torch/i);
    expect(screen.queryByRole('menuitem', { name: /take torch/i })).not.toBeInTheDocument();
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
      <MemoryRouter
        initialEntries={[
          `/party/${useStore.getState().appState?.party.id ?? 'test-party'}/character/test`,
        ]}
      >
        <Routes>
          <Route
            path="/party/:partyId/character/:id"
            element={
              <>
                <StashItemsTable stashId={stashId} characterId={characterId} />
                <Toaster />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('hides the Attune menu item on a mundane PHB row (Torch) but shows Equip', async () => {
    const user = userEvent.setup();
    const { characterId, inventoryStashId, catalog } = bootstrap();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    void useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });

    renderInventory(inventoryStashId, characterId);

    // R9.3 — Equip / Attune are menu items; open the Torch row's menu.
    await openRowMenu(user);
    expect(screen.getByRole('menuitem', { name: /^equip torch/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /^attune torch/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /^unattune torch/i })).not.toBeInTheDocument();
  });

  it('shows both Equip and Attune on a DMG row with requiresAttunement:true', async () => {
    const user = userEvent.setup();
    const { characterId, inventoryStashId, catalog } = bootstrap();
    const magic = catalog.find((d) => d.id === 'dmg-2024:cloak-of-protection')!;
    void useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: magic.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });

    renderInventory(inventoryStashId, characterId);

    await openRowMenu(user);
    expect(
      screen.getByRole('menuitem', { name: /^equip cloak of protection/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: /^attune cloak of protection/i }),
    ).toBeInTheDocument();
  });

  it('renders the rarity dot prefix on a DMG row (Uncommon class)', () => {
    const { characterId, inventoryStashId, catalog } = bootstrap();
    const magic = catalog.find((d) => d.id === 'dmg-2024:cloak-of-protection')!;
    void useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: magic.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });

    renderInventory(inventoryStashId, characterId);

    // The rarity dot is a small span labelled with the rarity name.
    expect(screen.getByLabelText('Rarity: Uncommon')).toBeInTheDocument();
  });
});

describe('StashItemsTable — R2.2 charges indicator', () => {
  /**
   * R2.2 — when a row's definition has a `charges` block AND the row
   * is in an Inventory stash (currentCharges !== null), the row name
   * gets a compact `(N/M)` suffix labelled "Charges: N/M". Mundane
   * rows show no indicator.
   */
  function renderInventory(stashId: string, characterId: string): void {
    render(
      <MemoryRouter
        initialEntries={[
          `/party/${useStore.getState().appState?.party.id ?? 'test-party'}/character/test`,
        ]}
      >
        <Routes>
          <Route
            path="/party/:partyId/character/:id"
            element={
              <>
                <StashItemsTable stashId={stashId} characterId={characterId} />
                <Toaster />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('shows the (N/M) charges indicator on a Wand row in Inventory', () => {
    const { characterId, inventoryStashId, catalog } = bootstrap();
    const wand = catalog.find((d) => d.id === 'dmg-2024:wand-of-magic-missiles')!;
    void useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: wand.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    renderInventory(inventoryStashId, characterId);
    expect(screen.getByLabelText(/Charges: 7\/7/)).toBeInTheDocument();
  });

  it('does NOT show a charges indicator on a mundane Torch row', () => {
    const { characterId, inventoryStashId, catalog } = bootstrap();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    void useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    renderInventory(inventoryStashId, characterId);
    expect(screen.queryByLabelText(/^Charges:/)).not.toBeInTheDocument();
  });
});

describe('StashItemsTable — R2.3 unidentified display gate', () => {
  /**
   * R2.3 — rows with `identified: false` render as "Unknown Magic Item"
   * (OUTLINE §8 display invariant) with a `?` glyph instead of the
   * rarity dot. Charges indicator and `customName` are also suppressed
   * because both reveal magic-item-ness.
   */
  function renderInventory(stashId: string, characterId: string): void {
    render(
      <MemoryRouter
        initialEntries={[
          `/party/${useStore.getState().appState?.party.id ?? 'test-party'}/character/test`,
        ]}
      >
        <Routes>
          <Route
            path="/party/:partyId/character/:id"
            element={
              <>
                <StashItemsTable stashId={stashId} characterId={characterId} />
                <Toaster />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('renders an identified magic-item row with the real name + rarity dot', () => {
    const { characterId, inventoryStashId, catalog } = bootstrap();
    const cloak = catalog.find((d) => d.id === 'dmg-2024:cloak-of-protection')!;
    void useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: cloak.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    renderInventory(inventoryStashId, characterId);
    expect(
      screen.getByRole('button', { name: /open details for cloak of protection/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Rarity: Uncommon')).toBeInTheDocument();
    expect(screen.queryByLabelText('Unidentified')).not.toBeInTheDocument();
  });

  it('renders an unidentified magic-item row as "Unknown Magic Item" with the ? glyph', () => {
    const { characterId, inventoryStashId, catalog } = bootstrap();
    const cloak = catalog.find((d) => d.id === 'dmg-2024:cloak-of-protection')!;
    void useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: cloak.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    const itemId = useStore.getState().appState!.items.find((i) => i.definitionId === cloak.id)!.id;
    void useStore.getState().dispatch({
      type: 'identify',
      payload: { itemInstanceId: itemId, identified: false, hint: 'shimmers faintly' },
    });
    renderInventory(inventoryStashId, characterId);

    expect(
      screen.getByRole('button', { name: /open details for unknown magic item/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Cloak of Protection')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Unidentified')).toBeInTheDocument();
    expect(screen.queryByLabelText('Rarity: Uncommon')).not.toBeInTheDocument();
  });

  it('hides the charges indicator on an unidentified Inventory wand', () => {
    const { characterId, inventoryStashId, catalog } = bootstrap();
    const wand = catalog.find((d) => d.id === 'dmg-2024:wand-of-magic-missiles')!;
    void useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: wand.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    const wandId = useStore.getState().appState!.items.find((i) => i.definitionId === wand.id)!.id;
    void useStore.getState().dispatch({
      type: 'identify',
      payload: { itemInstanceId: wandId, identified: false },
    });
    renderInventory(inventoryStashId, characterId);
    // The R2.2 charges indicator is gone (would say "Charges: 7/7" if identified).
    expect(screen.queryByLabelText(/^Charges:/)).not.toBeInTheDocument();
  });
});

// -------------------- R7.5 — fuzzy filter --------------------

describe('StashItemsTable — fuzzy filter (R7.5)', () => {
  function renderWithQuery(stashId: string, query: string): { rerender: (next: string) => void } {
    const partyId = useStore.getState().appState?.party.id ?? 'test-party';
    const { rerender } = render(
      <MemoryRouter initialEntries={[`/party/${partyId}/character/test`]}>
        <Routes>
          <Route
            path="/party/:partyId/character/:id"
            element={<StashItemsTable stashId={stashId} query={query} />}
          />
        </Routes>
      </MemoryRouter>,
    );
    return {
      rerender: (next: string) => {
        rerender(
          <MemoryRouter initialEntries={[`/party/${partyId}/character/test`]}>
            <Routes>
              <Route
                path="/party/:partyId/character/:id"
                element={<StashItemsTable stashId={stashId} query={next} />}
              />
            </Routes>
          </MemoryRouter>,
        );
      },
    };
  }

  it('empty query renders every row (undefined and "" are equivalent no-ops)', () => {
    const { inventoryStashId, catalog } = bootstrap();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    const rope = catalog.find((d) => d.id === 'phb-2024:rope-hempen-50ft')!;
    void useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    void useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: rope.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    renderWithQuery(inventoryStashId, '');
    expect(screen.getByRole('button', { name: /open details for torch/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open details for.*rope/i })).toBeInTheDocument();
  });

  it('filters visible rows by name (torch keeps, rope drops)', () => {
    const { inventoryStashId, catalog } = bootstrap();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    const rope = catalog.find((d) => d.id === 'phb-2024:rope-hempen-50ft')!;
    void useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    void useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: rope.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    renderWithQuery(inventoryStashId, 'torch');
    expect(screen.getByRole('button', { name: /open details for torch/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open details for.*rope/i })).toBeNull();
  });

  it('shows the empty-state hint when the filter drops every row', () => {
    const { inventoryStashId, catalog } = bootstrap();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    void useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    renderWithQuery(inventoryStashId, 'zzzznothingmatchesthis');
    expect(screen.getByText(/no items match your search/i)).toBeInTheDocument();
  });

  it('respects OUTLINE §8: unidentified row is NOT findable by its real name', () => {
    const { inventoryStashId, catalog } = bootstrap();
    const wand = catalog.find((d) => d.id === 'dmg-2024:wand-of-magic-missiles')!;
    void useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: wand.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    const wandRowId = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === wand.id)!.id;
    // Mark unidentified with a DM hint.
    void useStore.getState().dispatch({
      type: 'identify',
      payload: { itemInstanceId: wandRowId, identified: false, hint: 'smells of ozone' },
    });

    // Search for the real name — should MISS.
    renderWithQuery(inventoryStashId, 'wand');
    expect(screen.queryByRole('button', { name: /open details for/i })).toBeNull();
    expect(screen.getByText(/no items match your search/i)).toBeInTheDocument();
  });

  it('unidentified row IS findable by the hint text', () => {
    const { inventoryStashId, catalog } = bootstrap();
    const wand = catalog.find((d) => d.id === 'dmg-2024:wand-of-magic-missiles')!;
    void useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: wand.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    const wandRowId = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === wand.id)!.id;
    void useStore.getState().dispatch({
      type: 'identify',
      payload: { itemInstanceId: wandRowId, identified: false, hint: 'smells of ozone' },
    });

    renderWithQuery(inventoryStashId, 'ozone');
    // "Unknown Magic Item" label rendered (the identify display invariant).
    expect(
      screen.getByRole('button', { name: /open details for unknown magic item/i }),
    ).toBeInTheDocument();
  });
});
