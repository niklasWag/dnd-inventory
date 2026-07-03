import { describe, expect, it, beforeEach } from 'vitest';

import { db } from './schema';
import { loadAppState, listKnownPartyIds } from './load';
import { saveAppState, createDebouncedSaver, deleteAppStateForParty } from './save';
import { wipeAll } from './wipe';

beforeEach(async () => {
  await wipeAll();
});

/**
 * RH5.1 / RH5.2 — persistence tests exercise the single-path contract:
 * every persisted AppState lives under `appState:<partyId>`. No legacy
 * unkeyed slot, no null-state persistence. The debounced saver skips
 * writes when the snapshot has no `appState.party.id`.
 */

describe('persistence plumbing', () => {
  it('loadAppState(partyId) returns null when no row exists for that party', async () => {
    expect(await loadAppState('party-nope')).toBeNull();
  });

  it('wipeAll clears every store including meta', async () => {
    await saveAppState({ marker: true }, 'party-a');
    await db.table('users').put({ id: 'u1' });
    await wipeAll();
    expect(await loadAppState('party-a')).toBeNull();
    expect(await db.table('users').count()).toBe(0);
  });

  it('createDebouncedSaver coalesces rapid writes into one persisted state', async () => {
    const saver = createDebouncedSaver(10);
    // Coalesce test uses an AppState-shaped fixture so the party.id
    // extractor picks it up (RH5.1 — snapshots without a party.id are
    // no-op'd, so the previous {n: 1} shape wouldn't exercise the
    // write path).
    saver.save({ appState: { party: { id: 'party-x', name: 'X' } }, log: [{ n: 1 }] });
    saver.save({ appState: { party: { id: 'party-x', name: 'X' } }, log: [{ n: 2 }] });
    saver.save({ appState: { party: { id: 'party-x', name: 'X' } }, log: [{ n: 3 }] });
    await saver.flush();
    expect(await loadAppState('party-x')).toEqual({
      appState: { party: { id: 'party-x', name: 'X' } },
      log: [{ n: 3 }],
    });
  });

  it('createDebouncedSaver flush is a no-op when nothing is pending', async () => {
    const saver = createDebouncedSaver(10);
    await saver.flush();
    expect(await listKnownPartyIds()).toEqual([]);
  });

  it('createDebouncedSaver is a no-op when state.appState is null (RH5.1)', async () => {
    const saver = createDebouncedSaver(5);
    saver.save({ appState: null, log: [] });
    await saver.flush();
    // No keyed blob, no legacy unkeyed blob. The transient null-state
    // window is not persisted by design.
    expect(await listKnownPartyIds()).toEqual([]);
    expect(await db.meta.get('appState')).toBeUndefined();
  });

  it('createDebouncedSaver is a no-op when the snapshot has no party.id (RH5.1)', async () => {
    const saver = createDebouncedSaver(5);
    // Structurally-invalid snapshot (missing party.id) — the extractor
    // returns null so no write happens.
    saver.save({ appState: { characters: [] }, log: [] });
    await saver.flush();
    expect(await listKnownPartyIds()).toEqual([]);
  });
});

describe('persistence plumbing — multi-party (R4 followup)', () => {
  it('saveAppState with partyId writes under a keyed slot', async () => {
    await saveAppState({ marker: 'a' }, 'party-a');
    await saveAppState({ marker: 'b' }, 'party-b');
    expect(await loadAppState('party-a')).toEqual({ marker: 'a' });
    expect(await loadAppState('party-b')).toEqual({ marker: 'b' });
  });

  it('listKnownPartyIds enumerates every keyed slot', async () => {
    await saveAppState({ marker: 'a' }, 'party-a');
    await saveAppState({ marker: 'b' }, 'party-b');
    const ids = await listKnownPartyIds();
    expect(new Set(ids)).toEqual(new Set(['party-a', 'party-b']));
  });

  it('deleteAppStateForParty removes only the targeted keyed slot', async () => {
    await saveAppState({ marker: 'a' }, 'party-a');
    await saveAppState({ marker: 'b' }, 'party-b');
    await deleteAppStateForParty('party-a');
    expect(await loadAppState('party-a')).toBeNull();
    expect(await loadAppState('party-b')).toEqual({ marker: 'b' });
  });

  it('createDebouncedSaver routes through `state.appState.party.id`', async () => {
    const saver = createDebouncedSaver(5);
    saver.save({ appState: { party: { id: 'party-x', name: 'X' } }, log: [] });
    await saver.flush();
    expect(await loadAppState('party-x')).toEqual({
      appState: { party: { id: 'party-x', name: 'X' } },
      log: [],
    });
  });

  it('switching the saved state between partyIds keeps both blobs', async () => {
    const saver = createDebouncedSaver(5);
    saver.save({ appState: { party: { id: 'party-a', name: 'A' } }, log: [] });
    await saver.flush();
    saver.save({ appState: { party: { id: 'party-b', name: 'B' } }, log: [] });
    await saver.flush();
    expect(await loadAppState('party-a')).toEqual({
      appState: { party: { id: 'party-a', name: 'A' } },
      log: [],
    });
    expect(await loadAppState('party-b')).toEqual({
      appState: { party: { id: 'party-b', name: 'B' } },
      log: [],
    });
  });
});
