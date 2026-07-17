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

/**
 * R10.1 — test-only `document.elementFromPoint` shim.
 *
 * jsdom 29.x doesn't ship `document.elementFromPoint`. `input-otp` calls it
 * from a deferred `setTimeout` to sync caret/selection state; the timer
 * fires after the test body, so a missing implementation surfaces as an
 * *unhandled* `TypeError` that fails the run even when assertions pass.
 * A `null`-returning stub matches the spec's "no element at point" contract.
 */
if (typeof document !== 'undefined' && typeof document.elementFromPoint !== 'function') {
  document.elementFromPoint = () => null;
}

/**
 * R7.1.a — test-only `matchMedia` shim.
 *
 * jsdom 29.x doesn't ship `window.matchMedia`. The theme store
 * (`apps/web/src/store/theme.ts`) queries `prefers-color-scheme` to
 * resolve `'system'` mode; a missing implementation would throw at
 * module load. This default returns a `MediaQueryList`-shaped stub
 * with `matches: false` (i.e. light system default). Tests that need
 * to flip the value can `vi.spyOn(window, 'matchMedia')` and return
 * a custom stub.
 */
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList => {
      const listeners = new Set<EventListenerOrEventListenerObject>();
      const mql: MediaQueryList = {
        matches: false,
        media: query,
        onchange: null,
        addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
          if (type === 'change') {
            listeners.add(listener);
          }
        },
        removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
          if (type === 'change') {
            listeners.delete(listener);
          }
        },
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      };
      return mql;
    },
  });
}

/**
 * R10.1 — test-only `ResizeObserver` shim.
 *
 * jsdom 29.x doesn't ship `ResizeObserver`. The shadcn `input-otp`
 * primitive (`apps/web/src/components/ui/input-otp.tsx`) instantiates one
 * on mount to track the input's box; a missing implementation throws
 * `ReferenceError: ResizeObserver is not defined` during effect commit.
 * This no-op stub satisfies the constructor + observe/unobserve/disconnect
 * contract closely enough for the primitive to mount in tests.
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
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
