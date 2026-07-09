/**
 * R8.4.d.i — Playwright config for the Docker-native E2E rig.
 *
 * The rig runs entirely inside compose (`e2e/docker-compose.yml`); the
 * playwright container's env supplies `E2E_BASE_URL` / `E2E_API_URL` /
 * `E2E_MAILPIT_URL`. The `??` fallback below is only for `pnpm exec
 * playwright test` outside the container (developer convenience — spec
 * only when the standard host dev server is already up).
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // fullyParallel: false initially — parties tests will share DB state
  // (single postgres container in the compose network). Turn on later
  // once specs are namespaced by unique party names / seeded users.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [
    ['list'],
    // HTML report written to a bind-mounted volume so it survives
    // `--rm` on the playwright container. See `e2e/docker-compose.yml`
    // for the mount. Open post-run via `pnpm e2e:report`.
    ['html', { outputFolder: '/e2e-report', open: 'never' }],
  ],
  // Test artifacts (traces, videos, screenshots) also bind-mount out —
  // `retain-on-failure` above means these only exist for failed specs.
  outputDir: '/e2e-results',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
