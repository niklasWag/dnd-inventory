import { describe, expect, it, beforeEach } from 'vitest';

import { useStore, flushPendingPersist } from './index';
import { loadAppState } from '@/db/load';
import { wipeAll } from '@/db/wipe';
import { appStateSchema, type ItemDefinition } from '@app/shared';
import { PHB_SEED_VERSION, loadPhbSeed } from '@app/seeds';

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

const validPayload = {
  name: 'Thorin',
  species: 'Dwarf',
  class: 'Fighter',
  level: 1,
  str: 16,
};

describe('store plumbing', () => {
  it('starts with null appState and empty log', () => {
    const s = useStore.getState();
    expect(s.appState).toBeNull();
    expect(s.log).toEqual([]);
  });
});

describe('reducer: create-character (M1)', () => {
  it('provisions user + party + 2 memberships + character + 3 stashes + 3 currencies', () => {
    useStore.getState().dispatch({ type: 'create-character', payload: validPayload });
    const s = useStore.getState().appState;

    expect(s).not.toBeNull();
    if (s === null) return; // narrow for TS

    expect(s.user.displayName).toBe('You');
    expect(s.party.isSoloShortcut).toBe(true);
    expect(s.party.bankerUserId).toBeNull();
    expect(s.memberships).toHaveLength(2);
    expect(s.memberships.map((m) => m.role).sort()).toEqual(['dm', 'player']);
    expect(s.characters).toHaveLength(1);
    expect(s.stashes).toHaveLength(3);
    expect(s.stashes.map((st) => st.scope).sort()).toEqual([
      'character',
      'party',
      'recovered-loot',
    ]);
    expect(s.currencies).toHaveLength(3);
  });

  it('character.inventoryStashId references the isCarried stash', () => {
    useStore.getState().dispatch({ type: 'create-character', payload: validPayload });
    const s = useStore.getState().appState;
    if (s === null) throw new Error('appState should be populated');

    const inv = s.stashes.find((st) => st.id === s.characters[0]!.inventoryStashId);
    expect(inv).toBeDefined();
    expect(inv!.scope).toBe('character');
    expect(inv!.isCarried).toBe(true);
  });

  it('party.recoveredLootStashId references the recovered-loot scope stash', () => {
    useStore.getState().dispatch({ type: 'create-character', payload: validPayload });
    const s = useStore.getState().appState;
    if (s === null) throw new Error('appState should be populated');

    const loot = s.stashes.find((st) => st.id === s.party.recoveredLootStashId);
    expect(loot).toBeDefined();
    expect(loot!.scope).toBe('recovered-loot');
  });

  it('player membership references the new character; dm membership has null characterId', () => {
    useStore.getState().dispatch({ type: 'create-character', payload: validPayload });
    const s = useStore.getState().appState;
    if (s === null) throw new Error('appState should be populated');

    const dm = s.memberships.find((m) => m.role === 'dm');
    const player = s.memberships.find((m) => m.role === 'player');
    expect(dm!.characterId).toBeNull();
    expect(player!.characterId).toBe(s.characters[0]!.id);
    expect(dm!.userId).toBe(player!.userId);
  });

  it('one CurrencyHolding row per stash with all denominations zero', () => {
    useStore.getState().dispatch({ type: 'create-character', payload: validPayload });
    const s = useStore.getState().appState;
    if (s === null) throw new Error('appState should be populated');

    for (const stash of s.stashes) {
      const holding = s.currencies.find((c) => c.stashId === stash.id);
      expect(holding).toBeDefined();
      expect(holding).toMatchObject({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
    }
  });

  it('appends a typed create-character log entry with actorRole=dm', () => {
    useStore.getState().dispatch({ type: 'create-character', payload: validPayload });
    const { log, appState } = useStore.getState();

    expect(log).toHaveLength(1);
    expect(log[0]!.type).toBe('create-character');
    expect(log[0]!.actorRole).toBe('dm');
    expect(log[0]!.partyId).toBe(appState!.party.id);
    expect(log[0]!.id).toMatch(/[0-9a-f-]{36}/);
    expect(log[0]!.timestamp).toMatch(/\d{4}-\d{2}-\d{2}T/);
    // payload should carry every id the UI needs to navigate
    if (log[0]!.type === 'create-character') {
      expect(log[0]!.payload.characterId).toBe(appState!.characters[0]!.id);
      expect(log[0]!.payload.inventoryStashId).toBe(appState!.characters[0]!.inventoryStashId);
    }
  });

  it('produces an AppState that validates against the shared Zod schema', () => {
    useStore.getState().dispatch({ type: 'create-character', payload: validPayload });
    const s = useStore.getState().appState;
    expect(() => appStateSchema.parse(s)).not.toThrow();
  });

  it('rejects a second create-character once one exists', () => {
    const { dispatch } = useStore.getState();
    dispatch({ type: 'create-character', payload: validPayload });
    expect(() =>
      dispatch({ type: 'create-character', payload: { ...validPayload, name: 'Other' } }),
    ).toThrow(/already exists/);
  });

  it('debounced persist round-trips the new state + log through Dexie', async () => {
    useStore.getState().dispatch({ type: 'create-character', payload: validPayload });
    // Nothing written yet (debounce window still open).
    expect(await loadAppState()).toBeNull();

    await flushPendingPersist();

    const persisted = (await loadAppState()) as {
      appState: unknown;
      log: unknown[];
    } | null;
    expect(persisted).not.toBeNull();
    expect(persisted!.log).toHaveLength(1);
    // Round-trip validates against the shared schema too.
    expect(() => appStateSchema.parse(persisted!.appState)).not.toThrow();
  });
});

// -------------------------------------------------------------------- //
// M2: seed-catalog / acquire / consume
// -------------------------------------------------------------------- //

/**
 * Test helper: bring the store to the post-M2-bootstrap baseline — a fresh
 * character plus a seeded catalog. Every M2 test starts here so each suite
 * focuses on its own action rather than the create-character setup.
 */
function bootstrap(): {
  characterId: string;
  inventoryStashId: string;
  partyStashId: string;
  recoveredLootStashId: string;
  catalog: ItemDefinition[];
} {
  const { dispatch } = useStore.getState();
  dispatch({ type: 'create-character', payload: validPayload });
  const phb = loadPhbSeed();
  dispatch({
    type: 'seed-catalog',
    payload: { seedVersion: PHB_SEED_VERSION, entries: phb },
  });
  const s = useStore.getState().appState!;
  return {
    characterId: s.characters[0]!.id,
    inventoryStashId: s.characters[0]!.inventoryStashId,
    partyStashId: s.stashes.find((st) => st.scope === 'party')!.id,
    recoveredLootStashId: s.party.recoveredLootStashId,
    catalog: s.catalog,
  };
}

describe('reducer: seed-catalog (M2)', () => {
  it('populates the catalog from an empty state and bumps seedVersion', () => {
    useStore.getState().dispatch({ type: 'create-character', payload: validPayload });
    const before = useStore.getState().appState!;
    expect(before.catalog).toHaveLength(0);
    expect(before.seedVersion).toBe(0);

    const phb = loadPhbSeed();
    useStore.getState().dispatch({
      type: 'seed-catalog',
      payload: { seedVersion: PHB_SEED_VERSION, entries: phb },
    });

    const after = useStore.getState().appState!;
    expect(after.catalog).toHaveLength(phb.length);
    expect(after.seedVersion).toBe(PHB_SEED_VERSION);
    expect(() => appStateSchema.parse(after)).not.toThrow();
  });

  it('is idempotent: re-applying the same seed yields the same catalog size', () => {
    bootstrap();
    const sizeAfterFirst = useStore.getState().appState!.catalog.length;
    useStore.getState().dispatch({
      type: 'seed-catalog',
      payload: { seedVersion: PHB_SEED_VERSION, entries: loadPhbSeed() },
    });
    expect(useStore.getState().appState!.catalog).toHaveLength(sizeAfterFirst);
  });

  it('upserts PHB rows without disturbing homebrew entries', () => {
    bootstrap();
    // Inject a fake homebrew row directly — the create-homebrew action
    // lands in M6, but seed-catalog must already respect homebrew.
    const homebrewId = 'homebrew:test-trinket';
    useStore.setState((s) => {
      if (s.appState === null) return s;
      return {
        ...s,
        appState: {
          ...s.appState,
          catalog: [
            ...s.appState.catalog,
            {
              id: homebrewId,
              name: 'Test Trinket',
              source: 'homebrew',
              category: 'gear',
            },
          ],
        },
      };
    });

    // Re-seed: PHB entries get upserted, homebrew should survive untouched.
    useStore.getState().dispatch({
      type: 'seed-catalog',
      payload: { seedVersion: PHB_SEED_VERSION + 1, entries: loadPhbSeed() },
    });

    const after = useStore.getState().appState!;
    const homebrew = after.catalog.find((d) => d.id === homebrewId);
    expect(homebrew).toBeDefined();
    expect(homebrew!.source).toBe('homebrew');
    expect(after.seedVersion).toBe(PHB_SEED_VERSION + 1);
  });

  it('logs a seed-catalog entry with the right add/update split', () => {
    useStore.getState().dispatch({ type: 'create-character', payload: validPayload });
    const phb = loadPhbSeed();

    useStore.getState().dispatch({
      type: 'seed-catalog',
      payload: { seedVersion: PHB_SEED_VERSION, entries: phb },
    });

    const log = useStore.getState().log;
    const seedEntry = log.find((e) => e.type === 'seed-catalog');
    expect(seedEntry).toBeDefined();
    if (seedEntry?.type === 'seed-catalog') {
      expect(seedEntry.payload.addedDefinitionIds).toHaveLength(phb.length);
      expect(seedEntry.payload.updatedDefinitionIds).toHaveLength(0);
      expect(seedEntry.payload.seedVersion).toBe(PHB_SEED_VERSION);
    }
  });

  it('rejects seed-catalog before create-character (no AppState)', () => {
    expect(() =>
      useStore.getState().dispatch({
        type: 'seed-catalog',
        payload: { seedVersion: PHB_SEED_VERSION, entries: loadPhbSeed() },
      }),
    ).toThrow(/no AppState/);
  });
});

describe('reducer: acquire (M2)', () => {
  it('creates a new item row when the stash is empty for that definition', () => {
    const { inventoryStashId, catalog } = bootstrap();
    const rope = catalog.find((d) => d.id === 'phb-2024:rope-hempen-50ft')!;

    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: rope.id,
        quantity: 1,
        source: 'custom-create',
      },
    });

    const items = useStore.getState().appState!.items;
    expect(items).toHaveLength(1);
    expect(items[0]!.definitionId).toBe(rope.id);
    expect(items[0]!.ownerId).toBe(inventoryStashId);
    expect(items[0]!.quantity).toBe(1);
  });

  it('auto-stacks identical (definitionId, notes) acquires onto one row', () => {
    const { inventoryStashId, catalog } = bootstrap();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    const { dispatch } = useStore.getState();

    dispatch({
      type: 'acquire',
      payload: { stashId: inventoryStashId, definitionId: torch.id, quantity: 2, source: 'custom-create' },
    });
    dispatch({
      type: 'acquire',
      payload: { stashId: inventoryStashId, definitionId: torch.id, quantity: 3, source: 'custom-create' },
    });

    const items = useStore.getState().appState!.items;
    expect(items).toHaveLength(1);
    expect(items[0]!.quantity).toBe(5);

    // Both log entries reference the same itemInstanceId.
    const acquires = useStore.getState().log.filter((e) => e.type === 'acquire');
    expect(acquires).toHaveLength(2);
    if (acquires[0]?.type === 'acquire' && acquires[1]?.type === 'acquire') {
      expect(acquires[0].payload.itemInstanceId).toBe(acquires[1].payload.itemInstanceId);
    }
  });

  it('keeps different notes on separate rows', () => {
    const { inventoryStashId, catalog } = bootstrap();
    const dagger = catalog.find((d) => d.id === 'phb-2024:dagger')!;
    const { dispatch } = useStore.getState();

    dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: dagger.id,
        quantity: 1,
        source: 'custom-create',
        notes: 'given by Volo',
      },
    });
    dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: dagger.id,
        quantity: 1,
        source: 'custom-create',
        notes: 'looted',
      },
    });

    const items = useStore.getState().appState!.items;
    expect(items).toHaveLength(2);
    expect(new Set(items.map((i) => i.notes))).toEqual(new Set(['given by Volo', 'looted']));
  });

  it('logs the acquire entry with actorRole=player', () => {
    const { inventoryStashId, catalog } = bootstrap();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'custom-create',
      },
    });
    const last = useStore.getState().log.at(-1);
    expect(last?.type).toBe('acquire');
    expect(last?.actorRole).toBe('player');
  });

  it('rejects unknown stashId, unknown definitionId, and non-positive quantity', () => {
    const { inventoryStashId, catalog } = bootstrap();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    const { dispatch } = useStore.getState();

    expect(() =>
      dispatch({
        type: 'acquire',
        payload: {
          stashId: 'nope',
          definitionId: torch.id,
          quantity: 1,
          source: 'custom-create',
        },
      }),
    ).toThrow(/unknown stashId/);

    expect(() =>
      dispatch({
        type: 'acquire',
        payload: {
          stashId: inventoryStashId,
          definitionId: 'nope',
          quantity: 1,
          source: 'custom-create',
        },
      }),
    ).toThrow(/unknown definitionId/);

    expect(() =>
      dispatch({
        type: 'acquire',
        payload: {
          stashId: inventoryStashId,
          definitionId: torch.id,
          quantity: 0,
          source: 'custom-create',
        },
      }),
    ).toThrow(/quantity must be positive/);
  });

  it('produces AppState that still validates against the shared schema', () => {
    const { inventoryStashId, catalog } = bootstrap();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 4,
        source: 'custom-create',
      },
    });
    expect(() => appStateSchema.parse(useStore.getState().appState)).not.toThrow();
  });
});

describe('reducer: consume (M2)', () => {
  function bootstrapWithStack(quantity: number): { itemInstanceId: string; stashId: string } {
    const { inventoryStashId, catalog } = bootstrap();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity,
        source: 'custom-create',
      },
    });
    const row = useStore.getState().appState!.items[0]!;
    return { itemInstanceId: row.id, stashId: inventoryStashId };
  }

  it('decrements quantity and keeps the row when consuming part of a stack', () => {
    const { itemInstanceId } = bootstrapWithStack(5);
    useStore.getState().dispatch({
      type: 'consume',
      payload: { itemInstanceId, quantity: 2 },
    });

    const items = useStore.getState().appState!.items;
    expect(items).toHaveLength(1);
    expect(items[0]!.quantity).toBe(3);

    const last = useStore.getState().log.at(-1);
    expect(last?.type).toBe('consume');
    if (last?.type === 'consume') expect(last.payload.removed).toBe(false);
  });

  it('removes the row and logs removed=true when consuming the full quantity', () => {
    const { itemInstanceId } = bootstrapWithStack(3);
    useStore.getState().dispatch({
      type: 'consume',
      payload: { itemInstanceId, quantity: 3 },
    });

    expect(useStore.getState().appState!.items).toHaveLength(0);
    const last = useStore.getState().log.at(-1);
    if (last?.type === 'consume') expect(last.payload.removed).toBe(true);
  });

  it('rejects over-consumption and unknown ids', () => {
    const { itemInstanceId } = bootstrapWithStack(2);
    expect(() =>
      useStore.getState().dispatch({
        type: 'consume',
        payload: { itemInstanceId, quantity: 5 },
      }),
    ).toThrow(/exceeds row quantity/);

    expect(() =>
      useStore.getState().dispatch({
        type: 'consume',
        payload: { itemInstanceId: 'nope', quantity: 1 },
      }),
    ).toThrow(/unknown itemInstanceId/);
  });
});
