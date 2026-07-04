import { describe, expect, it } from 'vitest';
import { newUuidV7 } from '@app/shared';
import type { AppState, ItemDefinition } from '@app/shared';

import { reduce, type ReducerContext } from './index';

/**
 * BUG-008 — equipped/attuned items must never stack. Three defects
 * bundled into one invariant fix:
 *
 *   1. `acquire` must NOT auto-stack onto an existing equipped/attuned
 *      row (creating a "3 equipped longswords" stack).
 *   2. `split` must clear `equipped`/`attuned` on the new row (matches
 *      the server-side `persistSplit` which hard-codes both to false).
 *   3. `equip` / `attune` on a stacked row (quantity > 1) must
 *      auto-split off a fresh quantity-1 row and flip the flag on the
 *      NEW row, so the invariant holds end-to-end: no equipped/attuned
 *      row ever has quantity > 1.
 */

const CTX_NOW = '2026-07-04T12:00:00.000Z';

const ctx: ReducerContext = {
  now: () => CTX_NOW,
  newInviteCode: () => 'INV-BUG-008',
};

/** Bootstrap a party-of-one with a longsword definition + 1 longsword
 * already in inventory. Returns the useful ids for tests. */
function seed(): {
  state: NonNullable<AppState>;
  characterId: string;
  inventoryStashId: string;
  longswordId: string;
  longswordDefId: string;
  ringDefId: string; // requiresAttunement=true magic item
} {
  // Bootstrap the party.
  const bootstrap = reduce(
    null,
    {
      type: 'create-character',
      payload: {
        name: 'Alice',
        species: 'Human',
        size: 'medium',
        class: 'Fighter',
        level: 3,
        str: 14,
        newUserId: newUuidV7(),
        newPartyId: newUuidV7(),
        newPartyStashId: newUuidV7(),
        newRecoveredLootStashId: newUuidV7(),
        newPartyStashCurrencyId: newUuidV7(),
        newRecoveredLootCurrencyId: newUuidV7(),
        newCharacterId: newUuidV7(),
        newInventoryStashId: newUuidV7(),
        newCurrencyHoldingId: newUuidV7(),
      },
    },
    ctx,
  );
  let state = bootstrap.state as NonNullable<AppState>;
  const characterId = state.characters[0]!.id;
  const inventoryStashId = state.characters[0]!.inventoryStashId;

  // Seed a minimal catalog. Real seeds live in `@app/seeds` but we
  // avoid taking that dependency here — the two definitions this file
  // needs are trivial to construct inline.
  const longswordDefId = 'test:longsword';
  const magicRingDefId = 'test:ring-of-protection';
  const testCatalog: ItemDefinition[] = [
    {
      id: longswordDefId,
      name: 'Longsword',
      category: 'weapon',
      source: 'PHB',
      weight: 3,
      requiresAttunement: false,
    },
    {
      id: magicRingDefId,
      name: 'Ring of Protection',
      category: 'magic',
      source: 'DMG',
      weight: 0,
      requiresAttunement: true,
    },
  ];
  state = reduce(
    state,
    {
      type: 'seed-catalog',
      payload: { seedVersion: 1, entries: testCatalog },
    },
    ctx,
  ).state as NonNullable<AppState>;

  // Find a mundane weapon + a magic item requiring attunement from
  // the seeded catalog.
  const longswordDef = state.catalog.find((d) => d.id === longswordDefId);
  if (longswordDef === undefined) throw new Error('seed: longsword not in catalog');
  const ringDef = state.catalog.find((d) => d.id === magicRingDefId);
  if (ringDef === undefined) throw new Error('seed: magic ring not in catalog');

  // Acquire 1 longsword (baseline for stacking tests to build on).
  const longswordId = newUuidV7();
  const after = reduce(
    state,
    {
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: longswordDef.id,
        quantity: 1,
        source: 'catalog-add',
        newItemInstanceId: longswordId,
      },
    },
    ctx,
  );
  state = after.state as NonNullable<AppState>;

  return {
    state,
    characterId,
    inventoryStashId,
    longswordId,
    longswordDefId: longswordDef.id,
    ringDefId: ringDef.id,
  };
}

describe('BUG-008 (1) — acquire skip-stack on equipped/attuned rows', () => {
  it('does NOT stack a fresh acquire onto an equipped row (creates a new row instead)', () => {
    const s = seed();
    // Equip the existing longsword (quantity 1 → no auto-split path).
    const afterEquip = reduce(
      s.state,
      {
        type: 'equip',
        payload: { characterId: s.characterId, itemInstanceId: s.longswordId },
      },
      ctx,
    );
    const equippedState = afterEquip.state as NonNullable<AppState>;
    expect(equippedState.items.find((i) => i.id === s.longswordId)?.equipped).toBe(true);
    expect(equippedState.items.find((i) => i.id === s.longswordId)?.quantity).toBe(1);

    // Acquire another longsword. Must land as a NEW row (not stacked).
    const secondId = newUuidV7();
    const afterAcquire = reduce(
      equippedState,
      {
        type: 'acquire',
        payload: {
          stashId: s.inventoryStashId,
          definitionId: s.longswordDefId,
          quantity: 1,
          source: 'catalog-add',
          newItemInstanceId: secondId,
        },
      },
      ctx,
    );
    const nextState = afterAcquire.state as NonNullable<AppState>;
    const longswords = nextState.items.filter(
      (i) => i.ownerId === s.inventoryStashId && i.definitionId === s.longswordDefId,
    );
    expect(longswords).toHaveLength(2);
    const equipped = longswords.find((i) => i.equipped === true)!;
    const fresh = longswords.find((i) => i.equipped === false)!;
    expect(equipped.quantity).toBe(1);
    expect(fresh.id).toBe(secondId);
    expect(fresh.quantity).toBe(1);
  });

  it('does NOT stack a fresh acquire onto an attuned row', () => {
    const s = seed();
    // Acquire + attune a magic item.
    const magicId = newUuidV7();
    let state: NonNullable<AppState> = reduce(
      s.state,
      {
        type: 'acquire',
        payload: {
          stashId: s.inventoryStashId,
          definitionId: s.ringDefId,
          quantity: 1,
          source: 'catalog-add',
          newItemInstanceId: magicId,
        },
      },
      ctx,
    ).state as NonNullable<AppState>;
    state = reduce(
      state,
      {
        type: 'attune',
        payload: { characterId: s.characterId, itemInstanceId: magicId },
      },
      ctx,
    ).state as NonNullable<AppState>;
    expect(state.items.find((i) => i.id === magicId)?.attuned).toBe(true);

    // Acquire a second copy. Must not stack onto the attuned row.
    const secondId = newUuidV7();
    state = reduce(
      state,
      {
        type: 'acquire',
        payload: {
          stashId: s.inventoryStashId,
          definitionId: s.ringDefId,
          quantity: 1,
          source: 'catalog-add',
          newItemInstanceId: secondId,
        },
      },
      ctx,
    ).state as NonNullable<AppState>;

    const rings = state.items.filter(
      (i) => i.ownerId === s.inventoryStashId && i.definitionId === s.ringDefId,
    );
    expect(rings).toHaveLength(2);
    expect(rings.find((i) => i.attuned === true)?.quantity).toBe(1);
    expect(rings.find((i) => i.attuned === false)?.quantity).toBe(1);
  });

  it('DOES stack a fresh acquire onto a non-equipped, non-attuned row (baseline preserved)', () => {
    const s = seed();
    const secondId = newUuidV7();
    const after = reduce(
      s.state,
      {
        type: 'acquire',
        payload: {
          stashId: s.inventoryStashId,
          definitionId: s.longswordDefId,
          quantity: 2,
          source: 'catalog-add',
          newItemInstanceId: secondId,
        },
      },
      ctx,
    );
    const state = after.state as NonNullable<AppState>;
    const longswords = state.items.filter(
      (i) => i.ownerId === s.inventoryStashId && i.definitionId === s.longswordDefId,
    );
    expect(longswords).toHaveLength(1);
    // Original id preserved (existing row) with quantity 1+2 = 3.
    expect(longswords[0]!.id).toBe(s.longswordId);
    expect(longswords[0]!.quantity).toBe(3);
  });
});

describe('BUG-008 (2) — split clears equipped/attuned on the new row', () => {
  it('split from an equipped source produces a new row with equipped:false', () => {
    // Stack of 3 longswords, then equip → auto-split path fires.
    // Instead, exercise split directly against a stacked row that also
    // happens to have equipped=true (edge case: state coming in from a
    // pre-BUG-008 world).
    const s = seed();
    // Acquire 2 more longswords (baseline stack now = 3).
    let state: NonNullable<AppState> = reduce(
      s.state,
      {
        type: 'acquire',
        payload: {
          stashId: s.inventoryStashId,
          definitionId: s.longswordDefId,
          quantity: 2,
          source: 'catalog-add',
          newItemInstanceId: newUuidV7(),
        },
      },
      ctx,
    ).state as NonNullable<AppState>;
    // Force `equipped: true` on the stacked row to exercise the split
    // clear (the reducer wouldn't normally get here — the equip
    // auto-split would prevent it — but the split arm's guarantee is
    // independent of how we got there).
    state = {
      ...state,
      items: state.items.map((i) =>
        i.id === s.longswordId ? { ...i, equipped: true, attuned: true } : i,
      ),
    };

    const splitOffId = newUuidV7();
    const after = reduce(
      state,
      {
        type: 'split',
        payload: {
          itemInstanceId: s.longswordId,
          newItemInstanceId: splitOffId,
          quantity: 1,
        },
      },
      ctx,
    );
    const next = after.state as NonNullable<AppState>;
    const splitOff = next.items.find((i) => i.id === splitOffId)!;
    expect(splitOff.equipped).toBe(false);
    expect(splitOff.attuned).toBe(false);
    // Source row keeps its flags — split does not un-equip the source.
    const source = next.items.find((i) => i.id === s.longswordId)!;
    expect(source.equipped).toBe(true);
    expect(source.attuned).toBe(true);
  });
});

describe('BUG-008 (3) — equip auto-splits a stacked row', () => {
  it('equipping a stack-of-3 splits off a quantity-1 row + equips the NEW row', () => {
    const s = seed();
    // Bring the longsword stack to 3.
    const stackedState: NonNullable<AppState> = reduce(
      s.state,
      {
        type: 'acquire',
        payload: {
          stashId: s.inventoryStashId,
          definitionId: s.longswordDefId,
          quantity: 2,
          source: 'catalog-add',
          newItemInstanceId: newUuidV7(),
        },
      },
      ctx,
    ).state as NonNullable<AppState>;
    expect(stackedState.items.find((i) => i.id === s.longswordId)?.quantity).toBe(3);

    const newRowId = newUuidV7();
    const after = reduce(
      stackedState,
      {
        type: 'equip',
        payload: {
          characterId: s.characterId,
          itemInstanceId: s.longswordId,
          newItemInstanceId: newRowId,
        },
      },
      ctx,
    );
    const next = after.state as NonNullable<AppState>;

    // Source row: quantity dropped from 3 → 2, still unequipped.
    const source = next.items.find((i) => i.id === s.longswordId)!;
    expect(source.quantity).toBe(2);
    expect(source.equipped).toBe(false);

    // New row: quantity 1, equipped, matches source's definitionId.
    const newRow = next.items.find((i) => i.id === newRowId)!;
    expect(newRow.quantity).toBe(1);
    expect(newRow.equipped).toBe(true);
    expect(newRow.attuned).toBe(false);
    expect(newRow.definitionId).toBe(s.longswordDefId);
    expect(newRow.ownerId).toBe(s.inventoryStashId);

    // Log emits split + equip, in that order.
    expect(after.logEntries).toHaveLength(2);
    expect(after.logEntries[0]!.type).toBe('split');
    expect(after.logEntries[1]!.type).toBe('equip');
    const equipEntry = after.logEntries[1];
    if (equipEntry !== undefined && equipEntry.type === 'equip') {
      expect(equipEntry.payload.itemInstanceId).toBe(newRowId);
    }
  });

  it('equipping a quantity-1 row does not require newItemInstanceId (single flip)', () => {
    const s = seed();
    const after = reduce(
      s.state,
      {
        type: 'equip',
        payload: { characterId: s.characterId, itemInstanceId: s.longswordId },
      },
      ctx,
    );
    const next = after.state as NonNullable<AppState>;
    expect(next.items.find((i) => i.id === s.longswordId)?.equipped).toBe(true);
    expect(after.logEntries).toHaveLength(1);
    expect(after.logEntries[0]!.type).toBe('equip');
  });

  it('equipping a stack-of-2 without newItemInstanceId throws (dispatcher discipline)', () => {
    const s = seed();
    const stackedState: NonNullable<AppState> = reduce(
      s.state,
      {
        type: 'acquire',
        payload: {
          stashId: s.inventoryStashId,
          definitionId: s.longswordDefId,
          quantity: 1,
          source: 'catalog-add',
          newItemInstanceId: newUuidV7(),
        },
      },
      ctx,
    ).state as NonNullable<AppState>;
    expect(stackedState.items.find((i) => i.id === s.longswordId)?.quantity).toBe(2);

    expect(() =>
      reduce(
        stackedState,
        {
          type: 'equip',
          payload: { characterId: s.characterId, itemInstanceId: s.longswordId },
        },
        ctx,
      ),
    ).toThrow(/newItemInstanceId/);
  });
});

describe('BUG-008 (3) — attune auto-splits a stacked row', () => {
  it('attuning a stack-of-2 magic items splits off + attunes the NEW row', () => {
    const s = seed();
    // Acquire 2 magic rings.
    let state: NonNullable<AppState> = reduce(
      s.state,
      {
        type: 'acquire',
        payload: {
          stashId: s.inventoryStashId,
          definitionId: s.ringDefId,
          quantity: 2,
          source: 'catalog-add',
          newItemInstanceId: newUuidV7(),
        },
      },
      ctx,
    ).state as NonNullable<AppState>;
    const stackedRing = state.items.find(
      (i) => i.ownerId === s.inventoryStashId && i.definitionId === s.ringDefId,
    )!;
    expect(stackedRing.quantity).toBe(2);

    const newRowId = newUuidV7();
    const after = reduce(
      state,
      {
        type: 'attune',
        payload: {
          characterId: s.characterId,
          itemInstanceId: stackedRing.id,
          newItemInstanceId: newRowId,
        },
      },
      ctx,
    );
    state = after.state as NonNullable<AppState>;

    const source = state.items.find((i) => i.id === stackedRing.id)!;
    expect(source.quantity).toBe(1);
    expect(source.attuned).toBe(false);

    const newRow = state.items.find((i) => i.id === newRowId)!;
    expect(newRow.quantity).toBe(1);
    expect(newRow.attuned).toBe(true);
    expect(newRow.equipped).toBe(false);
    expect(newRow.definitionId).toBe(s.ringDefId);

    expect(after.logEntries).toHaveLength(2);
    expect(after.logEntries[0]!.type).toBe('split');
    expect(after.logEntries[1]!.type).toBe('attune');
  });

  it('attuning a quantity-1 magic item does not require newItemInstanceId', () => {
    const s = seed();
    const ringId = newUuidV7();
    let state: NonNullable<AppState> = reduce(
      s.state,
      {
        type: 'acquire',
        payload: {
          stashId: s.inventoryStashId,
          definitionId: s.ringDefId,
          quantity: 1,
          source: 'catalog-add',
          newItemInstanceId: ringId,
        },
      },
      ctx,
    ).state as NonNullable<AppState>;

    const after = reduce(
      state,
      {
        type: 'attune',
        payload: { characterId: s.characterId, itemInstanceId: ringId },
      },
      ctx,
    );
    state = after.state as NonNullable<AppState>;
    expect(state.items.find((i) => i.id === ringId)?.attuned).toBe(true);
    expect(after.logEntries).toHaveLength(1);
    expect(after.logEntries[0]!.type).toBe('attune');
  });
});

describe('BUG-008 (4) — unequip auto-restacks into a matching mundane row', () => {
  it('unequipping merges the row back into an existing mundane stack (same stash, same def, same notes)', () => {
    const s = seed();
    // Grow the mundane stack to 2 (one from seed + acquire 1 more).
    let state: NonNullable<AppState> = reduce(
      s.state,
      {
        type: 'acquire',
        payload: {
          stashId: s.inventoryStashId,
          definitionId: s.longswordDefId,
          quantity: 1,
          source: 'catalog-add',
          newItemInstanceId: newUuidV7(),
        },
      },
      ctx,
    ).state as NonNullable<AppState>;
    // Stack is now qty=2. Equip → auto-split → source qty=1, new row qty=1 equipped.
    const equippedRowId = newUuidV7();
    state = reduce(
      state,
      {
        type: 'equip',
        payload: {
          characterId: s.characterId,
          itemInstanceId: s.longswordId,
          newItemInstanceId: equippedRowId,
        },
      },
      ctx,
    ).state as NonNullable<AppState>;
    const preUnequip = state.items.filter(
      (i) => i.ownerId === s.inventoryStashId && i.definitionId === s.longswordDefId,
    );
    expect(preUnequip).toHaveLength(2);

    // Unequip the equipped quantity-1 row → merges back into the mundane stack (qty=1 → 2).
    const after = reduce(
      state,
      {
        type: 'unequip',
        payload: { characterId: s.characterId, itemInstanceId: equippedRowId },
      },
      ctx,
    );
    const next = after.state as NonNullable<AppState>;
    const longswords = next.items.filter(
      (i) => i.ownerId === s.inventoryStashId && i.definitionId === s.longswordDefId,
    );
    // Merged: one row, qty=2 (was 1 + the newly-unequipped 1), equipped=false.
    expect(longswords).toHaveLength(1);
    expect(longswords[0]!.id).toBe(s.longswordId);
    expect(longswords[0]!.quantity).toBe(2);
    expect(longswords[0]!.equipped).toBe(false);
    // Only ONE log entry — the `unequip`. Merge is silent (mirrors acquire).
    expect(after.logEntries).toHaveLength(1);
    expect(after.logEntries[0]!.type).toBe('unequip');
  });

  it('unequip leaves the row standalone when no merge target exists', () => {
    const s = seed();
    // Equip the single longsword (qty=1, no auto-split needed).
    const equipped = reduce(
      s.state,
      {
        type: 'equip',
        payload: { characterId: s.characterId, itemInstanceId: s.longswordId },
      },
      ctx,
    );
    const state = equipped.state as NonNullable<AppState>;
    expect(state.items.find((i) => i.id === s.longswordId)?.equipped).toBe(true);

    // Unequip — no other longsword in inventory, so no merge target.
    const after = reduce(
      state,
      {
        type: 'unequip',
        payload: { characterId: s.characterId, itemInstanceId: s.longswordId },
      },
      ctx,
    );
    const next = after.state as NonNullable<AppState>;
    const longswords = next.items.filter(
      (i) => i.ownerId === s.inventoryStashId && i.definitionId === s.longswordDefId,
    );
    expect(longswords).toHaveLength(1);
    expect(longswords[0]!.id).toBe(s.longswordId);
    expect(longswords[0]!.quantity).toBe(1);
    expect(longswords[0]!.equipped).toBe(false);
  });

  it('unequip does NOT merge when the row is still attuned (both flags must clear)', () => {
    const s = seed();
    // Grow the stack to 2, then equip → auto-split → source qty=1, new row equipped=true.
    let state: NonNullable<AppState> = reduce(
      s.state,
      {
        type: 'acquire',
        payload: {
          stashId: s.inventoryStashId,
          definitionId: s.longswordDefId,
          quantity: 1,
          source: 'catalog-add',
          newItemInstanceId: newUuidV7(),
        },
      },
      ctx,
    ).state as NonNullable<AppState>;
    const equippedRowId = newUuidV7();
    state = reduce(
      state,
      {
        type: 'equip',
        payload: {
          characterId: s.characterId,
          itemInstanceId: s.longswordId,
          newItemInstanceId: equippedRowId,
        },
      },
      ctx,
    ).state as NonNullable<AppState>;
    // Force `attuned: true` on the equipped row (edge case: state coming
    // in mid-equipped-and-attuned. This can happen for magic weapons
    // where the character both equips AND attunes them separately.).
    state = {
      ...state,
      items: state.items.map((i) => (i.id === equippedRowId ? { ...i, attuned: true } : i)),
    };

    const after = reduce(
      state,
      {
        type: 'unequip',
        payload: { characterId: s.characterId, itemInstanceId: equippedRowId },
      },
      ctx,
    );
    const next = after.state as NonNullable<AppState>;
    // Row stays standalone — still attuned=true, so must remain qty=1.
    const equippedRow = next.items.find((i) => i.id === equippedRowId);
    expect(equippedRow).toBeDefined();
    expect(equippedRow?.equipped).toBe(false);
    expect(equippedRow?.attuned).toBe(true);
    expect(equippedRow?.quantity).toBe(1);
    // Source row still qty=1 (no merge).
    expect(next.items.find((i) => i.id === s.longswordId)?.quantity).toBe(1);
  });

  it('unequip does NOT merge a row with non-null currentCharges (charge-count safety)', () => {
    const s = seed();
    // Create a stack of 2 charged items via acquire + reducer path.
    // For simplicity we hand-craft the state with a charged equipped row
    // and a matching mundane row.
    const chargedId = newUuidV7();
    const mundaneId = newUuidV7();
    const stateWithCharges: NonNullable<AppState> = {
      ...s.state,
      items: [
        // Delete the seeded longsword; replace with our two rows.
        ...s.state.items.filter((i) => i.id !== s.longswordId),
        {
          id: chargedId,
          definitionId: s.longswordDefId,
          ownerType: 'stash',
          ownerId: s.inventoryStashId,
          containerInstanceId: null,
          quantity: 1,
          equipped: true,
          attuned: false,
          identified: true,
          currentCharges: 5,
        },
        {
          id: mundaneId,
          definitionId: s.longswordDefId,
          ownerType: 'stash',
          ownerId: s.inventoryStashId,
          containerInstanceId: null,
          quantity: 3,
          equipped: false,
          attuned: false,
          identified: true,
          currentCharges: null,
        },
      ],
    };

    const after = reduce(
      stateWithCharges,
      {
        type: 'unequip',
        payload: { characterId: s.characterId, itemInstanceId: chargedId },
      },
      ctx,
    );
    const next = after.state as NonNullable<AppState>;
    // Charged row stays standalone; mundane stack untouched.
    expect(next.items.find((i) => i.id === chargedId)).toBeDefined();
    expect(next.items.find((i) => i.id === chargedId)?.currentCharges).toBe(5);
    expect(next.items.find((i) => i.id === mundaneId)?.quantity).toBe(3);
  });
});

describe('BUG-008 (4) — unattune auto-restacks', () => {
  it('unattuning merges into an existing mundane stack when both flags become false', () => {
    const s = seed();
    // Set up: an attuned magic ring (qty=1) + a mundane stack of the same ring (qty=2).
    const attunedId = newUuidV7();
    const mundaneId = newUuidV7();
    const state: NonNullable<AppState> = {
      ...s.state,
      items: [
        ...s.state.items,
        {
          id: attunedId,
          definitionId: s.ringDefId,
          ownerType: 'stash',
          ownerId: s.inventoryStashId,
          containerInstanceId: null,
          quantity: 1,
          equipped: false,
          attuned: true,
          identified: true,
          currentCharges: null,
        },
        {
          id: mundaneId,
          definitionId: s.ringDefId,
          ownerType: 'stash',
          ownerId: s.inventoryStashId,
          containerInstanceId: null,
          quantity: 2,
          equipped: false,
          attuned: false,
          identified: true,
          currentCharges: null,
        },
      ],
    };

    const after = reduce(
      state,
      {
        type: 'unattune',
        payload: { characterId: s.characterId, itemInstanceId: attunedId },
      },
      ctx,
    );
    const next = after.state as NonNullable<AppState>;
    // Merged: attunedId is gone; mundane stack is now qty=3.
    expect(next.items.find((i) => i.id === attunedId)).toBeUndefined();
    expect(next.items.find((i) => i.id === mundaneId)?.quantity).toBe(3);
  });

  it('unattune leaves the row standalone if it is still equipped', () => {
    const s = seed();
    // Attuned + equipped magic ring (qty=1) alongside a mundane stack.
    const attunedId = newUuidV7();
    const mundaneId = newUuidV7();
    const state: NonNullable<AppState> = {
      ...s.state,
      items: [
        ...s.state.items,
        {
          id: attunedId,
          definitionId: s.ringDefId,
          ownerType: 'stash',
          ownerId: s.inventoryStashId,
          containerInstanceId: null,
          quantity: 1,
          equipped: true,
          attuned: true,
          identified: true,
          currentCharges: null,
        },
        {
          id: mundaneId,
          definitionId: s.ringDefId,
          ownerType: 'stash',
          ownerId: s.inventoryStashId,
          containerInstanceId: null,
          quantity: 1,
          equipped: false,
          attuned: false,
          identified: true,
          currentCharges: null,
        },
      ],
    };

    const after = reduce(
      state,
      {
        type: 'unattune',
        payload: { characterId: s.characterId, itemInstanceId: attunedId },
      },
      ctx,
    );
    const next = after.state as NonNullable<AppState>;
    // Row still equipped=true, so must NOT merge.
    expect(next.items.find((i) => i.id === attunedId)?.equipped).toBe(true);
    expect(next.items.find((i) => i.id === attunedId)?.attuned).toBe(false);
    expect(next.items.find((i) => i.id === attunedId)?.quantity).toBe(1);
    expect(next.items.find((i) => i.id === mundaneId)?.quantity).toBe(1);
  });
});
