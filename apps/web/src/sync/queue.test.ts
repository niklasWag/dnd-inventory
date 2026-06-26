import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { server, TEST_SERVER_ORIGIN } from '../test/msw';
import type * as QueueModule from './queue';
import type { QueueDeps } from './queue';

async function loadQueue(): Promise<typeof QueueModule> {
  vi.stubEnv('VITE_SERVER_URL', TEST_SERVER_ORIGIN);
  vi.resetModules();
  return import('./queue.js');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

interface FakeSnapshot {
  appState: { party: { id: string } } | null;
  log: unknown[];
}

function fakeDeps(initial: FakeSnapshot): {
  deps: QueueDeps;
  current: () => FakeSnapshot;
} {
  let snap: FakeSnapshot = initial;
  return {
    deps: {
      getSnapshot: () => snap as unknown as ReturnType<QueueDeps['getSnapshot']>,
      restoreSnapshot: (s) => {
        // The fake's `getSnapshot` returns a `FakeSnapshot` widened to
        // the queue's interface — round-tripping is structurally safe.
        const cast = s as unknown as FakeSnapshot;
        snap = cast;
      },
      getActivePartyId: () => Promise.resolve(snap.appState?.party.id ?? null),
    },
    current: () => snap,
  };
}

describe('queue — happy path', () => {
  it('flushes a batch to /sync/actions with 200', async () => {
    const queue = await loadQueue();
    const { deps } = fakeDeps({ appState: { party: { id: 'party-1' } }, log: [] });
    queue.configureQueue(deps);
    const calls: unknown[] = [];
    server.use(
      http.post(`${TEST_SERVER_ORIGIN}/sync/actions`, async ({ request }) => {
        calls.push(await request.json());
        return HttpResponse.json({ applied: [], serverTime: '2026-06-26T00:00:00.000Z' });
      }),
    );

    queue.enqueue({ type: 'acquire' } as unknown as Parameters<typeof queue.enqueue>[0]);
    await queue.flush();

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ partyId: 'party-1' });
    queue.resetQueue();
  });
});

describe('queue — 401 clears session', () => {
  it('signs the user out so ProtectedRoute redirects to /login', async () => {
    const queue = await loadQueue();
    const session = await import('@/store/session');
    session.useSession.setState({
      status: 'authenticated',
      user: {
        id: 'u1',
        displayName: 'A',
        email: null,
        avatarUrl: null,
        discordId: null,
        needsDisplayName: false,
      },
    });
    const { deps } = fakeDeps({ appState: { party: { id: 'party-1' } }, log: [] });
    queue.configureQueue(deps);

    server.use(
      http.post(`${TEST_SERVER_ORIGIN}/sync/actions`, () =>
        HttpResponse.json({ error: 'unauthenticated' }, { status: 401 }),
      ),
      http.post(`${TEST_SERVER_ORIGIN}/auth/signout`, () => HttpResponse.json({})),
    );

    queue.enqueue({ type: 'acquire' } as unknown as Parameters<typeof queue.enqueue>[0]);
    await queue.flush();

    expect(session.useSession.getState().status).toBe('anonymous');
    queue.resetQueue();
  });
});
