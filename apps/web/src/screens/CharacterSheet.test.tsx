import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { CharacterSheet } from './CharacterSheet';
import { ItemDetail } from './ItemDetail';
import { newUuidV7 } from '@app/shared';
import type { Character, PartyMembership, Stash } from '@app/shared';
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
function createStashIds() {
  return { newStashId: newUuidV7(), newCurrencyHoldingId: newUuidV7() };
}
function createCharacterIds() {
  return {
    newCharacterId: newUuidV7(),
    newInventoryStashId: newUuidV7(),
    newCurrencyHoldingId: newUuidV7(),
    newUserId: newUuidV7(),
    newPartyId: newUuidV7(),
    newPartyStashId: newUuidV7(),
    newRecoveredLootStashId: newUuidV7(),
    newPartyStashCurrencyId: newUuidV7(),
    newRecoveredLootCurrencyId: newUuidV7(),
  };
}

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

/**
 * Component test for the M1 happy path: after dispatching create-character,
 * CharacterSheet renders the header from the store. Uses a memory router
 * pinned at /character/:id so we don't depend on jsdom history globals.
 *
 * ItemDetail is registered too so the M2.5 "row name → /item/:id"
 * navigation test can verify the destination renders.
 */
/**
 * RH4.1 — path arg is the pre-URL-scoping path (e.g. `/character/:id`
 * or `/item/:itemInstanceId`). Rewritten to `/party/:partyId/...` using
 * the currently-bootstrapped party's id. Callers stay untouched — the
 * per-test call sites don't need to know the partyId.
 */
function renderAt(path: string): void {
  const partyId = useStore.getState().appState?.party.id;
  const prefixed =
    partyId !== undefined && (path.startsWith('/character') || path.startsWith('/item'))
      ? `/party/${partyId}${path}`
      : path;
  const router = createMemoryRouter(
    [
      { path: '/', element: null },
      { path: '/party/:partyId/character/:id', Component: CharacterSheet },
      { path: '/party/:partyId/item/:itemInstanceId', Component: ItemDetail },
    ],
    { initialEntries: [prefixed] },
  );
  render(<RouterProvider router={router} />);
}

describe('CharacterSheet (M1)', () => {
  it('renders the character header after create-character', () => {
    useStore.getState().dispatch({
      type: 'create-character',
      payload: {
        name: 'Thorin',
        species: 'Dwarf',
        size: 'medium',
        class: 'Fighter',
        level: 3,
        str: 16,
        ...createCharacterIds(),
      },
    });
    const id = useStore.getState().appState!.characters[0]!.id;

    renderAt(`/character/${id}`);

    expect(screen.getByRole('heading', { name: 'Thorin' })).toBeInTheDocument();
    expect(screen.getByText(/Level 3 Dwarf Fighter/)).toBeInTheDocument();
    expect(screen.getByText(/STR 16/)).toBeInTheDocument();
  });

  it('renders all four tabs', () => {
    useStore.getState().dispatch({
      type: 'create-character',
      payload: {
        name: 'A',
        species: 'B',
        size: 'medium',
        class: 'C',
        level: 1,
        str: 10,
        ...createCharacterIds(),
      },
    });
    const id = useStore.getState().appState!.characters[0]!.id;

    renderAt(`/character/${id}`);

    expect(screen.getByRole('tab', { name: 'Inventory' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Storage' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Party Stash' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Recovered Loot' })).toBeInTheDocument();
  });

  it('redirects to / when the character id is unknown', () => {
    renderAt('/character/does-not-exist');
    // CharacterSheet renders its own h1 from the character name; if the redirect fires,
    // we land on "/" (the test stub renders nothing) and that heading isn't present.
    expect(screen.queryByRole('tab', { name: 'Inventory' })).not.toBeInTheDocument();
  });
});

describe('CharacterSheet (M2)', () => {
  it('renders an empty-state for the Inventory tab when nothing has been acquired', () => {
    const { characterId: id } = bootstrap();
    renderAt(`/character/${id}`);

    expect(screen.getByText(/Nothing here yet/i)).toBeInTheDocument();
  });

  it('shows an acquired item row with the correct name and qty', () => {
    const { characterId: id, inventoryStashId } = bootstrap();
    const torch = useStore.getState().appState!.catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 3,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });

    renderAt(`/character/${id}`);

    const row = screen.getByText('Torch').closest('tr');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('3')).toBeInTheDocument();
  });

  it('auto-stacks: two acquires of the same item yield one row, qty 2', () => {
    const { characterId: id, inventoryStashId } = bootstrap();
    const torch = useStore.getState().appState!.catalog.find((d) => d.id === 'phb-2024:torch')!;
    const { dispatch } = useStore.getState();
    dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });

    renderAt(`/character/${id}`);

    const torchRows = screen.getAllByText('Torch');
    expect(torchRows).toHaveLength(1);
    const row = torchRows[0]!.closest('tr');
    expect(within(row!).getByText('2')).toBeInTheDocument();
  });

  it('clicking − dispatches consume and updates the DOM', async () => {
    const user = userEvent.setup();
    const { characterId: id, inventoryStashId } = bootstrap();
    const torch = useStore.getState().appState!.catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 2,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });

    renderAt(`/character/${id}`);

    await user.click(screen.getByRole('button', { name: /Decrease Torch/ }));

    const row = screen.getByText('Torch').closest('tr');
    expect(within(row!).getByText('1')).toBeInTheDocument();
  });

  it('Storage tab renders the empty-state when no Storage stashes exist (M3)', async () => {
    const user = userEvent.setup();
    const { characterId: id } = bootstrap();
    renderAt(`/character/${id}`);

    await user.click(screen.getByRole('tab', { name: 'Storage' }));

    expect(screen.getByText(/no storage stashes yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new storage stash/i })).toBeInTheDocument();
  });

  it('Storage tab lists a Storage stash card after one is created (M3)', async () => {
    const user = userEvent.setup();
    const { characterId: id } = bootstrap();
    useStore.getState().dispatch({
      type: 'create-stash',
      payload: {
        ownerCharacterId: id,
        name: 'Vault of Waterdeep',
        ...createStashIds(),
        ...createStashIds(),
        ...createStashIds(),
      },
    });
    renderAt(`/character/${id}`);

    await user.click(screen.getByRole('tab', { name: 'Storage' }));

    expect(screen.getByText('Vault of Waterdeep')).toBeInTheDocument();
  });

  it('clicking a row name navigates to /item/:id (M2.5)', async () => {
    const user = userEvent.setup();
    const { characterId: id, inventoryStashId } = bootstrap();
    const torch = useStore.getState().appState!.catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });

    renderAt(`/character/${id}`);

    // The row name renders as a button — click it.
    await user.click(screen.getByRole('button', { name: /open details for torch/i }));

    // After navigation the ItemDetail screen renders the same name as an h1.
    expect(screen.getByRole('heading', { name: 'Torch' })).toBeInTheDocument();
  });
});

describe('CharacterSheet (M4)', () => {
  it('renders a CurrencyRow on the Inventory tab', () => {
    useStore.getState().dispatch({
      type: 'create-character',
      payload: {
        name: 'A',
        species: 'B',
        size: 'medium',
        class: 'C',
        level: 1,
        str: 10,
        ...createCharacterIds(),
      },
    });
    const id = useStore.getState().appState!.characters[0]!.id;
    renderAt(`/character/${id}`);

    // The CurrencyRow renders a "Currency" header and a Convert button.
    expect(screen.getByRole('heading', { name: /^currency$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /convert/i })).toBeInTheDocument();
    expect(screen.getByText(/total: 0 gp/i)).toBeInTheDocument();
  });

  it('clicking + on a denomination dispatches a currency-change with reason=deposit', async () => {
    const user = userEvent.setup();
    useStore.getState().dispatch({
      type: 'create-character',
      payload: {
        name: 'A',
        species: 'B',
        size: 'medium',
        class: 'C',
        level: 1,
        str: 10,
        ...createCharacterIds(),
      },
    });
    const id = useStore.getState().appState!.characters[0]!.id;
    renderAt(`/character/${id}`);

    const beforeLen = useStore.getState().log.length;
    await user.click(screen.getByLabelText(/increment gp/i));

    const newEntries = useStore.getState().log.slice(beforeLen);
    expect(newEntries).toHaveLength(1);
    const entry = newEntries[0]!;
    expect(entry.type).toBe('currency-change');
    if (entry.type !== 'currency-change') throw new Error('expected currency-change');
    expect(entry.payload.delta).toEqual({ cp: 0, sp: 0, ep: 0, gp: 1, pp: 0 });
    expect(entry.payload.reason).toBe('deposit');
  });
});

describe('CharacterSheet — R2.2 Rest dropdown', () => {
  /**
   * R2.2 — header gains a "Rest" button. Click opens a DropdownMenu with
   * four batch triggers (Short Rest / Long Rest / Dawn / Dusk) plus a
   * disabled Custom… entry. Each non-Custom item dispatches a
   * `recharge` action with `mode: 'batch'` for the matching trigger,
   * and the eligibility count (computed client-side from the rules
   * helper) drives a toast.
   *
   * Tests need the Toaster in the tree so `toast.success` / `toast.info`
   * surface as DOM. The base `renderAt` doesn't include it — these tests
   * use a local renderer.
   */
  function renderWithToaster(path: string): void {
    const partyId = useStore.getState().appState?.party.id;
    const prefixed =
      partyId !== undefined && (path.startsWith('/character') || path.startsWith('/item'))
        ? `/party/${partyId}${path}`
        : path;
    const router = createMemoryRouter(
      [
        { path: '/', element: null },
        { path: '/party/:partyId/character/:id', Component: CharacterSheet },
        { path: '/party/:partyId/item/:itemInstanceId', Component: ItemDetail },
      ],
      { initialEntries: [prefixed] },
    );
    render(
      <>
        <RouterProvider router={router} />
        <Toaster />
      </>,
    );
  }

  function setupCharacterWithWand(): { characterId: string } {
    const base = bootstrap();
    const wand = base.catalog.find((d) => d.id === 'dmg-2024:wand-of-magic-missiles')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: base.inventoryStashId,
        definitionId: wand.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    return { characterId: base.characterId };
  }

  it('renders a Rest button in the header', () => {
    const { characterId } = setupCharacterWithWand();
    renderWithToaster(`/character/${characterId}`);
    expect(screen.getByRole('button', { name: /^rest$/i })).toBeInTheDocument();
  });

  it('opens the menu with all four batch triggers + disabled Custom on click', async () => {
    const user = userEvent.setup();
    const { characterId } = setupCharacterWithWand();
    renderWithToaster(`/character/${characterId}`);

    await user.click(screen.getByRole('button', { name: /^rest$/i }));

    expect(await screen.findByRole('menuitem', { name: /short rest/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /long rest/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /^dawn$/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /^dusk$/i })).toBeInTheDocument();
    const customItem = screen.getByRole('menuitem', { name: /custom/i });
    expect(customItem).toHaveAttribute('aria-disabled', 'true');
  });

  it('clicking Dawn with a formula-bearing eligible item opens the RestRollModal', async () => {
    const user = userEvent.setup();
    const { characterId } = setupCharacterWithWand();
    // Spend a charge so the wand is eligible for recharge (not at max).
    const wandId = useStore.getState().appState!.items[0]!.id;
    useStore.getState().dispatch({
      type: 'use-charge',
      payload: { itemInstanceId: wandId, characterId },
    });

    renderWithToaster(`/character/${characterId}`);

    await user.click(screen.getByRole('button', { name: /^rest$/i }));
    await user.click(await screen.findByRole('menuitem', { name: /^dawn$/i }));

    // Modal opens with the wand listed.
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/dawn — roll for recharge/i)).toBeInTheDocument();
    // No dispatch yet — wand still at 6/7.
    expect(useStore.getState().appState!.items.find((i) => i.id === wandId)!.currentCharges).toBe(
      6,
    );

    // Enter a roll value and apply.
    const input = screen.getByLabelText(/roll result for wand of magic missiles/i);
    await user.type(input, '1');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));

    // Wand recharged by 1, toast displayed.
    expect(useStore.getState().appState!.items.find((i) => i.id === wandId)!.currentCharges).toBe(
      7,
    );
    expect(await screen.findByText(/1 item recharged/i)).toBeInTheDocument();
  });

  it('clicking Long Rest with no eligible items shows the "no items" info toast', async () => {
    const user = userEvent.setup();
    // No charged items in Inventory — just the bootstrap baseline.
    const base = bootstrap();
    renderWithToaster(`/character/${base.characterId}`);

    await user.click(screen.getByRole('button', { name: /^rest$/i }));
    await user.click(await screen.findByRole('menuitem', { name: /long rest/i }));

    expect(await screen.findByText(/no items needed recharging/i)).toBeInTheDocument();
  });

  it('clicking a trigger with only non-formula eligible items dispatches immediately (no modal)', async () => {
    const user = userEvent.setup();
    const base = bootstrap();
    // Decanter of Endless Water: dawn rule, NO rechargeAmount.
    const decanter = base.catalog.find((d) => d.id === 'dmg-2024:decanter-of-endless-water')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: base.inventoryStashId,
        definitionId: decanter.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    const decanterId = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === decanter.id)!.id;
    useStore.getState().dispatch({
      type: 'use-charge',
      payload: { itemInstanceId: decanterId, characterId: base.characterId },
    });

    renderWithToaster(`/character/${base.characterId}`);

    await user.click(screen.getByRole('button', { name: /^rest$/i }));
    await user.click(await screen.findByRole('menuitem', { name: /^dawn$/i }));

    // No modal — dispatched immediately.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      useStore.getState().appState!.items.find((i) => i.id === decanterId)!.currentCharges,
    ).toBe(decanter.charges!.max);
    expect(await screen.findByText(/1 item recharged/i)).toBeInTheDocument();
  });
});

// -------------------------------------------------------------------- //
// R4.5 — cross-character DM cue
// -------------------------------------------------------------------- //

describe('CharacterSheet — R4.5 cross-character DM cue', () => {
  it("shows an editing-cue banner when a DM views another player's character", () => {
    // Bootstrap gives a solo party with u1 as DM+player of char-me.
    // Convert to a 2-member party where the DM (me) is viewing another
    // player's character (Bob).
    const base = bootstrap();
    const state = useStore.getState().appState!;
    const bobCharId = 'char-bob';
    const bobMembership: PartyMembership = {
      userId: 'bob-user',
      partyId: state.party.id,
      role: 'player',
      characterId: bobCharId,
      joinedAt: '2026-01-01T00:00:00.000Z',
      leftAt: null,
    };
    const bobCharacter: Character = {
      id: bobCharId,
      partyId: state.party.id,
      ownerUserId: 'bob-user',
      name: 'Bob',
      species: 'Elf',
      size: 'medium',
      class: 'Rogue',
      level: 3,
      abilityScores: { STR: 8 },
      maxAttunement: 3,
      encumbranceRule: 'off',
      enforceEncumbrance: false,
      inventoryStashId: 's-inv-bob',
    };
    const bobStash: Stash = {
      id: 's-inv-bob',
      scope: 'character',
      name: 'Inventory',
      ownerCharacterId: bobCharId,
      partyId: null,
      isCarried: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    useStore.setState({
      appState: {
        ...state,
        memberships: [...state.memberships, bobMembership],
        characters: [...state.characters, bobCharacter],
        stashes: [...state.stashes, bobStash],
        currencies: [
          ...state.currencies,
          { id: 'c-bob', stashId: 's-inv-bob', cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
        ],
      },
    });
    void base;

    renderAt(`/character/${bobCharId}`);

    const cue = screen.getByRole('note');
    expect(cue).toHaveTextContent(/editing/i);
    expect(cue).toHaveTextContent(/bob/i);
  });

  it('does NOT show the cue on my own character', () => {
    const base = bootstrap();
    renderAt(`/character/${base.characterId}`);
    expect(screen.queryByRole('note')).toBeNull();
  });

  it("does NOT show the cue for a non-DM viewer looking at another player's character", () => {
    // Solo bootstrap, then flip actor to non-DM AND change owner of the
    // current character to someone else. The cue should still not show
    // because the viewer isn't the DM.
    const base = bootstrap();
    const state = useStore.getState().appState!;
    useStore.setState({
      appState: {
        ...state,
        // Drop the DM row so the viewer is a plain player.
        memberships: state.memberships.filter((m) => m.role !== 'dm'),
        // Retag character ownership to a stranger (so it looks
        // cross-character) AND add a second membership so we're not solo.
        characters: [
          {
            ...state.characters[0]!,
            ownerUserId: 'stranger',
          },
        ],
      },
    });
    // Add a second member so isSolo becomes false.
    const s2 = useStore.getState().appState!;
    const strangerMembership: PartyMembership = {
      userId: 'stranger',
      partyId: s2.party.id,
      role: 'player',
      characterId: s2.characters[0]!.id,
      joinedAt: '2026-01-01T00:00:00.000Z',
      leftAt: null,
    };
    useStore.setState({
      appState: {
        ...s2,
        memberships: [...s2.memberships, strangerMembership],
      },
    });
    renderAt(`/character/${base.characterId}`);
    expect(screen.queryByRole('note')).toBeNull();
  });
});
