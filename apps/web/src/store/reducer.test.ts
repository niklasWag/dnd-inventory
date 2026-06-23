import { describe, expect, it, beforeEach } from 'vitest';

import { useStore, flushPendingPersist } from './index';
import { loadAppState } from '@/db/load';
import { wipeAll } from '@/db/wipe';
import {
  appStateSchema,
  transactionLogEntrySchema,
} from '@app/shared';
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
      payload: { stashId: inventoryStashId, definitionId: torch.id, quantity: 2, source: 'catalog-add' },
    });
    dispatch({
      type: 'acquire',
      payload: { stashId: inventoryStashId, definitionId: torch.id, quantity: 3, source: 'catalog-add' },
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
function bootstrapWithItem(
  initial: { customName?: string; notes?: string } = {},
): { itemInstanceId: string; inventoryStashId: string; torchDefId: string } {
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
      payload: { stashId: storageStashId, definitionId: torch.id, quantity: 1, source: 'catalog-add' },
    });
    dispatch({
      type: 'acquire',
      payload: { stashId: storageStashId, definitionId: rope.id, quantity: 1, source: 'catalog-add' },
    });
    const torchId = useStore.getState().appState!.items.find((i) => i.definitionId === torch.id)!.id;
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
      payload: { stashId: storageStashId, definitionId: torch.id, quantity: 1, source: 'catalog-add' },
    });
    dispatch({
      type: 'acquire',
      payload: { stashId: storageStashId, definitionId: rope.id, quantity: 1, source: 'catalog-add' },
    });
    const torchId = useStore.getState().appState!.items.find((i) => i.definitionId === torch.id)!.id;
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
      payload: { stashId: storageStashId, definitionId: torch.id, quantity: 5, source: 'catalog-add' },
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
      payload: { stashId: recoveredLootStashId, definitionId: torch.id, quantity: 1, source: 'catalog-add' },
    });
    // Now a Torch in the Storage stash (will be transferred on delete).
    dispatch({
      type: 'acquire',
      payload: { stashId: storageStashId, definitionId: torch.id, quantity: 1, source: 'catalog-add' },
    });

    dispatch({ type: 'delete-stash', payload: { stashId: storageStashId } });

    const torchesInRecovered = useStore
      .getState()
      .appState!.items.filter((i) => i.ownerId === recoveredLootStashId && i.definitionId === torch.id);
    expect(torchesInRecovered).toHaveLength(2);
  });

  it('rejects deletion of Inventory', () => {
    const { inventoryStashId } = bootstrapWithStorage();
    expect(() =>
      useStore.getState().dispatch({ type: 'delete-stash', payload: { stashId: inventoryStashId } }),
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
      useStore.getState().dispatch({ type: 'delete-stash', payload: { stashId: recoveredLootStashId } }),
    ).toThrow(/cannot delete Recovered Loot/);
  });

  it('rejects unknown stashId', () => {
    localBootstrap();
    expect(() =>
      useStore.getState().dispatch({ type: 'delete-stash', payload: { stashId: 'does-not-exist' } }),
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
            c.stashId === storageStashId
              ? { ...c, gp: 5, sp: 3, cp: 7 }
              : c,
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
      payload: { stashId: storageStashId, definitionId: torch.id, quantity: 3, source: 'catalog-add' },
    });
    useStore.getState().dispatch({ type: 'delete-stash', payload: { stashId: storageStashId } });
    expect(() => appStateSchema.parse(useStore.getState().appState)).not.toThrow();
  });

  it('all entries in a cascade share actorUserId / actorRole / partyId', () => {
    const { storageStashId, catalog } = bootstrapWithStorage();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: { stashId: storageStashId, definitionId: torch.id, quantity: 1, source: 'catalog-add' },
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
    const holding = useStore.getState().appState!.currencies.find(
      (c) => c.stashId === inventoryStashId,
    )!;
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
    const holding = useStore.getState().appState!.currencies.find(
      (c) => c.stashId === inventoryStashId,
    )!;
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
    const holding = useStore.getState().appState!.currencies.find(
      (c) => c.stashId === inventoryStashId,
    )!;
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
    const holding = useStore.getState().appState!.currencies.find(
      (c) => c.stashId === storageStashId,
    )!;
    expect(holding.gp).toBe(25);
  });
});

