/**
 * R5.1.c — reconnect drain tests.
 *
 * Covers the two-phase drain: fetch missed log entries, then drain the
 * outbox. Uses the real Zustand store + fake-indexeddb outbox, mocks
 * only the network via MSW.
 *
 * Test setup:
 *   - `loadReconnect()` resets modules + stubs env + mocks backoff.
 *   - After the reset, we re-import `@/store` + `@/test/fixtures`
 *     within the test so both share the FRESH module graph. Bootstrap
 *     dispatches into the newly-imported store; reconnect reads it.
 */
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { newUuidV7 } from '@app/shared';

import { db } from '@/db/schema';
import { wipeAll } from '@/db/wipe';
import { server, TEST_SERVER_ORIGIN } from '@/test/msw';

import type * as ReconnectModule from './reconnect';
import type * as QueueModule from './queue';
import type * as OutboxModule from './outbox';
import type * as StoreModule from '@/store';
import type * as FixturesModule from '@/test/fixtures';
import type * as BackoffModule from '@/lib/backoff';

async function loadReconnect(): Promise<{
  reconnect: typeof ReconnectModule;
  store: typeof StoreModule;
  fixtures: typeof FixturesModule;
  outbox: typeof OutboxModule;
  queue: typeof QueueModule;
}> {
  vi.stubEnv('VITE_SERVER_URL', TEST_SERVER_ORIGIN);
  vi.resetModules();
  vi.doMock('@/lib/backoff', async () => {
    const actual = await vi.importActual<typeof BackoffModule>('@/lib/backoff');
    return { ...actual, computeBackoff: () => 1 };
  });
  const [reconnect, store, fixtures, outbox, queue] = await Promise.all([
    import('./reconnect.js'),
    import('@/store'),
    import('@/test/fixtures'),
    import('@/sync/outbox.js'),
    import('./queue.js'),
  ]);
  queue.configureQueue({
    getSnapshot: () => {
      const s = store.useStore.getState();
      return { appState: s.appState, log: s.log };
    },
    restoreSnapshot: (snap) => {
      store.useStore.getState().restoreSnapshot(snap);
    },
    appendServerLogEntries: (applied) => {
      store.useStore.getState().appendServerLogEntries(applied);
    },
  });
  return { reconnect, store, fixtures, outbox, queue };
}

beforeEach(async () => {
  await wipeAll();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('R5.1.c — drainOutbox', () => {
  it('is a no-op when the store has no active party (Hub view / logged-out)', async () => {
    const { reconnect } = await loadReconnect();
    // Fresh store from the reset — appState is null. No network call
    // should fire (MSW's `onUnhandledRequest: 'error'` would fail).
    await expect(reconnect.drainOutbox()).resolves.toBeUndefined();
  });

  it('fetches missed state via GET /sync/state and hydrates the store', async () => {
    const { reconnect, store, fixtures } = await loadReconnect();
    const base = fixtures.bootstrap();
    // Simulate a change made on the server while we were offline: a
    // torch appeared in inventory. The server returns the new full
    // state via `pullState`.
    const stashInInventory = base.inventoryStashId;
    const torch = base.catalog.find((d) => d.id === 'phb-2024:torch');
    if (torch === undefined) return;
    const newItemInstanceId = newUuidV7();

    // Build the mutated state: same as bootstrap + one torch row.
    const mutated = {
      ...store.useStore.getState().appState!,
      items: [
        {
          id: newItemInstanceId,
          ownerType: 'stash' as const,
          ownerId: stashInInventory,
          containerInstanceId: null,
          definitionId: torch.id,
          quantity: 5,
          equipped: false,
          attuned: false,
          identified: true,
          currentCharges: null,
        },
      ],
    };

    let stateCallCount = 0;
    server.use(
      http.get(`${TEST_SERVER_ORIGIN}/sync/state`, () => {
        stateCallCount++;
        return HttpResponse.json({
          state: mutated,
          serverTime: '2026-07-03T12:34:57.000Z',
        });
      }),
    );

    await reconnect.drainOutbox();

    expect(stateCallCount).toBe(1);
    const after = store.useStore.getState();
    const items = after.appState!.items.filter((i) => i.ownerId === stashInInventory);
    expect(items.some((i) => i.id === newItemInstanceId && i.quantity === 5)).toBe(true);
  });

  it('drains outbox rows via POST /sync/actions, removing them on 200', async () => {
    const { reconnect, fixtures, outbox, store } = await loadReconnect();
    const base = fixtures.bootstrap();

    await outbox.enqueueToOutbox(base.partyId, [
      {
        type: 'acquire',
        payload: {
          stashId: base.inventoryStashId,
          definitionId: 'phb-2024:torch',
          quantity: 1,
          source: 'catalog-add',
          newItemInstanceId: newUuidV7(),
        },
      } as unknown as Parameters<typeof outbox.enqueueToOutbox>[1][number],
    ]);
    expect(await db.outbox.count()).toBe(1);

    let actionsCallCount = 0;
    server.use(
      http.get(`${TEST_SERVER_ORIGIN}/sync/state`, () =>
        HttpResponse.json({
          state: store.useStore.getState().appState!,
          serverTime: '2026-07-03T12:34:57.000Z',
        }),
      ),
      http.post(`${TEST_SERVER_ORIGIN}/sync/actions`, () => {
        actionsCallCount++;
        return HttpResponse.json({ applied: [], serverTime: '2026-07-03T12:34:58.000Z' });
      }),
    );

    await reconnect.drainOutbox();

    expect(actionsCallCount).toBe(1);
    expect(await db.outbox.count()).toBe(0);
  });

  it('leaves outbox rows in place when the network is still down', async () => {
    const { reconnect, fixtures, outbox, queue, store } = await loadReconnect();
    const base = fixtures.bootstrap();

    await outbox.enqueueToOutbox(base.partyId, [
      {
        type: 'acquire',
        payload: {
          stashId: base.inventoryStashId,
          definitionId: 'phb-2024:torch',
          quantity: 1,
          source: 'catalog-add',
          newItemInstanceId: newUuidV7(),
        },
      } as unknown as Parameters<typeof outbox.enqueueToOutbox>[1][number],
    ]);

    server.use(
      http.get(`${TEST_SERVER_ORIGIN}/sync/state`, () =>
        HttpResponse.json({
          state: store.useStore.getState().appState!,
          serverTime: '2026-07-03T12:34:57.000Z',
        }),
      ),
      http.post(`${TEST_SERVER_ORIGIN}/sync/actions`, () => HttpResponse.error()),
    );

    await reconnect.drainOutbox();

    expect(await db.outbox.count()).toBe(1);
    queue.resetQueue();
  });
});
