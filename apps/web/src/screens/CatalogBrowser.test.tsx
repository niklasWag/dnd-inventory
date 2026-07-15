import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { CatalogBrowser } from './CatalogBrowser';
import { Toaster } from '@/components/ui/sonner';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';
import { SEED_VERSION, loadPhbSeed } from '@app/seeds';
import { bootstrap, bootstrapWithHomebrew } from '@/test/fixtures';
import { newUuidV7 } from '@app/shared';

/**
 * RH1.2 — id-injection helpers for direct `dispatch` sites. Fresh UUID
 * v7 per call keeps the fixture within the guard's clock-skew window
 * and hermetic per-test.
 */
function acquireIds() {
  return { newItemInstanceId: newUuidV7() };
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

function renderBrowser(): void {
  const router = createMemoryRouter([{ path: '/catalog', Component: CatalogBrowser }], {
    initialEntries: ['/catalog'],
  });
  render(
    <>
      <RouterProvider router={router} />
      <Toaster />
    </>,
  );
}

describe('CatalogBrowser', () => {
  it('renders the empty-state when there is no AppState (regression: was infinite-looping)', () => {
    // Pre-character-creation: appState is null. Selectors must return a
    // stable reference for the empty case, otherwise Zustand re-renders
    // forever ("Maximum update depth exceeded").
    expect(() => {
      renderBrowser();
    }).not.toThrow();

    expect(screen.getByRole('heading', { name: /catalog/i })).toBeInTheDocument();
    expect(screen.getByText(/Catalog is empty/i)).toBeInTheDocument();
  });

  it('renders the full PHB list when the catalog is seeded', () => {
    void useStore.getState().dispatch({
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
    void useStore.getState().dispatch({
      type: 'seed-catalog',
      payload: { seedVersion: SEED_VERSION, entries: loadPhbSeed() },
    });

    renderBrowser();

    expect(screen.getByText('Torch')).toBeInTheDocument();
    expect(screen.getByText('Longsword')).toBeInTheDocument();
  });

  it('PHB rows show a Duplicate button (M6)', () => {
    bootstrap();
    renderBrowser();
    // Use one specific PHB row's Duplicate button to avoid the
    // hundreds of identical buttons across the list.
    expect(screen.getByRole('button', { name: /duplicate torch$/i })).toBeInTheDocument();
  });

  it('homebrew rows show Edit + Delete buttons; PHB rows do not (M6)', () => {
    bootstrapWithHomebrew({ name: 'Mushroom' });
    renderBrowser();

    // Filter to the homebrew row by typing in the search box.
    expect(screen.getByRole('button', { name: /edit mushroom/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete mushroom/i })).toBeInTheDocument();
  });

  it('clicking Duplicate on a PHB row opens HomebrewForm in duplicate mode pre-filled (M6)', async () => {
    const user = userEvent.setup();
    bootstrap();
    renderBrowser();

    await user.click(screen.getByRole('button', { name: /duplicate torch$/i }));

    // Form dialog is up; its name field is pre-filled with "Torch".
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/^name$/i)).toHaveValue('Torch');
    // Submit label reads "Duplicate".
    expect(screen.getByRole('button', { name: /^duplicate$/i })).toBeInTheDocument();
  });

  it('submitting Duplicate creates a homebrew row with duplicatedFromId (M6)', async () => {
    const user = userEvent.setup();
    const { catalog } = bootstrap();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    renderBrowser();

    await user.click(screen.getByRole('button', { name: /duplicate torch$/i }));
    await user.click(screen.getByRole('button', { name: /^duplicate$/i }));

    const homebrew = useStore
      .getState()
      .appState!.catalog.find((d) => d.source === 'homebrew' && d.duplicatedFromId === torch.id);
    expect(homebrew).toBeDefined();
    expect(homebrew?.name).toBe('Torch');
  });

  it('clicking Edit on a homebrew row opens HomebrewForm pre-filled (M6)', async () => {
    const user = userEvent.setup();
    bootstrapWithHomebrew({ name: 'Mushroom' });
    renderBrowser();

    await user.click(screen.getByRole('button', { name: /edit mushroom/i }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/^name$/i)).toHaveValue('Mushroom');
    expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument();
  });

  it('Delete dialog shows reference count when item is held in stashes (M6)', async () => {
    const user = userEvent.setup();
    const { homebrewDefId, inventoryStashId } = bootstrapWithHomebrew({ name: 'Mushroom' });
    void useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: homebrewDefId,
        quantity: 2,
        source: 'custom-create',
        ...acquireIds(),
      },
    });
    renderBrowser();

    await user.click(screen.getByRole('button', { name: /delete mushroom/i }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent(/1 stash hold/i);
    // Delete action is disabled when reference count > 0.
    const deleteBtn = screen.getByRole('button', { name: /^delete$/i });
    expect(deleteBtn).toBeDisabled();
  });

  it('Delete dialog confirms cleanly when no instances reference the homebrew (M6)', async () => {
    const user = userEvent.setup();
    const { homebrewDefId } = bootstrapWithHomebrew({ name: 'Mushroom' });
    renderBrowser();

    await user.click(screen.getByRole('button', { name: /delete mushroom/i }));
    const deleteBtn = screen.getByRole('button', { name: /^delete$/i });
    expect(deleteBtn).not.toBeDisabled();
    await user.click(deleteBtn);

    expect(
      useStore.getState().appState!.catalog.find((d) => d.id === homebrewDefId),
    ).toBeUndefined();
  });

  it('"New homebrew" button opens HomebrewForm in create mode (M6)', async () => {
    const user = userEvent.setup();
    bootstrap();
    renderBrowser();

    await user.click(screen.getByRole('button', { name: /new homebrew/i }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Empty name input in create mode.
    expect(screen.getByLabelText(/^name$/i)).toHaveValue('');
    expect(screen.getByRole('button', { name: /^create$/i })).toBeInTheDocument();
  });

  // R2.1 — DMG row rarity badges.
  it('renders a rarity badge with the correct label on a DMG row (R2.1)', async () => {
    const user = userEvent.setup();
    bootstrap();
    renderBrowser();

    // Filter by name so the long DMG list collapses to a small set.
    // R6.5 note: multi-probe fuzzy search returns every "cloak" or
    // "protection" match. Pair the search with the Source filter set to
    // DMG so the surviving rows are the DMG-only cloaks, then locate the
    // specific "Cloak of Protection" row's rarity badge via a targeted
    // ancestor-scoped query.
    await user.type(screen.getByLabelText(/^search$/i), 'cloak of protection');

    // R9.6 — the rarity pill is now inline with the name in the same cell,
    // so the cell's accessible name includes the pill text. Locate the row
    // via the name text node instead of an exact cell-name match.
    const cloakRow = screen.getByText('Cloak of Protection').closest('tr');
    if (cloakRow === null) throw new Error('expected the Cloak row to be a <tr>');
    expect(within(cloakRow).getByLabelText('Rarity: Uncommon')).toBeInTheDocument();
  });

  it('treats DMG rows like PHB — Duplicate button, no Edit/Delete (R2.1)', async () => {
    const user = userEvent.setup();
    bootstrap();
    renderBrowser();

    await user.type(screen.getByLabelText(/^search$/i), 'cloak of protection');

    expect(
      screen.getByRole('button', { name: /duplicate cloak of protection/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /edit cloak of protection/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /delete cloak of protection/i }),
    ).not.toBeInTheDocument();
  });

  // ---------- R6.1 — per-party economy display ----------

  it('R6.1 — Gold standard default: 5 gp PHB row displays as "5 gp"', async () => {
    // Bootstrap = 1.0× / gp. A PHB Rope (2 sp) should render "2 sp".
    // A PHB item priced at 5 gp = 500 cp under gp-standard = "5 gp".
    // Use Rapier (25 gp = 2500 cp under gp-standard) since Torch is
    // 1 cp (edge case).
    const user = userEvent.setup();
    bootstrap();
    renderBrowser();

    await user.type(screen.getByLabelText(/^search$/i), 'rapier');
    // Look for the "25 gp" text (Rapier is 25 gp in the PHB seed).
    expect(screen.getByText(/^25 gp$/)).toBeInTheDocument();
  });

  it('R6.1 — Silver standard: PHB prices scale by 0.1 and canonicalize to sp', async () => {
    // 1 sp Torch, 25 gp Rapier: under silver-standard (0.1× / sp) the
    // Rapier becomes 25 gp * 0.1 = 2.5 gp = 250 cp → "25 sp".
    const user = userEvent.setup();
    const { partyId } = bootstrap();
    void useStore.getState().dispatch({
      type: 'update-party-economy',
      payload: { partyId, priceModifier: 0.1, baseCurrency: 'sp' },
    });
    renderBrowser();

    await user.type(screen.getByLabelText(/^search$/i), 'rapier');
    expect(screen.getByText(/^25 sp$/)).toBeInTheDocument();
  });

  it('R6.1 — homebrew rows keep their typed price (partyModifier does not apply)', async () => {
    // Homebrew "Torc of Whimsy" priced 10 gp. Under silver-standard
    // (0.1× / sp) a PHB 10 gp item would become 10 sp. Homebrew skips
    // the modifier → still 10 gp = 1000 cp under baseCurrency='sp' →
    // canonicalization descends from sp: 1000/10 = 100 → "100 sp"
    // (§3.5 baseCurrency=sp caps the ceiling; no rollup to gp).
    const user = userEvent.setup();
    const { partyId } = bootstrapWithHomebrew({
      name: 'Torc of Whimsy',
      category: 'gear',
      cost: { amount: 10, currency: 'gp' },
    });
    void useStore.getState().dispatch({
      type: 'update-party-economy',
      payload: { partyId, priceModifier: 0.1, baseCurrency: 'sp' },
    });
    renderBrowser();

    await user.type(screen.getByLabelText(/^search$/i), 'torc');
    // 10 gp = 1000 cp; homebrew skips the modifier; sp-standard
    // ceiling → 1000 / 10 = 100 → "100 sp".
    expect(screen.getByText(/^100 sp$/)).toBeInTheDocument();
  });

  it('R6.1 — preset switch re-renders visible catalog prices without re-seeding', async () => {
    // Bootstrap defaults to Gold-standard: Rapier reads "25 gp". Flip
    // the economy to Silver via `update-party-economy` and confirm
    // the same row re-renders as "25 sp" (Rapier 25 gp * 0.1 → 250 cp
    // → "25 sp") without touching the catalog seed itself.
    const user = userEvent.setup();
    const { partyId } = bootstrap();
    renderBrowser();

    await user.type(screen.getByLabelText(/^search$/i), 'rapier');
    expect(screen.getByText(/^25 gp$/)).toBeInTheDocument();

    void useStore.getState().dispatch({
      type: 'update-party-economy',
      payload: { partyId, priceModifier: 0.1, baseCurrency: 'sp' },
    });

    expect(await screen.findByText(/^25 sp$/)).toBeInTheDocument();
    expect(screen.queryByText(/^25 gp$/)).not.toBeInTheDocument();
  });

  // R6.5 — Catalog search + filters --------------------------------------

  it('R6.5 — Source filter hides PHB rows when set to "Homebrew"', async () => {
    const user = userEvent.setup();
    bootstrapWithHomebrew();
    renderBrowser();

    // Baseline: PHB Longsword is visible.
    expect(screen.getByText(/^Longsword$/)).toBeInTheDocument();

    await user.click(screen.getByLabelText(/^source$/i));
    await user.click(await screen.findByRole('option', { name: /^homebrew$/i }));

    // PHB row is gone; the homebrew fixture row remains.
    expect(screen.queryByText(/^Longsword$/)).not.toBeInTheDocument();
  });

  it('R6.5 — Source filter set to "All" restores PHB rows', async () => {
    const user = userEvent.setup();
    bootstrapWithHomebrew();
    renderBrowser();

    await user.click(screen.getByLabelText(/^source$/i));
    await user.click(await screen.findByRole('option', { name: /^homebrew$/i }));
    expect(screen.queryByText(/^Longsword$/)).not.toBeInTheDocument();

    await user.click(screen.getByLabelText(/^source$/i));
    await user.click(await screen.findByRole('option', { name: /^all sources$/i }));
    expect(screen.getByText(/^Longsword$/)).toBeInTheDocument();
  });

  it('R6.5 — Rarity filter hides items outside the selected rarity', async () => {
    const user = userEvent.setup();
    bootstrap();
    renderBrowser();

    // Baseline: Longsword (mundane, no rarity) and Cloak of Protection
    // (uncommon) both present.
    expect(screen.getByText(/^Longsword$/)).toBeInTheDocument();
    expect(screen.getByText(/^Cloak of Protection$/)).toBeInTheDocument();

    await user.click(screen.getByLabelText(/^rarity$/i));
    await user.click(await screen.findByRole('option', { name: /^uncommon$/i }));

    expect(screen.queryByText(/^Longsword$/)).not.toBeInTheDocument();
    expect(screen.getByText(/^Cloak of Protection$/)).toBeInTheDocument();
  });

  it('R6.5 — Attunement filter hides items without attunement requirement', async () => {
    const user = userEvent.setup();
    bootstrap();
    renderBrowser();

    // Longsword doesn't require attunement.
    expect(screen.getByText(/^Longsword$/)).toBeInTheDocument();

    await user.click(screen.getByLabelText(/^attunement$/i));
    await user.click(await screen.findByRole('option', { name: /^required$/i }));

    expect(screen.queryByText(/^Longsword$/)).not.toBeInTheDocument();
    // At least one DMG attunement-required item survives.
    expect(screen.getByText(/^Cloak of Protection$/)).toBeInTheDocument();
  });

  it('R6.5 — fuzzy search matches subsequence queries ("lgsw" → Longsword)', async () => {
    const user = userEvent.setup();
    bootstrap();
    renderBrowser();

    await user.type(screen.getByLabelText(/^search$/i), 'lgsw');

    expect(screen.getByText(/^Longsword$/)).toBeInTheDocument();
    // Rows unrelated to "lgsw" are hidden.
    expect(screen.queryByText(/^Rapier$/)).not.toBeInTheDocument();
  });

  it('R6.5 — filters compose: Source=homebrew + Category=consumable hides mismatches', async () => {
    const user = userEvent.setup();
    // Seed with the standard homebrew fixture (creates one homebrew row).
    // The fixture's homebrew row is a weapon, not a consumable, so the
    // combined filter should return zero rows.
    bootstrapWithHomebrew();
    renderBrowser();

    await user.click(screen.getByLabelText(/^source$/i));
    await user.click(await screen.findByRole('option', { name: /^homebrew$/i }));
    await user.click(screen.getByLabelText(/^category$/i));
    await user.click(await screen.findByRole('option', { name: /^consumables$/i }));

    expect(screen.getByText(/No items match your search\.|Catalog is empty/i)).toBeInTheDocument();
  });
});
