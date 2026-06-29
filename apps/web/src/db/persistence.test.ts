import { describe, expect, it, beforeEach } from 'vitest';

import { db } from './schema';
import { loadAppState, listKnownPartyIds } from './load';
import { saveAppState, createDebouncedSaver, deleteAppStateForParty } from './save';
import { wipeAll } from './wipe';

beforeEach(async () => {
  await wipeAll();
});

describe('persistence plumbing', () => {
  it('loadAppState returns null when nothing is stored', async () => {
    expect(await loadAppState()).toBeNull();
  });

  it('saveAppState then loadAppState round-trips an opaque blob', async () => {
    const blob = { version: 1 as const, hello: 'world', n: 42 };
    await saveAppState(blob);
    expect(await loadAppState()).toEqual(blob);
  });

  it('wipeAll clears every store including meta', async () => {
    await saveAppState({ version: 1, marker: true });
    await db.table('users').put({ id: 'u1' });
    await wipeAll();
    expect(await loadAppState()).toBeNull();
    expect(await db.table('users').count()).toBe(0);
  });

  it('createDebouncedSaver coalesces rapid writes into one persisted state', async () => {
    const saver = createDebouncedSaver(10);
    saver.save({ n: 1 });
    saver.save({ n: 2 });
    saver.save({ n: 3 });
    await saver.flush();
    expect(await loadAppState()).toEqual({ n: 3 });
  });

  it('createDebouncedSaver flush is a no-op when nothing is pending', async () => {
    const saver = createDebouncedSaver(10);
    await saver.flush();
    expect(await loadAppState()).toBeNull();
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

  it('listKnownPartyIds returns empty when only the legacy unkeyed slot is set', async () => {
    await saveAppState({ legacy: true });
    expect(await listKnownPartyIds()).toEqual([]);
  });

  it('deleteAppStateForParty removes only the targeted keyed slot', async () => {
    await saveAppState({ marker: 'a' }, 'party-a');
    await saveAppState({ marker: 'b' }, 'party-b');
    await deleteAppStateForParty('party-a');
    expect(await loadAppState('party-a')).toBeNull();
    expect(await loadAppState('party-b')).toEqual({ marker: 'b' });
  });

  it('createDebouncedSaver routes through `state.appState.party.id` when present', async () => {
    const saver = createDebouncedSaver(5);
    saver.save({ appState: { party: { id: 'party-x', name: 'X' } }, log: [] });
    await saver.flush();
    expect(await loadAppState('party-x')).toEqual({
      appState: { party: { id: 'party-x', name: 'X' } },
      log: [],
    });
  });

  it('createDebouncedSaver falls back to the unkeyed slot when state is null', async () => {
    const saver = createDebouncedSaver(5);
    saver.save({ appState: null, log: [] });
    await saver.flush();
    expect(await loadAppState()).toEqual({ appState: null, log: [] });
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
