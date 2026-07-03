import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { server, TEST_SERVER_ORIGIN } from '../test/msw';
import type * as QueueModule from './queue';
import type { QueueDeps } from './queue';

/**
 * RH2.3 — same-origin multi-tab coordination via `navigator.locks`.
 *
 * The queue is module-level state, so two tabs on the same origin each
 * hold their own `queue`, `timer`, and `inflight` bindings. Without the
 * Web-Locks wrapper installed in `flush()`, both tabs would happily
 * fire `POST /sync/actions` in parallel — the server sees interleaved
 * batches, Dexie diverges, and BUG-003-shaped rollback is impossible.
 *
 * Two `loadQueue()` calls in the same test process (each preceded by
 * `vi.resetModules()`) give us two distinct queue module instances.
 * Both are wired to the same origin, so `navigator.locks` (the FIFO
 * shim installed in `apps/web/src/test/setup.ts`) serialises them
 * across the shared 'sync-queue-flush' key.
 *
 * The property we assert: when both instances flush concurrently, the
 * two `POST /sync/actions` requests are NON-OVERLAPPING. We enforce
 * this by making each handler take ~100ms and recording start/end
 * timestamps in call order; overlapping means `starts[1] < ends[0]`.
 */

async function loadQueue(): Promise<typeof QueueModule> {
  vi.stubEnv('VITE_SERVER_URL', TEST_SERVER_ORIGIN);
  vi.resetModules();
  return import('./queue.js');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

interface FakeSnapshot {
  appState: { party: { id: string } } | null;
  log: unknown[];
}

function fakeDeps(partyId: string): {
  deps: QueueDeps;
} {
  const snap: FakeSnapshot = { appState: { party: { id: partyId } }, log: [] };
  return {
    deps: {
      getSnapshot: () => snap as unknown as ReturnType<QueueDeps['getSnapshot']>,
      restoreSnapshot: () => {
        // The multi-tab test never triggers a rollback path.
      },
    },
  };
}

describe('queue — RH2.3 multi-tab lock coordination', () => {
  it('serialises concurrent flushes across two same-origin queue instances', async () => {
    // Track the wall-clock ordering of the two `POST /sync/actions`
    // handlers. Each handler sleeps ~100ms so an unlocked race would
    // produce overlapping [start, end) intervals; a properly-locked
    // pair produces strictly-sequential intervals.
    const intervals: Array<{ start: number; end: number }> = [];
    server.use(
      http.post(`${TEST_SERVER_ORIGIN}/sync/actions`, async () => {
        const start = Date.now();
        await new Promise((r) => setTimeout(r, 100));
        const end = Date.now();
        intervals.push({ start, end });
        return HttpResponse.json({ applied: [], serverTime: '2026-07-03T00:00:00.000Z' });
      }),
    );

    // Instance A — first tab.
    const queueA = await loadQueue();
    queueA.configureQueue(fakeDeps('party-1').deps);
    queueA.enqueue(
      { type: 'acquire' } as unknown as Parameters<typeof queueA.enqueue>[0],
      'party-1',
    );

    // Instance B — second tab. `vi.resetModules()` in `loadQueue()`
    // gives us a fresh module-scope, so `queueB` is a distinct queue
    // with its own `inflight` pointer.
    const queueB = await loadQueue();
    queueB.configureQueue(fakeDeps('party-1').deps);
    queueB.enqueue(
      { type: 'acquire' } as unknown as Parameters<typeof queueB.enqueue>[0],
      'party-1',
    );

    // Race both flushes.
    await Promise.all([queueA.flush(), queueB.flush()]);

    // Both requests fired.
    expect(intervals).toHaveLength(2);

    // Ordering property: the second handler must start AT OR AFTER
    // the first handler ends. Web Locks / the FIFO shim guarantees
    // this. An unlocked race would show `intervals[1].start` close to
    // `intervals[0].start`, well before `intervals[0].end`.
    const [first, second] = intervals as [
      { start: number; end: number },
      { start: number; end: number },
    ];
    expect(second.start).toBeGreaterThanOrEqual(first.end);

    queueA.resetQueue();
    queueB.resetQueue();
  });
});
