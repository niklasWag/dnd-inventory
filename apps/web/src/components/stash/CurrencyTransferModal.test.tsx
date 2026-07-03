import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { CurrencyTransferModal } from './CurrencyTransferModal';
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
function createStashIds() {
  return { newStashId: newUuidV7(), newCurrencyHoldingId: newUuidV7() };
}

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

interface SetupResult {
  inventoryStashId: string;
  partyStashId: string;
  recoveredLootStashId: string;
  storageStashId: string;
}

/**
 * Common setup: bootstrap + a Storage stash + seed Inventory with 10 gp.
 * Returns every stash id the modal needs.
 */
function setupWith(): SetupResult {
  const base = bootstrap();
  useStore.getState().dispatch({
    type: 'create-stash',
    payload: {
      ownerCharacterId: base.characterId,
      name: 'Chest at home',
      ...createStashIds(),
      ...createStashIds(),
    },
  });
  const storageStashId = useStore.getState().appState!.stashes.at(-1)!.id;
  // Seed Inventory with 10 gp directly into state (no currency-change UI in
  // play here — we want the holding without crowding the log).
  useStore.setState((s) => {
    if (s.appState === null) return s;
    return {
      ...s,
      appState: {
        ...s.appState,
        currencies: s.appState.currencies.map((c) =>
          c.stashId === base.inventoryStashId ? { ...c, gp: 10 } : c,
        ),
      },
    };
  });
  return {
    inventoryStashId: base.inventoryStashId,
    partyStashId: base.partyStashId,
    recoveredLootStashId: base.recoveredLootStashId,
    storageStashId,
  };
}

function renderWith(
  open: boolean,
  stashId: string,
  onOpenChange: (next: boolean) => void = () => {
    /* noop */
  },
): void {
  render(
    <MemoryRouter>
      <CurrencyTransferModal stashId={stashId} open={open} onOpenChange={onOpenChange} />
      <Toaster />
    </MemoryRouter>,
  );
}

describe('CurrencyTransferModal (M5.5)', () => {
  it('does not render when open=false', () => {
    const { inventoryStashId } = setupWith();
    renderWith(false, inventoryStashId);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the form with target select + five denom inputs when open=true', () => {
    const { inventoryStashId } = setupWith();
    renderWith(true, inventoryStashId);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/target stash/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^cp$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^sp$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^ep$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^gp$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^pp$/i)).toBeInTheDocument();
  });

  it('lists every stash except the source as a target option', () => {
    const { inventoryStashId, partyStashId, recoveredLootStashId, storageStashId } = setupWith();
    renderWith(true, inventoryStashId);

    const select = screen.getByLabelText(/target stash/i);
    const optionIds = Array.from(select.querySelectorAll('option')).map((o) => o.value);
    expect(optionIds).toContain(partyStashId);
    expect(optionIds).toContain(recoveredLootStashId);
    expect(optionIds).toContain(storageStashId);
    expect(optionIds).not.toContain(inventoryStashId);
  });

  it('dispatches currency-transfer on submit and closes the modal', async () => {
    const user = userEvent.setup();
    const { inventoryStashId, partyStashId } = setupWith();
    let openValue = true;
    const onOpenChange = (next: boolean): void => {
      openValue = next;
    };
    renderWith(true, inventoryStashId, onOpenChange);

    await user.selectOptions(screen.getByLabelText(/target stash/i), partyStashId);
    const gpInput = screen.getByLabelText(/^gp$/i);
    await user.clear(gpInput);
    await user.type(gpInput, '3');
    await user.click(screen.getByRole('button', { name: /^transfer$/i }));

    const s = useStore.getState().appState!;
    expect(s.currencies.find((c) => c.stashId === inventoryStashId)!.gp).toBe(7);
    expect(s.currencies.find((c) => c.stashId === partyStashId)!.gp).toBe(3);
    expect(openValue).toBe(false);
  });

  it('disables submit when all denominations are zero', () => {
    const { inventoryStashId } = setupWith();
    renderWith(true, inventoryStashId);
    expect(screen.getByRole('button', { name: /^transfer$/i })).toBeDisabled();
  });

  it('blocks submit and shows insufficient-funds reason when qty exceeds holding', async () => {
    const user = userEvent.setup();
    const { inventoryStashId, partyStashId } = setupWith();
    renderWith(true, inventoryStashId);

    await user.selectOptions(screen.getByLabelText(/target stash/i), partyStashId);
    const gpInput = screen.getByLabelText(/^gp$/i);
    await user.clear(gpInput);
    await user.type(gpInput, '20'); // only 10 in source

    expect(screen.getByRole('button', { name: /^transfer$/i })).toBeDisabled();
    expect(screen.getByRole('status').textContent).toMatch(/insufficient/i);
  });

  it('shows a "Currency transferred" toast on success', async () => {
    const user = userEvent.setup();
    const { inventoryStashId, partyStashId } = setupWith();
    renderWith(true, inventoryStashId, () => {
      /* noop */
    });

    await user.selectOptions(screen.getByLabelText(/target stash/i), partyStashId);
    const gpInput = screen.getByLabelText(/^gp$/i);
    await user.clear(gpInput);
    await user.type(gpInput, '2');
    await user.click(screen.getByRole('button', { name: /^transfer$/i }));

    expect(await screen.findByText(/currency transferred/i)).toBeInTheDocument();
  });

  it('supports a multi-denomination transfer in one submit', async () => {
    const user = userEvent.setup();
    const { inventoryStashId, partyStashId } = setupWith();
    // Add 5 sp + 25 cp to inventory.
    useStore.setState((s) => {
      if (s.appState === null) return s;
      return {
        ...s,
        appState: {
          ...s.appState,
          currencies: s.appState.currencies.map((c) =>
            c.stashId === inventoryStashId ? { ...c, sp: c.sp + 5, cp: c.cp + 25 } : c,
          ),
        },
      };
    });
    renderWith(true, inventoryStashId);

    await user.selectOptions(screen.getByLabelText(/target stash/i), partyStashId);
    const gp = screen.getByLabelText(/^gp$/i);
    const sp = screen.getByLabelText(/^sp$/i);
    const cp = screen.getByLabelText(/^cp$/i);
    await user.clear(gp);
    await user.type(gp, '1');
    await user.clear(sp);
    await user.type(sp, '2');
    await user.clear(cp);
    await user.type(cp, '10');
    await user.click(screen.getByRole('button', { name: /^transfer$/i }));

    const s = useStore.getState().appState!;
    const src = s.currencies.find((c) => c.stashId === inventoryStashId)!;
    const dst = s.currencies.find((c) => c.stashId === partyStashId)!;
    expect(src.gp).toBe(9);
    expect(src.sp).toBe(3);
    expect(src.cp).toBe(15);
    expect(dst.gp).toBe(1);
    expect(dst.sp).toBe(2);
    expect(dst.cp).toBe(10);
  });
});
