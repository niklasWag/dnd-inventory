import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { EquippedSlotsPanel } from './EquippedSlotsPanel';
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

/** Helper: bootstrap + add `count` Torch rows in inventory with distinct notes. */
function bootstrapWithTorches(count: number): { characterId: string; rowIds: string[] } {
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
        ...acquireIds(), },
    });
  }
  const rowIds: string[] = [];
  for (const row of useStore.getState().appState!.items) {
    if (row.ownerId === inventoryStashId) rowIds.push(row.id);
  }
  return { characterId, rowIds };
}

/**
 * Helper: bootstrap + add `count` magic-item rows (Wand of Magic Missiles)
 * in Inventory with distinct notes. Used for tests that exercise `attune`,
 * since R2.1 added a reducer gate rejecting `attune` on mundane rows.
 */
function bootstrapWithMagicItems(count: number): { characterId: string; rowIds: string[] } {
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
        ...acquireIds(), },
    });
  }
  const rowIds: string[] = [];
  for (const row of useStore.getState().appState!.items) {
    if (row.ownerId === inventoryStashId) rowIds.push(row.id);
  }
  return { characterId, rowIds };
}

describe('EquippedSlotsPanel (R1.2)', () => {
  it('renders empty-state copy when nothing equipped or attuned', () => {
    const { characterId } = bootstrap();
    render(<EquippedSlotsPanel characterId={characterId} />);
    expect(screen.getByText(/Nothing equipped/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing attuned/)).toBeInTheDocument();
    // Default cap of 3 surfaced in the counter.
    expect(screen.getByLabelText('Attunement slots').textContent).toMatch(/0\s*\/\s*3/);
  });

  it('lists equipped items by name', () => {
    const { characterId, rowIds } = bootstrapWithTorches(1);
    useStore
      .getState()
      .dispatch({ type: 'equip', payload: { characterId, itemInstanceId: rowIds[0]! } });
    render(<EquippedSlotsPanel characterId={characterId} />);
    expect(screen.getByText('Torch')).toBeInTheDocument();
  });

  it('counts attuned items against the cap (X/max)', () => {
    const { characterId, rowIds } = bootstrapWithMagicItems(3);
    for (const id of rowIds) {
      useStore
        .getState()
        .dispatch({ type: 'attune', payload: { characterId, itemInstanceId: id } });
    }
    render(<EquippedSlotsPanel characterId={characterId} />);
    expect(screen.getByLabelText('Attunement slots').textContent).toMatch(/3\s*\/\s*3/);
  });

  it('reflects DM-raised maxAttunement via edit-character', () => {
    const { characterId } = bootstrap();
    useStore
      .getState()
      .dispatch({ type: 'edit-character', payload: { characterId, patch: { maxAttunement: 5 } } });
    render(<EquippedSlotsPanel characterId={characterId} />);
    expect(screen.getByLabelText('Attunement slots').textContent).toMatch(/0\s*\/\s*5/);
  });

  it('R2.3 — equipped unidentified magic item renders as "Unknown Magic Item", not its real name', () => {
    const { characterId, inventoryStashId, catalog } = bootstrap();
    const cloak = catalog.find((d) => d.id === 'dmg-2024:cloak-of-protection')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: cloak.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(), },
    });
    const cloakId = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === cloak.id)!.id;
    useStore.getState().dispatch({
      type: 'equip',
      payload: { characterId, itemInstanceId: cloakId },
    });
    useStore.getState().dispatch({
      type: 'identify',
      payload: { itemInstanceId: cloakId, identified: false },
    });
    render(<EquippedSlotsPanel characterId={characterId} />);
    expect(screen.getByText('Unknown Magic Item')).toBeInTheDocument();
    expect(screen.queryByText('Cloak of Protection')).not.toBeInTheDocument();
  });

  it('R2.3 — attuned unidentified magic item renders as "Unknown Magic Item" in the Attuned list', () => {
    const { characterId, inventoryStashId, catalog } = bootstrap();
    const cloak = catalog.find((d) => d.id === 'dmg-2024:cloak-of-protection')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: cloak.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(), },
    });
    const cloakId = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === cloak.id)!.id;
    useStore.getState().dispatch({
      type: 'attune',
      payload: { characterId, itemInstanceId: cloakId },
    });
    useStore.getState().dispatch({
      type: 'identify',
      payload: { itemInstanceId: cloakId, identified: false, hint: 'shimmers faintly' },
    });
    render(<EquippedSlotsPanel characterId={characterId} />);
    expect(screen.getByText('Unknown Magic Item')).toBeInTheDocument();
    expect(screen.queryByText('Cloak of Protection')).not.toBeInTheDocument();
  });
});
