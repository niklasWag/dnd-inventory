import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';

import { server } from './msw';

/**
 * R3.5 — MSW + env-stubbing rig for the web vitest suite.
 *
 * Defaults to LOCAL MODE so existing screen tests (CharacterSheet, Settings,
 * CatalogBrowser, …) keep their current contract: no auth chrome, no
 * outbound network calls. Individual tests that need server mode call
 * `vi.stubEnv('VITE_SERVER_URL', TEST_SERVER_ORIGIN)` + `vi.resetModules()`
 * inside `beforeEach` and dynamically import the module under test.
 *
 * MSW runs with `onUnhandledRequest: 'error'`: if a server-mode test
 * forgets to stub the endpoint it calls, the test fails loudly rather
 * than going out to the real network.
 */

// Pin local mode for the whole suite. Per-test overrides flip it.
vi.stubEnv('VITE_SERVER_URL', '');

/**
 * RH2.3 — test-only Web Locks shim.
 *
 * jsdom 29.x doesn't ship `navigator.locks`, but the production sync
 * queue relies on `navigator.locks.request('sync-queue-flush', ...)`
 * to serialise multi-tab flushes (`apps/web/src/sync/queue.ts`). This
 * shim installs an in-process FIFO queue per lock name that mimics
 * the Web Locks contract closely enough for the queue's usage:
 *
 *   - Requests to the same lock name are serialised in call order.
 *   - The callback runs exclusively; the returned promise resolves
 *     with the callback's value.
 *   - Errors propagate; the next waiter still runs after unwind.
 *
 * Once jsdom lands native LockManager support (or the suite migrates
 * to happy-dom / a real browser via Playwright at M5+), this shim is
 * safe to delete.
 */
if (!('locks' in navigator)) {
  const pending = new Map<string, Promise<void>>();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      async request<T>(name: string, cb: () => Promise<T> | T): Promise<T> {
        const prev = pending.get(name) ?? Promise.resolve();
        let release!: () => void;
        const gate = new Promise<void>((r) => {
          release = r;
        });
        pending.set(
          name,
          prev.then(() => gate),
        );
        await prev;
        try {
          return await cb();
        } finally {
          release();
          if (pending.get(name) === gate) pending.delete(name);
        }
      },
    },
  });
}

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
