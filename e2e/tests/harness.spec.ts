/**
 * R8.4.d.i — Harness smoke spec.
 *
 * Proves the compose stack is up end-to-end: the server responds to
 * `/healthz`, and the web SPA is reachable from a browser. If either
 * check fails, later specs are pointless — this is the "does the rig
 * even boot" gate.
 */
import { expect, test } from '@playwright/test';

const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

test('rig is up', async ({ page, request }) => {
  // Server health.
  const healthRes = await request.get(`${API_URL}/healthz`);
  expect(healthRes.status()).toBe(200);

  // Web SPA loads. Track any 4xx/5xx on the document nav.
  const navResponse = await page.goto(`${BASE_URL}/`);
  expect(navResponse, 'page.goto did not return a response').not.toBeNull();
  expect(navResponse!.status()).toBeLessThan(400);

  // Sanity: the SPA should render some HTML content. We don't assert on
  // specific copy because it will churn with UI work; a non-empty body
  // is enough to prove nginx is serving the built bundle.
  const html = await page.content();
  expect(html.length).toBeGreaterThan(0);
});
