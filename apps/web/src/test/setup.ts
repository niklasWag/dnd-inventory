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

/**
 * R6.5 — test-only jsdom shims for Radix UI's pointer-capture usage.
 *
 * Radix `Select` (and other floating primitives) calls
 * `Element#hasPointerCapture` / `#setPointerCapture` / `#releasePointerCapture`
 * on pointer-down events. jsdom 29.x doesn't ship these on the
 * `Element` prototype, so any userEvent.click on a `SelectTrigger`
 * throws `TypeError: target.hasPointerCapture is not a function`.
 *
 * Additionally, Radix uses `Element#scrollIntoView` inside its option
 * navigation which is also missing from jsdom.
 *
 * These are safe no-op shims: production browsers implement them
 * natively; here we just satisfy Radix's feature check.
 */
if (typeof Element !== 'undefined') {
  const proto = Element.prototype as unknown as {
    hasPointerCapture?: (id: number) => boolean;
    setPointerCapture?: (id: number) => void;
    releasePointerCapture?: (id: number) => void;
    scrollIntoView?: (arg?: boolean | ScrollIntoViewOptions) => void;
  };
  if (typeof proto.hasPointerCapture !== 'function') {
    proto.hasPointerCapture = () => false;
  }
  if (typeof proto.setPointerCapture !== 'function') {
    proto.setPointerCapture = () => undefined;
  }
  if (typeof proto.releasePointerCapture !== 'function') {
    proto.releasePointerCapture = () => undefined;
  }
  if (typeof proto.scrollIntoView !== 'function') {
    proto.scrollIntoView = () => undefined;
  }
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
