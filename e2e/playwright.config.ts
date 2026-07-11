/**
 * R8.4.d — Playwright config for the Docker-native E2E rig.
 *
 * The rig runs entirely inside compose (`e2e/docker-compose.yml`); the
 * playwright container shares Caddy's network namespace, so the browser
 * reaches the app at `http://localhost:8080` (a secure context — see the
 * compose file for why that matters). Env supplies `E2E_BASE_URL` +
 * `E2E_MAILPIT_URL`. The `??` fallback below is only for `pnpm exec
 * playwright test` outside the container (developer convenience — valid
 * only when a same-origin stack is already up on :8080).
 */
import { defineConfig } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:8080';

export default defineConfig({
  testDir: './tests',
  // fullyParallel: false — the specs share one Postgres container, and
  // the party-lifecycle spec seeds users via the real OTP flow. Turn on
  // later once specs are fully isolated by unique emails / party names.
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
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          // Chromium runs as root in the Playwright container.
          args: ['--no-sandbox'],
        },
      },
    },
  ],
});
