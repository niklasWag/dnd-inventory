import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { server, TEST_SERVER_ORIGIN } from '../test/msw';
import type * as ApiModule from './api';

/**
 * `api.ts` reads `SERVER_URL` once via `serverMode.ts` at module-load
 * time. To exercise server-mode behavior we stub `VITE_SERVER_URL`,
 * reset modules, and dynamically import the suite under test. The
 * `loadApi()` helper centralises that ritual.
 */
async function loadApi(): Promise<typeof ApiModule> {
  vi.stubEnv('VITE_SERVER_URL', TEST_SERVER_ORIGIN);
  vi.resetModules();
  return import('./api.js');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('apiFetch — local mode guard', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SERVER_URL', '');
    vi.resetModules();
  });

  it('throws synchronously when SERVER_URL is null', async () => {
    const api = await import('./api.js');
    await expect(api.getSessionMe()).rejects.toThrow(/local mode/);
  });
});

describe('apiFetch — server mode', () => {
  it('parses a 200 happy path against its schema', async () => {
    const api = await loadApi();
    server.use(
      http.get(`${TEST_SERVER_ORIGIN}/auth/session`, () =>
        HttpResponse.json({
          user: {
            id: 'u1',
            displayName: 'Alice',
            email: null,
            avatarUrl: null,
            discordId: null,
            needsDisplayName: false,
          },
          expires: '2026-12-31T00:00:00.000Z',
        }),
      ),
    );
    const result = await api.getSessionMe();
    expect(result.user?.id).toBe('u1');
    expect(result.user?.displayName).toBe('Alice');
  });

  it('returns an empty body as anonymous session', async () => {
    const api = await loadApi();
    server.use(http.get(`${TEST_SERVER_ORIGIN}/auth/session`, () => HttpResponse.json({})));
    const result = await api.getSessionMe();
    expect(result.user).toBeUndefined();
  });

  it('maps a 401 body to an ApiError with code from server', async () => {
    const api = await loadApi();
    server.use(
      http.post(`${TEST_SERVER_ORIGIN}/auth/email/set-display-name`, () =>
        HttpResponse.json({ error: 'unauthenticated' }, { status: 401 }),
      ),
    );
    await expect(api.setDisplayName('Alice')).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      code: 'unauthenticated',
    });
  });

  it('exposes retryAfter on 429', async () => {
    const api = await loadApi();
    server.use(
      http.post(`${TEST_SERVER_ORIGIN}/auth/email/request-otp`, () =>
        HttpResponse.json(
          { error: 'rate_limited', retryAfter: '2026-06-26T12:00:00.000Z' },
          { status: 429, headers: { 'Retry-After': '900' } },
        ),
      ),
    );
    await expect(api.requestEmailOtp('a@example.com')).rejects.toMatchObject({
      status: 429,
      code: 'rate_limited',
      retryAfter: '2026-06-26T12:00:00.000Z',
    });
  });

  it('throws BatchRejectedError on 422 from /sync/actions', async () => {
    const api = await loadApi();
    server.use(
      http.post(`${TEST_SERVER_ORIGIN}/sync/actions`, () =>
        HttpResponse.json(
          { rejected: { index: 1, code: 'forbidden_role', message: 'DM only' } },
          { status: 422 },
        ),
      ),
    );
    await expect(api.pushActions('p1', [{ type: 'acquire' }])).rejects.toMatchObject({
      name: 'BatchRejectedError',
      index: 1,
      rejectedCode: 'forbidden_role',
      rejectedMessage: 'DM only',
    });
  });

  it('maps 503 to a typed error', async () => {
    const api = await loadApi();
    server.use(
      http.post(`${TEST_SERVER_ORIGIN}/auth/email/request-otp`, () =>
        HttpResponse.json({ error: 'email_auth_disabled' }, { status: 503 }),
      ),
    );
    await expect(api.requestEmailOtp('a@example.com')).rejects.toMatchObject({
      status: 503,
      code: 'email_auth_disabled',
    });
  });

  it('rejects malformed happy-path responses', async () => {
    const api = await loadApi();
    server.use(
      http.post(`${TEST_SERVER_ORIGIN}/auth/email/verify-otp`, () =>
        HttpResponse.json({ unexpected: 'shape' }),
      ),
    );
    await expect(api.verifyEmailOtp('a@example.com', '12345678')).rejects.toMatchObject({
      code: 'malformed_response',
    });
  });

  it('URL-encodes partyId on /sync/state', async () => {
    const api = await loadApi();
    let observed: string | null = null;
    server.use(
      http.get(`${TEST_SERVER_ORIGIN}/sync/state`, ({ request }) => {
        observed = new URL(request.url).searchParams.get('partyId');
        // Return a 401 — we don't care about the body here, just the URL.
        return HttpResponse.json({ error: 'unauthenticated' }, { status: 401 });
      }),
    );
    await expect(api.pullState('weird id&extra=1')).rejects.toMatchObject({
      status: 401,
    });
    expect(observed).toBe('weird id&extra=1');
  });
});
