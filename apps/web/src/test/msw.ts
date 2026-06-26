/**
 * R3.5 — MSW (Mock Service Worker) Node setup for the web's vitest suite.
 *
 * `setupServer` is wired into `apps/web/src/test/setup.ts` so every test
 * gets the same intercept rig. `onUnhandledRequest: 'error'` is deliberate:
 * any unmocked outbound request fails the test loudly rather than hitting
 * a real server during CI.
 *
 * Default handlers cover the universally-called endpoint (`GET /auth/session`)
 * with an anonymous response. Per-test handlers override via
 * `server.use(...)` and reset between tests.
 */
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

/**
 * Tests run with `VITE_SERVER_URL` stubbed to a known origin. We use a
 * synthetic origin here so request URLs are stable and easy to match.
 * Individual mode-aware test files override this via `vi.stubEnv`.
 */
export const TEST_SERVER_ORIGIN = 'http://test.server.local';

export const defaultHandlers = [
  http.get(`${TEST_SERVER_ORIGIN}/auth/session`, () => {
    // Anonymous response — Auth.js convention is `{}` (no `user` field).
    return HttpResponse.json({});
  }),
];

export const server = setupServer(...defaultHandlers);
