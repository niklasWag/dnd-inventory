import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { ItemDetail } from './ItemDetail';
import { CharacterSheet } from './CharacterSheet';
import { Toaster } from '@/components/ui/sonner';
import { useStore, flushPendingPersist } from '@/store';
import { loadAppState } from '@/db/load';
import { wipeAll } from '@/db/wipe';
import { newUuidV7, appStateSchema } from '@app/shared';

import { bootstrap, bootstrapWithItem } from '@/test/fixtures';

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
    // If the redirect fires we land on "/" (the test stub renders nothing).
    // No ItemDetail-specific surface (the History panel) should appear.
    expect(screen.queryByRole('heading', { name: /history/i })).not.toBeInTheDocument();
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
    expect(useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!.notes).toBe(
      'made of moonsilver',
    );

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
    const dispatchSpy = vi.spyOn(useStore.getState(), 'dispatch').mockImplementation(() => {
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

describe('ItemDetail — R2.1 rarity + attunement display', () => {
  /**
   * R2.1 — DMG rows surface their rarity (as a colored chip with an
   * aria-label), a "Requires attunement" pill when `requiresAttunement`
   * is true, and the `attunementPrereq` string as italic advisory text.
   */
  function bootstrapWithDmgRow(definitionId: string): { itemInstanceId: string } {
    const { inventoryStashId, catalog } = bootstrap();
    const def = catalog.find((d) => d.id === definitionId);
    if (def === undefined) throw new Error(`bootstrapWithDmgRow: ${definitionId} not in catalog`);
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: def.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    const itemInstanceId = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === def.id)!.id;
    return { itemInstanceId };
  }

  it('renders the rarity chip on a DMG row (Cloak of Protection → Uncommon)', () => {
    const { itemInstanceId } = bootstrapWithDmgRow('dmg-2024:cloak-of-protection');
    renderAt(`/item/${itemInstanceId}`);
    expect(screen.getByLabelText('Rarity: Uncommon')).toBeInTheDocument();
  });

  it('renders the Requires attunement pill on a row with requiresAttunement:true', () => {
    const { itemInstanceId } = bootstrapWithDmgRow('dmg-2024:cloak-of-protection');
    renderAt(`/item/${itemInstanceId}`);
    expect(screen.getByLabelText('Requires attunement')).toBeInTheDocument();
  });

  it('renders the attunementPrereq advisory text when present', () => {
    // Wand of the War Mage +1 carries `attunementPrereq: "Requires
    // attunement by a spellcaster"`.
    const { itemInstanceId } = bootstrapWithDmgRow('dmg-2024:wand-of-the-war-mage-plus-1');
    renderAt(`/item/${itemInstanceId}`);
    expect(screen.getByText(/Requires attunement by a spellcaster/i)).toBeInTheDocument();
  });

  it('omits the rarity chip and attunement pill on a mundane PHB row (Torch)', () => {
    const { itemInstanceId } = bootstrapWithTorch();
    renderAt(`/item/${itemInstanceId}`);
    expect(screen.queryByLabelText(/^Rarity:/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Requires attunement')).not.toBeInTheDocument();
  });
});

describe('ItemDetail — R2.2 charges row + Use/Recharge buttons', () => {
  /**
   * R2.2 — surfaces the `def.charges` block as a `<span aria-label="Charges">`
   * line plus two action buttons:
   *   - Use: dispatches `use-charge` (disabled when currentCharges === 0)
   *   - Recharge: dispatches `recharge` (mode: 'manual', disabled at max)
   * Hidden entirely when the item has no charges block OR isn't in
   * the character's Inventory.
   */
  function bootstrapWithChargedRow(definitionId: string): {
    itemInstanceId: string;
    characterId: string;
    inventoryStashId: string;
    partyStashId: string;
  } {
    const base = bootstrap();
    const def = base.catalog.find((d) => d.id === definitionId);
    if (def === undefined)
      throw new Error(`bootstrapWithChargedRow: ${definitionId} not in catalog`);
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: base.inventoryStashId,
        definitionId,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
        ...acquireIds(),
      },
    });
    const itemInstanceId = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === definitionId)!.id;
    return {
      itemInstanceId,
      characterId: base.characterId,
      inventoryStashId: base.inventoryStashId,
      partyStashId: base.partyStashId,
    };
  }

  it('renders the charges line on an Inventory wand row', () => {
    const { itemInstanceId } = bootstrapWithChargedRow('dmg-2024:wand-of-magic-missiles');
    renderAt(`/item/${itemInstanceId}`);
    expect(screen.getByLabelText('Charges')).toHaveTextContent(
      '7 / 7 charges — Recharges at dawn (1d6+1)',
    );
  });

  it('does NOT render the charges row on a non-charged item (Torch)', () => {
    const { itemInstanceId } = bootstrapWithTorch();
    renderAt(`/item/${itemInstanceId}`);
    expect(screen.queryByLabelText('Charges')).not.toBeInTheDocument();
  });

  it('does NOT render the charges row on a charged item that is NOT in Inventory', () => {
    const { itemInstanceId, partyStashId } = bootstrapWithChargedRow(
      'dmg-2024:wand-of-magic-missiles',
    );
    // Move the wand to the Party Stash; currentCharges clears via cascade.
    useStore.getState().dispatch({
      type: 'transfer',
      payload: {
        itemInstanceId,
        toStashId: partyStashId,
        quantity: 1,
        ...transferIds(),
        ...transferIds(),
      },
    });
    const movedId = useStore.getState().appState!.items.find((i) => i.ownerId === partyStashId)!.id;
    renderAt(`/item/${movedId}`);
    expect(screen.queryByLabelText('Charges')).not.toBeInTheDocument();
  });

  it('Use button decrements currentCharges and disables at 0', async () => {
    const user = userEvent.setup();
    const { itemInstanceId } = bootstrapWithChargedRow('dmg-2024:wand-of-magic-missiles');
    renderAt(`/item/${itemInstanceId}`);

    const useBtn = screen.getByRole('button', { name: /^use$/i });
    expect(useBtn).toBeEnabled();
    // Spend 7 charges.
    for (let i = 0; i < 7; i++) {
      await user.click(useBtn);
    }
    expect(
      useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!.currentCharges,
    ).toBe(0);
    // Button disables at 0.
    expect(screen.getByRole('button', { name: /^use$/i })).toBeDisabled();
  });

  it('Recharge button is disabled at full charges and enabled after a spend', async () => {
    const user = userEvent.setup();
    const { itemInstanceId } = bootstrapWithChargedRow('dmg-2024:wand-of-magic-missiles');
    renderAt(`/item/${itemInstanceId}`);

    // At full charges, Recharge is disabled.
    expect(screen.getByRole('button', { name: /^recharge$/i })).toBeDisabled();

    // Spend one charge to enable Recharge.
    await user.click(screen.getByRole('button', { name: /^use$/i }));
    expect(screen.getByRole('button', { name: /^recharge$/i })).toBeEnabled();

    // Wand of Magic Missiles has rechargeAmount '1d6+1' — clicking Recharge
    // now opens the inline roll input rather than dispatching. R2.2.1.
    await user.click(screen.getByRole('button', { name: /^recharge$/i }));
    const rollInput = await screen.findByLabelText(/Roll result/i);
    expect(rollInput).toBeInTheDocument();

    // Enter 1 charge (the deficit), click Apply.
    await user.type(rollInput, '1');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));

    // Reducer state: wand back to full charges; input collapses; Recharge re-disables.
    expect(
      useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!.currentCharges,
    ).toBe(7);
    expect(screen.queryByLabelText(/Roll result/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^recharge$/i })).toBeDisabled();
  });

  it('Roll input rejects amounts that exceed the current deficit', async () => {
    const user = userEvent.setup();
    const { itemInstanceId } = bootstrapWithChargedRow('dmg-2024:wand-of-magic-missiles');
    renderAt(`/item/${itemInstanceId}`);

    // Spend 2 charges → deficit = 2.
    await user.click(screen.getByRole('button', { name: /^use$/i }));
    await user.click(screen.getByRole('button', { name: /^use$/i }));

    await user.click(screen.getByRole('button', { name: /^recharge$/i }));
    const rollInput = await screen.findByLabelText(/Roll result/i);
    await user.type(rollInput, '5');
    await user.click(screen.getByRole('button', { name: /^apply$/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/Cannot exceed deficit/);
    // State unchanged.
    expect(
      useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!.currentCharges,
    ).toBe(5); // 7 - 2 = 5
  });

  it('Cancel button closes the roll input without dispatching', async () => {
    const user = userEvent.setup();
    const { itemInstanceId } = bootstrapWithChargedRow('dmg-2024:wand-of-magic-missiles');
    renderAt(`/item/${itemInstanceId}`);

    await user.click(screen.getByRole('button', { name: /^use$/i }));
    await user.click(screen.getByRole('button', { name: /^recharge$/i }));
    expect(screen.getByLabelText(/Roll result/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.queryByLabelText(/Roll result/i)).not.toBeInTheDocument();
    expect(
      useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!.currentCharges,
    ).toBe(6); // unchanged after Use, no Recharge applied
  });

  it('Items without a rechargeAmount formula (Decanter) still full-recharge on click', async () => {
    const user = userEvent.setup();
    // Decanter of Endless Water: rechargeRule dawn, NO rechargeAmount.
    const { itemInstanceId } = bootstrapWithChargedRow('dmg-2024:decanter-of-endless-water');
    renderAt(`/item/${itemInstanceId}`);
    // Spend all 3 charges.
    await user.click(screen.getByRole('button', { name: /^use$/i }));
    await user.click(screen.getByRole('button', { name: /^use$/i }));
    await user.click(screen.getByRole('button', { name: /^use$/i }));

    // Clicking Recharge dispatches immediately — no roll input appears.
    await user.click(screen.getByRole('button', { name: /^recharge$/i }));
    expect(screen.queryByLabelText(/Roll result/i)).not.toBeInTheDocument();
    expect(
      useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!.currentCharges,
    ).toBe(3); // full recharge to max
  });
});

describe('ItemDetail — R2.3 identification panel + display gate', () => {
  /**
   * R2.3 — adds an Identification Panel with a toggle (`<button
   * role="switch">`) + hint editor. Header rendering switches to the
   * "Unknown Magic Item" + hint subtitle UI when `row.identified ===
   * false`; rarity chip + Requires-attunement pill + charges section
   * are all hidden in that state (spoiler protection).
   */
  function bootstrapWithCloak(): { itemInstanceId: string } {
    const base = bootstrap();
    const cloak = base.catalog.find((d) => d.id === 'dmg-2024:cloak-of-protection');
    if (cloak === undefined) throw new Error('cloak missing from catalog');
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: base.inventoryStashId,
        definitionId: cloak.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    const itemInstanceId = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === cloak.id)!.id;
    return { itemInstanceId };
  }

  it('identified row renders the real name + rarity chip + attunement pill', () => {
    const { itemInstanceId } = bootstrapWithCloak();
    renderAt(`/item/${itemInstanceId}`);
    expect(screen.getByRole('heading', { name: 'Cloak of Protection' })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Rarity:/)).toBeInTheDocument();
    expect(screen.getByLabelText('Requires attunement')).toBeInTheDocument();
    expect(screen.queryByLabelText('Unidentified')).not.toBeInTheDocument();
  });

  it('unidentified row renders "Unknown Magic Item" + Unidentified badge, hides rarity + attunement', () => {
    const { itemInstanceId } = bootstrapWithCloak();
    useStore.getState().dispatch({
      type: 'identify',
      payload: { itemInstanceId, identified: false, hint: 'shimmers faintly' },
    });
    renderAt(`/item/${itemInstanceId}`);
    expect(screen.getByRole('heading', { name: 'Unknown Magic Item' })).toBeInTheDocument();
    expect(screen.getByLabelText('Unidentified')).toBeInTheDocument();
    expect(screen.getByLabelText('Unidentified hint')).toHaveTextContent('shimmers faintly');
    expect(screen.queryByLabelText(/^Rarity:/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Requires attunement')).not.toBeInTheDocument();
  });

  it('clicking the Identified toggle flips identified and dispatches identify', async () => {
    const user = userEvent.setup();
    const { itemInstanceId } = bootstrapWithCloak();
    renderAt(`/item/${itemInstanceId}`);

    const toggle = screen.getByRole('switch', { name: 'Identified' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    await user.click(toggle);

    const after = useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!;
    expect(after.identified).toBe(false);
    // The toggle re-renders against the new row.
    expect(screen.getByRole('switch', { name: 'Identified' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    // Log captured the transition.
    const last = useStore.getState().log.at(-1)!;
    expect(last.type).toBe('identify');
  });

  it('typing in the hint editor and clicking Save dispatches identify with the new hint', async () => {
    const user = userEvent.setup();
    const { itemInstanceId } = bootstrapWithCloak();
    // Start unidentified so the hint is meaningful for the smoke flow.
    useStore.getState().dispatch({
      type: 'identify',
      payload: { itemInstanceId, identified: false },
    });
    renderAt(`/item/${itemInstanceId}`);

    const input = screen.getByLabelText(/unidentified hint \(dm only\)/i);
    await user.type(input, 'radiates evil');
    await user.click(screen.getByRole('button', { name: /save hint/i }));

    const after = useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!;
    expect(after.hint).toBe('radiates evil');
    // Identified state preserved.
    expect(after.identified).toBe(false);
  });

  it('Save hint button is disabled when the input matches the current hint (no-op guard)', () => {
    const { itemInstanceId } = bootstrapWithCloak();
    useStore.getState().dispatch({
      type: 'identify',
      payload: { itemInstanceId, identified: false, hint: 'glows blue' },
    });
    renderAt(`/item/${itemInstanceId}`);
    // Input is pre-populated with the current hint via the syncing useEffect.
    expect(screen.getByRole('button', { name: /save hint/i })).toBeDisabled();
  });

  it('clearing the hint input enables a "Clear" button that dispatches identify with hint: undefined', async () => {
    const user = userEvent.setup();
    const { itemInstanceId } = bootstrapWithCloak();
    useStore.getState().dispatch({
      type: 'identify',
      payload: { itemInstanceId, identified: false, hint: 'glows blue' },
    });
    renderAt(`/item/${itemInstanceId}`);
    const input = screen.getByLabelText(/unidentified hint \(dm only\)/i);
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: /^clear$/i }));

    const after = useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!;
    expect(after.hint).toBeUndefined();
  });

  it('unidentified Inventory wand hides the charges row (spoiler protection)', () => {
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
    const wandId = useStore.getState().appState!.items.find((i) => i.definitionId === wand.id)!.id;
    useStore.getState().dispatch({
      type: 'identify',
      payload: { itemInstanceId: wandId, identified: false },
    });
    renderAt(`/item/${wandId}`);
    // Identified would show the charges line; unidentified hides it.
    expect(screen.queryByLabelText('Charges')).not.toBeInTheDocument();
  });
});
