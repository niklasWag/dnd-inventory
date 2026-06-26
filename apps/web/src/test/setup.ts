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

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
