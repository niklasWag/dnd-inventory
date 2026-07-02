import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { server, TEST_SERVER_ORIGIN } from '../test/msw';
import { newUuidV7 } from '@app/shared';

/**
 * RH2.1b — server-authoritative log-entry timestamp.
 *
 * In server mode, `buildLogEntry` composes local log entries with
 * `timestamp: 'PENDING'`. The queue's post-flush hook consumes the
 * server's `applied[]` echo and patches the local entries' timestamps
 * to the server-canonical ISO string.
 *
 * Local mode is unchanged — `buildLogEntry` stamps
 * `new Date().toISOString()` and no post-flush patching happens.
 */

async function loadModules(serverMode: boolean) {
  vi.stubEnv('VITE_SERVER_URL', serverMode ? TEST_SERVER_ORIGIN : '');
  vi.resetModules();
  const [storeMod, queueMod, wipeMod, fixturesMod] = await Promise.all([
    import('./index'),
    import('@/sync/queue'),
    import('@/db/wipe'),
    import('@/test/fixtures'),
  ]);
  await wipeMod.wipeAll();
  storeMod.useStore.setState({ appState: null, log: [] });
  queueMod.resetQueue();

  // In server mode, wire a permissive queue with real store-backed deps
  // so bootstrap's dispatch (which enqueues create-character) doesn't
  // throw. Individual tests replace the MSW handler to control what
  // `applied[]` looks like.
  if (serverMode) {
    queueMod.configureQueue({
      getSnapshot: () => {
        const s = storeMod.useStore.getState();
        return { appState: s.appState, log: s.log };
      },
      restoreSnapshot: (snap) => storeMod.useStore.getState().restoreSnapshot(snap),
      getActivePartyId: () =>
        Promise.resolve(storeMod.useStore.getState().appState?.party.id ?? null),
      patchLogEntries: (applied) => storeMod.useStore.getState().patchLogEntries(applied),
    });
    // Default MSW handler: echo an empty applied. Tests that want to
    // patch specific timestamps override this handler.
    server.use(
      http.post(`${TEST_SERVER_ORIGIN}/sync/actions`, () =>
        HttpResponse.json({ applied: [], serverTime: '2026-07-02T00:00:00.000Z' }),
      ),
    );
  }

  return { store: storeMod, queue: queueMod, fixtures: fixturesMod };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('RH2.1b — server-authoritative log timestamp', () => {
  it('server mode: dispatch emits timestamp === "PENDING" on the local log entry', async () => {
    const { store, fixtures } = await loadModules(true);
    const { inventoryStashId } = fixtures.bootstrap();

    // Bootstrap emitted a create-character entry (plus a seed-catalog
    // entry from the fixture). Under RH2.1b (server mode) every
    // client-emitted timestamp is 'PENDING' until the flush echoes back
    // a real one.
    const bootLog = store.useStore.getState().log;
    const createCharEntry = bootLog.find((e) => e.type === 'create-character');
    expect(createCharEntry).toBeDefined();
    expect(createCharEntry!.timestamp).toBe('PENDING');

    // Reset the log for a clean acquire assertion.
    store.useStore.setState({
      appState: store.useStore.getState().appState,
      log: [],
    });

    store.useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: 'phb-2024:torch',
        quantity: 1,
        source: 'catalog-add',
        newItemInstanceId: newUuidV7(),
      },
    });

    const log = store.useStore.getState().log;
    expect(log).toHaveLength(1);
    expect(log[0]!.type).toBe('acquire');
    expect(log[0]!.timestamp).toBe('PENDING');
  });

  it('local mode: dispatch emits an ISO datetime timestamp (unchanged)', async () => {
    const { store, fixtures } = await loadModules(false);
    const { inventoryStashId } = fixtures.bootstrap();

    // In local mode, bootstrap's create-character entry has a real
    // ISO timestamp — no post-flush patching happens because there's
    // no server to flush against.
    const bootLog = store.useStore.getState().log;
    expect(bootLog[0]!.type).toBe('create-character');
    expect(bootLog[0]!.timestamp).not.toBe('PENDING');
    expect(Number.isFinite(Date.parse(bootLog[0]!.timestamp))).toBe(true);

    store.useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: 'phb-2024:torch',
        quantity: 1,
        source: 'catalog-add',
        newItemInstanceId: newUuidV7(),
      },
    });

    const acquireEntry = store.useStore.getState().log.find((e) => e.type === 'acquire');
    expect(acquireEntry).toBeDefined();
    expect(acquireEntry!.timestamp).not.toBe('PENDING');
    expect(Number.isFinite(Date.parse(acquireEntry!.timestamp))).toBe(true);
  });

  it('server mode: after flush success, queue patches the local timestamp from applied[]', async () => {
    const { store, queue, fixtures } = await loadModules(true);
    const canonicalTimestamp = '2026-07-02T12:34:56.789Z';

    const { inventoryStashId, partyId, userId } = fixtures.bootstrap();
    const acquireId = newUuidV7();

    // Drain the bootstrap create-character enqueue with a default echo.
    // The default handler set up in loadModules(true) already returns
    // applied: [], so this flush is a no-op patch (nothing to match).
    await queue.flush();

    // Reset the log so we measure only the acquire round-trip.
    store.useStore.setState({
      appState: store.useStore.getState().appState,
      log: [],
    });

    // Now override MSW to echo a canonical timestamp for the acquire.
    server.use(
      http.post(`${TEST_SERVER_ORIGIN}/sync/actions`, () => {
        return HttpResponse.json({
          applied: [
            {
              id: newUuidV7(),
              partyId,
              sessionId: null,
              timestamp: canonicalTimestamp,
              actorUserId: userId,
              actorRole: 'player',
              type: 'acquire',
              payload: {
                stashId: inventoryStashId,
                itemInstanceId: acquireId,
                definitionId: 'phb-2024:torch',
                quantity: 1,
                source: 'catalog-add',
              },
            },
          ],
          serverTime: canonicalTimestamp,
        });
      }),
    );

    store.useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: 'phb-2024:torch',
        quantity: 1,
        source: 'catalog-add',
        newItemInstanceId: acquireId,
      },
    });

    // Pre-flush: PENDING.
    expect(store.useStore.getState().log[0]!.timestamp).toBe('PENDING');

    await queue.flush();

    // Post-flush: patched to server's canonical value.
    const patched = store.useStore.getState().log.find((e) => e.type === 'acquire');
    expect(patched).toBeDefined();
    expect(patched!.timestamp).toBe(canonicalTimestamp);
    queue.resetQueue();
  });
});
