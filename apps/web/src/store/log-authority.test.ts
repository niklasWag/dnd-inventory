import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { server, TEST_SERVER_ORIGIN } from '../test/msw';
import { newUuidV7 } from '@app/shared';

/**
 * RH2.6 — mode-aware log-authority split.
 *
 * In **server mode** the client-side reducer's `logEntries` slice output
 * is discarded at the store boundary. `state.log` grows ONLY via
 * `appendServerLogEntries`, which the queue calls with the server's
 * `applied[]` echo after each successful `POST /sync/actions`.
 *
 * In **local mode** behaviour is unchanged: the client builds full
 * log entries from the reducer's slices and appends to `state.log`.
 *
 * These tests replace the earlier RH2.1b PENDING-timestamp tests
 * (which are void post-RH2.6: no client-emitted log entry exists in
 * server mode, so there's no `timestamp === 'PENDING'` to assert).
 * See `docs/SECURITY.md` §3.1.6 for the contract; BUG-004 for the
 * defect this closes.
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
      appendServerLogEntries: (applied) =>
        storeMod.useStore.getState().appendServerLogEntries(applied),
    });
    // Default MSW handler: echo an empty applied. Tests that want to
    // verify a specific server-emitted entry override this handler.
    server.use(
      http.post(`${TEST_SERVER_ORIGIN}/sync/actions`, () =>
        HttpResponse.json({ applied: [], serverTime: '2026-07-03T00:00:00.000Z' }),
      ),
    );
  }

  return { store: storeMod, queue: queueMod, fixtures: fixturesMod };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('RH2.6 — mode-aware log-authority split', () => {
  it('server mode: dispatch mutates state.appState but does NOT append to state.log', async () => {
    const { store, fixtures } = await loadModules(true);
    const { inventoryStashId } = fixtures.bootstrap();

    // Bootstrap dispatch happened in server mode. Under RH2.6 the
    // client-side reducer's logEntries are discarded — no
    // create-character entry, no seed-catalog entry, empty log.
    expect(
      store.useStore.getState().log,
      'server-mode bootstrap should not have appended any log entries client-side',
    ).toHaveLength(0);

    // But `state.appState` reflects the mutation — optimistic UI still
    // works. The Character row is present regardless of the empty log.
    const appState = store.useStore.getState().appState;
    expect(appState).not.toBeNull();
    expect(appState!.characters).toHaveLength(1);

    // A second dispatch (acquire) also produces no log entry.
    const preLogLen = store.useStore.getState().log.length;
    const preItemsLen = appState!.items.length;
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
    expect(
      store.useStore.getState().log.length - preLogLen,
      'server-mode acquire should not have appended a log entry',
    ).toBe(0);
    expect(store.useStore.getState().appState!.items.length - preItemsLen).toBe(1);
  });

  it('local mode: dispatch appends a full log entry with an ISO timestamp (unchanged)', async () => {
    const { store, fixtures } = await loadModules(false);
    const { inventoryStashId } = fixtures.bootstrap();

    // Local-mode bootstrap emits create-character (+ any fixture-side
    // slices). Every entry has a real ISO timestamp — no PENDING
    // sentinel exists post-RH2.6.
    const bootLog = store.useStore.getState().log;
    const createCharEntry = bootLog.find((e) => e.type === 'create-character');
    expect(createCharEntry).toBeDefined();
    expect(createCharEntry!.timestamp).not.toBe('PENDING');
    expect(Number.isFinite(Date.parse(createCharEntry!.timestamp))).toBe(true);

    const preLogLen = store.useStore.getState().log.length;
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
    expect(log.length - preLogLen, 'local-mode acquire should append exactly one log entry').toBe(
      1,
    );
    const acquireEntry = log.find((e) => e.type === 'acquire');
    expect(acquireEntry).toBeDefined();
    expect(acquireEntry!.timestamp).not.toBe('PENDING');
    expect(Number.isFinite(Date.parse(acquireEntry!.timestamp))).toBe(true);
  });

  it('server mode: post-flush appendServerLogEntries populates state.log from applied[]', async () => {
    const { store, queue, fixtures } = await loadModules(true);
    const canonicalTimestamp = '2026-07-03T12:34:56.789Z';
    const serverLogId = newUuidV7();

    const { inventoryStashId, partyId, userId } = fixtures.bootstrap();
    const acquireItemId = newUuidV7();

    // Drain the bootstrap create-character enqueue with the default
    // (empty applied) handler. state.log stays empty on both sides —
    // the client didn't emit any entries (server-mode dispatch), and
    // the server echoed no applied[] entries either.
    await queue.flush();
    expect(store.useStore.getState().log).toHaveLength(0);

    // Now override MSW to echo a canonical acquire log entry.
    server.use(
      http.post(`${TEST_SERVER_ORIGIN}/sync/actions`, () => {
        return HttpResponse.json({
          applied: [
            {
              id: serverLogId,
              partyId,
              sessionId: null,
              timestamp: canonicalTimestamp,
              actorUserId: userId,
              actorRole: 'player',
              type: 'acquire',
              payload: {
                stashId: inventoryStashId,
                itemInstanceId: acquireItemId,
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
        newItemInstanceId: acquireItemId,
      },
    });

    // Pre-flush: state.appState.items grew (optimistic), but state.log
    // is still empty — server-mode dispatch skips log-append.
    expect(store.useStore.getState().log).toHaveLength(0);
    expect(store.useStore.getState().appState!.items).toHaveLength(1);

    await queue.flush();

    // Post-flush: appendServerLogEntries pushed the server's canonical
    // entry. Server-authoritative id + timestamp + actorRole preserved
    // verbatim — no client-side patching, no id divergence (BUG-004).
    const log = store.useStore.getState().log;
    expect(log).toHaveLength(1);
    const first = log[0]!;
    expect(first.id).toBe(serverLogId);
    expect(first.timestamp).toBe(canonicalTimestamp);
    expect(first.type).toBe('acquire');
    if (first.type === 'acquire') {
      expect(first.payload.itemInstanceId).toBe(acquireItemId);
    }
    queue.resetQueue();
  });
});

/**
 * RH3.1 — sessionId stamping. When a `GameSession` is current in
 * `state.gameSessions`, the middleware stamps its id onto every
 * subsequent log entry's `sessionId`. When no session is current the
 * stamp is `null` ("Untagged" bucket per OUTLINE §3.12).
 *
 * The shared `currentGameSessionId(state)` helper is called by both
 * web `buildLogEntry` and server `buildLogEntryServer` — tested here
 * on the web side; server-side stamping is covered by the server
 * integration test in `apps/server/src/sync/routes.test.ts`.
 *
 * **Middleware reads PRE-reduce state.** Same as `partyId` /
 * `actorRole`. Consequences for the transition markers:
 *   - `start-game-session` lands Untagged (pre-state has no current
 *     session yet). Subsequent entries inherit the new session's id.
 *   - `end-game-session` lands WITH the ending session's id (pre-state
 *     still has isCurrent=true). Subsequent entries land Untagged.
 */
describe('RH3.1 — sessionId stamping', () => {
  it('local mode: entries emitted AFTER start-game-session inherit the new session id', async () => {
    const { store, fixtures } = await loadModules(false);
    const { inventoryStashId } = fixtures.bootstrap();

    const gameSessionId = newUuidV7();
    store.useStore.getState().dispatch({
      type: 'start-game-session',
      payload: { newGameSessionId: gameSessionId },
    });

    // The start-game-session entry itself lands Untagged (the session
    // doesn't yet exist in the pre-reduce state that the middleware
    // reads for sessionId). Payload still carries the gameSessionId
    // for audit; only the derived sessionId field is null.
    const startEntry = store.useStore.getState().log.find((e) => e.type === 'start-game-session');
    expect(startEntry).toBeDefined();
    expect(startEntry!.sessionId).toBeNull();
    if (startEntry !== undefined && startEntry.type === 'start-game-session') {
      expect(startEntry.payload.gameSessionId).toBe(gameSessionId);
    }

    // A subsequent acquire inherits the current session id.
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
    expect(acquireEntry!.sessionId).toBe(gameSessionId);
  });

  it('local mode: entries emitted with no current session have sessionId: null (Untagged)', async () => {
    const { store, fixtures } = await loadModules(false);
    const { inventoryStashId } = fixtures.bootstrap();

    // No start-game-session dispatched — every entry stamps null.
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
    expect(acquireEntry!.sessionId).toBeNull();
  });

  it('local mode: end-game-session carries the ending session id; subsequent entries are Untagged', async () => {
    const { store, fixtures } = await loadModules(false);
    const { inventoryStashId } = fixtures.bootstrap();

    const gameSessionId = newUuidV7();
    store.useStore.getState().dispatch({
      type: 'start-game-session',
      payload: { newGameSessionId: gameSessionId },
    });
    store.useStore.getState().dispatch({ type: 'end-game-session', payload: {} });

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
    const startEntry = log.find((e) => e.type === 'start-game-session');
    const endEntry = log.find((e) => e.type === 'end-game-session');
    const acquireEntry = log.find((e) => e.type === 'acquire');

    // start-game-session lands Untagged (pre-state had no current session).
    expect(startEntry!.sessionId).toBeNull();
    // end-game-session lands WITH the ending id (pre-state still had
    // isCurrent=true).
    expect(endEntry!.sessionId).toBe(gameSessionId);
    // Post-end acquire is Untagged (pre-state had isCurrent=false by
    // then).
    expect(acquireEntry!.sessionId).toBeNull();
  });
});
