import { describe, expect, it, beforeEach } from 'vitest';

import { useStore, flushPendingPersist } from './index';
import { loadAppState } from '@/db/load';
import { wipeAll } from '@/db/wipe';
import { appStateSchema, transactionLogEntrySchema } from '@app/shared';
import { PHB_SEED_VERSION, loadPhbSeed } from '@app/seeds';

import { bootstrap } from '@/test/fixtures';

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

// reducer.test.ts uses level: 1 specifically (a lot of suites depend on that
// baseline). fixtures' default is level: 3 — pass our own payload explicitly
// to bootstrap() to keep these tests stable.
const validPayload = {
  name: 'Thorin',
  species: 'Dwarf',
  size: 'medium',
  class: 'Fighter',
  level: 1,
  str: 16,
} as const;

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
      expect(log[0].payload.characterId).toBe(appState!.characters[0]!.id);
      expect(log[0].payload.inventoryStashId).toBe(appState!.characters[0]!.inventoryStashId);
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
 * Thin alias around the shared fixtures `bootstrap()` so this test file's
 * suites keep using `level: 1` for the create-character payload.
 * Fixtures default to `level: 3`.
 */
function localBootstrap(): ReturnType<typeof bootstrap> {
  return bootstrap(validPayload);
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
    localBootstrap();
    const sizeAfterFirst = useStore.getState().appState!.catalog.length;
    useStore.getState().dispatch({
      type: 'seed-catalog',
      payload: { seedVersion: PHB_SEED_VERSION, entries: loadPhbSeed() },
    });
    expect(useStore.getState().appState!.catalog).toHaveLength(sizeAfterFirst);
  });

  it('upserts PHB rows without disturbing homebrew entries', () => {
    localBootstrap();
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
    const { inventoryStashId, catalog } = localBootstrap();
    const rope = catalog.find((d) => d.id === 'phb-2024:rope-hempen-50ft')!;

    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: rope.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });

    const items = useStore.getState().appState!.items;
    expect(items).toHaveLength(1);
    expect(items[0]!.definitionId).toBe(rope.id);
    expect(items[0]!.ownerId).toBe(inventoryStashId);
    expect(items[0]!.quantity).toBe(1);
  });

  it('auto-stacks identical (definitionId, notes) acquires onto one row', () => {
    const { inventoryStashId, catalog } = localBootstrap();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    const { dispatch } = useStore.getState();

    dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 2,
        source: 'catalog-add',
      },
    });
    dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 3,
        source: 'catalog-add',
      },
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
    const { inventoryStashId, catalog } = localBootstrap();
    const dagger = catalog.find((d) => d.id === 'phb-2024:dagger')!;
    const { dispatch } = useStore.getState();

    dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: dagger.id,
        quantity: 1,
        source: 'catalog-add',
        notes: 'given by Volo',
      },
    });
    dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: dagger.id,
        quantity: 1,
        source: 'catalog-add',
        notes: 'looted',
      },
    });

    const items = useStore.getState().appState!.items;
    expect(items).toHaveLength(2);
    expect(new Set(items.map((i) => i.notes))).toEqual(new Set(['given by Volo', 'looted']));
  });

  it('logs the acquire entry with actorRole=player', () => {
    const { inventoryStashId, catalog } = localBootstrap();
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
    const last = useStore.getState().log.at(-1);
    expect(last?.type).toBe('acquire');
    expect(last?.actorRole).toBe('player');
  });

  it('rejects unknown stashId, unknown definitionId, and non-positive quantity', () => {
    const { inventoryStashId, catalog } = localBootstrap();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    const { dispatch } = useStore.getState();

    expect(() =>
      dispatch({
        type: 'acquire',
        payload: {
          stashId: 'nope',
          definitionId: torch.id,
          quantity: 1,
          source: 'catalog-add',
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
          source: 'catalog-add',
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
          source: 'catalog-add',
        },
      }),
    ).toThrow(/quantity must be positive/);
  });

  it('produces AppState that still validates against the shared schema', () => {
    const { inventoryStashId, catalog } = localBootstrap();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 4,
        source: 'catalog-add',
      },
    });
    expect(() => appStateSchema.parse(useStore.getState().appState)).not.toThrow();
  });
});

describe('reducer: consume (M2)', () => {
  function bootstrapWithStack(quantity: number): { itemInstanceId: string; stashId: string } {
    const { inventoryStashId, catalog } = localBootstrap();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity,
        source: 'catalog-add',
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

// -------------------------------------------------------------------- //
// M2.5: edit-item-instance + back-compat
// -------------------------------------------------------------------- //

/**
 * Bootstrap the store with a Torch row in inventory. Returns the row id +
 * stash id so each edit-item-instance test starts from a clean baseline.
 */
function bootstrapWithItem(initial: { customName?: string; notes?: string } = {}): {
  itemInstanceId: string;
  inventoryStashId: string;
  torchDefId: string;
} {
  const { inventoryStashId, catalog } = localBootstrap();
  const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
  useStore.getState().dispatch({
    type: 'acquire',
    payload: {
      stashId: inventoryStashId,
      definitionId: torch.id,
      quantity: 1,
      source: 'catalog-add',
      ...(initial.notes !== undefined ? { notes: initial.notes } : {}),
    },
  });
  // customName isn't an acquire field — patch it directly into state for
  // tests that need a pre-existing customName baseline.
  if (initial.customName !== undefined) {
    useStore.setState((s) => {
      if (s.appState === null) return s;
      return {
        ...s,
        appState: {
          ...s.appState,
          items: s.appState.items.map((i) => ({ ...i, customName: initial.customName })),
        },
      };
    });
  }
  const row = useStore.getState().appState!.items[0]!;
  return { itemInstanceId: row.id, inventoryStashId, torchDefId: torch.id };
}

describe('reducer: edit-item-instance (M2.5)', () => {
  it('updates customName only and logs changedFields: [customName]', () => {
    const { itemInstanceId } = bootstrapWithItem();
    useStore.getState().dispatch({
      type: 'edit-item-instance',
      payload: { itemInstanceId, patch: { customName: 'Glamdring' } },
    });

    const row = useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!;
    expect(row.customName).toBe('Glamdring');
    expect(row.notes).toBeUndefined();
    expect(row.id).toBe(itemInstanceId); // id is stable across edits

    const last = useStore.getState().log.at(-1);
    expect(last?.type).toBe('edit-item-instance');
    if (last?.type === 'edit-item-instance') {
      expect(last.payload.changedFields).toEqual(['customName']);
      expect(last.payload.itemInstanceId).toBe(itemInstanceId);
    }
  });

  it('updates notes only and logs changedFields: [notes]', () => {
    const { itemInstanceId } = bootstrapWithItem({ notes: 'fragile' });
    useStore.getState().dispatch({
      type: 'edit-item-instance',
      payload: { itemInstanceId, patch: { notes: 'broken' } },
    });

    const row = useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!;
    expect(row.notes).toBe('broken');

    const last = useStore.getState().log.at(-1);
    if (last?.type === 'edit-item-instance') {
      expect(last.payload.changedFields).toEqual(['notes']);
    }
  });

  it('updates both fields in one dispatch and logs both in changedFields', () => {
    const { itemInstanceId } = bootstrapWithItem();
    useStore.getState().dispatch({
      type: 'edit-item-instance',
      payload: { itemInstanceId, patch: { customName: 'Sting', notes: 'moonsilver' } },
    });

    const row = useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!;
    expect(row.customName).toBe('Sting');
    expect(row.notes).toBe('moonsilver');

    const last = useStore.getState().log.at(-1);
    if (last?.type === 'edit-item-instance') {
      expect(last.payload.changedFields).toEqual(['customName', 'notes']);
    }
    // Single log entry, not two
    const edits = useStore.getState().log.filter((e) => e.type === 'edit-item-instance');
    expect(edits).toHaveLength(1);
  });

  it('preserves empty-string notes as a distinct value (decision #4)', () => {
    const { itemInstanceId } = bootstrapWithItem({ notes: 'something' });
    useStore.getState().dispatch({
      type: 'edit-item-instance',
      payload: { itemInstanceId, patch: { notes: '' } },
    });

    const row = useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!;
    // Empty string is preserved, NOT coerced to undefined.
    expect(row.notes).toBe('');

    const last = useStore.getState().log.at(-1);
    if (last?.type === 'edit-item-instance') {
      expect(last.payload.changedFields).toEqual(['notes']);
    }
  });

  it('throws when the patch contains values identical to the current row (no-op)', () => {
    const { itemInstanceId } = bootstrapWithItem({ customName: 'Sting' });
    const beforeLogLen = useStore.getState().log.length;
    expect(() =>
      useStore.getState().dispatch({
        type: 'edit-item-instance',
        payload: { itemInstanceId, patch: { customName: 'Sting' } },
      }),
    ).toThrow(/no fields changed/);
    expect(useStore.getState().log).toHaveLength(beforeLogLen);
  });

  it('throws on an empty patch object', () => {
    const { itemInstanceId } = bootstrapWithItem();
    expect(() =>
      useStore.getState().dispatch({
        type: 'edit-item-instance',
        payload: { itemInstanceId, patch: {} },
      }),
    ).toThrow(/no fields changed/);
  });

  it('throws on unknown itemInstanceId', () => {
    bootstrapWithItem();
    expect(() =>
      useStore.getState().dispatch({
        type: 'edit-item-instance',
        payload: { itemInstanceId: 'nope', patch: { customName: 'X' } },
      }),
    ).toThrow(/unknown itemInstanceId/);
  });

  it('throws when AppState is null (no character yet)', () => {
    expect(() =>
      useStore.getState().dispatch({
        type: 'edit-item-instance',
        payload: { itemInstanceId: 'whatever', patch: { customName: 'X' } },
      }),
    ).toThrow(/no AppState/);
  });

  it('ignores keys outside the M2.5 allowlist (defensive)', () => {
    // TS gates this at compile time; this runtime test documents intent.
    // The reducer iterates a closed allowlist of [customName, notes], so
    // extra keys on the patch are silently dropped — which means a patch
    // containing ONLY non-allowlist keys collapses to "no fields changed".
    const { itemInstanceId } = bootstrapWithItem();
    const beforeLogLen = useStore.getState().log.length;
    // Cast through `unknown` then to the correct payload shape. This is
    // the no-`any` way to construct a deliberately-malformed payload for
    // a defensive test (CLAUDE.md: "no `any`, validate at boundaries").
    const bogusPatch = { equipped: true } as unknown as {
      customName?: string;
      notes?: string;
    };
    expect(() =>
      useStore.getState().dispatch({
        type: 'edit-item-instance',
        payload: { itemInstanceId, patch: bogusPatch },
      }),
    ).toThrow(/no fields changed/);
    expect(useStore.getState().log).toHaveLength(beforeLogLen);
  });

  it('leaves two rows separate when an edit would collide on (definitionId, notes) — M5 follow-up', () => {
    // Two Torch rows distinguished only by `notes`.
    const { inventoryStashId, catalog } = localBootstrap();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    const { dispatch } = useStore.getState();
    dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
        notes: 'A',
      },
    });
    dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
        notes: 'B',
      },
    });

    const rowB = useStore.getState().appState!.items.find((i) => i.notes === 'B')!;

    // Edit row B's notes to 'A' — would collide with row A's auto-stack key.
    // M2.5 decision #5: rows stay separate (no silent merge, no throw).
    dispatch({
      type: 'edit-item-instance',
      payload: { itemInstanceId: rowB.id, patch: { notes: 'A' } },
    });

    const items = useStore.getState().appState!.items;
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.notes === 'A')).toBe(true);
    // Both rows still have distinct ids (no merge).
    expect(new Set(items.map((i) => i.id)).size).toBe(2);
  });

  it('logs exactly one entry with actorRole=player and the correct ids', () => {
    const { itemInstanceId } = bootstrapWithItem();
    const beforeLen = useStore.getState().log.length;
    useStore.getState().dispatch({
      type: 'edit-item-instance',
      payload: { itemInstanceId, patch: { customName: 'X' } },
    });
    const after = useStore.getState();
    expect(after.log).toHaveLength(beforeLen + 1);
    const last = after.log.at(-1)!;
    expect(last.type).toBe('edit-item-instance');
    expect(last.actorRole).toBe('player');
    expect(last.actorUserId).toBe(after.appState!.user.id);
    expect(last.partyId).toBe(after.appState!.party.id);
  });

  it('produces AppState that still validates against the shared schema', () => {
    const { itemInstanceId } = bootstrapWithItem();
    useStore.getState().dispatch({
      type: 'edit-item-instance',
      payload: { itemInstanceId, patch: { customName: 'Sting', notes: 'moonsilver' } },
    });
    expect(() => appStateSchema.parse(useStore.getState().appState)).not.toThrow();
  });
});

describe('schema back-compat: source = custom-create still validates (M2.5)', () => {
  it('an M2-vintage acquire log entry with source: "custom-create" still parses', () => {
    // M2 dispatches recorded `source: "custom-create"` for catalog-add.
    // M2.5 renamed new dispatches to `"catalog-add"` but kept `"custom-create"`
    // in the Zod enum so persisted Dexie blobs from M2 still rehydrate.
    const legacy = {
      id: '11111111-1111-1111-1111-111111111111',
      partyId: '22222222-2222-2222-2222-222222222222',
      sessionId: null,
      timestamp: new Date().toISOString(),
      actorUserId: '33333333-3333-3333-3333-333333333333',
      actorRole: 'player' as const,
      type: 'acquire' as const,
      payload: {
        stashId: '44444444-4444-4444-4444-444444444444',
        itemInstanceId: '55555555-5555-5555-5555-555555555555',
        definitionId: 'phb-2024:torch',
        quantity: 1,
        source: 'custom-create' as const,
      },
    };
    expect(() => transactionLogEntrySchema.parse(legacy)).not.toThrow();
  });

  it('a fresh M2.5 acquire log entry with source: "catalog-add" parses', () => {
    const fresh = {
      id: '11111111-1111-1111-1111-111111111111',
      partyId: '22222222-2222-2222-2222-222222222222',
      sessionId: null,
      timestamp: new Date().toISOString(),
      actorUserId: '33333333-3333-3333-3333-333333333333',
      actorRole: 'player' as const,
      type: 'acquire' as const,
      payload: {
        stashId: '44444444-4444-4444-4444-444444444444',
        itemInstanceId: '55555555-5555-5555-5555-555555555555',
        definitionId: 'phb-2024:torch',
        quantity: 1,
        source: 'catalog-add' as const,
      },
    };
    expect(() => transactionLogEntrySchema.parse(fresh)).not.toThrow();
  });
});

// -------------------------------------------------------------------- //
// M3: create-stash / rename-stash / delete-stash
// -------------------------------------------------------------------- //

describe('reducer: create-stash (M3)', () => {
  it('appends a character-scope, non-carried Storage stash', () => {
    const { characterId } = localBootstrap();
    const beforeCount = useStore.getState().appState!.stashes.length;

    useStore.getState().dispatch({
      type: 'create-stash',
      payload: { ownerCharacterId: characterId, name: 'Chest at home' },
    });

    const s = useStore.getState().appState!;
    expect(s.stashes).toHaveLength(beforeCount + 1);
    const newStash = s.stashes.at(-1)!;
    expect(newStash.scope).toBe('character');
    expect(newStash.isCarried).toBe(false);
    expect(newStash.name).toBe('Chest at home');
    if (newStash.scope === 'character') {
      expect(newStash.ownerCharacterId).toBe(characterId);
      expect(newStash.partyId).toBeNull();
    }
    expect(newStash.id).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('appends a matching CurrencyHolding row (all zeros)', () => {
    const { characterId } = localBootstrap();

    useStore.getState().dispatch({
      type: 'create-stash',
      payload: { ownerCharacterId: characterId, name: 'Vault' },
    });

    const s = useStore.getState().appState!;
    const newStash = s.stashes.at(-1)!;
    const holding = s.currencies.find((c) => c.stashId === newStash.id);
    expect(holding).toBeDefined();
    expect(holding).toMatchObject({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
  });

  it('logs a single create-stash entry with the expected payload', () => {
    const { characterId } = localBootstrap();

    useStore.getState().dispatch({
      type: 'create-stash',
      payload: { ownerCharacterId: characterId, name: 'Wagon' },
    });

    const last = useStore.getState().log.at(-1);
    expect(last?.type).toBe('create-stash');
    if (last?.type === 'create-stash') {
      const newStash = useStore.getState().appState!.stashes.at(-1)!;
      expect(last.payload).toEqual({
        stashId: newStash.id,
        scope: 'character',
        name: 'Wagon',
        ownerCharacterId: characterId,
      });
      expect(last.actorRole).toBe('player');
    }
  });

  it('trims leading/trailing whitespace from the name', () => {
    const { characterId } = localBootstrap();

    useStore.getState().dispatch({
      type: 'create-stash',
      payload: { ownerCharacterId: characterId, name: '  Tower of Mystra  ' },
    });

    const newStash = useStore.getState().appState!.stashes.at(-1)!;
    expect(newStash.name).toBe('Tower of Mystra');
  });

  it('throws when ownerCharacterId is unknown', () => {
    localBootstrap();
    expect(() =>
      useStore.getState().dispatch({
        type: 'create-stash',
        payload: { ownerCharacterId: 'does-not-exist', name: 'Ghost vault' },
      }),
    ).toThrow(/unknown ownerCharacterId/);
  });

  it('throws on empty name', () => {
    const { characterId } = localBootstrap();
    expect(() =>
      useStore.getState().dispatch({
        type: 'create-stash',
        payload: { ownerCharacterId: characterId, name: '' },
      }),
    ).toThrow(/name is empty/);
  });

  it('throws on whitespace-only name (after trim is empty)', () => {
    const { characterId } = localBootstrap();
    expect(() =>
      useStore.getState().dispatch({
        type: 'create-stash',
        payload: { ownerCharacterId: characterId, name: '    ' },
      }),
    ).toThrow(/name is empty/);
  });

  it('throws when state is null (must run create-character first)', () => {
    expect(() =>
      useStore.getState().dispatch({
        type: 'create-stash',
        payload: { ownerCharacterId: 'foo', name: 'bar' },
      }),
    ).toThrow(/no AppState/);
  });

  it('produces AppState that still validates against the shared schema', () => {
    const { characterId } = localBootstrap();
    useStore.getState().dispatch({
      type: 'create-stash',
      payload: { ownerCharacterId: characterId, name: 'A' },
    });
    expect(() => appStateSchema.parse(useStore.getState().appState)).not.toThrow();
  });

  it('does NOT create a second isCarried=true stash for the same character', () => {
    // Sanity check: the action payload shape doesn't permit `isCarried`,
    // and the reducer always constructs `isCarried: false`. We assert the
    // invariant after dispatch instead of trying to bypass the type system.
    const { characterId } = localBootstrap();
    useStore.getState().dispatch({
      type: 'create-stash',
      payload: { ownerCharacterId: characterId, name: 'Second pack?' },
    });
    const carriedStashes = useStore
      .getState()
      .appState!.stashes.filter((st) => st.isCarried === true);
    expect(carriedStashes).toHaveLength(1);
    expect(carriedStashes[0]!.name).toBe('Inventory');
  });
});

describe('reducer: rename-stash (M3)', () => {
  /**
   * Helper: bootstrap + create one Storage stash, return its id so each
   * test starts from a baseline with a Storage stash to rename.
   */
  function bootstrapWithStorage(initialName = 'Chest at home'): {
    characterId: string;
    storageStashId: string;
    inventoryStashId: string;
    partyStashId: string;
    recoveredLootStashId: string;
  } {
    const base = localBootstrap();
    useStore.getState().dispatch({
      type: 'create-stash',
      payload: { ownerCharacterId: base.characterId, name: initialName },
    });
    const storageStashId = useStore.getState().appState!.stashes.at(-1)!.id;
    return { ...base, storageStashId };
  }

  it('renames a Storage stash; id + createdAt stable', () => {
    const { storageStashId } = bootstrapWithStorage('Old name');
    const before = useStore.getState().appState!.stashes.find((st) => st.id === storageStashId)!;

    useStore.getState().dispatch({
      type: 'rename-stash',
      payload: { stashId: storageStashId, newName: 'Vault of Waterdeep' },
    });

    const after = useStore.getState().appState!.stashes.find((st) => st.id === storageStashId)!;
    expect(after.name).toBe('Vault of Waterdeep');
    expect(after.id).toBe(before.id);
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.scope).toBe(before.scope);
    expect(after.isCarried).toBe(before.isCarried);
  });

  it('logs a rename-stash entry with oldName + newName', () => {
    const { storageStashId } = bootstrapWithStorage('Before');
    useStore.getState().dispatch({
      type: 'rename-stash',
      payload: { stashId: storageStashId, newName: 'After' },
    });
    const last = useStore.getState().log.at(-1);
    expect(last?.type).toBe('rename-stash');
    if (last?.type === 'rename-stash') {
      expect(last.payload).toEqual({
        stashId: storageStashId,
        oldName: 'Before',
        newName: 'After',
      });
      expect(last.actorRole).toBe('player');
    }
  });

  it('trims leading/trailing whitespace from newName', () => {
    const { storageStashId } = bootstrapWithStorage();
    useStore.getState().dispatch({
      type: 'rename-stash',
      payload: { stashId: storageStashId, newName: '  Tower  ' },
    });
    const stash = useStore.getState().appState!.stashes.find((st) => st.id === storageStashId)!;
    expect(stash.name).toBe('Tower');
  });

  it('throws when renaming Inventory', () => {
    const { inventoryStashId } = bootstrapWithStorage();
    expect(() =>
      useStore.getState().dispatch({
        type: 'rename-stash',
        payload: { stashId: inventoryStashId, newName: 'Backpack' },
      }),
    ).toThrow(/cannot rename Inventory/);
  });

  it('throws when renaming Party Stash', () => {
    const { partyStashId } = bootstrapWithStorage();
    expect(() =>
      useStore.getState().dispatch({
        type: 'rename-stash',
        payload: { stashId: partyStashId, newName: 'Group Pool' },
      }),
    ).toThrow(/cannot rename Party Stash/);
  });

  it('throws when renaming Recovered Loot', () => {
    const { recoveredLootStashId } = bootstrapWithStorage();
    expect(() =>
      useStore.getState().dispatch({
        type: 'rename-stash',
        payload: { stashId: recoveredLootStashId, newName: 'Forgotten' },
      }),
    ).toThrow(/cannot rename Recovered Loot/);
  });

  it('throws on unknown stashId', () => {
    localBootstrap();
    expect(() =>
      useStore.getState().dispatch({
        type: 'rename-stash',
        payload: { stashId: 'does-not-exist', newName: 'X' },
      }),
    ).toThrow(/unknown stashId/);
  });

  it('throws on empty newName', () => {
    const { storageStashId } = bootstrapWithStorage();
    expect(() =>
      useStore.getState().dispatch({
        type: 'rename-stash',
        payload: { stashId: storageStashId, newName: '' },
      }),
    ).toThrow(/newName is empty/);
  });

  it('throws on whitespace-only newName', () => {
    const { storageStashId } = bootstrapWithStorage();
    expect(() =>
      useStore.getState().dispatch({
        type: 'rename-stash',
        payload: { stashId: storageStashId, newName: '   ' },
      }),
    ).toThrow(/newName is empty/);
  });

  it('throws on no-op rename (newName === current name after trim)', () => {
    const { storageStashId } = bootstrapWithStorage('Vault');
    expect(() =>
      useStore.getState().dispatch({
        type: 'rename-stash',
        payload: { stashId: storageStashId, newName: '  Vault  ' },
      }),
    ).toThrow(/name unchanged/);
  });

  it('throws when state is null', () => {
    expect(() =>
      useStore.getState().dispatch({
        type: 'rename-stash',
        payload: { stashId: 'foo', newName: 'bar' },
      }),
    ).toThrow(/no AppState/);
  });

  it('produces AppState that still validates against the shared schema', () => {
    const { storageStashId } = bootstrapWithStorage();
    useStore.getState().dispatch({
      type: 'rename-stash',
      payload: { stashId: storageStashId, newName: 'Renamed' },
    });
    expect(() => appStateSchema.parse(useStore.getState().appState)).not.toThrow();
  });
});

describe('reducer: delete-stash (M3)', () => {
  /**
   * Helper: bootstrap + create one Storage stash optionally acquiring
   * items into it. Returns every id a delete-stash test might want.
   */
  function bootstrapWithStorage(): {
    characterId: string;
    storageStashId: string;
    inventoryStashId: string;
    partyStashId: string;
    recoveredLootStashId: string;
    catalog: ReturnType<typeof localBootstrap>['catalog'];
  } {
    const base = localBootstrap();
    useStore.getState().dispatch({
      type: 'create-stash',
      payload: { ownerCharacterId: base.characterId, name: 'Chest at home' },
    });
    const storageStashId = useStore.getState().appState!.stashes.at(-1)!.id;
    return { ...base, storageStashId };
  }

  it('deletes an empty Storage stash; single delete-stash log entry', () => {
    const { storageStashId } = bootstrapWithStorage();
    const beforeStashes = useStore.getState().appState!.stashes.length;
    const beforeCurrencies = useStore.getState().appState!.currencies.length;
    const beforeLog = useStore.getState().log.length;

    useStore.getState().dispatch({
      type: 'delete-stash',
      payload: { stashId: storageStashId },
    });

    const s = useStore.getState().appState!;
    expect(s.stashes).toHaveLength(beforeStashes - 1);
    expect(s.stashes.find((st) => st.id === storageStashId)).toBeUndefined();
    expect(s.currencies).toHaveLength(beforeCurrencies - 1);
    expect(s.currencies.find((c) => c.stashId === storageStashId)).toBeUndefined();

    const log = useStore.getState().log;
    expect(log.length).toBe(beforeLog + 1); // one delete-stash; no transfers (empty), no currency-change (zero)
    const last = log.at(-1);
    expect(last?.type).toBe('delete-stash');
    if (last?.type === 'delete-stash') {
      expect(last.payload).toEqual({
        stashId: storageStashId,
        name: 'Chest at home',
        itemCount: 0,
        currencyTotalCp: 0,
        ownerCharacterId: useStore.getState().appState!.characters[0]!.id,
      });
    }
  });

  it('moves items to Recovered Loot with original quantities preserved', () => {
    const { storageStashId, recoveredLootStashId, catalog } = bootstrapWithStorage();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    const rope = catalog.find((d) => d.id === 'phb-2024:rope-hempen-50ft')!;
    const { dispatch } = useStore.getState();
    dispatch({
      type: 'acquire',
      payload: {
        stashId: storageStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    dispatch({
      type: 'acquire',
      payload: {
        stashId: storageStashId,
        definitionId: rope.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    const torchId = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === torch.id)!.id;
    const ropeId = useStore.getState().appState!.items.find((i) => i.definitionId === rope.id)!.id;

    dispatch({ type: 'delete-stash', payload: { stashId: storageStashId } });

    const s = useStore.getState().appState!;
    expect(s.items.find((i) => i.id === torchId)?.ownerId).toBe(recoveredLootStashId);
    expect(s.items.find((i) => i.id === ropeId)?.ownerId).toBe(recoveredLootStashId);
    expect(s.items.find((i) => i.id === torchId)?.quantity).toBe(1);
    expect(s.items.find((i) => i.id === ropeId)?.quantity).toBe(1);
  });

  it('emits N transfer entries + 1 delete-stash entry, in order', () => {
    const { storageStashId, recoveredLootStashId, catalog } = bootstrapWithStorage();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    const rope = catalog.find((d) => d.id === 'phb-2024:rope-hempen-50ft')!;
    const { dispatch } = useStore.getState();
    dispatch({
      type: 'acquire',
      payload: {
        stashId: storageStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    dispatch({
      type: 'acquire',
      payload: {
        stashId: storageStashId,
        definitionId: rope.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    const torchId = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === torch.id)!.id;
    const ropeId = useStore.getState().appState!.items.find((i) => i.definitionId === rope.id)!.id;
    const beforeLogLen = useStore.getState().log.length;

    dispatch({ type: 'delete-stash', payload: { stashId: storageStashId } });

    const log = useStore.getState().log;
    const newEntries = log.slice(beforeLogLen);
    expect(newEntries).toHaveLength(3); // 2 transfer + 1 delete-stash
    expect(newEntries[0]?.type).toBe('transfer');
    expect(newEntries[1]?.type).toBe('transfer');
    expect(newEntries[2]?.type).toBe('delete-stash');

    const transferEntries = newEntries.filter((e) => e.type === 'transfer');
    const movedItemIds = transferEntries
      .map((e) => (e.type === 'transfer' ? e.payload.itemInstanceId : ''))
      .sort();
    expect(movedItemIds).toEqual([torchId, ropeId].sort());

    for (const e of transferEntries) {
      if (e.type !== 'transfer') continue;
      expect(e.payload.fromStashId).toBe(storageStashId);
      expect(e.payload.toStashId).toBe(recoveredLootStashId);
      expect(e.payload.quantity).toBe(1);
      expect(e.actorRole).toBe('player');
    }
  });

  it('single transfer entry for a stacked item; itemCount = sum of quantities', () => {
    const { storageStashId, catalog } = bootstrapWithStorage();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: storageStashId,
        definitionId: torch.id,
        quantity: 5,
        source: 'catalog-add',
      },
    });
    const beforeLogLen = useStore.getState().log.length;

    useStore.getState().dispatch({ type: 'delete-stash', payload: { stashId: storageStashId } });

    const newEntries = useStore.getState().log.slice(beforeLogLen);
    const transferEntries = newEntries.filter((e) => e.type === 'transfer');
    expect(transferEntries).toHaveLength(1);
    if (transferEntries[0]?.type === 'transfer') {
      expect(transferEntries[0].payload.quantity).toBe(5);
    }
    const deleteEntry = newEntries.find((e) => e.type === 'delete-stash');
    if (deleteEntry?.type === 'delete-stash') {
      expect(deleteEntry.payload.itemCount).toBe(5);
    }
  });

  it('leaves two rows separate when an item being transferred collides with a Recovered Loot row — M5 follow-up', () => {
    // M3: transfer does NOT auto-stack. M5's user-initiated transfer UI
    // will decide between reject / merge / synthetic-consume.
    const { storageStashId, recoveredLootStashId, catalog } = bootstrapWithStorage();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    const { dispatch } = useStore.getState();
    // Pre-seed: one Torch in Recovered Loot.
    dispatch({
      type: 'acquire',
      payload: {
        stashId: recoveredLootStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    // Now a Torch in the Storage stash (will be transferred on delete).
    dispatch({
      type: 'acquire',
      payload: {
        stashId: storageStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });

    dispatch({ type: 'delete-stash', payload: { stashId: storageStashId } });

    const torchesInRecovered = useStore
      .getState()
      .appState!.items.filter(
        (i) => i.ownerId === recoveredLootStashId && i.definitionId === torch.id,
      );
    expect(torchesInRecovered).toHaveLength(2);
  });

  it('rejects deletion of Inventory', () => {
    const { inventoryStashId } = bootstrapWithStorage();
    expect(() =>
      useStore
        .getState()
        .dispatch({ type: 'delete-stash', payload: { stashId: inventoryStashId } }),
    ).toThrow(/cannot delete Inventory/);
  });

  it('rejects deletion of Party Stash', () => {
    const { partyStashId } = bootstrapWithStorage();
    expect(() =>
      useStore.getState().dispatch({ type: 'delete-stash', payload: { stashId: partyStashId } }),
    ).toThrow(/cannot delete Party Stash/);
  });

  it('rejects deletion of Recovered Loot', () => {
    const { recoveredLootStashId } = bootstrapWithStorage();
    expect(() =>
      useStore
        .getState()
        .dispatch({ type: 'delete-stash', payload: { stashId: recoveredLootStashId } }),
    ).toThrow(/cannot delete Recovered Loot/);
  });

  it('rejects unknown stashId', () => {
    localBootstrap();
    expect(() =>
      useStore
        .getState()
        .dispatch({ type: 'delete-stash', payload: { stashId: 'does-not-exist' } }),
    ).toThrow(/unknown stashId/);
  });

  it('does NOT emit a currency-change entry when the deleted stash has zero currency', () => {
    const { storageStashId } = bootstrapWithStorage();
    const beforeLogLen = useStore.getState().log.length;
    useStore.getState().dispatch({ type: 'delete-stash', payload: { stashId: storageStashId } });
    const newEntries = useStore.getState().log.slice(beforeLogLen);
    expect(newEntries.find((e) => e.type === 'currency-change')).toBeUndefined();
  });

  it('emits one currency-change entry with reason=stash-deleted when currency is non-zero (M4 dormant path)', () => {
    const { storageStashId, recoveredLootStashId } = bootstrapWithStorage();
    // Synthetically set the Storage stash currency to non-zero (M3 has no
    // currency-edit UI; this exercises the otherwise-dormant code path).
    useStore.setState((s) => {
      if (s.appState === null) return s;
      return {
        ...s,
        appState: {
          ...s.appState,
          currencies: s.appState.currencies.map((c) =>
            c.stashId === storageStashId ? { ...c, gp: 5, sp: 3, cp: 7 } : c,
          ),
        },
      };
    });
    const beforeLogLen = useStore.getState().log.length;

    useStore.getState().dispatch({ type: 'delete-stash', payload: { stashId: storageStashId } });

    const newEntries = useStore.getState().log.slice(beforeLogLen);
    const currencyEntries = newEntries.filter((e) => e.type === 'currency-change');
    expect(currencyEntries).toHaveLength(1);
    if (currencyEntries[0]?.type === 'currency-change') {
      expect(currencyEntries[0].payload.stashId).toBe(recoveredLootStashId);
      expect(currencyEntries[0].payload.reason).toBe('stash-deleted');
      expect(currencyEntries[0].payload.delta).toEqual({ cp: 7, sp: 3, ep: 0, gp: 5, pp: 0 });
    }

    // Recovered Loot's holding has the rolled-in values.
    const recovered = useStore
      .getState()
      .appState!.currencies.find((c) => c.stashId === recoveredLootStashId)!;
    expect(recovered).toMatchObject({ cp: 7, sp: 3, ep: 0, gp: 5, pp: 0 });

    // delete-stash payload records the CP-equivalent snapshot.
    // Formula: cp + sp*10 + ep*50 + gp*100 + pp*1000 = 7 + 30 + 0 + 500 + 0 = 537.
    const deleteEntry = newEntries.find((e) => e.type === 'delete-stash');
    if (deleteEntry?.type === 'delete-stash') {
      expect(deleteEntry.payload.currencyTotalCp).toBe(537);
    }
  });

  it('throws when state is null', () => {
    expect(() =>
      useStore.getState().dispatch({ type: 'delete-stash', payload: { stashId: 'foo' } }),
    ).toThrow(/no AppState/);
  });

  it('produces AppState that still validates against the shared schema after cascade', () => {
    const { storageStashId, catalog } = bootstrapWithStorage();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: storageStashId,
        definitionId: torch.id,
        quantity: 3,
        source: 'catalog-add',
      },
    });
    useStore.getState().dispatch({ type: 'delete-stash', payload: { stashId: storageStashId } });
    expect(() => appStateSchema.parse(useStore.getState().appState)).not.toThrow();
  });

  it('all entries in a cascade share actorUserId / actorRole / partyId', () => {
    const { storageStashId, catalog } = bootstrapWithStorage();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: storageStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    const beforeLogLen = useStore.getState().log.length;

    useStore.getState().dispatch({ type: 'delete-stash', payload: { stashId: storageStashId } });

    const newEntries = useStore.getState().log.slice(beforeLogLen);
    const userId = useStore.getState().appState!.user.id;
    const partyId = useStore.getState().appState!.party.id;
    for (const e of newEntries) {
      expect(e.actorUserId).toBe(userId);
      expect(e.actorRole).toBe('player');
      expect(e.partyId).toBe(partyId);
    }
    // Distinct ids.
    expect(new Set(newEntries.map((e) => e.id)).size).toBe(newEntries.length);
  });
});

describe('reducer: currency-change (M4)', () => {
  /**
   * M4 dispatches `currency-change` from two paths: the inline +/− buttons
   * on `<CurrencyRow>` (reason: 'deposit' | 'withdraw') and the Convert
   * modal (reason: 'convert', mixed delta). The reducer is reason-agnostic
   * — it applies the delta, refuses zero-net or would-go-negative results,
   * and emits one log entry with the dispatch reason preserved.
   */

  it('applies a positive delta and logs reason=deposit', () => {
    const { inventoryStashId } = localBootstrap();
    useStore.getState().dispatch({
      type: 'currency-change',
      payload: {
        stashId: inventoryStashId,
        delta: { cp: 0, sp: 0, ep: 0, gp: 1, pp: 0 },
        reason: 'deposit',
      },
    });
    const s = useStore.getState().appState!;
    const holding = s.currencies.find((c) => c.stashId === inventoryStashId)!;
    expect(holding.gp).toBe(1);
    expect(holding.cp + holding.sp + holding.ep + holding.pp).toBe(0);

    const last = useStore.getState().log.at(-1)!;
    expect(last.type).toBe('currency-change');
    if (last.type !== 'currency-change') return; // narrow
    expect(last.payload.stashId).toBe(inventoryStashId);
    expect(last.payload.delta).toEqual({ cp: 0, sp: 0, ep: 0, gp: 1, pp: 0 });
    expect(last.payload.reason).toBe('deposit');
  });

  it('applies a negative delta and logs reason=withdraw', () => {
    const { inventoryStashId } = localBootstrap();
    // Seed +1 gp first.
    useStore.getState().dispatch({
      type: 'currency-change',
      payload: {
        stashId: inventoryStashId,
        delta: { cp: 0, sp: 0, ep: 0, gp: 1, pp: 0 },
        reason: 'deposit',
      },
    });
    // Now withdraw it back to zero.
    useStore.getState().dispatch({
      type: 'currency-change',
      payload: {
        stashId: inventoryStashId,
        delta: { cp: 0, sp: 0, ep: 0, gp: -1, pp: 0 },
        reason: 'withdraw',
      },
    });
    const holding = useStore
      .getState()
      .appState!.currencies.find((c) => c.stashId === inventoryStashId)!;
    expect(holding.gp).toBe(0);

    const last = useStore.getState().log.at(-1)!;
    if (last.type !== 'currency-change') throw new Error('expected currency-change');
    expect(last.payload.reason).toBe('withdraw');
  });

  it('applies a mixed delta (convert path: 100 sp → 10 gp)', () => {
    const { inventoryStashId } = localBootstrap();
    // Seed 100 sp.
    useStore.getState().dispatch({
      type: 'currency-change',
      payload: {
        stashId: inventoryStashId,
        delta: { cp: 0, sp: 100, ep: 0, gp: 0, pp: 0 },
        reason: 'deposit',
      },
    });
    // Convert: -100 sp + +10 gp.
    useStore.getState().dispatch({
      type: 'currency-change',
      payload: {
        stashId: inventoryStashId,
        delta: { cp: 0, sp: -100, ep: 0, gp: 10, pp: 0 },
        reason: 'convert',
      },
    });
    const holding = useStore
      .getState()
      .appState!.currencies.find((c) => c.stashId === inventoryStashId)!;
    expect(holding.sp).toBe(0);
    expect(holding.gp).toBe(10);

    const last = useStore.getState().log.at(-1)!;
    if (last.type !== 'currency-change') throw new Error('expected currency-change');
    expect(last.payload.delta).toEqual({ cp: 0, sp: -100, ep: 0, gp: 10, pp: 0 });
    expect(last.payload.reason).toBe('convert');
  });

  it('rejects unknown stashId', () => {
    localBootstrap();
    expect(() =>
      useStore.getState().dispatch({
        type: 'currency-change',
        payload: {
          stashId: 'no-such-stash',
          delta: { cp: 0, sp: 0, ep: 0, gp: 1, pp: 0 },
          reason: 'deposit',
        },
      }),
    ).toThrow(/unknown stashId/i);
  });

  it('rejects an all-zero delta as a no-op', () => {
    const { inventoryStashId } = localBootstrap();
    expect(() =>
      useStore.getState().dispatch({
        type: 'currency-change',
        payload: {
          stashId: inventoryStashId,
          delta: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
          reason: 'deposit',
        },
      }),
    ).toThrow(/no-op delta/i);
  });

  it('refuses to push a denomination negative (cp from zero)', () => {
    const { inventoryStashId } = localBootstrap();
    expect(() =>
      useStore.getState().dispatch({
        type: 'currency-change',
        payload: {
          stashId: inventoryStashId,
          delta: { cp: -1, sp: 0, ep: 0, gp: 0, pp: 0 },
          reason: 'withdraw',
        },
      }),
    ).toThrow(/negative/i);
  });

  it('refuses a convert that would push the source negative', () => {
    const { inventoryStashId } = localBootstrap();
    // Seed only 50 gp.
    useStore.getState().dispatch({
      type: 'currency-change',
      payload: {
        stashId: inventoryStashId,
        delta: { cp: 0, sp: 0, ep: 0, gp: 50, pp: 0 },
        reason: 'deposit',
      },
    });
    expect(() =>
      useStore.getState().dispatch({
        type: 'currency-change',
        payload: {
          stashId: inventoryStashId,
          delta: { cp: 0, sp: 1000, ep: 0, gp: -100, pp: 0 },
          reason: 'convert',
        },
      }),
    ).toThrow(/negative/i);
  });

  it('throws when AppState is null', () => {
    useStore.setState({ appState: null });
    expect(() =>
      useStore.getState().dispatch({
        type: 'currency-change',
        payload: {
          stashId: 'whatever',
          delta: { cp: 0, sp: 0, ep: 0, gp: 1, pp: 0 },
          reason: 'deposit',
        },
      }),
    ).toThrow();
  });

  it('log entry carries actorRole=player, actorUserId=state.user.id, partyId=state.party.id', () => {
    const { inventoryStashId } = localBootstrap();
    useStore.getState().dispatch({
      type: 'currency-change',
      payload: {
        stashId: inventoryStashId,
        delta: { cp: 0, sp: 0, ep: 0, gp: 1, pp: 0 },
        reason: 'deposit',
      },
    });
    const s = useStore.getState().appState!;
    const last = useStore.getState().log.at(-1)!;
    expect(last.actorRole).toBe('player');
    expect(last.actorUserId).toBe(s.user.id);
    expect(last.partyId).toBe(s.party.id);
    expect(last.id.length).toBeGreaterThan(0);
    expect(() => transactionLogEntrySchema.parse(last)).not.toThrow();
  });

  it('state validates against appStateSchema after a currency-change dispatch', () => {
    const { inventoryStashId } = localBootstrap();
    useStore.getState().dispatch({
      type: 'currency-change',
      payload: {
        stashId: inventoryStashId,
        delta: { cp: 1, sp: 2, ep: 3, gp: 4, pp: 5 },
        reason: 'deposit',
      },
    });
    expect(() => appStateSchema.parse(useStore.getState().appState)).not.toThrow();
  });

  it('two consecutive +1 gp dispatches accumulate to 2 gp', () => {
    const { inventoryStashId } = localBootstrap();
    const delta = { cp: 0, sp: 0, ep: 0, gp: 1, pp: 0 } as const;
    useStore.getState().dispatch({
      type: 'currency-change',
      payload: { stashId: inventoryStashId, delta, reason: 'deposit' },
    });
    useStore.getState().dispatch({
      type: 'currency-change',
      payload: { stashId: inventoryStashId, delta, reason: 'deposit' },
    });
    const holding = useStore
      .getState()
      .appState!.currencies.find((c) => c.stashId === inventoryStashId)!;
    expect(holding.gp).toBe(2);
  });

  it('applies cleanly to Storage stash holdings (no special-casing by scope)', () => {
    const { characterId } = localBootstrap();
    useStore.getState().dispatch({
      type: 'create-stash',
      payload: { ownerCharacterId: characterId, name: 'Chest at home' },
    });
    const storageStashId = useStore.getState().appState!.stashes.at(-1)!.id;
    useStore.getState().dispatch({
      type: 'currency-change',
      payload: {
        stashId: storageStashId,
        delta: { cp: 0, sp: 0, ep: 0, gp: 25, pp: 0 },
        reason: 'deposit',
      },
    });
    const holding = useStore
      .getState()
      .appState!.currencies.find((c) => c.stashId === storageStashId)!;
    expect(holding.gp).toBe(25);
  });
});

describe('reducer: transfer (M5)', () => {
  /**
   * M5 promotes `transfer` from M3's internal delete-cascade emitter to a
   * first-class user-initiated action. The action payload is the user's
   * intent (`itemInstanceId, toStashId, quantity`); the reducer resolves
   * the surviving destination row id and emits one `transfer` log entry.
   *
   * Auto-stack on arrival per the (definitionId, notes ?? "") key, mirroring
   * `acquire` (M2). Same-stash transfers and over-qty transfers throw.
   */

  function bootstrapTransfer(): {
    characterId: string;
    inventoryStashId: string;
    partyStashId: string;
    recoveredLootStashId: string;
    storageStashId: string;
    catalog: ReturnType<typeof localBootstrap>['catalog'];
  } {
    const base = localBootstrap();
    useStore.getState().dispatch({
      type: 'create-stash',
      payload: { ownerCharacterId: base.characterId, name: 'Chest at home' },
    });
    const storageStashId = useStore.getState().appState!.stashes.at(-1)!.id;
    return { ...base, storageStashId };
  }

  it('moves the whole stack to an empty destination (no auto-stack target)', () => {
    const { inventoryStashId, storageStashId, catalog } = bootstrapTransfer();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 3,
        source: 'catalog-add',
      },
    });
    const sourceId = useStore.getState().appState!.items[0]!.id;

    useStore.getState().dispatch({
      type: 'transfer',
      payload: { itemInstanceId: sourceId, toStashId: storageStashId, quantity: 3 },
    });

    const items = useStore.getState().appState!.items;
    expect(items).toHaveLength(1);
    expect(items[0]!.ownerId).toBe(storageStashId);
    expect(items[0]!.quantity).toBe(3);
    expect(items[0]!.id).toBe(sourceId); // id preserved when destination was empty
  });

  it('partial transfer: source decremented, new row in destination, both rows exist', () => {
    const { inventoryStashId, storageStashId, catalog } = bootstrapTransfer();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 5,
        source: 'catalog-add',
      },
    });
    const sourceId = useStore.getState().appState!.items[0]!.id;

    useStore.getState().dispatch({
      type: 'transfer',
      payload: { itemInstanceId: sourceId, toStashId: storageStashId, quantity: 2 },
    });

    const items = useStore.getState().appState!.items;
    expect(items).toHaveLength(2);
    const source = items.find((i) => i.id === sourceId)!;
    const dest = items.find((i) => i.id !== sourceId && i.ownerId === storageStashId)!;
    expect(source.quantity).toBe(3);
    expect(source.ownerId).toBe(inventoryStashId);
    expect(dest.quantity).toBe(2);
    expect(dest.definitionId).toBe(torch.id);
  });

  it('auto-stacks onto an existing matching row in the destination (full move)', () => {
    const { inventoryStashId, storageStashId, catalog } = bootstrapTransfer();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    // Seed destination with 1 torch (auto-stack target).
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: storageStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    const destId = useStore.getState().appState!.items[0]!.id;
    // Seed inventory with 3 torches.
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 3,
        source: 'catalog-add',
      },
    });
    const sourceId = useStore
      .getState()
      .appState!.items.find((i) => i.ownerId === inventoryStashId)!.id;

    useStore.getState().dispatch({
      type: 'transfer',
      payload: { itemInstanceId: sourceId, toStashId: storageStashId, quantity: 3 },
    });

    const items = useStore.getState().appState!.items;
    expect(items).toHaveLength(1); // source row removed, destination absorbed
    expect(items[0]!.id).toBe(destId); // destination's id survives
    expect(items[0]!.ownerId).toBe(storageStashId);
    expect(items[0]!.quantity).toBe(4); // 1 + 3
  });

  it('auto-stacks onto matching destination (partial move)', () => {
    const { inventoryStashId, storageStashId, catalog } = bootstrapTransfer();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: storageStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    const destId = useStore.getState().appState!.items[0]!.id;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 5,
        source: 'catalog-add',
      },
    });
    const sourceId = useStore
      .getState()
      .appState!.items.find((i) => i.ownerId === inventoryStashId)!.id;

    useStore.getState().dispatch({
      type: 'transfer',
      payload: { itemInstanceId: sourceId, toStashId: storageStashId, quantity: 2 },
    });

    const items = useStore.getState().appState!.items;
    expect(items).toHaveLength(2); // source decremented, destination stacked
    const source = items.find((i) => i.id === sourceId)!;
    const dest = items.find((i) => i.id === destId)!;
    expect(source.quantity).toBe(3);
    expect(dest.quantity).toBe(3); // 1 + 2
  });

  it('respects notes in the auto-stack key (different notes => no merge)', () => {
    const { inventoryStashId, storageStashId, catalog } = bootstrapTransfer();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: storageStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
        notes: 'lit',
      },
    });
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
        notes: 'unlit',
      },
    });
    const sourceId = useStore.getState().appState!.items.find((i) => i.notes === 'unlit')!.id;

    useStore.getState().dispatch({
      type: 'transfer',
      payload: { itemInstanceId: sourceId, toStashId: storageStashId, quantity: 1 },
    });

    const inStorage = useStore
      .getState()
      .appState!.items.filter((i) => i.ownerId === storageStashId);
    expect(inStorage).toHaveLength(2); // both rows live in storage, distinct notes
  });

  it('emits one transfer log entry with the surviving destination row id', () => {
    const { inventoryStashId, storageStashId, catalog } = bootstrapTransfer();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: storageStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    const destId = useStore.getState().appState!.items[0]!.id;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 2,
        source: 'catalog-add',
      },
    });
    const sourceId = useStore
      .getState()
      .appState!.items.find((i) => i.ownerId === inventoryStashId)!.id;
    const beforeLogLen = useStore.getState().log.length;

    useStore.getState().dispatch({
      type: 'transfer',
      payload: { itemInstanceId: sourceId, toStashId: storageStashId, quantity: 2 },
    });

    const newEntries = useStore.getState().log.slice(beforeLogLen);
    expect(newEntries).toHaveLength(1);
    const e = newEntries[0]!;
    expect(e.type).toBe('transfer');
    if (e.type !== 'transfer') return;
    expect(e.payload.itemInstanceId).toBe(destId); // surviving id, not the gone source
    expect(e.payload.quantity).toBe(2);
    expect(e.payload.fromStashId).toBe(inventoryStashId);
    expect(e.payload.toStashId).toBe(storageStashId);
    expect(e.actorRole).toBe('player');
  });

  it('rejects same-stash transfer (no-op)', () => {
    const { inventoryStashId, catalog } = bootstrapTransfer();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 2,
        source: 'catalog-add',
      },
    });
    const sourceId = useStore.getState().appState!.items[0]!.id;
    expect(() =>
      useStore.getState().dispatch({
        type: 'transfer',
        payload: { itemInstanceId: sourceId, toStashId: inventoryStashId, quantity: 1 },
      }),
    ).toThrow(/same stash|no-op/i);
  });

  it('rejects unknown itemInstanceId', () => {
    const { storageStashId } = bootstrapTransfer();
    expect(() =>
      useStore.getState().dispatch({
        type: 'transfer',
        payload: { itemInstanceId: 'nope', toStashId: storageStashId, quantity: 1 },
      }),
    ).toThrow(/unknown itemInstanceId/i);
  });

  it('rejects unknown toStashId', () => {
    const { inventoryStashId, catalog } = bootstrapTransfer();
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
    const sourceId = useStore.getState().appState!.items[0]!.id;
    expect(() =>
      useStore.getState().dispatch({
        type: 'transfer',
        payload: { itemInstanceId: sourceId, toStashId: 'nope', quantity: 1 },
      }),
    ).toThrow(/unknown.*stash/i);
  });

  it('rejects over-quantity transfer', () => {
    const { inventoryStashId, storageStashId, catalog } = bootstrapTransfer();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 2,
        source: 'catalog-add',
      },
    });
    const sourceId = useStore.getState().appState!.items[0]!.id;
    expect(() =>
      useStore.getState().dispatch({
        type: 'transfer',
        payload: { itemInstanceId: sourceId, toStashId: storageStashId, quantity: 3 },
      }),
    ).toThrow(/exceeds/i);
  });

  it('rejects non-positive quantity', () => {
    const { inventoryStashId, storageStashId, catalog } = bootstrapTransfer();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 2,
        source: 'catalog-add',
      },
    });
    const sourceId = useStore.getState().appState!.items[0]!.id;
    expect(() =>
      useStore.getState().dispatch({
        type: 'transfer',
        payload: { itemInstanceId: sourceId, toStashId: storageStashId, quantity: 0 },
      }),
    ).toThrow(/positive/i);
  });

  it('produces an AppState that still validates against the shared schema', () => {
    const { inventoryStashId, storageStashId, catalog } = bootstrapTransfer();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 3,
        source: 'catalog-add',
      },
    });
    const sourceId = useStore.getState().appState!.items[0]!.id;
    useStore.getState().dispatch({
      type: 'transfer',
      payload: { itemInstanceId: sourceId, toStashId: storageStashId, quantity: 2 },
    });
    expect(() => appStateSchema.parse(useStore.getState().appState)).not.toThrow();
  });

  it('round-trips through Dexie persistence', async () => {
    const { inventoryStashId, storageStashId, catalog } = bootstrapTransfer();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 3,
        source: 'catalog-add',
      },
    });
    const sourceId = useStore.getState().appState!.items[0]!.id;
    useStore.getState().dispatch({
      type: 'transfer',
      payload: { itemInstanceId: sourceId, toStashId: storageStashId, quantity: 3 },
    });
    await flushPendingPersist();
    const loaded = await loadAppState();
    expect(loaded).not.toBeNull();
    const wrapped = loaded as { appState: unknown; log: unknown };
    expect(wrapped.appState).toEqual(useStore.getState().appState);
  });
});

describe('reducer: split (M5)', () => {
  /**
   * `split` breaks one stack into two rows in the same stash. The new row
   * inherits `notes` and `customName` (M5 plan decision). Validation lives
   * in `packages/rules/inventory.validateSplit`: `1 \u2264 qty < source.quantity`.
   *
   * The auto-stack key `(definitionId, notes ?? "")` is unchanged by split —
   * which is the point: the user splits in order to *change* one of those
   * fields via the Item Detail editor (M2.5) afterwards. If they don't,
   * a subsequent acquire against the same key collapses the rows back via
   * the acquire reducer's existing auto-stack logic.
   */

  function bootstrapWithStack(quantity: number): { itemInstanceId: string; stashId: string } {
    const { inventoryStashId, catalog } = localBootstrap();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity,
        source: 'catalog-add',
      },
    });
    const row = useStore.getState().appState!.items[0]!;
    return { itemInstanceId: row.id, stashId: inventoryStashId };
  }

  it('splits a stack into two rows, source decremented, new row created with the split qty', () => {
    const { itemInstanceId, stashId } = bootstrapWithStack(5);
    useStore.getState().dispatch({
      type: 'split',
      payload: { itemInstanceId, quantity: 2 },
    });

    const items = useStore.getState().appState!.items;
    expect(items).toHaveLength(2);
    const source = items.find((i) => i.id === itemInstanceId)!;
    const newRow = items.find((i) => i.id !== itemInstanceId)!;
    expect(source.quantity).toBe(3);
    expect(source.ownerId).toBe(stashId);
    expect(newRow.quantity).toBe(2);
    expect(newRow.ownerId).toBe(stashId);
    expect(newRow.definitionId).toBe(source.definitionId);
  });

  it('carries over `notes` to the new row', () => {
    const { inventoryStashId, catalog } = localBootstrap();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 4,
        source: 'catalog-add',
        notes: 'given by Volo',
      },
    });
    const sourceId = useStore.getState().appState!.items[0]!.id;

    useStore.getState().dispatch({
      type: 'split',
      payload: { itemInstanceId: sourceId, quantity: 1 },
    });

    const newRow = useStore.getState().appState!.items.find((i) => i.id !== sourceId)!;
    expect(newRow.notes).toBe('given by Volo');
  });

  it('carries over `customName` to the new row', () => {
    const { itemInstanceId } = bootstrapWithStack(3);
    // Inject customName directly (acquire doesn't take it).
    useStore.setState((s) => {
      if (s.appState === null) return s;
      return {
        ...s,
        appState: {
          ...s.appState,
          items: s.appState.items.map((i) =>
            i.id === itemInstanceId ? { ...i, customName: "Volo's torch" } : i,
          ),
        },
      };
    });

    useStore.getState().dispatch({
      type: 'split',
      payload: { itemInstanceId, quantity: 1 },
    });

    const newRow = useStore.getState().appState!.items.find((i) => i.id !== itemInstanceId)!;
    expect(newRow.customName).toBe("Volo's torch");
  });

  it('emits one split log entry with both ids', () => {
    const { itemInstanceId } = bootstrapWithStack(5);
    const beforeLogLen = useStore.getState().log.length;

    useStore.getState().dispatch({
      type: 'split',
      payload: { itemInstanceId, quantity: 2 },
    });

    const newEntries = useStore.getState().log.slice(beforeLogLen);
    expect(newEntries).toHaveLength(1);
    const e = newEntries[0]!;
    expect(e.type).toBe('split');
    if (e.type !== 'split') return;
    expect(e.payload.sourceInstanceId).toBe(itemInstanceId);
    expect(e.payload.quantity).toBe(2);
    const newRowId = useStore.getState().appState!.items.find((i) => i.id !== itemInstanceId)!.id;
    expect(e.payload.newInstanceId).toBe(newRowId);
    expect(e.payload.stashId).toBe(
      useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!.ownerId,
    );
    expect(e.actorRole).toBe('player');
  });

  it('rejects qty === source.quantity (would empty the source row)', () => {
    const { itemInstanceId } = bootstrapWithStack(3);
    expect(() =>
      useStore.getState().dispatch({
        type: 'split',
        payload: { itemInstanceId, quantity: 3 },
      }),
    ).toThrow();
  });

  it('rejects qty > source.quantity', () => {
    const { itemInstanceId } = bootstrapWithStack(3);
    expect(() =>
      useStore.getState().dispatch({
        type: 'split',
        payload: { itemInstanceId, quantity: 4 },
      }),
    ).toThrow();
  });

  it('rejects qty <= 0', () => {
    const { itemInstanceId } = bootstrapWithStack(3);
    expect(() =>
      useStore.getState().dispatch({
        type: 'split',
        payload: { itemInstanceId, quantity: 0 },
      }),
    ).toThrow(/positive/i);
  });

  it('rejects splitting a singleton', () => {
    const { itemInstanceId } = bootstrapWithStack(1);
    expect(() =>
      useStore.getState().dispatch({
        type: 'split',
        payload: { itemInstanceId, quantity: 1 },
      }),
    ).toThrow();
  });

  it('rejects unknown itemInstanceId', () => {
    localBootstrap();
    expect(() =>
      useStore.getState().dispatch({
        type: 'split',
        payload: { itemInstanceId: 'nope', quantity: 1 },
      }),
    ).toThrow(/unknown/i);
  });

  it('produces an AppState that still validates against the shared schema', () => {
    const { itemInstanceId } = bootstrapWithStack(5);
    useStore.getState().dispatch({
      type: 'split',
      payload: { itemInstanceId, quantity: 2 },
    });
    expect(() => appStateSchema.parse(useStore.getState().appState)).not.toThrow();
  });
});

describe('reducer: currency-transfer (M5.5)', () => {
  /**
   * `currency-transfer` is the atomic stash-to-stash currency move that
   * replaces a paired debit/credit `currency-change` dispatch (OUTLINE §4).
   * In MVP (party-of-one, `bankerUserId === null`) the rule is simply
   * "any source \u2260 target with non-negative result" — the Banker-mediated
   * branch arrives in R4.
   *
   * Reducer:
   *   - Validates both stashes exist.
   *   - Rejects same-stash transfers (no-op).
   *   - Rejects all-zero deltas.
   *   - Subtracts from source via `currency.subtract` (throws on negative).
   *   - Adds to destination via `currency.add`.
   *   - Emits one log entry. Per-cascade actor / timestamp consistency
   *     is inherited from the M3 multi-entry middleware contract.
   */

  function seedHolding(
    stashId: string,
    delta: { cp?: number; sp?: number; ep?: number; gp?: number; pp?: number },
  ): void {
    useStore.setState((s) => {
      if (s.appState === null) return s;
      return {
        ...s,
        appState: {
          ...s.appState,
          currencies: s.appState.currencies.map((c) =>
            c.stashId === stashId
              ? {
                  ...c,
                  cp: c.cp + (delta.cp ?? 0),
                  sp: c.sp + (delta.sp ?? 0),
                  ep: c.ep + (delta.ep ?? 0),
                  gp: c.gp + (delta.gp ?? 0),
                  pp: c.pp + (delta.pp ?? 0),
                }
              : c,
          ),
        },
      };
    });
  }

  it('moves currency from source to destination atomically (Inventory → Storage)', () => {
    const base = localBootstrap();
    useStore.getState().dispatch({
      type: 'create-stash',
      payload: { ownerCharacterId: base.characterId, name: 'Chest at home' },
    });
    const storageStashId = useStore.getState().appState!.stashes.at(-1)!.id;
    seedHolding(base.inventoryStashId, { gp: 10 });

    useStore.getState().dispatch({
      type: 'currency-transfer',
      payload: {
        fromStashId: base.inventoryStashId,
        toStashId: storageStashId,
        delta: { cp: 0, sp: 0, ep: 0, gp: 3, pp: 0 },
      },
    });

    const s = useStore.getState().appState!;
    const src = s.currencies.find((c) => c.stashId === base.inventoryStashId)!;
    const dst = s.currencies.find((c) => c.stashId === storageStashId)!;
    expect(src.gp).toBe(7);
    expect(dst.gp).toBe(3);
  });

  it('moves currency from Inventory → Party Stash (deposit into shared pool)', () => {
    const { inventoryStashId, partyStashId } = localBootstrap();
    seedHolding(inventoryStashId, { gp: 5 });

    useStore.getState().dispatch({
      type: 'currency-transfer',
      payload: {
        fromStashId: inventoryStashId,
        toStashId: partyStashId,
        delta: { cp: 0, sp: 0, ep: 0, gp: 5, pp: 0 },
      },
    });

    const s = useStore.getState().appState!;
    expect(s.currencies.find((c) => c.stashId === inventoryStashId)!.gp).toBe(0);
    expect(s.currencies.find((c) => c.stashId === partyStashId)!.gp).toBe(5);
  });

  it('moves currency from Party Stash → Inventory (no Banker → self-claim allowed)', () => {
    // MVP `bankerUserId === null` so a player can self-claim freely
    // from the Party Stash (OUTLINE §3.14).
    const { inventoryStashId, partyStashId } = localBootstrap();
    seedHolding(partyStashId, { gp: 10 });

    useStore.getState().dispatch({
      type: 'currency-transfer',
      payload: {
        fromStashId: partyStashId,
        toStashId: inventoryStashId,
        delta: { cp: 0, sp: 0, ep: 0, gp: 4, pp: 0 },
      },
    });

    const s = useStore.getState().appState!;
    expect(s.currencies.find((c) => c.stashId === partyStashId)!.gp).toBe(6);
    expect(s.currencies.find((c) => c.stashId === inventoryStashId)!.gp).toBe(4);
  });

  it('handles mixed multi-denomination deltas', () => {
    const { inventoryStashId, partyStashId } = localBootstrap();
    seedHolding(inventoryStashId, { cp: 50, sp: 10, gp: 2 });

    useStore.getState().dispatch({
      type: 'currency-transfer',
      payload: {
        fromStashId: inventoryStashId,
        toStashId: partyStashId,
        delta: { cp: 25, sp: 5, ep: 0, gp: 1, pp: 0 },
      },
    });

    const s = useStore.getState().appState!;
    const src = s.currencies.find((c) => c.stashId === inventoryStashId)!;
    const dst = s.currencies.find((c) => c.stashId === partyStashId)!;
    expect(src).toMatchObject({ cp: 25, sp: 5, gp: 1 });
    expect(dst).toMatchObject({ cp: 25, sp: 5, gp: 1 });
  });

  it('emits one currency-transfer log entry with the dispatched delta', () => {
    const { inventoryStashId, partyStashId } = localBootstrap();
    seedHolding(inventoryStashId, { gp: 5 });
    const beforeLogLen = useStore.getState().log.length;

    useStore.getState().dispatch({
      type: 'currency-transfer',
      payload: {
        fromStashId: inventoryStashId,
        toStashId: partyStashId,
        delta: { cp: 0, sp: 0, ep: 0, gp: 3, pp: 0 },
      },
    });

    const newEntries = useStore.getState().log.slice(beforeLogLen);
    expect(newEntries).toHaveLength(1);
    const e = newEntries[0]!;
    expect(e.type).toBe('currency-transfer');
    if (e.type !== 'currency-transfer') return;
    expect(e.payload.fromStashId).toBe(inventoryStashId);
    expect(e.payload.toStashId).toBe(partyStashId);
    expect(e.payload.delta).toEqual({ cp: 0, sp: 0, ep: 0, gp: 3, pp: 0 });
    expect(e.actorRole).toBe('player');
  });

  it('rejects same-stash transfer (no-op)', () => {
    const { inventoryStashId } = localBootstrap();
    seedHolding(inventoryStashId, { gp: 5 });
    expect(() =>
      useStore.getState().dispatch({
        type: 'currency-transfer',
        payload: {
          fromStashId: inventoryStashId,
          toStashId: inventoryStashId,
          delta: { cp: 0, sp: 0, ep: 0, gp: 1, pp: 0 },
        },
      }),
    ).toThrow(/same stash|no-op/i);
  });

  it('rejects all-zero delta (no-op)', () => {
    const { inventoryStashId, partyStashId } = localBootstrap();
    expect(() =>
      useStore.getState().dispatch({
        type: 'currency-transfer',
        payload: {
          fromStashId: inventoryStashId,
          toStashId: partyStashId,
          delta: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
        },
      }),
    ).toThrow(/no-op/i);
  });

  it('rejects negative delta values (delta is the positive amount being moved)', () => {
    const { inventoryStashId, partyStashId } = localBootstrap();
    seedHolding(inventoryStashId, { gp: 5 });
    expect(() =>
      useStore.getState().dispatch({
        type: 'currency-transfer',
        payload: {
          fromStashId: inventoryStashId,
          toStashId: partyStashId,
          delta: { cp: 0, sp: 0, ep: 0, gp: -1, pp: 0 },
        },
      }),
    ).toThrow(/negative|positive/i);
  });

  it('rejects unknown fromStashId', () => {
    const { partyStashId } = localBootstrap();
    expect(() =>
      useStore.getState().dispatch({
        type: 'currency-transfer',
        payload: {
          fromStashId: 'nope',
          toStashId: partyStashId,
          delta: { cp: 0, sp: 0, ep: 0, gp: 1, pp: 0 },
        },
      }),
    ).toThrow(/unknown.*stash/i);
  });

  it('rejects unknown toStashId', () => {
    const { inventoryStashId } = localBootstrap();
    seedHolding(inventoryStashId, { gp: 5 });
    expect(() =>
      useStore.getState().dispatch({
        type: 'currency-transfer',
        payload: {
          fromStashId: inventoryStashId,
          toStashId: 'nope',
          delta: { cp: 0, sp: 0, ep: 0, gp: 1, pp: 0 },
        },
      }),
    ).toThrow(/unknown.*stash/i);
  });

  it('rejects when source would go negative on any denomination', () => {
    const { inventoryStashId, partyStashId } = localBootstrap();
    seedHolding(inventoryStashId, { gp: 2 });
    expect(() =>
      useStore.getState().dispatch({
        type: 'currency-transfer',
        payload: {
          fromStashId: inventoryStashId,
          toStashId: partyStashId,
          delta: { cp: 0, sp: 0, ep: 0, gp: 5, pp: 0 },
        },
      }),
    ).toThrow(/negative|insufficient/i);
    // State is unchanged.
    const s = useStore.getState().appState!;
    expect(s.currencies.find((c) => c.stashId === inventoryStashId)!.gp).toBe(2);
    expect(s.currencies.find((c) => c.stashId === partyStashId)!.gp).toBe(0);
  });

  it('produces an AppState that still validates against the shared schema', () => {
    const { inventoryStashId, partyStashId } = localBootstrap();
    seedHolding(inventoryStashId, { gp: 5 });
    useStore.getState().dispatch({
      type: 'currency-transfer',
      payload: {
        fromStashId: inventoryStashId,
        toStashId: partyStashId,
        delta: { cp: 0, sp: 0, ep: 0, gp: 3, pp: 0 },
      },
    });
    expect(() => appStateSchema.parse(useStore.getState().appState)).not.toThrow();
  });

  it('round-trips through Dexie persistence', async () => {
    const { inventoryStashId, partyStashId } = localBootstrap();
    seedHolding(inventoryStashId, { gp: 5 });
    useStore.getState().dispatch({
      type: 'currency-transfer',
      payload: {
        fromStashId: inventoryStashId,
        toStashId: partyStashId,
        delta: { cp: 0, sp: 0, ep: 0, gp: 3, pp: 0 },
      },
    });
    await flushPendingPersist();
    const loaded = await loadAppState();
    expect(loaded).not.toBeNull();
    const wrapped = loaded as { appState: unknown; log: unknown };
    expect(wrapped.appState).toEqual(useStore.getState().appState);
  });
});

// -------------------------------------------------------------------- //
// M6: create-homebrew / edit-homebrew / delete-homebrew
// -------------------------------------------------------------------- //

describe('reducer: create-homebrew (M6)', () => {
  it('adds a homebrew ItemDefinition to the catalog with full stamping', () => {
    localBootstrap();
    const catalogBefore = useStore.getState().appState!.catalog.length;
    const userId = useStore.getState().appState!.user.id;
    const partyId = useStore.getState().appState!.party.id;

    useStore.getState().dispatch({
      type: 'create-homebrew',
      payload: {
        name: 'Glowing Mushroom',
        category: 'consumable',
        weight: 0.1,
        cost: { amount: 5, currency: 'gp' },
        description: 'A small mushroom that glows in the dark.',
        tags: ['light', 'underdark'],
      },
    });

    const catalog = useStore.getState().appState!.catalog;
    expect(catalog).toHaveLength(catalogBefore + 1);
    const created = catalog.at(-1)!;
    expect(created.name).toBe('Glowing Mushroom');
    expect(created.source).toBe('homebrew');
    expect(created.category).toBe('consumable');
    expect(created.weight).toBe(0.1);
    expect(created.cost).toEqual({ amount: 5, currency: 'gp' });
    expect(created.description).toBe('A small mushroom that glows in the dark.');
    expect(created.tags).toEqual(['light', 'underdark']);
    expect(created.partyId).toBe(partyId);
    expect(created.createdBy).toBe(userId);
    expect(created.duplicatedFromId).toBeUndefined();
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('records a create-homebrew log entry with name snapshot', () => {
    localBootstrap();
    const beforeLog = useStore.getState().log.length;

    useStore.getState().dispatch({
      type: 'create-homebrew',
      payload: { name: 'Foobar', category: 'gear' },
    });

    const log = useStore.getState().log;
    expect(log.length).toBe(beforeLog + 1);
    const entry = log.at(-1)!;
    expect(entry.type).toBe('create-homebrew');
    if (entry.type !== 'create-homebrew') return;
    expect(entry.payload.name).toBe('Foobar');
    const created = useStore.getState().appState!.catalog.at(-1)!;
    expect(entry.payload.definitionId).toBe(created.id);
    expect(entry.actorRole).toBe('player');
  });

  it('preserves duplicatedFromId for the Duplicate flow', () => {
    const { catalog } = localBootstrap();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;

    useStore.getState().dispatch({
      type: 'create-homebrew',
      payload: {
        name: 'Glowing Torch',
        category: 'gear',
        duplicatedFromId: torch.id,
      },
    });

    const created = useStore.getState().appState!.catalog.at(-1)!;
    expect(created.duplicatedFromId).toBe(torch.id);
    expect(created.source).toBe('homebrew');
  });

  it('rejects an empty / whitespace-only name', () => {
    localBootstrap();
    const { dispatch } = useStore.getState();
    expect(() =>
      dispatch({ type: 'create-homebrew', payload: { name: '', category: 'gear' } }),
    ).toThrow(/name/i);
    expect(() =>
      dispatch({ type: 'create-homebrew', payload: { name: '   ', category: 'gear' } }),
    ).toThrow(/name/i);
  });

  it('rejects when no AppState exists (must run after create-character)', () => {
    expect(() =>
      useStore.getState().dispatch({
        type: 'create-homebrew',
        payload: { name: 'Foo', category: 'gear' },
      }),
    ).toThrow(/create-character must run first/);
  });

  it('trims name before storing', () => {
    localBootstrap();
    useStore.getState().dispatch({
      type: 'create-homebrew',
      payload: { name: '  Trimmed  ', category: 'gear' },
    });
    expect(useStore.getState().appState!.catalog.at(-1)!.name).toBe('Trimmed');
  });

  it('persisted state validates against appStateSchema', () => {
    localBootstrap();
    useStore.getState().dispatch({
      type: 'create-homebrew',
      payload: { name: 'Foo', category: 'gear' },
    });
    expect(() => appStateSchema.parse(useStore.getState().appState)).not.toThrow();
  });
});

describe('reducer: edit-homebrew (M6)', () => {
  function bootstrapWithLocalHomebrew(): {
    homebrewDefId: string;
    characterId: string;
    inventoryStashId: string;
    partyStashId: string;
    recoveredLootStashId: string;
    catalog: ReturnType<typeof localBootstrap>['catalog'];
  } {
    const base = localBootstrap();
    useStore.getState().dispatch({
      type: 'create-homebrew',
      payload: { name: 'Glowing Mushroom', category: 'consumable' },
    });
    const homebrewDefId = useStore.getState().appState!.catalog.at(-1)!.id;
    return { ...base, homebrewDefId };
  }

  it('updates name on the catalog row', () => {
    const { homebrewDefId } = bootstrapWithLocalHomebrew();
    useStore.getState().dispatch({
      type: 'edit-homebrew',
      payload: { definitionId: homebrewDefId, patch: { name: 'Bazqux' } },
    });
    const def = useStore.getState().appState!.catalog.find((d) => d.id === homebrewDefId)!;
    expect(def.name).toBe('Bazqux');
  });

  it('logs only the changed field names in changedFields', () => {
    const { homebrewDefId } = bootstrapWithLocalHomebrew();
    const beforeLog = useStore.getState().log.length;
    useStore.getState().dispatch({
      type: 'edit-homebrew',
      payload: { definitionId: homebrewDefId, patch: { name: 'New' } },
    });
    const entry = useStore.getState().log.at(-1)!;
    expect(entry.type).toBe('edit-homebrew');
    if (entry.type !== 'edit-homebrew') return;
    expect(entry.payload.changedFields).toEqual(['name']);
    expect(useStore.getState().log.length).toBe(beforeLog + 1);
  });

  it('logs multiple changed fields in one entry', () => {
    const { homebrewDefId } = bootstrapWithLocalHomebrew();
    useStore.getState().dispatch({
      type: 'edit-homebrew',
      payload: {
        definitionId: homebrewDefId,
        patch: {
          name: 'New',
          description: 'Now with description.',
          weight: 2,
        },
      },
    });
    const entry = useStore.getState().log.at(-1)!;
    if (entry.type !== 'edit-homebrew') throw new Error('expected edit-homebrew entry');
    expect([...entry.payload.changedFields].sort()).toEqual(['description', 'name', 'weight']);
  });

  it('rejects no-op edits (same value as current)', () => {
    const { homebrewDefId } = bootstrapWithLocalHomebrew();
    expect(() =>
      useStore.getState().dispatch({
        type: 'edit-homebrew',
        payload: { definitionId: homebrewDefId, patch: { name: 'Glowing Mushroom' } },
      }),
    ).toThrow(/no fields changed|no-op/i);
  });

  it('rejects empty patch', () => {
    const { homebrewDefId } = bootstrapWithLocalHomebrew();
    expect(() =>
      useStore.getState().dispatch({
        type: 'edit-homebrew',
        payload: { definitionId: homebrewDefId, patch: {} },
      }),
    ).toThrow(/no fields changed|no-op/i);
  });

  it('rejects edits to PHB rows (immutable per OUTLINE §3.7)', () => {
    const { catalog } = localBootstrap();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    expect(() =>
      useStore.getState().dispatch({
        type: 'edit-homebrew',
        payload: { definitionId: torch.id, patch: { name: 'Hacked Torch' } },
      }),
    ).toThrow(/PHB|immutable|homebrew/i);
  });

  it('rejects unknown definitionId', () => {
    localBootstrap();
    expect(() =>
      useStore.getState().dispatch({
        type: 'edit-homebrew',
        payload: { definitionId: 'nope-id', patch: { name: 'X' } },
      }),
    ).toThrow(/unknown definitionId/i);
  });

  it('clearing optional cost via undefined removes the field', () => {
    localBootstrap();
    useStore.getState().dispatch({
      type: 'create-homebrew',
      payload: { name: 'X', category: 'gear', cost: { amount: 5, currency: 'gp' } },
    });
    const defId = useStore.getState().appState!.catalog.at(-1)!.id;
    useStore.getState().dispatch({
      type: 'edit-homebrew',
      payload: { definitionId: defId, patch: { cost: undefined } },
    });
    const after = useStore.getState().appState!.catalog.find((d) => d.id === defId)!;
    expect(after.cost).toBeUndefined();
  });

  it('Inventory rows reflect the new name via definitionId lookup', () => {
    // The store doesn't denormalize the definition name onto the
    // instance — components read by `definitionId` join. This test
    // confirms the join surface (the catalog row name) updates and
    // the instance keeps the link.
    const { homebrewDefId, inventoryStashId } = bootstrapWithLocalHomebrew();
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: homebrewDefId,
        quantity: 1,
        source: 'custom-create',
      },
    });
    useStore.getState().dispatch({
      type: 'edit-homebrew',
      payload: { definitionId: homebrewDefId, patch: { name: 'Renamed' } },
    });
    const def = useStore.getState().appState!.catalog.find((d) => d.id === homebrewDefId)!;
    expect(def.name).toBe('Renamed');
    const item = useStore.getState().appState!.items.find((i) => i.definitionId === homebrewDefId)!;
    expect(item.definitionId).toBe(homebrewDefId);
  });
});

describe('reducer: delete-homebrew (M6)', () => {
  function bootstrapWithLocalHomebrew(): {
    homebrewDefId: string;
    inventoryStashId: string;
    characterId: string;
    partyStashId: string;
    recoveredLootStashId: string;
    catalog: ReturnType<typeof localBootstrap>['catalog'];
  } {
    const base = localBootstrap();
    useStore.getState().dispatch({
      type: 'create-homebrew',
      payload: { name: 'Glowing Mushroom', category: 'consumable' },
    });
    const homebrewDefId = useStore.getState().appState!.catalog.at(-1)!.id;
    return { ...base, homebrewDefId };
  }

  it('removes the homebrew row when no instances reference it', () => {
    const { homebrewDefId } = bootstrapWithLocalHomebrew();
    useStore.getState().dispatch({
      type: 'delete-homebrew',
      payload: { definitionId: homebrewDefId },
    });
    const def = useStore.getState().appState!.catalog.find((d) => d.id === homebrewDefId);
    expect(def).toBeUndefined();
  });

  it('emits a delete-homebrew log entry with name snapshot', () => {
    const { homebrewDefId } = bootstrapWithLocalHomebrew();
    useStore.getState().dispatch({
      type: 'delete-homebrew',
      payload: { definitionId: homebrewDefId },
    });
    const entry = useStore.getState().log.at(-1)!;
    expect(entry.type).toBe('delete-homebrew');
    if (entry.type !== 'delete-homebrew') return;
    expect(entry.payload).toEqual({ definitionId: homebrewDefId, name: 'Glowing Mushroom' });
  });

  it('rejects deletion when one or more ItemInstances reference it', () => {
    const { homebrewDefId, inventoryStashId } = bootstrapWithLocalHomebrew();
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: homebrewDefId,
        quantity: 2,
        source: 'custom-create',
      },
    });
    expect(() =>
      useStore.getState().dispatch({
        type: 'delete-homebrew',
        payload: { definitionId: homebrewDefId },
      }),
    ).toThrow(/1 stash|reference|in use|held/i);
    expect(useStore.getState().appState!.catalog.find((d) => d.id === homebrewDefId)).toBeDefined();
  });

  it('rejects deletion of PHB rows', () => {
    const { catalog } = localBootstrap();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    expect(() =>
      useStore.getState().dispatch({
        type: 'delete-homebrew',
        payload: { definitionId: torch.id },
      }),
    ).toThrow(/PHB|immutable|homebrew/i);
  });

  it('rejects unknown definitionId', () => {
    localBootstrap();
    expect(() =>
      useStore.getState().dispatch({
        type: 'delete-homebrew',
        payload: { definitionId: 'nope-id' },
      }),
    ).toThrow(/unknown definitionId/i);
  });

  it('persisted state validates against appStateSchema after delete', () => {
    const { homebrewDefId } = bootstrapWithLocalHomebrew();
    useStore.getState().dispatch({
      type: 'delete-homebrew',
      payload: { definitionId: homebrewDefId },
    });
    expect(() => appStateSchema.parse(useStore.getState().appState)).not.toThrow();
  });

  it('log entry parses against transactionLogEntrySchema', () => {
    const { homebrewDefId } = bootstrapWithLocalHomebrew();
    useStore.getState().dispatch({
      type: 'delete-homebrew',
      payload: { definitionId: homebrewDefId },
    });
    const entry = useStore.getState().log.at(-1)!;
    expect(() => transactionLogEntrySchema.parse(entry)).not.toThrow();
  });
});

describe('reducer: rename-character (M7)', () => {
  /**
   * Mirrors `rename-stash` (M3): UI sends `{ characterId, newName }`;
   * reducer trims, rejects empty + same-name, captures `oldName` from
   * the row before applying. id / ownerUserId / partyId / abilityScores
   * / level / inventoryStashId stay stable.
   */
  it('renames the character; id + ownerUserId + level + abilityScores stable', () => {
    const { characterId } = localBootstrap();
    const before = useStore.getState().appState!.characters.find((c) => c.id === characterId)!;

    useStore.getState().dispatch({
      type: 'rename-character',
      payload: { characterId, newName: 'Thorin Stonefist' },
    });

    const after = useStore.getState().appState!.characters.find((c) => c.id === characterId)!;
    expect(after.name).toBe('Thorin Stonefist');
    expect(after.id).toBe(before.id);
    expect(after.ownerUserId).toBe(before.ownerUserId);
    expect(after.partyId).toBe(before.partyId);
    expect(after.level).toBe(before.level);
    expect(after.abilityScores).toEqual(before.abilityScores);
    expect(after.inventoryStashId).toBe(before.inventoryStashId);
  });

  it('logs a rename-character entry with oldName + newName', () => {
    const { characterId } = localBootstrap();
    const oldName = useStore
      .getState()
      .appState!.characters.find((c) => c.id === characterId)!.name;

    useStore.getState().dispatch({
      type: 'rename-character',
      payload: { characterId, newName: 'Bara of Waterdeep' },
    });

    const last = useStore.getState().log.at(-1);
    expect(last?.type).toBe('rename-character');
    if (last?.type === 'rename-character') {
      expect(last.payload).toEqual({
        characterId,
        oldName,
        newName: 'Bara of Waterdeep',
      });
      expect(last.actorRole).toBe('player');
    }
  });

  it('trims leading/trailing whitespace from newName', () => {
    const { characterId } = localBootstrap();
    useStore.getState().dispatch({
      type: 'rename-character',
      payload: { characterId, newName: '  Aldric  ' },
    });
    const c = useStore.getState().appState!.characters.find((ch) => ch.id === characterId)!;
    expect(c.name).toBe('Aldric');
  });

  it('throws on empty newName', () => {
    const { characterId } = localBootstrap();
    expect(() =>
      useStore.getState().dispatch({
        type: 'rename-character',
        payload: { characterId, newName: '' },
      }),
    ).toThrow(/newName is empty/);
  });

  it('throws on whitespace-only newName', () => {
    const { characterId } = localBootstrap();
    expect(() =>
      useStore.getState().dispatch({
        type: 'rename-character',
        payload: { characterId, newName: '   ' },
      }),
    ).toThrow(/newName is empty/);
  });

  it('throws on no-op rename (newName equals current after trim)', () => {
    const { characterId } = localBootstrap();
    const currentName = useStore
      .getState()
      .appState!.characters.find((c) => c.id === characterId)!.name;
    expect(() =>
      useStore.getState().dispatch({
        type: 'rename-character',
        payload: { characterId, newName: `  ${currentName}  ` },
      }),
    ).toThrow(/name unchanged/);
  });

  it('throws on unknown characterId', () => {
    localBootstrap();
    expect(() =>
      useStore.getState().dispatch({
        type: 'rename-character',
        payload: { characterId: 'does-not-exist', newName: 'X' },
      }),
    ).toThrow(/unknown characterId/);
  });

  it('throws when state is null', () => {
    expect(() =>
      useStore.getState().dispatch({
        type: 'rename-character',
        payload: { characterId: 'foo', newName: 'bar' },
      }),
    ).toThrow(/no AppState/);
  });

  it('produces AppState that still validates against the shared schema', () => {
    const { characterId } = localBootstrap();
    useStore.getState().dispatch({
      type: 'rename-character',
      payload: { characterId, newName: 'Renamed Hero' },
    });
    expect(() => appStateSchema.parse(useStore.getState().appState)).not.toThrow();
  });

  it('log entry parses against transactionLogEntrySchema', () => {
    const { characterId } = localBootstrap();
    useStore.getState().dispatch({
      type: 'rename-character',
      payload: { characterId, newName: 'Logged' },
    });
    const entry = useStore.getState().log.at(-1)!;
    expect(() => transactionLogEntrySchema.parse(entry)).not.toThrow();
  });
});

describe('reducer: rename-party (M7)', () => {
  /**
   * Same shape as rename-character: trim / reject-empty / reject-same /
   * captures `oldName`. In MVP there is exactly one Party so the lookup
   * is `payload.partyId === state.party.id`; mismatched ids throw to
   * keep R4 (multi-party) honest.
   */
  it('renames the party; id + ownerUserId + inviteCode stable', () => {
    localBootstrap();
    const before = useStore.getState().appState!.party;

    useStore.getState().dispatch({
      type: 'rename-party',
      payload: { partyId: before.id, newName: 'The Misfits' },
    });

    const after = useStore.getState().appState!.party;
    expect(after.name).toBe('The Misfits');
    expect(after.id).toBe(before.id);
    expect(after.ownerUserId).toBe(before.ownerUserId);
    expect(after.inviteCode).toBe(before.inviteCode);
    expect(after.recoveredLootStashId).toBe(before.recoveredLootStashId);
    expect(after.createdAt).toBe(before.createdAt);
  });

  it('logs a rename-party entry with oldName + newName', () => {
    localBootstrap();
    const partyId = useStore.getState().appState!.party.id;
    const oldName = useStore.getState().appState!.party.name;

    useStore.getState().dispatch({
      type: 'rename-party',
      payload: { partyId, newName: 'New Campaign' },
    });

    const last = useStore.getState().log.at(-1);
    expect(last?.type).toBe('rename-party');
    if (last?.type === 'rename-party') {
      expect(last.payload).toEqual({
        partyId,
        oldName,
        newName: 'New Campaign',
      });
      expect(last.actorRole).toBe('player');
    }
  });

  it('trims leading/trailing whitespace from newName', () => {
    localBootstrap();
    const partyId = useStore.getState().appState!.party.id;
    useStore.getState().dispatch({
      type: 'rename-party',
      payload: { partyId, newName: '  Heroes United  ' },
    });
    expect(useStore.getState().appState!.party.name).toBe('Heroes United');
  });

  it('throws on empty newName', () => {
    localBootstrap();
    const partyId = useStore.getState().appState!.party.id;
    expect(() =>
      useStore.getState().dispatch({
        type: 'rename-party',
        payload: { partyId, newName: '' },
      }),
    ).toThrow(/newName is empty/);
  });

  it('throws on whitespace-only newName', () => {
    localBootstrap();
    const partyId = useStore.getState().appState!.party.id;
    expect(() =>
      useStore.getState().dispatch({
        type: 'rename-party',
        payload: { partyId, newName: '   ' },
      }),
    ).toThrow(/newName is empty/);
  });

  it('throws on no-op rename (newName equals current after trim)', () => {
    localBootstrap();
    const partyId = useStore.getState().appState!.party.id;
    const currentName = useStore.getState().appState!.party.name;
    expect(() =>
      useStore.getState().dispatch({
        type: 'rename-party',
        payload: { partyId, newName: `  ${currentName}  ` },
      }),
    ).toThrow(/name unchanged/);
  });

  it('throws on unknown partyId', () => {
    localBootstrap();
    expect(() =>
      useStore.getState().dispatch({
        type: 'rename-party',
        payload: { partyId: 'does-not-exist', newName: 'X' },
      }),
    ).toThrow(/unknown partyId/);
  });

  it('throws when state is null', () => {
    expect(() =>
      useStore.getState().dispatch({
        type: 'rename-party',
        payload: { partyId: 'foo', newName: 'bar' },
      }),
    ).toThrow(/no AppState/);
  });

  it('produces AppState that still validates against the shared schema', () => {
    localBootstrap();
    const partyId = useStore.getState().appState!.party.id;
    useStore.getState().dispatch({
      type: 'rename-party',
      payload: { partyId, newName: 'Validated' },
    });
    expect(() => appStateSchema.parse(useStore.getState().appState)).not.toThrow();
  });

  it('log entry parses against transactionLogEntrySchema', () => {
    localBootstrap();
    const partyId = useStore.getState().appState!.party.id;
    useStore.getState().dispatch({
      type: 'rename-party',
      payload: { partyId, newName: 'Schema OK' },
    });
    const entry = useStore.getState().log.at(-1)!;
    expect(() => transactionLogEntrySchema.parse(entry)).not.toThrow();
  });
});

describe('reducer: set-encumbrance (R1.1)', () => {
  /**
   * R1.1 introduces two orthogonal fields:
   *   - `encumbranceRule: 'off' | 'phb' | 'variant'`
   *   - `enforceEncumbrance: boolean`
   * One reducer action covers both. Guards mirror `rename-character`:
   * unknown characterId rejects; no-op rejects only when BOTH fields
   * match the current row.
   */
  it('flips rule from off → variant; STR + level + name stable', () => {
    const { characterId } = localBootstrap();
    const before = useStore.getState().appState!.characters.find((c) => c.id === characterId)!;
    expect(before.encumbranceRule).toBe('off');
    expect(before.enforceEncumbrance).toBe(false);

    useStore.getState().dispatch({
      type: 'set-encumbrance',
      payload: { characterId, rule: 'variant', enforce: false },
    });

    const after = useStore.getState().appState!.characters.find((c) => c.id === characterId)!;
    expect(after.encumbranceRule).toBe('variant');
    expect(after.enforceEncumbrance).toBe(false);
    expect(after.id).toBe(before.id);
    expect(after.name).toBe(before.name);
    expect(after.level).toBe(before.level);
    expect(after.abilityScores).toEqual(before.abilityScores);
    expect(after.inventoryStashId).toBe(before.inventoryStashId);
  });

  it('flips through off → phb → variant → off', () => {
    const { characterId } = localBootstrap();
    useStore.getState().dispatch({
      type: 'set-encumbrance',
      payload: { characterId, rule: 'phb', enforce: false },
    });
    expect(
      useStore.getState().appState!.characters.find((c) => c.id === characterId)!.encumbranceRule,
    ).toBe('phb');

    useStore.getState().dispatch({
      type: 'set-encumbrance',
      payload: { characterId, rule: 'variant', enforce: false },
    });
    expect(
      useStore.getState().appState!.characters.find((c) => c.id === characterId)!.encumbranceRule,
    ).toBe('variant');

    useStore.getState().dispatch({
      type: 'set-encumbrance',
      payload: { characterId, rule: 'off', enforce: false },
    });
    expect(
      useStore.getState().appState!.characters.find((c) => c.id === characterId)!.encumbranceRule,
    ).toBe('off');
  });

  it('flips enforce independently of rule', () => {
    const { characterId } = localBootstrap();
    // First set the rule so enforce flipping makes sense.
    useStore.getState().dispatch({
      type: 'set-encumbrance',
      payload: { characterId, rule: 'variant', enforce: false },
    });
    // Now flip ONLY enforce.
    useStore.getState().dispatch({
      type: 'set-encumbrance',
      payload: { characterId, rule: 'variant', enforce: true },
    });
    const after = useStore.getState().appState!.characters.find((c) => c.id === characterId)!;
    expect(after.encumbranceRule).toBe('variant');
    expect(after.enforceEncumbrance).toBe(true);
  });

  it('logs a set-encumbrance entry with old/new for both fields', () => {
    const { characterId } = localBootstrap();

    useStore.getState().dispatch({
      type: 'set-encumbrance',
      payload: { characterId, rule: 'variant', enforce: true },
    });

    const last = useStore.getState().log.at(-1);
    expect(last?.type).toBe('set-encumbrance');
    if (last?.type === 'set-encumbrance') {
      expect(last.payload).toEqual({
        characterId,
        oldRule: 'off',
        newRule: 'variant',
        oldEnforce: false,
        newEnforce: true,
      });
      expect(last.actorRole).toBe('player');
    }
  });

  it('throws on no-op (rule AND enforce both unchanged)', () => {
    const { characterId } = localBootstrap();
    expect(() =>
      useStore.getState().dispatch({
        type: 'set-encumbrance',
        payload: { characterId, rule: 'off', enforce: false },
      }),
    ).toThrow(/nothing changed/);
  });

  it('does NOT throw when only enforce changes (rule stays)', () => {
    const { characterId } = localBootstrap();
    // off → variant first (so the no-op flip below isn't bookending an off-with-enforce state which is meaningless).
    useStore.getState().dispatch({
      type: 'set-encumbrance',
      payload: { characterId, rule: 'variant', enforce: false },
    });
    expect(() =>
      useStore.getState().dispatch({
        type: 'set-encumbrance',
        payload: { characterId, rule: 'variant', enforce: true },
      }),
    ).not.toThrow();
  });

  it('throws on unknown characterId', () => {
    localBootstrap();
    expect(() =>
      useStore.getState().dispatch({
        type: 'set-encumbrance',
        payload: { characterId: 'does-not-exist', rule: 'variant', enforce: false },
      }),
    ).toThrow(/unknown characterId/);
  });

  it('throws when state is null', () => {
    expect(() =>
      useStore.getState().dispatch({
        type: 'set-encumbrance',
        payload: { characterId: 'foo', rule: 'variant', enforce: false },
      }),
    ).toThrow(/no AppState/);
  });

  it('produces AppState that still validates against the shared schema', () => {
    const { characterId } = localBootstrap();
    useStore.getState().dispatch({
      type: 'set-encumbrance',
      payload: { characterId, rule: 'variant', enforce: true },
    });
    expect(() => appStateSchema.parse(useStore.getState().appState)).not.toThrow();
  });

  it('log entry parses against transactionLogEntrySchema', () => {
    const { characterId } = localBootstrap();
    useStore.getState().dispatch({
      type: 'set-encumbrance',
      payload: { characterId, rule: 'phb', enforce: false },
    });
    const entry = useStore.getState().log.at(-1)!;
    expect(() => transactionLogEntrySchema.parse(entry)).not.toThrow();
  });
});

describe('reducer: equip / unequip (R1.2)', () => {
  /**
   * R1.2 flips `ItemInstance.equipped` on Inventory rows. Invariants:
   *   - row must be in the character's Inventory stash (OUTLINE §3.4);
   *   - no-ops reject so the "one dispatch = one log entry" invariant holds;
   *   - rejections leave the row + log untouched.
   * The Inventory-only check IS the schema-level "equip is only meaningful
   * when scope=character & isCarried=true" rule expressed at the reducer.
   */
  function bootstrapWithTorchInInventory(): {
    characterId: string;
    inventoryStashId: string;
    partyStashId: string;
    itemInstanceId: string;
  } {
    const { characterId, inventoryStashId, partyStashId, catalog } = localBootstrap();
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
    const itemInstanceId = useStore.getState().appState!.items[0]!.id;
    return { characterId, inventoryStashId, partyStashId, itemInstanceId };
  }

  it('flips equipped=false → true on an Inventory row', () => {
    const { characterId, itemInstanceId } = bootstrapWithTorchInInventory();
    useStore.getState().dispatch({
      type: 'equip',
      payload: { characterId, itemInstanceId },
    });
    const row = useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!;
    expect(row.equipped).toBe(true);
  });

  it('flips equipped=true → false via unequip', () => {
    const { characterId, itemInstanceId } = bootstrapWithTorchInInventory();
    useStore.getState().dispatch({ type: 'equip', payload: { characterId, itemInstanceId } });
    useStore.getState().dispatch({
      type: 'unequip',
      payload: { characterId, itemInstanceId },
    });
    const row = useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!;
    expect(row.equipped).toBe(false);
  });

  it('appends a typed equip log entry with the characterId payload', () => {
    const { characterId, itemInstanceId } = bootstrapWithTorchInInventory();
    useStore.getState().dispatch({ type: 'equip', payload: { characterId, itemInstanceId } });
    const last = useStore.getState().log.at(-1)!;
    expect(last.type).toBe('equip');
    expect(() => transactionLogEntrySchema.parse(last)).not.toThrow();
    if (last.type === 'equip') {
      expect(last.payload.itemInstanceId).toBe(itemInstanceId);
      expect(last.payload.characterId).toBe(characterId);
    }
  });

  it('rejects equip of a row that lives in the Party Stash (Inventory-only invariant)', () => {
    const { characterId, partyStashId, catalog } = localBootstrap();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: partyStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    const itemInstanceId = useStore.getState().appState!.items[0]!.id;
    const logLenBefore = useStore.getState().log.length;
    expect(() =>
      useStore.getState().dispatch({
        type: 'equip',
        payload: { characterId, itemInstanceId },
      }),
    ).toThrow(/not in character .* Inventory/);
    expect(useStore.getState().log.length).toBe(logLenBefore);
  });

  it('rejects no-op equip (already equipped)', () => {
    const { characterId, itemInstanceId } = bootstrapWithTorchInInventory();
    useStore.getState().dispatch({ type: 'equip', payload: { characterId, itemInstanceId } });
    expect(() =>
      useStore.getState().dispatch({
        type: 'equip',
        payload: { characterId, itemInstanceId },
      }),
    ).toThrow(/already equipped=true/);
  });

  it('rejects unknown itemInstanceId', () => {
    const { characterId } = localBootstrap();
    expect(() =>
      useStore.getState().dispatch({
        type: 'equip',
        payload: { characterId, itemInstanceId: 'nope' },
      }),
    ).toThrow(/unknown itemInstanceId/);
  });

  it('rejects unknown characterId', () => {
    const { itemInstanceId } = bootstrapWithTorchInInventory();
    expect(() =>
      useStore.getState().dispatch({
        type: 'equip',
        payload: { characterId: 'nope', itemInstanceId },
      }),
    ).toThrow(/unknown characterId/);
  });
});

describe('reducer: attune / unattune (R1.2)', () => {
  /**
   * Slot-cap invariant uses `Character.maxAttunement` (default 3, OUTLINE
   * §3.3). The reducer counts currently-attuned rows in the character's
   * Inventory before allowing `attune`; `unattune` always succeeds (modulo
   * no-op). Inventory-only / ownership guards mirror equip/unequip.
   */
  function bootstrapWithAttunables(count: number): {
    characterId: string;
    ids: string[];
  } {
    const { characterId, inventoryStashId, catalog } = localBootstrap();
    // R2.1 — `attune` reducer rejects mundane rows. Use a DMG magic item
    // (Wand of Magic Missiles: `requiresAttunement: true`, no prereq) so
    // these tests focus on slot-cap + Inventory-only invariants, not the
    // magic-item gate (covered in its own describe block below).
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
    const ids: string[] = [];
    for (const it of useStore.getState().appState!.items) {
      if (it.ownerId === inventoryStashId) ids.push(it.id);
    }
    return { characterId, ids };
  }

  it('flips attuned=false → true', () => {
    const { characterId, ids } = bootstrapWithAttunables(1);
    useStore.getState().dispatch({
      type: 'attune',
      payload: { characterId, itemInstanceId: ids[0]! },
    });
    const row = useStore.getState().appState!.items.find((i) => i.id === ids[0])!;
    expect(row.attuned).toBe(true);
  });

  it('respects the slot cap — 4th attune rejects when maxAttunement = 3 (default)', () => {
    const { characterId, ids } = bootstrapWithAttunables(4);
    for (let i = 0; i < 3; i += 1) {
      useStore.getState().dispatch({
        type: 'attune',
        payload: { characterId, itemInstanceId: ids[i]! },
      });
    }
    expect(() =>
      useStore.getState().dispatch({
        type: 'attune',
        payload: { characterId, itemInstanceId: ids[3]! },
      }),
    ).toThrow(/no free attunement slot/);
    expect(useStore.getState().appState!.items.find((i) => i.id === ids[3])!.attuned).toBe(false);
  });

  it('un-attuning frees a slot for the next attune', () => {
    const { characterId, ids } = bootstrapWithAttunables(4);
    for (let i = 0; i < 3; i += 1) {
      useStore.getState().dispatch({
        type: 'attune',
        payload: { characterId, itemInstanceId: ids[i]! },
      });
    }
    useStore.getState().dispatch({
      type: 'unattune',
      payload: { characterId, itemInstanceId: ids[0]! },
    });
    useStore.getState().dispatch({
      type: 'attune',
      payload: { characterId, itemInstanceId: ids[3]! },
    });
    expect(useStore.getState().appState!.items.find((i) => i.id === ids[3])!.attuned).toBe(true);
  });

  it('rejects attune of a row in Party Stash (Inventory-only invariant)', () => {
    const { characterId, partyStashId, catalog } = localBootstrap();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: partyStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    const itemInstanceId = useStore.getState().appState!.items[0]!.id;
    expect(() =>
      useStore.getState().dispatch({
        type: 'attune',
        payload: { characterId, itemInstanceId },
      }),
    ).toThrow(/not in character .* Inventory/);
  });

  it('rejects no-op attune / unattune', () => {
    const { characterId, ids } = bootstrapWithAttunables(1);
    useStore.getState().dispatch({
      type: 'attune',
      payload: { characterId, itemInstanceId: ids[0]! },
    });
    expect(() =>
      useStore.getState().dispatch({
        type: 'attune',
        payload: { characterId, itemInstanceId: ids[0]! },
      }),
    ).toThrow(/already attuned=true/);
    useStore.getState().dispatch({
      type: 'unattune',
      payload: { characterId, itemInstanceId: ids[0]! },
    });
    expect(() =>
      useStore.getState().dispatch({
        type: 'unattune',
        payload: { characterId, itemInstanceId: ids[0]! },
      }),
    ).toThrow(/already attuned=false/);
  });

  it('logs typed attune entries that round-trip through the schema', () => {
    const { characterId, ids } = bootstrapWithAttunables(1);
    useStore.getState().dispatch({
      type: 'attune',
      payload: { characterId, itemInstanceId: ids[0]! },
    });
    const last = useStore.getState().log.at(-1)!;
    expect(last.type).toBe('attune');
    expect(() => transactionLogEntrySchema.parse(last)).not.toThrow();
  });
});

describe('reducer: attune magic-item gate (R2.1)', () => {
  /**
   * R2.1 — `attune` rejects mundane rows (`def.requiresAttunement !== true`).
   * Ordering: Inventory-only (via `resolveInventoryRow`) → no-op →
   * magic-item gate → slot cap. `unattune` deliberately skips the gate
   * so legacy state with `attuned: true` on a mundane row can be cleaned
   * up.
   */
  it('rejects attune on a mundane PHB row (Torch); state unchanged, no log entry', () => {
    const { characterId, inventoryStashId, catalog } = localBootstrap();
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
    const itemInstanceId = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === torch.id)!.id;
    const logLenBefore = useStore.getState().log.length;
    const itemsBefore = useStore.getState().appState!.items;

    expect(() =>
      useStore.getState().dispatch({ type: 'attune', payload: { characterId, itemInstanceId } }),
    ).toThrow(/is not a magic item/);

    // State unchanged, log untouched.
    expect(useStore.getState().appState!.items).toEqual(itemsBefore);
    expect(useStore.getState().log.length).toBe(logLenBefore);
  });

  it('accepts attune on a DMG row with requiresAttunement:true', () => {
    const { characterId, inventoryStashId, catalog } = localBootstrap();
    const magic = catalog.find((d) => d.id === 'dmg-2024:cloak-of-protection')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: magic.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    const itemInstanceId = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === magic.id)!.id;

    expect(() =>
      useStore.getState().dispatch({ type: 'attune', payload: { characterId, itemInstanceId } }),
    ).not.toThrow();
    const row = useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!;
    expect(row.attuned).toBe(true);
  });

  it('unattune succeeds even when the definition is mundane (cleanup path)', () => {
    // Construct a stale state: a mundane Torch row with `attuned: true`.
    // Pre-R2.1 vintage Dexie blobs could carry this combination; the
    // reducer must let users clean it up via `unattune`.
    const { characterId, inventoryStashId, catalog } = localBootstrap();
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
    const itemInstanceId = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === torch.id)!.id;
    // Patch the row directly to mimic legacy state.
    useStore.setState((s) => {
      if (s.appState === null) return s;
      return {
        ...s,
        appState: {
          ...s.appState,
          items: s.appState.items.map((i) =>
            i.id === itemInstanceId ? { ...i, attuned: true } : i,
          ),
        },
      };
    });

    expect(() =>
      useStore.getState().dispatch({ type: 'unattune', payload: { characterId, itemInstanceId } }),
    ).not.toThrow();
    const row = useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!;
    expect(row.attuned).toBe(false);
  });

  it('attune on a mundane row in Party Stash surfaces the Inventory-only error FIRST (rejection ordering)', () => {
    // The Inventory-only check runs in `resolveInventoryRow` BEFORE the
    // magic-item gate. A Torch in the Party Stash trips BOTH guards;
    // the error message must be the Inventory-only one, not the
    // magic-item one.
    const { characterId, partyStashId, catalog } = localBootstrap();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: partyStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    const itemInstanceId = useStore.getState().appState!.items[0]!.id;

    expect(() =>
      useStore.getState().dispatch({ type: 'attune', payload: { characterId, itemInstanceId } }),
    ).toThrow(/not in character .* Inventory/);
  });

  it("attune throws a clear error when the row's definitionId is missing from the catalog", () => {
    // Construct an inventory row whose `definitionId` points at a id
    // that doesn't exist in the catalog. Schema can't catch this — it
    // only enforces string-min-1 on `definitionId`.
    const { characterId, inventoryStashId } = localBootstrap();
    useStore.setState((s) => {
      if (s.appState === null) return s;
      const orphanRow = {
        id: 'orphan-row',
        definitionId: 'dmg-2024:does-not-exist',
        ownerType: 'stash' as const,
        ownerId: inventoryStashId,
        quantity: 1,
        containerInstanceId: null,
        equipped: false,
        attuned: false,
        identified: true,
        currentCharges: null,
      };
      return {
        ...s,
        appState: { ...s.appState, items: [...s.appState.items, orphanRow] },
      };
    });

    expect(() =>
      useStore.getState().dispatch({
        type: 'attune',
        payload: { characterId, itemInstanceId: 'orphan-row' },
      }),
    ).toThrow(/not in catalog/);
  });
});

describe('reducer: edit-character (R1.2)', () => {
  /**
   * Catch-all editor per OUTLINE §4 line 320. Mirrors `edit-homebrew`:
   * diff the patch, derive `changedFields`, reject no-ops. `str` is
   * stored under `abilityScores.STR` but logged + carried as `str`.
   */
  it('updates species and class in one dispatch; log records both fields', () => {
    const { characterId } = localBootstrap();
    useStore.getState().dispatch({
      type: 'edit-character',
      payload: { characterId, patch: { species: 'Elf', class: 'Wizard' } },
    });
    const after = useStore.getState().appState!.characters[0]!;
    expect(after.species).toBe('Elf');
    expect(after.class).toBe('Wizard');
    const last = useStore.getState().log.at(-1)!;
    expect(last.type).toBe('edit-character');
    if (last.type === 'edit-character') {
      expect([...last.payload.changedFields].sort()).toEqual(['class', 'species']);
    }
  });

  it('updates str (stored on abilityScores.STR) and logs as str', () => {
    const { characterId } = localBootstrap();
    useStore.getState().dispatch({
      type: 'edit-character',
      payload: { characterId, patch: { str: 18 } },
    });
    const after = useStore.getState().appState!.characters[0]!;
    expect(after.abilityScores.STR).toBe(18);
    const last = useStore.getState().log.at(-1)!;
    if (last.type === 'edit-character') {
      expect(last.payload.changedFields).toEqual(['str']);
    }
  });

  it('updates maxAttunement (the DM-editable field per §8.1)', () => {
    const { characterId } = localBootstrap();
    useStore.getState().dispatch({
      type: 'edit-character',
      payload: { characterId, patch: { maxAttunement: 5 } },
    });
    expect(useStore.getState().appState!.characters[0]!.maxAttunement).toBe(5);
  });

  it('rejects no-op edits (every field unchanged)', () => {
    const { characterId } = localBootstrap();
    const before = useStore.getState().appState!.characters[0]!;
    expect(() =>
      useStore.getState().dispatch({
        type: 'edit-character',
        payload: {
          characterId,
          patch: {
            species: before.species,
            class: before.class,
            level: before.level,
            str: before.abilityScores.STR,
            maxAttunement: before.maxAttunement,
          },
        },
      }),
    ).toThrow(/no fields changed/);
  });

  it('rejects unknown characterId', () => {
    localBootstrap();
    expect(() =>
      useStore.getState().dispatch({
        type: 'edit-character',
        payload: { characterId: 'nope', patch: { level: 5 } },
      }),
    ).toThrow(/unknown characterId/);
  });

  it('logs an edit-character entry that round-trips through the schema', () => {
    const { characterId } = localBootstrap();
    useStore.getState().dispatch({
      type: 'edit-character',
      payload: { characterId, patch: { level: 4 } },
    });
    const last = useStore.getState().log.at(-1)!;
    expect(() => transactionLogEntrySchema.parse(last)).not.toThrow();
  });
});

describe('reducer: transfer cascade — leave-Inventory clears equipped/attuned (R1.3)', () => {
  /**
   * OUTLINE §3.4: when a `transfer` moves an item from a character's
   * Inventory (`scope=character, isCarried=true`) to ANY other stash,
   * the reducer atomically sets `equipped: false`, `attuned: false`,
   * `currentCharges: null` as part of the same dispatch — and emits ONE
   * paired `edit-item-instance` log entry capturing the cleared fields.
   *
   * `currentCharges` is still null-locked in R1.3 (R2.2 widens it), so
   * the cascade has nothing to clear there yet — the test scaffolding
   * is here so R2.2 doesn't have to re-discover the contract.
   */

  function setupEquippedTorch(): {
    characterId: string;
    inventoryStashId: string;
    partyStashId: string;
    itemInstanceId: string;
  } {
    const { characterId, inventoryStashId, partyStashId, catalog } = localBootstrap();
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
    const itemInstanceId = useStore.getState().appState!.items[0]!.id;
    useStore.getState().dispatch({ type: 'equip', payload: { characterId, itemInstanceId } });
    return { characterId, inventoryStashId, partyStashId, itemInstanceId };
  }

  it('clears equipped on Inventory → Party Stash transfer + emits paired edit-item-instance entry', () => {
    const { partyStashId, itemInstanceId } = setupEquippedTorch();
    const logLenBefore = useStore.getState().log.length;

    useStore.getState().dispatch({
      type: 'transfer',
      payload: { itemInstanceId, toStashId: partyStashId, quantity: 1 },
    });

    const moved = useStore.getState().appState!.items.find((i) => i.ownerId === partyStashId);
    expect(moved).toBeDefined();
    expect(moved!.equipped).toBe(false);

    // Two log entries appended: one `transfer`, one `edit-item-instance`.
    const log = useStore.getState().log;
    const added = log.slice(logLenBefore);
    expect(added.map((e) => e.type)).toEqual(['transfer', 'edit-item-instance']);
    const edit = added[1]!;
    if (edit.type === 'edit-item-instance') {
      expect(edit.payload.changedFields).toEqual(['equipped']);
      expect(edit.payload.itemInstanceId).toBe(moved!.id);
    }
    // Both entries share actor/party/timestamp per the M3 cascade contract.
    expect(added[0]!.actorUserId).toBe(added[1]!.actorUserId);
    expect(added[0]!.partyId).toBe(added[1]!.partyId);
    expect(added[0]!.timestamp).toBe(added[1]!.timestamp);
  });

  it('clears attuned on Inventory → Storage transfer + frees slot on source character', () => {
    const { characterId, inventoryStashId, catalog } = localBootstrap();
    // R2.1 — use a DMG magic item so `attune` doesn't reject under the
    // mundane-item gate. Cascade behaviour is orthogonal to the gate.
    const magic = catalog.find((d) => d.id === 'dmg-2024:cloak-of-protection')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: magic.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    const itemInstanceId = useStore.getState().appState!.items[0]!.id;
    useStore.getState().dispatch({ type: 'attune', payload: { characterId, itemInstanceId } });
    // Create a Storage stash to transfer into.
    useStore.getState().dispatch({
      type: 'create-stash',
      payload: { ownerCharacterId: characterId, name: 'Vault' },
    });
    const storageStashId = useStore
      .getState()
      .appState!.stashes.find((st) => st.name === 'Vault')!.id;

    useStore.getState().dispatch({
      type: 'transfer',
      payload: { itemInstanceId, toStashId: storageStashId, quantity: 1 },
    });

    const moved = useStore.getState().appState!.items.find((i) => i.ownerId === storageStashId);
    expect(moved!.attuned).toBe(false);

    // Slot is free again — attuning a fresh row succeeds without rejection.
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: magic.id,
        quantity: 1,
        source: 'catalog-add',
        notes: 'fresh-row',
      },
    });
    const freshId = useStore.getState().appState!.items.find((i) => i.notes === 'fresh-row')!.id;
    expect(() =>
      useStore
        .getState()
        .dispatch({ type: 'attune', payload: { characterId, itemInstanceId: freshId } }),
    ).not.toThrow();
  });

  it('does NOT emit edit-item-instance when source row had no flags to clear', () => {
    // A plain Inventory → Party Stash transfer of an un-equipped, un-attuned
    // row should still emit only ONE log entry (`transfer`) — the cascade
    // is a no-op when the source is already at the placeholder values.
    const { inventoryStashId, partyStashId, catalog } = localBootstrap();
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
    const itemInstanceId = useStore.getState().appState!.items[0]!.id;
    const logLenBefore = useStore.getState().log.length;

    useStore.getState().dispatch({
      type: 'transfer',
      payload: { itemInstanceId, toStashId: partyStashId, quantity: 1 },
    });

    const added = useStore.getState().log.slice(logLenBefore);
    expect(added.map((e) => e.type)).toEqual(['transfer']);
  });

  it('does NOT cascade on a stash-to-stash transfer that does NOT leave Inventory', () => {
    // Equip a row, then run a same-stash split-then-merge scenario via a
    // dest that ISN'T the character's Inventory but the source already
    // wasn't either: Party Stash → Recovered Loot. equipped should never
    // have been true on a Party Stash row (the reducer would've rejected
    // equip there) — so this is the cascade-doesn't-fire case.
    const { partyStashId, recoveredLootStashId, catalog } = localBootstrap();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: partyStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    const itemInstanceId = useStore.getState().appState!.items[0]!.id;
    const logLenBefore = useStore.getState().log.length;

    useStore.getState().dispatch({
      type: 'transfer',
      payload: { itemInstanceId, toStashId: recoveredLootStashId, quantity: 1 },
    });

    const added = useStore.getState().log.slice(logLenBefore);
    expect(added.map((e) => e.type)).toEqual(['transfer']);
  });

  it('clears BOTH equipped and attuned on the same transfer in ONE paired entry', () => {
    const { characterId, inventoryStashId, partyStashId, catalog } = localBootstrap();
    // R2.1 — magic item required for `attune`. `equip` accepts any item
    // category in R1.2 (the property-based slot conflict rule is advisory
    // only) so a wand is fine for the equip leg too.
    const magic = catalog.find((d) => d.id === 'dmg-2024:cloak-of-protection')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: magic.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    const itemInstanceId = useStore.getState().appState!.items[0]!.id;
    useStore.getState().dispatch({ type: 'equip', payload: { characterId, itemInstanceId } });
    useStore.getState().dispatch({ type: 'attune', payload: { characterId, itemInstanceId } });

    const logLenBefore = useStore.getState().log.length;
    useStore.getState().dispatch({
      type: 'transfer',
      payload: { itemInstanceId, toStashId: partyStashId, quantity: 1 },
    });

    const added = useStore.getState().log.slice(logLenBefore);
    // Just two entries — `transfer` + ONE `edit-item-instance` covering both fields.
    expect(added.map((e) => e.type)).toEqual(['transfer', 'edit-item-instance']);
    const edit = added[1]!;
    if (edit.type === 'edit-item-instance') {
      expect([...edit.payload.changedFields].sort()).toEqual(['attuned', 'equipped']);
    }
  });
});

describe('reducer: transfer cascade — container contents follow (R1.3)', () => {
  /**
   * OUTLINE §3.4: when a `transfer` moves an item whose `id` is the
   * `containerInstanceId` of one or more other instances in the SAME
   * source stash, those child rows' `ownerId` updates to the destination
   * stash too. The children's `containerInstanceId` is preserved (still
   * points at the same parent), so the (parent, contents) hierarchy
   * stays intact across the move.
   *
   * R1.3 wires the rule at the reducer; the UI path for packing items
   * INTO a container lands later (no `set-container` action yet, so the
   * "transfer rejects A-into-B" guard is moot at the reducer level for
   * R1.3 — it'd only trigger when packing is wired). These tests use
   * `useStore.setState` to construct the nested fixture so we can
   * exercise the cascade without a packing UI.
   */

  function bootstrapWithBackpackAndRations(): {
    inventoryStashId: string;
    partyStashId: string;
    backpackId: string;
    rationIds: string[];
  } {
    const { inventoryStashId, partyStashId, catalog } = localBootstrap();
    const backpack = catalog.find((d) => d.id === 'phb-2024:backpack');
    const rations = catalog.find((d) => d.id === 'phb-2024:rations-1day');
    if (backpack === undefined || rations === undefined) {
      throw new Error('PHB seed missing backpack or rations definition');
    }
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: backpack.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    const backpackId = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === backpack.id)!.id;
    // Three separate ration rows so we can verify the cascade catches
    // each child independently. Distinct `notes` keeps them as 3 rows.
    const rationIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      useStore.getState().dispatch({
        type: 'acquire',
        payload: {
          stashId: inventoryStashId,
          definitionId: rations.id,
          quantity: 1,
          source: 'catalog-add',
          notes: `day-${i}`,
        },
      });
    }
    // Patch the three rows to point at the backpack as their container.
    useStore.setState((curr) => {
      if (curr.appState === null) return curr;
      const nextItems = curr.appState.items.map((row) => {
        if (row.definitionId === rations.id && row.ownerId === inventoryStashId) {
          rationIds.push(row.id);
          return { ...row, containerInstanceId: backpackId };
        }
        return row;
      });
      return { ...curr, appState: { ...curr.appState, items: nextItems } };
    });
    return { inventoryStashId, partyStashId, backpackId, rationIds };
  }

  it('moves child rows when the parent container is transferred', () => {
    const { partyStashId, backpackId } = bootstrapWithBackpackAndRations();

    useStore.getState().dispatch({
      type: 'transfer',
      payload: { itemInstanceId: backpackId, toStashId: partyStashId, quantity: 1 },
    });

    // All 4 rows (backpack + 3 rations) now live in the Party Stash.
    const rowsInParty = useStore
      .getState()
      .appState!.items.filter((i) => i.ownerId === partyStashId);
    expect(rowsInParty).toHaveLength(4);

    // Children still reference the backpack via containerInstanceId.
    const childRows = rowsInParty.filter((r) => r.containerInstanceId === backpackId);
    expect(childRows).toHaveLength(3);
  });

  it('emits ONE transfer log entry (cascade does not double-log per child)', () => {
    const { partyStashId, backpackId } = bootstrapWithBackpackAndRations();
    const logLenBefore = useStore.getState().log.length;

    useStore.getState().dispatch({
      type: 'transfer',
      payload: { itemInstanceId: backpackId, toStashId: partyStashId, quantity: 1 },
    });

    const added = useStore.getState().log.slice(logLenBefore);
    // Just one entry — the cascade is implicit in the state diff and
    // doesn't emit a per-child synthetic transfer. (M3's delete-stash
    // cascade does emit per-row, but that's a different contract.)
    expect(added.map((e) => e.type)).toEqual(['transfer']);
  });

  it('does NOT move sibling rows that are not children of the moved container', () => {
    const { inventoryStashId, partyStashId, backpackId } = bootstrapWithBackpackAndRations();
    const rope = useStore
      .getState()
      .appState!.catalog.find((d) => d.id === 'phb-2024:rope-hempen-50ft');
    if (rope === undefined) {
      // PHB seed doesn't ship hempen rope under that exact id — skip.
      return;
    }
    // Add a loose rope row to Inventory (not a child of the backpack).
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: rope.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });

    useStore.getState().dispatch({
      type: 'transfer',
      payload: { itemInstanceId: backpackId, toStashId: partyStashId, quantity: 1 },
    });

    // Rope stays in Inventory.
    const ropeRow = useStore.getState().appState!.items.find((i) => i.definitionId === rope.id);
    expect(ropeRow!.ownerId).toBe(inventoryStashId);
  });

  it('clears equipped/attuned on container parent if it was equipped (cascade composes)', () => {
    // Container could be equipped (Wand of magic missiles in a holster,
    // etc.). The leave-Inventory cascade still fires on the parent. The
    // children are non-Inventory-flag carriers (rations); they don't
    // trip the cascade themselves.
    const { partyStashId, backpackId } = bootstrapWithBackpackAndRations();
    const characterId = useStore.getState().appState!.characters[0]!.id;
    useStore
      .getState()
      .dispatch({ type: 'equip', payload: { characterId, itemInstanceId: backpackId } });

    const logLenBefore = useStore.getState().log.length;
    useStore.getState().dispatch({
      type: 'transfer',
      payload: { itemInstanceId: backpackId, toStashId: partyStashId, quantity: 1 },
    });

    const moved = useStore.getState().appState!.items.find((i) => i.id === backpackId);
    expect(moved!.equipped).toBe(false);

    const added = useStore.getState().log.slice(logLenBefore);
    expect(added.map((e) => e.type)).toEqual(['transfer', 'edit-item-instance']);
  });
});

describe('reducer: hard-mode enforcement (R1.4) — acquire / transfer reject when over carrying capacity', () => {
  /**
   * R1.4 — when a character has `enforceEncumbrance: true` and a
   * non-`off` rule, the reducer rejects `acquire` / `transfer` that
   * would push the destination Inventory's container-aware weight
   * past `heavyThreshold(str, size, rule)`. Composes with the R1.3
   * cascade: cascade adjusts the moved row first (clears flags); the
   * threshold check runs on the post-cascade weight. A leave-Inventory
   * transfer never trips the guard (it lowers source weight); the
   * entering-Inventory case is the one that matters.
   *
   * The fixtures use the default STR 16 Medium → variant ceiling
   * 160 lb, phb ceiling 240 lb. `phb-2024:greatclub` is 10 lb/row so
   * the math reads cleanly (16 greatclubs = 160 lb at-cap; 17 = 170 lb
   * over). All tests start from `localBootstrap()` which auto-stacks
   * via `(definitionId, notes ?? "")` per the M2 acquire contract.
   */

  function enableEnforce(characterId: string, rule: 'phb' | 'variant'): void {
    useStore.getState().dispatch({
      type: 'set-encumbrance',
      payload: { characterId, rule, enforce: true },
    });
  }

  it('rejects acquire when post-write weight exceeds variant 10×STR×size (enforced)', () => {
    const { characterId, inventoryStashId, catalog } = localBootstrap();
    const greatclub = catalog.find((d) => d.id === 'phb-2024:greatclub')!;
    enableEnforce(characterId, 'variant');

    // Pre-load to 160 lb (16 × 10) — exactly at cap, no reject.
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: greatclub.id,
        quantity: 16,
        source: 'catalog-add',
      },
    });

    const itemsBefore = useStore.getState().appState!.items.slice();
    const logLenBefore = useStore.getState().log.length;

    // Adding one more pushes to 170 lb > 160 — must reject.
    expect(() => {
      useStore.getState().dispatch({
        type: 'acquire',
        payload: {
          stashId: inventoryStashId,
          definitionId: greatclub.id,
          quantity: 1,
          source: 'catalog-add',
        },
      });
    }).toThrow(/carrying capacity/i);

    // State unchanged — no row mutation, no log entry.
    expect(useStore.getState().appState!.items).toEqual(itemsBefore);
    expect(useStore.getState().log.length).toBe(logLenBefore);
  });

  it('rejects transfer-into-Inventory when post-write weight exceeds phb STR×15×size (enforced)', () => {
    const { characterId, inventoryStashId, partyStashId, catalog } = localBootstrap();
    const greatclub = catalog.find((d) => d.id === 'phb-2024:greatclub')!;
    enableEnforce(characterId, 'phb');

    // Stage 240 lb worth (24 × 10) in the Party Stash; Inventory empty.
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: partyStashId,
        definitionId: greatclub.id,
        quantity: 24,
        source: 'catalog-add',
      },
    });
    // Pre-load Inventory to 230 lb so any incoming over 10 lb rejects.
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: greatclub.id,
        // notes differ so this is a separate row (avoids auto-stack
        // colliding with the transfer target row below).
        notes: 'pre-loaded',
        quantity: 23,
        source: 'catalog-add',
      },
    });

    // Find the row in the party stash; transfer 2 (= 20 lb) into Inventory.
    const partyRow = useStore
      .getState()
      .appState!.items.find((i) => i.ownerId === partyStashId && i.definitionId === greatclub.id)!;
    const itemsBefore = useStore.getState().appState!.items.slice();
    const logLenBefore = useStore.getState().log.length;

    // Post-write would be 230 + 20 = 250 > 240 phb ceiling → reject.
    expect(() => {
      useStore.getState().dispatch({
        type: 'transfer',
        payload: { itemInstanceId: partyRow.id, toStashId: inventoryStashId, quantity: 2 },
      });
    }).toThrow(/carrying capacity/i);

    expect(useStore.getState().appState!.items).toEqual(itemsBefore);
    expect(useStore.getState().log.length).toBe(logLenBefore);
  });

  it('allows acquire when rule = off even if enforce flag is true (off short-circuits)', () => {
    const { characterId, inventoryStashId, catalog } = localBootstrap();
    const greatclub = catalog.find((d) => d.id === 'phb-2024:greatclub')!;
    // Hand-write the enforce flag while leaving rule = off (the reducer
    // wouldn't accept this via `set-encumbrance` no-op check, but the
    // schema permits the combo and the guard must respect it).
    useStore.setState((s) => {
      if (s.appState === null) return s;
      return {
        ...s,
        appState: {
          ...s.appState,
          characters: s.appState.characters.map((c) =>
            c.id === characterId ? { ...c, enforceEncumbrance: true } : c,
          ),
        },
      };
    });

    // Push way over any threshold — must succeed under rule = off.
    expect(() => {
      useStore.getState().dispatch({
        type: 'acquire',
        payload: {
          stashId: inventoryStashId,
          definitionId: greatclub.id,
          quantity: 100, // 1000 lb
          source: 'catalog-add',
        },
      });
    }).not.toThrow();
  });

  it('allows acquire over threshold when enforceEncumbrance = false (display-only path)', () => {
    const { characterId, inventoryStashId, catalog } = localBootstrap();
    const greatclub = catalog.find((d) => d.id === 'phb-2024:greatclub')!;
    // Rule on, enforce off — CapacityBar will paint red but reducer allows.
    useStore.getState().dispatch({
      type: 'set-encumbrance',
      payload: { characterId, rule: 'variant', enforce: false },
    });

    expect(() => {
      useStore.getState().dispatch({
        type: 'acquire',
        payload: {
          stashId: inventoryStashId,
          definitionId: greatclub.id,
          quantity: 20, // 200 lb > 160 variant ceiling
          source: 'catalog-add',
        },
      });
    }).not.toThrow();
    const row = useStore.getState().appState!.items.find((i) => i.ownerId === inventoryStashId);
    expect(row!.quantity).toBe(20);
  });

  it('respects size multiplier (Small character: phb ceiling halves to STR × 15 × 0.5)', () => {
    // Small + STR 10 → phb ceiling = 10 × 15 × 0.5 = 75 lb.
    const { characterId, inventoryStashId, catalog } = bootstrap({
      name: 'Pip',
      species: 'Halfling',
      size: 'small',
      class: 'Rogue',
      level: 1,
      str: 10,
    });
    const greatclub = catalog.find((d) => d.id === 'phb-2024:greatclub')!;
    enableEnforce(characterId, 'phb');

    // 7 greatclubs = 70 lb → under, OK.
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: greatclub.id,
        quantity: 7,
        source: 'catalog-add',
      },
    });
    // 8th greatclub = 80 lb > 75 ceiling → reject.
    expect(() => {
      useStore.getState().dispatch({
        type: 'acquire',
        payload: {
          stashId: inventoryStashId,
          definitionId: greatclub.id,
          quantity: 1,
          source: 'catalog-add',
        },
      });
    }).toThrow(/carrying capacity/i);
  });

  it('allows transfer OUT of Inventory regardless of source-side weight (leave-Inventory always lowers)', () => {
    // The §3.4 cascade test composes here: even if the SOURCE inventory
    // is over-cap and enforce is on, moving items OUT can only lower
    // the inventory weight — must succeed.
    const { characterId, inventoryStashId, partyStashId, catalog } = localBootstrap();
    const greatclub = catalog.find((d) => d.id === 'phb-2024:greatclub')!;
    // First load Inventory to 230 lb with enforce OFF (so the load itself
    // doesn't trip the guard), then flip enforce on.
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: greatclub.id,
        quantity: 23,
        source: 'catalog-add',
      },
    });
    enableEnforce(characterId, 'phb'); // ceiling = 240 — fine, but a future
    // hypothetical "edit-character to lower STR" path could leave the row
    // over-cap; this test pins the leave-Inventory direction as always-safe.

    const row = useStore.getState().appState!.items[0]!;
    expect(() => {
      useStore.getState().dispatch({
        type: 'transfer',
        payload: { itemInstanceId: row.id, toStashId: partyStashId, quantity: 23 },
      });
    }).not.toThrow();
  });
});

describe('reducer: transfer — pack & take out (R1.5)', () => {
  /**
   * R1.5 — same-stash packing UI. Extends `transfer` with optional
   * `toContainerInstanceId`:
   *   - `undefined`: parent unchanged (every pre-R1.5 dispatch).
   *   - `null`: take-out — clears `containerInstanceId` on the moved row.
   *   - `string`: pack-into — sets `containerInstanceId` to the supplied id.
   *
   * Guards: self-ref, one-level-deep, same-stash, unknown-id. The hard-
   * mode (R1.4) check composes on post-pack weight, so packing into a
   * `flatWeight: true` container LOWERS effective weight (it just works
   * via the existing `containerAwareWeight` rule).
   *
   * Approach B for container auto-stack policy (acquire side): every
   * `acquire` of a `category === 'container'` definition synthesizes a
   * distinguishing `notes` value so two backpacks never collide on the
   * `(definitionId, notes ?? "")` key.
   */

  function acquireRow(stashId: string, definitionId: string, quantity = 1, notes?: string): string {
    const before = new Set(useStore.getState().appState!.items.map((i) => i.id));
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId,
        definitionId,
        quantity,
        source: 'catalog-add',
        ...(notes !== undefined ? { notes } : {}),
      },
    });
    const fresh = useStore.getState().appState!.items.find((i) => !before.has(i.id));
    return fresh!.id;
  }

  function enableEnforce(characterId: string, rule: 'phb' | 'variant'): void {
    useStore.getState().dispatch({
      type: 'set-encumbrance',
      payload: { characterId, rule, enforce: true },
    });
  }

  it('packs a torch into a backpack in the same stash', () => {
    const { inventoryStashId, catalog } = localBootstrap();
    const backpack = catalog.find((d) => d.id === 'phb-2024:backpack')!;
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    const backpackId = acquireRow(inventoryStashId, backpack.id);
    const torchId = acquireRow(inventoryStashId, torch.id);

    useStore.getState().dispatch({
      type: 'transfer',
      payload: {
        itemInstanceId: torchId,
        toStashId: inventoryStashId,
        quantity: 1,
        toContainerInstanceId: backpackId,
      },
    });

    const torchRow = useStore.getState().appState!.items.find((i) => i.id === torchId)!;
    expect(torchRow.containerInstanceId).toBe(backpackId);
    expect(torchRow.ownerId).toBe(inventoryStashId);
  });

  it('rejects pack when destination container has a non-null containerInstanceId (two-level nesting)', () => {
    const { inventoryStashId, catalog } = localBootstrap();
    const backpack = catalog.find((d) => d.id === 'phb-2024:backpack')!;
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    // Backpack A (top-level), Backpack B (will be nested), torch.
    const backpackAId = acquireRow(inventoryStashId, backpack.id, 1, 'A');
    const backpackBId = acquireRow(inventoryStashId, backpack.id, 1, 'B');
    const torchId = acquireRow(inventoryStashId, torch.id);
    // Manually nest backpack B inside A so it has containerInstanceId !== null.
    useStore.setState((curr) => {
      const next = curr.appState!.items.map((i) =>
        i.id === backpackBId ? { ...i, containerInstanceId: backpackAId } : i,
      );
      return { ...curr, appState: { ...curr.appState!, items: next } };
    });

    expect(() => {
      useStore.getState().dispatch({
        type: 'transfer',
        payload: {
          itemInstanceId: torchId,
          toStashId: inventoryStashId,
          quantity: 1,
          toContainerInstanceId: backpackBId, // already nested inside A
        },
      });
    }).toThrow(/one level|two-level|nested|already in a container/i);
  });

  it('rejects pack with self-reference (row.id === toContainerInstanceId)', () => {
    const { inventoryStashId, catalog } = localBootstrap();
    const backpack = catalog.find((d) => d.id === 'phb-2024:backpack')!;
    const backpackId = acquireRow(inventoryStashId, backpack.id);

    expect(() => {
      useStore.getState().dispatch({
        type: 'transfer',
        payload: {
          itemInstanceId: backpackId,
          toStashId: inventoryStashId,
          quantity: 1,
          toContainerInstanceId: backpackId, // pack into self
        },
      });
    }).toThrow(/self|itself|same row/i);
  });

  it('rejects pack when destination container lives in a different stash than toStashId', () => {
    const { inventoryStashId, partyStashId, catalog } = localBootstrap();
    const backpack = catalog.find((d) => d.id === 'phb-2024:backpack')!;
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    // Backpack lives in party stash; torch lives in inventory.
    const partyBackpackId = acquireRow(partyStashId, backpack.id);
    const torchId = acquireRow(inventoryStashId, torch.id);

    expect(() => {
      useStore.getState().dispatch({
        type: 'transfer',
        payload: {
          itemInstanceId: torchId,
          toStashId: inventoryStashId, // moving to inventory
          quantity: 1,
          toContainerInstanceId: partyBackpackId, // ... but container is in party stash
        },
      });
    }).toThrow(/same stash|different stash/i);
  });

  it('rejects pack when toContainerInstanceId references an unknown id', () => {
    const { inventoryStashId, catalog } = localBootstrap();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    const torchId = acquireRow(inventoryStashId, torch.id);

    expect(() => {
      useStore.getState().dispatch({
        type: 'transfer',
        payload: {
          itemInstanceId: torchId,
          toStashId: inventoryStashId,
          quantity: 1,
          toContainerInstanceId: 'bogus-container-id',
        },
      });
    }).toThrow(/unknown|not found/i);
  });

  it('takes a row out of a container via toContainerInstanceId: null (same stash)', () => {
    const { inventoryStashId, catalog } = localBootstrap();
    const backpack = catalog.find((d) => d.id === 'phb-2024:backpack')!;
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    const backpackId = acquireRow(inventoryStashId, backpack.id);
    const torchId = acquireRow(inventoryStashId, torch.id);
    // Pack first.
    useStore.getState().dispatch({
      type: 'transfer',
      payload: {
        itemInstanceId: torchId,
        toStashId: inventoryStashId,
        quantity: 1,
        toContainerInstanceId: backpackId,
      },
    });
    // Take out.
    useStore.getState().dispatch({
      type: 'transfer',
      payload: {
        itemInstanceId: torchId,
        toStashId: inventoryStashId,
        quantity: 1,
        toContainerInstanceId: null,
      },
    });

    const torchRow = useStore.getState().appState!.items.find((i) => i.id === torchId)!;
    expect(torchRow.containerInstanceId).toBeNull();
    expect(torchRow.ownerId).toBe(inventoryStashId);
  });

  it('hard-mode allows packing into a flatWeight container at-cap (effective weight drops)', () => {
    const { characterId, inventoryStashId, catalog } = localBootstrap();
    const greatclub = catalog.find((d) => d.id === 'phb-2024:greatclub')!;
    // Create a homebrew "Big Sack" container, then patch its `flatWeight`
    // via setState (the M6 homebrew payload doesn't expose flatWeight in
    // R1.5 — DMG seed lands in R2.1; for now we exercise the reducer rule
    // against a manually-flagged row).
    const bigSackName = 'Big Sack of Plenty';
    useStore.getState().dispatch({
      type: 'create-homebrew',
      payload: {
        name: bigSackName,
        category: 'container',
        weight: 5,
        cost: { amount: 1, currency: 'gp' },
        description: 'A magical sack that ignores its contents weight.',
        tags: [],
      },
    });
    useStore.setState((curr) => {
      const nextCatalog = curr.appState!.catalog.map((d) =>
        d.name === bigSackName ? { ...d, flatWeight: true } : d,
      );
      return { ...curr, appState: { ...curr.appState!, catalog: nextCatalog } };
    });
    const sackDef = useStore.getState().appState!.catalog.find((d) => d.name === bigSackName)!;
    const sackId = acquireRow(inventoryStashId, sackDef.id);
    // Pre-load Inventory near the PHB cap (16 × 15 = 240 lb).
    // 23 greatclubs × 10 lb = 230 lb + 5 lb sack = 235 lb total (under 240).
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: greatclub.id,
        quantity: 23,
        source: 'catalog-add',
      },
    });
    enableEnforce(characterId, 'phb'); // ceiling = 240 lb
    const greatclubRow = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === greatclub.id)!;

    // Packing the 230 lb greatclub stack into the flat-weight sack should
    // LOWER effective weight (sack still contributes 5 lb, contents free).
    expect(() => {
      useStore.getState().dispatch({
        type: 'transfer',
        payload: {
          itemInstanceId: greatclubRow.id,
          toStashId: inventoryStashId,
          quantity: greatclubRow.quantity,
          toContainerInstanceId: sackId,
        },
      });
    }).not.toThrow();
  });

  it('Approach B: two acquires of the same container definition produce two rows with distinct synthesized notes', () => {
    const { inventoryStashId, catalog } = localBootstrap();
    const backpack = catalog.find((d) => d.id === 'phb-2024:backpack')!;

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

    const backpackRows = useStore
      .getState()
      .appState!.items.filter((i) => i.definitionId === backpack.id);
    expect(backpackRows).toHaveLength(2);
    const notesA = backpackRows[0]!.notes;
    const notesB = backpackRows[1]!.notes;
    expect(notesA).toBeDefined();
    expect(notesB).toBeDefined();
    expect(notesA).not.toBe(notesB);
    // Conventional synthesis pattern: '#1', '#2'.
    expect([notesA, notesB].sort()).toEqual(['#1', '#2']);
  });

  it('Approach B: user-provided notes on container acquire are used verbatim (no synthesis)', () => {
    const { inventoryStashId, catalog } = localBootstrap();
    const backpack = catalog.find((d) => d.id === 'phb-2024:backpack')!;

    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: backpack.id,
        quantity: 1,
        source: 'catalog-add',
        notes: "Volo's backpack",
      },
    });

    const row = useStore.getState().appState!.items.find((i) => i.definitionId === backpack.id)!;
    expect(row.notes).toBe("Volo's backpack");
  });

  it('Approach B: synthesis uses "highest existing + 1" so deletes do not recycle ids', () => {
    const { inventoryStashId, catalog } = localBootstrap();
    const backpack = catalog.find((d) => d.id === 'phb-2024:backpack')!;
    const def = backpack.id;

    useStore.getState().dispatch({
      type: 'acquire',
      payload: { stashId: inventoryStashId, definitionId: def, quantity: 1, source: 'catalog-add' },
    });
    useStore.getState().dispatch({
      type: 'acquire',
      payload: { stashId: inventoryStashId, definitionId: def, quantity: 1, source: 'catalog-add' },
    });
    // Consume #1 fully.
    const row1 = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === def && i.notes === '#1')!;
    useStore.getState().dispatch({
      type: 'consume',
      payload: { itemInstanceId: row1.id, quantity: 1 },
    });
    // Next acquire must synth '#3', not recycle '#1'.
    useStore.getState().dispatch({
      type: 'acquire',
      payload: { stashId: inventoryStashId, definitionId: def, quantity: 1, source: 'catalog-add' },
    });

    const liveRows = useStore.getState().appState!.items.filter((i) => i.definitionId === def);
    const notes = liveRows.map((r) => r.notes).sort();
    expect(notes).toEqual(['#2', '#3']);
  });

  it('synthesized notes are scoped per-stash (acquiring the same container in two stashes yields #1 in each)', () => {
    const { inventoryStashId, partyStashId, catalog } = localBootstrap();
    const backpack = catalog.find((d) => d.id === 'phb-2024:backpack')!;

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
        stashId: partyStashId,
        definitionId: backpack.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });

    const invBackpack = useStore
      .getState()
      .appState!.items.find(
        (i) => i.definitionId === backpack.id && i.ownerId === inventoryStashId,
      )!;
    const partyBackpack = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === backpack.id && i.ownerId === partyStashId)!;
    expect(invBackpack.notes).toBe('#1');
    expect(partyBackpack.notes).toBe('#1');
  });

  it('non-container acquire is unchanged (no synthesis on weapons / gear)', () => {
    const { inventoryStashId, catalog } = localBootstrap();
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
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });

    // Should auto-stack on `(definitionId, notes ?? "")` per the M2 contract.
    const torchRows = useStore
      .getState()
      .appState!.items.filter((i) => i.definitionId === torch.id);
    expect(torchRows).toHaveLength(1);
    expect(torchRows[0]!.quantity).toBe(2);
    expect(torchRows[0]!.notes).toBeUndefined();
  });

  it('cross-stash transfer of a contained row clears its containerInstanceId (no dangling parent)', () => {
    // Bug repro: pack a torch into a backpack (Inventory), then Move the
    // torch (NOT the backpack) to the Party Stash. The moved torch must
    // NOT carry its old `containerInstanceId` — the parent backpack
    // stayed in Inventory, so the reference would dangle. Without this
    // fix the UI's `isContained` check renders a Take-out button on the
    // moved row in the new stash, even though there's no parent there.
    //
    // Note: this is the inverse of the OUTLINE §3.4 contents-follow rule.
    // §3.4 handles "move the PARENT, children come along". This test
    // covers "move a CHILD out of the container by cross-stash Move",
    // which must drop the parent reference.
    const { inventoryStashId, partyStashId, catalog } = localBootstrap();
    const backpack = catalog.find((d) => d.id === 'phb-2024:backpack')!;
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    const backpackId = acquireRow(inventoryStashId, backpack.id);
    const torchId = acquireRow(inventoryStashId, torch.id);

    // Pack torch into backpack.
    useStore.getState().dispatch({
      type: 'transfer',
      payload: {
        itemInstanceId: torchId,
        toStashId: inventoryStashId,
        quantity: 1,
        toContainerInstanceId: backpackId,
      },
    });
    expect(
      useStore.getState().appState!.items.find((i) => i.id === torchId)!.containerInstanceId,
    ).toBe(backpackId);

    // Now move JUST the torch cross-stash. The backpack stays in Inventory.
    useStore.getState().dispatch({
      type: 'transfer',
      payload: {
        itemInstanceId: torchId,
        toStashId: partyStashId,
        quantity: 1,
      },
    });

    const torchAfter = useStore.getState().appState!.items.find((i) => i.id === torchId)!;
    expect(torchAfter.ownerId).toBe(partyStashId);
    // The fix: containerInstanceId must be cleared because the parent
    // isn't in the destination stash.
    expect(torchAfter.containerInstanceId).toBeNull();
  });
});

describe('reducer: use-charge (R2.2)', () => {
  /**
   * Bootstrap a character with a Wand of Magic Missiles in their
   * Inventory. The acquire path auto-stacks into a row; the leave/enter-
   * Inventory cascade (R2.2) initialises `currentCharges` to `def.max`
   * the moment the row lands in Inventory. Verifying the init here is
   * load-bearing for every subsequent use-charge test.
   */
  function setupWandInInventory(): {
    characterId: string;
    inventoryStashId: string;
    partyStashId: string;
    itemInstanceId: string;
    wand: ReturnType<typeof bootstrap>['catalog'][number];
  } {
    const base = localBootstrap();
    const wand = base.catalog.find((d) => d.id === 'dmg-2024:wand-of-magic-missiles');
    if (wand === undefined) throw new Error('setupWandInInventory: wand not in catalog');
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: base.inventoryStashId,
        definitionId: wand.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    const itemInstanceId = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === wand.id)!.id;
    return {
      characterId: base.characterId,
      inventoryStashId: base.inventoryStashId,
      partyStashId: base.partyStashId,
      itemInstanceId,
      wand,
    };
  }

  function setupPotionInInventory(quantity: number): {
    characterId: string;
    inventoryStashId: string;
    itemInstanceId: string;
    potion: ReturnType<typeof bootstrap>['catalog'][number];
  } {
    const base = localBootstrap();
    const potion = base.catalog.find((d) => d.id === 'dmg-2024:potion-of-healing');
    if (potion === undefined) throw new Error('setupPotionInInventory: potion not in catalog');
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: base.inventoryStashId,
        definitionId: potion.id,
        quantity,
        source: 'catalog-add',
      },
    });
    const itemInstanceId = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === potion.id)!.id;
    return {
      characterId: base.characterId,
      inventoryStashId: base.inventoryStashId,
      itemInstanceId,
      potion,
    };
  }

  it('initialises currentCharges to def.max when a charged item enters Inventory via acquire', () => {
    const { itemInstanceId, wand } = setupWandInInventory();
    const row = useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!;
    expect(row.currentCharges).toBe(wand.charges!.max);
  });

  it('decrements currentCharges by 1 on dispatch with default amount', () => {
    const { characterId, itemInstanceId, wand } = setupWandInInventory();
    useStore.getState().dispatch({
      type: 'use-charge',
      payload: { itemInstanceId, characterId },
    });
    const row = useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!;
    expect(row.currentCharges).toBe(wand.charges!.max - 1);
  });

  it('decrements by the provided amount', () => {
    const { characterId, itemInstanceId, wand } = setupWandInInventory();
    useStore.getState().dispatch({
      type: 'use-charge',
      payload: { itemInstanceId, characterId, amount: 3 },
    });
    const row = useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!;
    expect(row.currentCharges).toBe(wand.charges!.max - 3);
  });

  it('emits one use-charge log entry with amount captured', () => {
    const { characterId, itemInstanceId } = setupWandInInventory();
    const logLenBefore = useStore.getState().log.length;
    useStore.getState().dispatch({
      type: 'use-charge',
      payload: { itemInstanceId, characterId, amount: 2 },
    });
    const added = useStore.getState().log.slice(logLenBefore);
    expect(added).toHaveLength(1);
    const entry = added[0]!;
    expect(entry.type).toBe('use-charge');
    if (entry.type !== 'use-charge') throw new Error('narrow');
    expect(entry.payload).toMatchObject({ itemInstanceId, characterId, amount: 2 });
  });

  it('log entry round-trips through the schema', () => {
    const { characterId, itemInstanceId } = setupWandInInventory();
    useStore.getState().dispatch({
      type: 'use-charge',
      payload: { itemInstanceId, characterId },
    });
    const last = useStore.getState().log.at(-1)!;
    expect(() => transactionLogEntrySchema.parse(last)).not.toThrow();
  });

  it("rejects when the row is not in the character's Inventory (Party Stash)", () => {
    const { characterId, partyStashId, wand } = setupWandInInventory();
    // Move the wand out of Inventory into Party Stash.
    const wandRow = useStore.getState().appState!.items.find((i) => i.definitionId === wand.id)!;
    useStore.getState().dispatch({
      type: 'transfer',
      payload: { itemInstanceId: wandRow.id, toStashId: partyStashId, quantity: 1 },
    });
    // The wand is now in Party Stash. Try to use-charge — must reject.
    const movedId = useStore.getState().appState!.items.find((i) => i.definitionId === wand.id)!.id;
    expect(() =>
      useStore
        .getState()
        .dispatch({ type: 'use-charge', payload: { itemInstanceId: movedId, characterId } }),
    ).toThrow(/not in character .* Inventory stash/);
  });

  it("rejects when the row's definition has no charges block (Torch)", () => {
    const base = localBootstrap();
    const torch = base.catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: base.inventoryStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    const torchId = useStore.getState().appState!.items[0]!.id;
    expect(() =>
      useStore.getState().dispatch({
        type: 'use-charge',
        payload: { itemInstanceId: torchId, characterId: base.characterId },
      }),
    ).toThrow(/has no charges defined/);
  });

  it('rejects when currentCharges - amount would go below 0', () => {
    const { characterId, itemInstanceId, wand } = setupWandInInventory();
    expect(() =>
      useStore.getState().dispatch({
        type: 'use-charge',
        payload: { itemInstanceId, characterId, amount: wand.charges!.max + 1 },
      }),
    ).toThrow(/insufficient charges/);
  });

  it('rejects amount <= 0', () => {
    const { characterId, itemInstanceId } = setupWandInInventory();
    expect(() =>
      useStore
        .getState()
        .dispatch({ type: 'use-charge', payload: { itemInstanceId, characterId, amount: 0 } }),
    ).toThrow(/positive integer/);
    expect(() =>
      useStore
        .getState()
        .dispatch({ type: 'use-charge', payload: { itemInstanceId, characterId, amount: -1 } }),
    ).toThrow(/positive integer/);
  });

  it('non-single-use: spending last charge leaves currentCharges 0, row intact', () => {
    const { characterId, itemInstanceId, wand } = setupWandInInventory();
    useStore.getState().dispatch({
      type: 'use-charge',
      payload: { itemInstanceId, characterId, amount: wand.charges!.max },
    });
    const row = useStore.getState().appState!.items.find((i) => i.id === itemInstanceId);
    expect(row).toBeDefined();
    expect(row!.currentCharges).toBe(0);
  });

  it('single-use cascade: spending last charge on stack=1 drops row + emits paired consume entry', () => {
    const { characterId, itemInstanceId } = setupPotionInInventory(1);
    const logLenBefore = useStore.getState().log.length;

    useStore.getState().dispatch({
      type: 'use-charge',
      payload: { itemInstanceId, characterId },
    });

    // Row is gone.
    const row = useStore.getState().appState!.items.find((i) => i.id === itemInstanceId);
    expect(row).toBeUndefined();

    // Two log entries appended in order.
    const added = useStore.getState().log.slice(logLenBefore);
    expect(added.map((e) => e.type)).toEqual(['use-charge', 'consume']);
    const consumeEntry = added[1]!;
    if (consumeEntry.type !== 'consume') throw new Error('narrow');
    expect(consumeEntry.payload.removed).toBe(true);
    expect(consumeEntry.payload.itemInstanceId).toBe(itemInstanceId);
    expect(consumeEntry.payload.quantity).toBe(1);
  });

  it('single-use stack: spending one charge from stack of 5 decrements quantity to 4 + resets currentCharges to max', () => {
    const { characterId, itemInstanceId, potion } = setupPotionInInventory(5);
    const logLenBefore = useStore.getState().log.length;

    useStore.getState().dispatch({
      type: 'use-charge',
      payload: { itemInstanceId, characterId },
    });

    const row = useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!;
    expect(row.quantity).toBe(4);
    expect(row.currentCharges).toBe(potion.charges!.max);

    const added = useStore.getState().log.slice(logLenBefore);
    expect(added.map((e) => e.type)).toEqual(['use-charge', 'consume']);
    const consumeEntry = added[1]!;
    if (consumeEntry.type !== 'consume') throw new Error('narrow');
    expect(consumeEntry.payload.removed).toBe(false);
  });

  it('single-use + non-zero result: no synthetic consume entry', () => {
    // A potion with `max: 1` always decrements to 0, so this test uses a
    // necklace-of-fireballs (`max: 9`, `rechargeRule: 'none'`) and spends
    // a single charge. The row stays put (it's a single-use mechanism
    // that bookkeeps charges WITHIN a single instance — the necklace
    // doesn't drop until all 9 beads are spent).
    const base = localBootstrap();
    const necklace = base.catalog.find((d) => d.id === 'dmg-2024:necklace-of-fireballs');
    if (necklace === undefined) {
      throw new Error('test: necklace not in catalog');
    }
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: base.inventoryStashId,
        definitionId: necklace.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    const itemInstanceId = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === necklace.id)!.id;
    const logLenBefore = useStore.getState().log.length;

    useStore.getState().dispatch({
      type: 'use-charge',
      payload: { itemInstanceId, characterId: base.characterId },
    });

    const row = useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!;
    expect(row.currentCharges).toBe(necklace.charges!.max - 1);
    expect(row.quantity).toBe(1); // intact

    const added = useStore.getState().log.slice(logLenBefore);
    expect(added.map((e) => e.type)).toEqual(['use-charge']); // no consume
  });
});

describe('reducer: recharge (R2.2)', () => {
  function setupWandSpentTo(targetCharges: number): {
    characterId: string;
    itemInstanceId: string;
    wand: ReturnType<typeof bootstrap>['catalog'][number];
  } {
    const base = localBootstrap();
    const wand = base.catalog.find((d) => d.id === 'dmg-2024:wand-of-magic-missiles')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: base.inventoryStashId,
        definitionId: wand.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    const itemInstanceId = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === wand.id)!.id;
    const spend = wand.charges!.max - targetCharges;
    if (spend > 0) {
      useStore.getState().dispatch({
        type: 'use-charge',
        payload: { itemInstanceId, characterId: base.characterId, amount: spend },
      });
    }
    return { characterId: base.characterId, itemInstanceId, wand };
  }

  it('mode=single: recharges to def.max and emits one recharge entry with trigger=manual', () => {
    const { characterId, itemInstanceId, wand } = setupWandSpentTo(2);
    const logLenBefore = useStore.getState().log.length;

    useStore.getState().dispatch({
      type: 'recharge',
      payload: { mode: 'single', itemInstanceId, characterId },
    });

    const row = useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!;
    expect(row.currentCharges).toBe(wand.charges!.max);

    const added = useStore.getState().log.slice(logLenBefore);
    expect(added).toHaveLength(1);
    const rechargeEntry = added[0]!;
    if (rechargeEntry.type !== 'recharge') throw new Error('narrow');
    expect(rechargeEntry.payload).toMatchObject({
      itemInstanceId,
      characterId,
      from: 2,
      to: wand.charges!.max,
      trigger: 'manual',
    });
  });

  it('mode=manual: behaves identically to mode=single', () => {
    const { characterId, itemInstanceId, wand } = setupWandSpentTo(0);

    useStore.getState().dispatch({
      type: 'recharge',
      payload: { mode: 'manual', itemInstanceId, characterId },
    });

    const row = useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!;
    expect(row.currentCharges).toBe(wand.charges!.max);
    const last = useStore.getState().log.at(-1)!;
    if (last.type !== 'recharge') throw new Error('narrow');
    expect(last.payload.trigger).toBe('manual');
  });

  it('mode=single rejects items already at full charges', () => {
    const { characterId, itemInstanceId } = setupWandSpentTo(7); // full
    expect(() =>
      useStore.getState().dispatch({
        type: 'recharge',
        payload: { mode: 'single', itemInstanceId, characterId },
      }),
    ).toThrow(/already at full charges/);
  });

  it('mode=single rejects rows whose definition has no charges block', () => {
    const base = localBootstrap();
    const torch = base.catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: base.inventoryStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    const torchId = useStore.getState().appState!.items[0]!.id;
    expect(() =>
      useStore.getState().dispatch({
        type: 'recharge',
        payload: { mode: 'single', itemInstanceId: torchId, characterId: base.characterId },
      }),
    ).toThrow(/has no charges defined/);
  });

  it('mode=batch dawn: recharges only dawn-rule items; long-rest items untouched', () => {
    const base = localBootstrap();
    const wand = base.catalog.find((d) => d.id === 'dmg-2024:wand-of-magic-missiles')!;
    const pearl = base.catalog.find((d) => d.id === 'dmg-2024:pearl-of-power')!;
    // Acquire both into Inventory.
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: base.inventoryStashId,
        definitionId: wand.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: base.inventoryStashId,
        definitionId: pearl.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    const wandId = useStore.getState().appState!.items.find((i) => i.definitionId === wand.id)!.id;
    const pearlId = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === pearl.id)!.id;
    // Spend a charge on each.
    useStore.getState().dispatch({
      type: 'use-charge',
      payload: { itemInstanceId: wandId, characterId: base.characterId },
    });
    useStore.getState().dispatch({
      type: 'use-charge',
      payload: { itemInstanceId: pearlId, characterId: base.characterId },
    });
    const logLenBefore = useStore.getState().log.length;

    // Trigger dawn batch.
    useStore.getState().dispatch({
      type: 'recharge',
      payload: { mode: 'batch', characterId: base.characterId, trigger: 'dawn' },
    });

    const wandAfter = useStore.getState().appState!.items.find((i) => i.id === wandId)!;
    const pearlAfter = useStore.getState().appState!.items.find((i) => i.id === pearlId)!;
    expect(wandAfter.currentCharges).toBe(wand.charges!.max); // dawn rule → recharged
    expect(pearlAfter.currentCharges).toBe(0); // long-rest rule → untouched

    const added = useStore.getState().log.slice(logLenBefore);
    expect(added).toHaveLength(1); // only the wand
    const dawnEntry = added[0]!;
    if (dawnEntry.type !== 'recharge') throw new Error('narrow');
    expect(dawnEntry.payload.trigger).toBe('dawn');
  });

  it('mode=batch long-rest: recharges only long-rest-rule items', () => {
    const base = localBootstrap();
    const pearl = base.catalog.find((d) => d.id === 'dmg-2024:pearl-of-power')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: base.inventoryStashId,
        definitionId: pearl.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    const pearlId = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === pearl.id)!.id;
    useStore.getState().dispatch({
      type: 'use-charge',
      payload: { itemInstanceId: pearlId, characterId: base.characterId },
    });

    useStore.getState().dispatch({
      type: 'recharge',
      payload: { mode: 'batch', characterId: base.characterId, trigger: 'long-rest' },
    });

    const pearlAfter = useStore.getState().appState!.items.find((i) => i.id === pearlId)!;
    expect(pearlAfter.currentCharges).toBe(pearl.charges!.max);
  });

  it('mode=batch with no eligible items emits zero log entries (no throw)', () => {
    const { characterId } = localBootstrap(); // empty Inventory
    const logLenBefore = useStore.getState().log.length;

    expect(() =>
      useStore.getState().dispatch({
        type: 'recharge',
        payload: { mode: 'batch', characterId, trigger: 'long-rest' },
      }),
    ).not.toThrow();

    expect(useStore.getState().log.length).toBe(logLenBefore);
  });

  it('mode=batch silently skips rows already at full charges (no-op rows)', () => {
    const base = localBootstrap();
    const wand = base.catalog.find((d) => d.id === 'dmg-2024:wand-of-magic-missiles')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: base.inventoryStashId,
        definitionId: wand.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    // Wand acquired = full charges immediately. No spend.
    const logLenBefore = useStore.getState().log.length;

    useStore.getState().dispatch({
      type: 'recharge',
      payload: { mode: 'batch', characterId: base.characterId, trigger: 'dawn' },
    });

    expect(useStore.getState().log.length).toBe(logLenBefore); // zero new entries
  });

  it('mode=batch recharge log entry round-trips through the schema', () => {
    const { characterId, itemInstanceId } = setupWandSpentTo(0);
    useStore.getState().dispatch({
      type: 'recharge',
      payload: { mode: 'batch', characterId, trigger: 'dawn' },
    });
    const last = useStore.getState().log.at(-1)!;
    expect(() => transactionLogEntrySchema.parse(last)).not.toThrow();
    if (last.type !== 'recharge') throw new Error('narrow');
    expect(last.payload.itemInstanceId).toBe(itemInstanceId);
  });

  // -------------------------------------------------------------------- //
  // R2.2.1 — partial recharge by user-rolled amount                       //
  // -------------------------------------------------------------------- //

  it('mode=single with amount: applies partial recharge clamped at max', () => {
    const { characterId, itemInstanceId } = setupWandSpentTo(2);
    useStore.getState().dispatch({
      type: 'recharge',
      payload: { mode: 'single', itemInstanceId, characterId, amount: 3 },
    });
    const row = useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!;
    expect(row.currentCharges).toBe(5); // 2 + 3 = 5
    const last = useStore.getState().log.at(-1)!;
    if (last.type !== 'recharge') throw new Error('narrow');
    expect(last.payload.from).toBe(2);
    expect(last.payload.to).toBe(5);
  });

  it('mode=single with amount: clamps when amount overshoots max', () => {
    const { characterId, itemInstanceId, wand } = setupWandSpentTo(5);
    useStore.getState().dispatch({
      type: 'recharge',
      payload: { mode: 'single', itemInstanceId, characterId, amount: 99 },
    });
    const row = useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!;
    expect(row.currentCharges).toBe(wand.charges!.max); // capped at 7
  });

  it('mode=single with amount: rejects non-positive amount', () => {
    const { characterId, itemInstanceId } = setupWandSpentTo(0);
    expect(() =>
      useStore.getState().dispatch({
        type: 'recharge',
        payload: { mode: 'single', itemInstanceId, characterId, amount: 0 },
      }),
    ).toThrow(/positive integer/);
  });

  it('mode=batch with amounts: applies per-item partial recharge for formula-bearing items', () => {
    const base = localBootstrap();
    const wand = base.catalog.find((d) => d.id === 'dmg-2024:wand-of-magic-missiles')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: base.inventoryStashId,
        definitionId: wand.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    const wandId = useStore.getState().appState!.items.find((i) => i.definitionId === wand.id)!.id;
    // Spend down to 0.
    useStore.getState().dispatch({
      type: 'use-charge',
      payload: { itemInstanceId: wandId, characterId: base.characterId, amount: 7 },
    });

    useStore.getState().dispatch({
      type: 'recharge',
      payload: {
        mode: 'batch',
        characterId: base.characterId,
        trigger: 'dawn',
        amounts: { [wandId]: 4 },
      },
    });

    const row = useStore.getState().appState!.items.find((i) => i.id === wandId)!;
    expect(row.currentCharges).toBe(4); // partial recharge
  });

  it('mode=batch with amounts: rows without formula full-recharge regardless of amounts map', () => {
    const base = localBootstrap();
    // Decanter of Endless Water: rechargeRule dawn, NO rechargeAmount.
    const decanter = base.catalog.find((d) => d.id === 'dmg-2024:decanter-of-endless-water')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: base.inventoryStashId,
        definitionId: decanter.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    const decanterId = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === decanter.id)!.id;
    useStore.getState().dispatch({
      type: 'use-charge',
      payload: {
        itemInstanceId: decanterId,
        characterId: base.characterId,
        amount: decanter.charges!.max,
      },
    });

    useStore.getState().dispatch({
      type: 'recharge',
      payload: {
        mode: 'batch',
        characterId: base.characterId,
        trigger: 'dawn',
        amounts: { [decanterId]: 1 }, // ignored — decanter has no formula
      },
    });

    const row = useStore.getState().appState!.items.find((i) => i.id === decanterId)!;
    expect(row.currentCharges).toBe(decanter.charges!.max); // full recharge
  });
});

describe('reducer: transfer cascade currentCharges clear / init (R2.2 unblock + R2.3 preserve)', () => {
  /**
   * R1.3 left scaffolding for the currentCharges branch in the transfer
   * cascade test suite (`reducer.test.ts:3606`). R2.2 widens currentCharges
   * from `z.null()` to `number | null` and activated both cascade
   * directions. R2.3 amended the design: charges PRESERVE across moves
   * (the R2.2 round-trip-recharge exploit is fixed). The cascade now:
   *   - leave Inventory → currentCharges UNCHANGED (only `equipped` /
   *     `attuned` clear).
   *   - enter Inventory → currentCharges initialised to def.max only if
   *     currently null (preserves non-null values).
   * The OUTLINE §3.4 "only meaningful in Inventory" invariant becomes a
   * UI display rule, not a storage rule.
   */

  it('Inventory → Storage: preserves currentCharges (no longer cleared to null per R2.3)', () => {
    const base = localBootstrap();
    const wand = base.catalog.find((d) => d.id === 'dmg-2024:wand-of-magic-missiles')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: base.inventoryStashId,
        definitionId: wand.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    const wandId = useStore.getState().appState!.items.find((i) => i.definitionId === wand.id)!.id;
    // Verify the entering-Inventory init worked (the row has currentCharges = max).
    expect(useStore.getState().appState!.items.find((i) => i.id === wandId)!.currentCharges).toBe(
      wand.charges!.max,
    );
    // Spend one charge so the post-move value is observably non-default.
    useStore.getState().dispatch({
      type: 'use-charge',
      payload: { itemInstanceId: wandId, characterId: base.characterId },
    });
    expect(useStore.getState().appState!.items.find((i) => i.id === wandId)!.currentCharges).toBe(
      wand.charges!.max - 1,
    );

    // Create a Storage stash.
    useStore.getState().dispatch({
      type: 'create-stash',
      payload: { ownerCharacterId: base.characterId, name: 'Vault' },
    });
    const storageStashId = useStore
      .getState()
      .appState!.stashes.find((st) => st.name === 'Vault')!.id;

    const logLenBefore = useStore.getState().log.length;
    useStore.getState().dispatch({
      type: 'transfer',
      payload: { itemInstanceId: wandId, toStashId: storageStashId, quantity: 1 },
    });

    const moved = useStore.getState().appState!.items.find((i) => i.ownerId === storageStashId);
    expect(moved).toBeDefined();
    // R2.3 — currentCharges preserved across the move.
    expect(moved!.currentCharges).toBe(wand.charges!.max - 1);

    // No paired edit-item-instance entry for currentCharges (nothing
    // changed). Equipped/attuned were already false on the wand so the
    // cascade emits no edit-item-instance at all.
    const added = useStore.getState().log.slice(logLenBefore);
    expect(added.map((e) => e.type)).toEqual(['transfer']);
  });

  it('Storage → Inventory: initialises currentCharges to def.max when source has null (first-entry case)', () => {
    const base = localBootstrap();
    const wand = base.catalog.find((d) => d.id === 'dmg-2024:wand-of-magic-missiles')!;
    // Acquire DIRECTLY into Storage (not Inventory) so currentCharges starts null.
    useStore.getState().dispatch({
      type: 'create-stash',
      payload: { ownerCharacterId: base.characterId, name: 'Vault' },
    });
    const storageStashId = useStore
      .getState()
      .appState!.stashes.find((st) => st.name === 'Vault')!.id;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: storageStashId,
        definitionId: wand.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    const wandId = useStore.getState().appState!.items.find((i) => i.definitionId === wand.id)!.id;
    expect(
      useStore.getState().appState!.items.find((i) => i.id === wandId)!.currentCharges,
    ).toBeNull();

    // Move into Inventory — currentCharges should initialise to def.max
    // (first time the row is meaningfully tracked).
    useStore.getState().dispatch({
      type: 'transfer',
      payload: { itemInstanceId: wandId, toStashId: base.inventoryStashId, quantity: 1 },
    });

    const moved = useStore
      .getState()
      .appState!.items.find((i) => i.ownerId === base.inventoryStashId);
    expect(moved!.currentCharges).toBe(wand.charges!.max);
  });

  it('R2.3 — round-trip Inventory → Storage → Inventory preserves the spent count (no free recharge exploit)', () => {
    const base = localBootstrap();
    const wand = base.catalog.find((d) => d.id === 'dmg-2024:wand-of-magic-missiles')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: base.inventoryStashId,
        definitionId: wand.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    const wandId = useStore.getState().appState!.items.find((i) => i.definitionId === wand.id)!.id;
    // Spend 4 charges → 3/7 left.
    for (let i = 0; i < 4; i++) {
      useStore.getState().dispatch({
        type: 'use-charge',
        payload: { itemInstanceId: wandId, characterId: base.characterId },
      });
    }
    expect(useStore.getState().appState!.items.find((i) => i.id === wandId)!.currentCharges).toBe(
      3,
    );

    // Move to Storage.
    useStore.getState().dispatch({
      type: 'create-stash',
      payload: { ownerCharacterId: base.characterId, name: 'Vault' },
    });
    const storageStashId = useStore
      .getState()
      .appState!.stashes.find((st) => st.name === 'Vault')!.id;
    useStore.getState().dispatch({
      type: 'transfer',
      payload: { itemInstanceId: wandId, toStashId: storageStashId, quantity: 1 },
    });
    expect(useStore.getState().appState!.items.find((i) => i.id === wandId)!.currentCharges).toBe(
      3,
    );

    // Move back to Inventory — charges still 3/7, not refilled.
    useStore.getState().dispatch({
      type: 'transfer',
      payload: { itemInstanceId: wandId, toStashId: base.inventoryStashId, quantity: 1 },
    });
    expect(useStore.getState().appState!.items.find((i) => i.id === wandId)!.currentCharges).toBe(
      3,
    );
  });

  it('non-charged item (Torch) Inventory → Storage: cascade leaves currentCharges null both sides', () => {
    const base = localBootstrap();
    const torch = base.catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: base.inventoryStashId,
        definitionId: torch.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    const torchId = useStore.getState().appState!.items[0]!.id;
    expect(useStore.getState().appState!.items[0]!.currentCharges).toBeNull(); // torch has no charges

    useStore.getState().dispatch({
      type: 'create-stash',
      payload: { ownerCharacterId: base.characterId, name: 'Vault' },
    });
    const storageStashId = useStore
      .getState()
      .appState!.stashes.find((st) => st.name === 'Vault')!.id;

    const logLenBefore = useStore.getState().log.length;
    useStore.getState().dispatch({
      type: 'transfer',
      payload: { itemInstanceId: torchId, toStashId: storageStashId, quantity: 1 },
    });

    // No paired edit-item-instance because nothing changed (no equipped, no attuned, no charges).
    const added = useStore.getState().log.slice(logLenBefore);
    expect(added.map((e) => e.type)).toEqual(['transfer']);
  });
});

describe('reducer: identify (R2.3)', () => {
  /**
   * Bootstrap a character with a magic item in Inventory. Cloak of
   * Protection is the canonical fixture — `requiresAttunement: true`,
   * `rarity: 'uncommon'`, no charges block — so it exercises the
   * identification surface cleanly without dragging in attunement
   * cap / charges init side-effects.
   */
  function setupCloakInInventory(): {
    characterId: string;
    inventoryStashId: string;
    partyStashId: string;
    itemInstanceId: string;
  } {
    const base = localBootstrap();
    const cloak = base.catalog.find((d) => d.id === 'dmg-2024:cloak-of-protection');
    if (cloak === undefined) throw new Error('setupCloakInInventory: cloak not in catalog');
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: base.inventoryStashId,
        definitionId: cloak.id,
        quantity: 1,
        source: 'catalog-add',
      },
    });
    const itemInstanceId = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === cloak.id)!.id;
    return {
      characterId: base.characterId,
      inventoryStashId: base.inventoryStashId,
      partyStashId: base.partyStashId,
      itemInstanceId,
    };
  }

  it('flips identified: true → false and emits a log entry capturing the transition', () => {
    const { itemInstanceId } = setupCloakInInventory();
    const before = useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!;
    expect(before.identified).toBe(true);
    const logLenBefore = useStore.getState().log.length;

    useStore.getState().dispatch({
      type: 'identify',
      payload: { itemInstanceId, identified: false },
    });

    const after = useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!;
    expect(after.identified).toBe(false);

    const added = useStore.getState().log.slice(logLenBefore);
    expect(added).toHaveLength(1);
    const entry = added[0]!;
    expect(entry.type).toBe('identify');
    if (entry.type !== 'identify') throw new Error('expected identify');
    expect(entry.payload.previousIdentified).toBe(true);
    expect(entry.payload.newIdentified).toBe(false);
    expect(entry.payload.previousHint).toBeUndefined();
    expect(entry.payload.newHint).toBeUndefined();
    expect(entry.actorRole).toBe('dm');
  });

  it('flips identified: false → true (re-identify) and logs the reverse transition', () => {
    const { itemInstanceId } = setupCloakInInventory();
    // First mark unidentified with a hint.
    useStore.getState().dispatch({
      type: 'identify',
      payload: { itemInstanceId, identified: false, hint: 'shimmers faintly' },
    });
    const logLenBefore = useStore.getState().log.length;

    useStore.getState().dispatch({
      type: 'identify',
      payload: { itemInstanceId, identified: true, hint: 'shimmers faintly' },
    });

    const after = useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!;
    expect(after.identified).toBe(true);
    // Hint preserved on re-identify per the R2.3 plan (DM panel can reuse it
    // if the item is later flipped unidentified again).
    expect(after.hint).toBe('shimmers faintly');

    const entry = useStore.getState().log.slice(logLenBefore)[0]!;
    expect(entry.type).toBe('identify');
    if (entry.type !== 'identify') throw new Error('expected identify');
    expect(entry.payload.previousIdentified).toBe(false);
    expect(entry.payload.newIdentified).toBe(true);
  });

  it('writes a new hint without changing identified', () => {
    const { itemInstanceId } = setupCloakInInventory();
    useStore.getState().dispatch({
      type: 'identify',
      payload: { itemInstanceId, identified: false },
    });
    const logLenBefore = useStore.getState().log.length;

    useStore.getState().dispatch({
      type: 'identify',
      payload: { itemInstanceId, identified: false, hint: 'radiates evil' },
    });

    const after = useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!;
    expect(after.identified).toBe(false);
    expect(after.hint).toBe('radiates evil');

    const entry = useStore.getState().log.slice(logLenBefore)[0]!;
    if (entry.type !== 'identify') throw new Error('expected identify');
    expect(entry.payload.previousHint).toBeUndefined();
    expect(entry.payload.newHint).toBe('radiates evil');
  });

  it('clears the hint when payload.hint is explicit undefined', () => {
    const { itemInstanceId } = setupCloakInInventory();
    useStore.getState().dispatch({
      type: 'identify',
      payload: { itemInstanceId, identified: false, hint: 'whispers in elvish' },
    });
    const logLenBefore = useStore.getState().log.length;

    useStore.getState().dispatch({
      type: 'identify',
      payload: { itemInstanceId, identified: false, hint: undefined },
    });

    const after = useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!;
    expect(after.identified).toBe(false);
    expect(after.hint).toBeUndefined();

    const entry = useStore.getState().log.slice(logLenBefore)[0]!;
    if (entry.type !== 'identify') throw new Error('expected identify');
    expect(entry.payload.previousHint).toBe('whispers in elvish');
    expect(entry.payload.newHint).toBeUndefined();
  });

  it('succeeds on a non-Inventory row (Party Stash) — identify has no location restriction', () => {
    const { itemInstanceId, inventoryStashId, partyStashId } = setupCloakInInventory();
    // Move the cloak to the Party Stash.
    useStore.getState().dispatch({
      type: 'transfer',
      payload: { itemInstanceId, toStashId: partyStashId, quantity: 1 },
    });
    expect(useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!.ownerId).toBe(
      partyStashId,
    );

    useStore.getState().dispatch({
      type: 'identify',
      payload: { itemInstanceId, identified: false, hint: 'feels heavy' },
    });

    const after = useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!;
    expect(after.identified).toBe(false);
    expect(after.hint).toBe('feels heavy');
    // Sanity: the original Inventory stash no longer holds the cloak.
    expect(
      useStore
        .getState()
        .appState!.items.find((i) => i.ownerId === inventoryStashId && i.id === itemInstanceId),
    ).toBeUndefined();
  });

  it('rejects when itemInstanceId is unknown', () => {
    setupCloakInInventory();
    expect(() =>
      useStore.getState().dispatch({
        type: 'identify',
        payload: { itemInstanceId: 'ghost-id', identified: false },
      }),
    ).toThrow(/unknown itemInstanceId/);
  });

  it('rejects when the definitionId is not in the catalog (defensive)', () => {
    const { itemInstanceId } = setupCloakInInventory();
    // Synthesise an orphan row by editing the store directly.
    useStore.setState((s) => {
      if (s.appState === null) return s;
      return {
        ...s,
        appState: {
          ...s.appState,
          items: s.appState.items.map((i) =>
            i.id === itemInstanceId ? { ...i, definitionId: 'ghost-def' } : i,
          ),
        },
      };
    });
    expect(() =>
      useStore.getState().dispatch({
        type: 'identify',
        payload: { itemInstanceId, identified: false },
      }),
    ).toThrow(/not in catalog/);
  });

  it('rejects exact no-op (same identified, same hint)', () => {
    const { itemInstanceId } = setupCloakInInventory();
    // Row starts identified=true, no hint. Dispatching the same combination
    // is a no-op.
    expect(() =>
      useStore.getState().dispatch({
        type: 'identify',
        payload: { itemInstanceId, identified: true },
      }),
    ).toThrow(/no-op/);
  });

  it('does not throw on no-op when hint key is omitted but identified differs (hint untouched)', () => {
    const { itemInstanceId } = setupCloakInInventory();
    useStore.getState().dispatch({
      type: 'identify',
      payload: { itemInstanceId, identified: false, hint: 'shimmers' },
    });
    const logLenBefore = useStore.getState().log.length;

    // Flip identified back without supplying hint key — hint stays untouched.
    useStore.getState().dispatch({
      type: 'identify',
      payload: { itemInstanceId, identified: true },
    });

    const after = useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!;
    expect(after.identified).toBe(true);
    expect(after.hint).toBe('shimmers');

    const entry = useStore.getState().log.slice(logLenBefore)[0]!;
    if (entry.type !== 'identify') throw new Error('expected identify');
    expect(entry.payload.previousHint).toBe('shimmers');
    expect(entry.payload.newHint).toBe('shimmers');
  });

  it('hint-only change (identified unchanged) is a valid dispatch', () => {
    const { itemInstanceId } = setupCloakInInventory();
    useStore.getState().dispatch({
      type: 'identify',
      payload: { itemInstanceId, identified: false, hint: 'glows blue' },
    });
    const logLenBefore = useStore.getState().log.length;

    // Same identified state, different hint.
    useStore.getState().dispatch({
      type: 'identify',
      payload: { itemInstanceId, identified: false, hint: 'glows red' },
    });

    const after = useStore.getState().appState!.items.find((i) => i.id === itemInstanceId)!;
    expect(after.hint).toBe('glows red');

    const entry = useStore.getState().log.slice(logLenBefore)[0]!;
    if (entry.type !== 'identify') throw new Error('expected identify');
    expect(entry.payload.previousIdentified).toBe(false);
    expect(entry.payload.newIdentified).toBe(false);
    expect(entry.payload.previousHint).toBe('glows blue');
    expect(entry.payload.newHint).toBe('glows red');
  });

  it('routes the log entry through actorRole=dm per OUTLINE §8.1', () => {
    const { itemInstanceId } = setupCloakInInventory();
    const logLenBefore = useStore.getState().log.length;
    useStore.getState().dispatch({
      type: 'identify',
      payload: { itemInstanceId, identified: false },
    });
    const entry = useStore.getState().log.slice(logLenBefore)[0]!;
    expect(entry.actorRole).toBe('dm');
  });
});
