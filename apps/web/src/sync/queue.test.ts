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

describe('queue — id canonicalization after id-minting actions', () => {
  /**
   * R4.1.f post-ship bug fix (2026-06-30): the queue's post-flush
   * re-pull was wired only for `create-character`. Every other action
   * that mints server-canonical entity ids (`acquire`, `create-stash`,
   * `split`, `create-homebrew`) suffered the same divergence: the
   * client's reducer minted a local UUID that the server's reducer
   * never agreed with. Subsequent actions referencing the new id (e.g.
   * `transfer` after `acquire`) then failed with `item_not_found`
   * because the client was holding stale optimistic ids.
   *
   * The fix is to re-pull canonical state after ANY id-minting action
   * lands, mirroring the create-character pattern.
   */
  it('re-pulls canonical state after `acquire` so optimistic ids get replaced', async () => {
    const queue = await loadQueue();
    const { deps } = fakeDeps({ appState: { party: { id: 'party-1' } }, log: [] });
    queue.configureQueue(deps);

    const calls: { actions?: number; pulls?: number } = { actions: 0, pulls: 0 };
    server.use(
      http.post(`${TEST_SERVER_ORIGIN}/sync/actions`, () => {
        calls.actions = (calls.actions ?? 0) + 1;
        return HttpResponse.json({
          applied: [
            {
              id: 'log-server-1',
              partyId: 'party-1',
              sessionId: null,
              timestamp: '2026-06-30T00:00:00.000Z',
              actorUserId: 'u1',
              actorRole: 'player',
              type: 'acquire',
              payload: {
                stashId: 'inv-1',
                // Server-canonical itemInstanceId differs from any id
                // the client minted locally.
                itemInstanceId: 'server-minted-item-id',
                definitionId: 'phb-2024:torch',
                quantity: 1,
                source: 'catalog-add',
              },
            },
          ],
          serverTime: '2026-06-30T00:00:00.000Z',
        });
      }),
      // The bug: this handler isn't called today. The fix: it must be.
      http.get(`${TEST_SERVER_ORIGIN}/sync/state`, () => {
        calls.pulls = (calls.pulls ?? 0) + 1;
        // Return a structurally-empty response — the queue's restore
        // path will fail Zod-parse but the assertion we care about is
        // "the pull was triggered." We catch the resulting toast / log.
        return HttpResponse.json({}, { status: 500 });
      }),
    );

    queue.enqueue({ type: 'acquire' } as unknown as Parameters<typeof queue.enqueue>[0]);
    await queue.flush();

    expect(calls.actions).toBe(1);
    expect(calls.pulls).toBe(1);
    queue.resetQueue();
  });
});

// ------------------------------------------------------------------ //
// BUG-003 (2026-07-01) — pre-batch snapshot must be captured BEFORE
// the store mutation, not after. If the queue's snapshot is captured
// via `deps.getSnapshot()` inside `enqueue()` (which runs AFTER
// `dispatch` has already applied the reducer to the store), then a
// 422 rollback restores the mutated state to itself — the item stays
// visually in the wrong place. The user reported this reproducing
// every time on a non-Banker attempting to move an item out of
// Party Stash post-R4.2.c.
// ------------------------------------------------------------------ //

describe('queue — 422 rollback restores PRE-mutation snapshot (BUG-003)', () => {
  it('restores the snapshot the caller captured BEFORE mutating the store', async () => {
    const queue = await loadQueue();
    // Simulate the dispatch order: caller captures snapshot BEFORE
    // mutating, then applies the mutation, then enqueues.
    const preSnapshot: FakeSnapshot = { appState: { party: { id: 'party-1' } }, log: [{ marker: 'PRE' }] };
    const postSnapshot: FakeSnapshot = { appState: { party: { id: 'party-1' } }, log: [{ marker: 'POST' }] };
    let current: FakeSnapshot = preSnapshot;

    queue.configureQueue({
      // getSnapshot always returns the "current" store state, which
      // will be the POST-mutation state by the time enqueue runs.
      getSnapshot: () => current as unknown as ReturnType<QueueDeps['getSnapshot']>,
      restoreSnapshot: (s) => {
        const cast = s as unknown as FakeSnapshot;
        current = cast;
      },
      getActivePartyId: () => Promise.resolve('party-1'),
    });

    // 422 response with a Banker-gate rejection (the exact shape
    // R4.2.c returns; the queue only cares about the discriminator).
    server.use(
      http.post(`${TEST_SERVER_ORIGIN}/sync/actions`, () =>
        HttpResponse.json(
          {
            rejected: {
              index: 0,
              code: 'banker_required_for_claim',
              message: 'A Banker is appointed; only the Banker can move items out of shared pools.',
            },
          },
          { status: 422 },
        ),
      ),
    );

    // Caller (store.dispatch) captures the PRE snapshot first.
    queue.captureRollbackSnapshot();
    // Caller then mutates the store — simulated by flipping `current`
    // to the post-mutation snapshot.
    current = postSnapshot;
    // Caller then enqueues the action.
    queue.enqueue({ type: 'transfer' } as unknown as Parameters<typeof queue.enqueue>[0]);
    await queue.flush();

    // The rollback must have restored the PRE snapshot, not the POST.
    expect(current.log).toEqual([{ marker: 'PRE' }]);
    queue.resetQueue();
  });
});
