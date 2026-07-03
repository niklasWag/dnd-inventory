import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hydrateFromDexie } from './hydrate';
import { useStore } from './index';
import { db } from '@/db/schema';
import { setCurrentPartyId } from '@/db/meta';
import { saveAppState } from '@/db/save';
import { wipeAll } from '@/db/wipe';
import { bootstrap } from '@/test/fixtures';

/**
 * RH5.2 — boot hydration is single-path. These tests assert the four
 * observable outcomes of `hydrateFromDexie`:
 *
 *   1. No `currentPartyId` pointer → store stays empty.
 *   2. Stale pointer (blob deleted) → store stays empty.
 *   3. Valid blob → store is hydrated.
 *   4. Corrupted blob → store stays empty + toast surfaces.
 *
 * Absent by design: no test exercises the pre-RH5.2 legacy-slot or
 * first-keyed-blob fallbacks — those tiers were retired.
 */

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// Import the mocked toast to inspect calls.
import { toast } from 'sonner';

beforeEach(async () => {
  await wipeAll();
  useStore.setState({ appState: null, log: [] });
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
});

afterEach(() => {
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
});

describe('hydrateFromDexie — RH5.2', () => {
  it('no `currentPartyId` pointer → store stays empty', async () => {
    // Empty Dexie, no pointer. Fresh boot on a brand-new device.
    await hydrateFromDexie();
    expect(useStore.getState().appState).toBeNull();
    expect(useStore.getState().log).toEqual([]);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('stale pointer (party blob deleted) → store stays empty', async () => {
    // Pointer set but the corresponding blob was wiped from Dexie
    // (e.g. user cleared a specific party via deleteAppStateForParty).
    await setCurrentPartyId('party-ghost');
    await hydrateFromDexie();
    expect(useStore.getState().appState).toBeNull();
    // Pointer-stale is NOT corruption — no user-visible toast.
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('valid blob → store is hydrated', async () => {
    // Seed a valid party into Dexie via the reducer/fixtures, then
    // wipe the in-memory store to simulate a cold boot.
    bootstrap();
    const partyId = useStore.getState().appState!.party.id;
    const snapshot = {
      appState: useStore.getState().appState,
      log: useStore.getState().log,
    };
    await saveAppState(snapshot, partyId);
    await setCurrentPartyId(partyId);
    useStore.setState({ appState: null, log: [] });

    await hydrateFromDexie();

    expect(useStore.getState().appState).not.toBeNull();
    expect(useStore.getState().appState!.party.id).toBe(partyId);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('corrupted blob → store stays empty + toast surfaces', async () => {
    // Write a shape-invalid blob directly. Post-RH0.1's .strict()
    // schema this fails Zod parse.
    await setCurrentPartyId('party-broken');
    await db.meta.put({
      key: 'appState:party-broken',
      value: { appState: 42, log: 'nope' }, // schema-incompatible
    });

    await hydrateFromDexie();

    expect(useStore.getState().appState).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(
      'Local data for this party is corrupted. Open Settings to wipe.',
    );
  });
});
