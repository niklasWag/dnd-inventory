import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { server, TEST_SERVER_ORIGIN } from '../test/msw';
import type * as SessionModule from './session';

/**
 * Like `api.test.ts`, the session store reads `isServerMode` once via
 * `serverMode.ts` at module load. We dynamically import the store after
 * `vi.stubEnv` to exercise both modes.
 */
async function loadSession(serverMode: boolean): Promise<typeof SessionModule> {
  vi.stubEnv('VITE_SERVER_URL', serverMode ? TEST_SERVER_ORIGIN : '');
  vi.resetModules();
  return import('./session.js');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('useSession — local mode', () => {
  beforeEach(() => {
    // any leftover state from previous tests should be reset by resetModules
  });

  it('hydrate settles at anonymous without any network call', async () => {
    const { useSession } = await loadSession(false);
    await useSession.getState().hydrate();
    expect(useSession.getState().status).toBe('anonymous');
    expect(useSession.getState().user).toBeNull();
  });

  it('signOut is a no-op locally', async () => {
    const { useSession } = await loadSession(false);
    await useSession.getState().signOut();
    expect(useSession.getState().status).toBe('anonymous');
  });
});

describe('useSession — server mode', () => {
  it('hydrate lands at anonymous when /auth/session returns {}', async () => {
    const { useSession } = await loadSession(true);
    server.use(http.get(`${TEST_SERVER_ORIGIN}/auth/session`, () => HttpResponse.json({})));
    await useSession.getState().hydrate();
    expect(useSession.getState().status).toBe('anonymous');
  });

  it('hydrate lands at needsDisplayName when the user has the flag', async () => {
    const { useSession } = await loadSession(true);
    server.use(
      http.get(`${TEST_SERVER_ORIGIN}/auth/session`, () =>
        HttpResponse.json({
          user: {
            id: 'u1',
            displayName: '',
            email: 'a@example.com',
            avatarUrl: null,
            discordId: null,
            needsDisplayName: true,
          },
          expires: '2026-12-31T00:00:00.000Z',
        }),
      ),
    );
    await useSession.getState().hydrate();
    expect(useSession.getState().status).toBe('needsDisplayName');
    expect(useSession.getState().user?.id).toBe('u1');
  });

  it('hydrate lands at authenticated when the user is fully set up', async () => {
    const { useSession } = await loadSession(true);
    server.use(
      http.get(`${TEST_SERVER_ORIGIN}/auth/session`, () =>
        HttpResponse.json({
          user: {
            id: 'u1',
            displayName: 'Alice',
            email: 'a@example.com',
            avatarUrl: null,
            discordId: null,
            needsDisplayName: false,
          },
          expires: '2026-12-31T00:00:00.000Z',
        }),
      ),
    );
    await useSession.getState().hydrate();
    expect(useSession.getState().status).toBe('authenticated');
  });

  it('treats /auth/session 5xx as anonymous (graceful fallback)', async () => {
    const { useSession } = await loadSession(true);
    server.use(
      http.get(`${TEST_SERVER_ORIGIN}/auth/session`, () =>
        HttpResponse.json({ error: 'internal' }, { status: 500 }),
      ),
    );
    // silence console.warn for this test
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await useSession.getState().hydrate();
    expect(useSession.getState().status).toBe('anonymous');
    warn.mockRestore();
  });

  it('setSession flips status based on needsDisplayName', async () => {
    const { useSession } = await loadSession(true);
    useSession.getState().setSession({
      id: 'u1',
      displayName: '',
      email: null,
      avatarUrl: null,
      discordId: null,
      needsDisplayName: true,
    });
    expect(useSession.getState().status).toBe('needsDisplayName');
    useSession.getState().setSession({
      id: 'u1',
      displayName: 'Alice',
      email: null,
      avatarUrl: null,
      discordId: null,
      needsDisplayName: false,
    });
    expect(useSession.getState().status).toBe('authenticated');
  });

  it('setUserPatch merges into an existing session', async () => {
    const { useSession } = await loadSession(true);
    useSession.getState().setSession({
      id: 'u1',
      displayName: '',
      email: null,
      avatarUrl: null,
      discordId: null,
      needsDisplayName: true,
    });
    useSession.getState().setUserPatch({ id: 'u1', displayName: 'Alice', needsDisplayName: false });
    expect(useSession.getState().status).toBe('authenticated');
    expect(useSession.getState().user?.displayName).toBe('Alice');
  });

  it('setUserPatch throws when no session is active', async () => {
    const { useSession } = await loadSession(true);
    expect(() => useSession.getState().setUserPatch({ id: 'u1', displayName: 'Alice' })).toThrow();
  });

  it('signOut clears the session even if the server call fails', async () => {
    const { useSession } = await loadSession(true);
    useSession.getState().setSession({
      id: 'u1',
      displayName: 'Alice',
      email: null,
      avatarUrl: null,
      discordId: null,
      needsDisplayName: false,
    });
    server.use(
      http.post(`${TEST_SERVER_ORIGIN}/auth/signout`, () =>
        HttpResponse.json({ error: 'internal' }, { status: 500 }),
      ),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await useSession.getState().signOut();
    expect(useSession.getState().status).toBe('anonymous');
    expect(useSession.getState().user).toBeNull();
    warn.mockRestore();
  });
});
