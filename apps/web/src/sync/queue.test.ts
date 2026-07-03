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

    queue.enqueue({ type: 'acquire' } as unknown as Parameters<typeof queue.enqueue>[0], 'party-1');
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

    queue.enqueue({ type: 'acquire' } as unknown as Parameters<typeof queue.enqueue>[0], 'party-1');
    await queue.flush();

    expect(session.useSession.getState().status).toBe('anonymous');
    queue.resetQueue();
  });
});

describe('queue — no post-flush re-pull after id-minting actions (RH1.3)', () => {
  /**
   * R4.1.f post-ship bug fix (2026-06-30) initially wired a post-flush
   * `GET /sync/state` re-pull after any id-minting action to
   * canonicalize local ids the server had re-minted. RH1.2 (2026-07-02)
   * moved id-minting authority to the client — every entity id is now
   * a client-minted UUID v7 sent in the action payload, and the server
   * echoes it back verbatim in `applied[]`. That eliminated the
   * divergence that made the re-pull necessary in the first place.
   *
   * RH1.3 removes the re-pull entirely. This test asserts the negative:
   * after an `acquire` (or any other formerly-id-minting action), the
   * queue MUST NOT call `/sync/state`. The old positive assertion (that
   * the re-pull IS triggered) is kept below in the "regression archive"
   * comment as documentation of the pre-RH1.3 behaviour.
   */
  it('does NOT re-pull /sync/state after `acquire`', async () => {
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
              timestamp: '2026-07-02T00:00:00.000Z',
              actorUserId: 'u1',
              actorRole: 'player',
              type: 'acquire',
              payload: {
                stashId: 'inv-1',
                // The itemInstanceId in the applied echo matches the
                // client-minted id (RH1.2) — no divergence, so no
                // canonicalize step is needed.
                itemInstanceId: 'client-minted-item-id',
                definitionId: 'phb-2024:torch',
                quantity: 1,
                source: 'catalog-add',
              },
            },
          ],
          serverTime: '2026-07-02T00:00:00.000Z',
        });
      }),
      // This handler MUST NOT fire post-RH1.3. If it does, the test
      // will observe `calls.pulls > 0`.
      http.get(`${TEST_SERVER_ORIGIN}/sync/state`, () => {
        calls.pulls = (calls.pulls ?? 0) + 1;
        return HttpResponse.json({}, { status: 500 });
      }),
    );

    queue.enqueue({ type: 'acquire' } as unknown as Parameters<typeof queue.enqueue>[0], 'party-1');
    await queue.flush();

    expect(calls.actions).toBe(1);
    expect(calls.pulls).toBe(0);
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
    const preSnapshot: FakeSnapshot = {
      appState: { party: { id: 'party-1' } },
      log: [{ marker: 'PRE' }],
    };
    const postSnapshot: FakeSnapshot = {
      appState: { party: { id: 'party-1' } },
      log: [{ marker: 'POST' }],
    };
    let current: FakeSnapshot = preSnapshot;

    queue.configureQueue({
      // getSnapshot always returns the "current" store state, which
      // will be the POST-mutation state by the time enqueue runs.
      getSnapshot: () => current as unknown as ReturnType<QueueDeps['getSnapshot']>,
      restoreSnapshot: (s) => {
        const cast = s as unknown as FakeSnapshot;
        current = cast;
      },
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
    queue.enqueue(
      { type: 'transfer' } as unknown as Parameters<typeof queue.enqueue>[0],
      'party-1',
    );
    await queue.flush();

    // The rollback must have restored the PRE snapshot, not the POST.
    expect(current.log).toEqual([{ marker: 'PRE' }]);
    queue.resetQueue();
  });

  // ---------------------------------------------------------------- //
  // R4.3.b — new rejection codes from R4.3.a's dm-transfer reducer
  // (`dm_transfer_self`, `dm_transfer_target_not_member`). BUG-003
  // lesson: every new rejection code needs a matching optimistic-
  // rollback assertion so future regressions can't recur in a new
  // slice. One representative case covers the code path since the
  // rollback behavior is code-agnostic.
  // ---------------------------------------------------------------- //

  it('R4.3.a — rolls back on dm_transfer_target_not_member (BUG-003 lesson)', async () => {
    const queue = await loadQueue();
    const preSnapshot: FakeSnapshot = {
      appState: { party: { id: 'party-1' } },
      log: [{ marker: 'PRE_DM_TRANSFER' }],
    };
    const postSnapshot: FakeSnapshot = {
      appState: { party: { id: 'party-1' } },
      log: [{ marker: 'POST_DM_TRANSFER' }],
    };
    let current: FakeSnapshot = preSnapshot;

    queue.configureQueue({
      getSnapshot: () => current as unknown as ReturnType<QueueDeps['getSnapshot']>,
      restoreSnapshot: (s) => {
        const cast = s as unknown as FakeSnapshot;
        current = cast;
      },
    });

    server.use(
      http.post(`${TEST_SERVER_ORIGIN}/sync/actions`, () =>
        HttpResponse.json(
          {
            rejected: {
              index: 0,
              code: 'dm_transfer_target_not_member',
              message: 'Target user lacks an active player membership in this party.',
            },
          },
          { status: 422 },
        ),
      ),
    );

    queue.captureRollbackSnapshot();
    current = postSnapshot;
    queue.enqueue(
      { type: 'dm-transfer' } as unknown as Parameters<typeof queue.enqueue>[0],
      'party-1',
    );
    await queue.flush();

    // Rollback restored the PRE snapshot (dm-transfer optimistic
    // mutation was undone once the server rejected).
    expect(current.log).toEqual([{ marker: 'PRE_DM_TRANSFER' }]);
    queue.resetQueue();
  });
});

describe('queue — RH4.2 explicit partyId per enqueue', () => {
  it('the partyId passed to enqueue reaches the POST body (no Dexie meta round-trip)', async () => {
    const queue = await loadQueue();
    const { deps } = fakeDeps({ appState: { party: { id: 'from-state' } }, log: [] });
    queue.configureQueue(deps);
    const requestedPartyIds: string[] = [];
    server.use(
      http.post(`${TEST_SERVER_ORIGIN}/sync/actions`, async ({ request }) => {
        const body = (await request.json()) as { partyId: string };
        requestedPartyIds.push(body.partyId);
        return HttpResponse.json({ applied: [], serverTime: '2026-07-03T00:00:00.000Z' });
      }),
    );

    // Enqueue with an explicit partyId that differs from state's — proves
    // the queue does NOT read state's partyId or Dexie meta; it uses the
    // caller-supplied value verbatim.
    queue.enqueue(
      { type: 'acquire' } as unknown as Parameters<typeof queue.enqueue>[0],
      'from-enqueue',
    );
    await queue.flush();

    expect(requestedPartyIds).toEqual(['from-enqueue']);
    queue.resetQueue();
  });

  it('mixed-party batch requeues the tail: only entries sharing the first partyId flush together', async () => {
    const queue = await loadQueue();
    const { deps } = fakeDeps({ appState: { party: { id: 'party-A' } }, log: [] });
    queue.configureQueue(deps);
    const batches: { partyId: string; actionCount: number }[] = [];
    server.use(
      http.post(`${TEST_SERVER_ORIGIN}/sync/actions`, async ({ request }) => {
        const body = (await request.json()) as { partyId: string; actions: unknown[] };
        batches.push({ partyId: body.partyId, actionCount: body.actions.length });
        return HttpResponse.json({ applied: [], serverTime: '2026-07-03T00:00:00.000Z' });
      }),
    );

    // Interleave two parties. The queue's flush splits by partyId,
    // sending the first party's entries first and requeuing the rest.
    queue.enqueue({ type: 'acquire' } as unknown as Parameters<typeof queue.enqueue>[0], 'party-A');
    queue.enqueue({ type: 'acquire' } as unknown as Parameters<typeof queue.enqueue>[0], 'party-B');
    queue.enqueue({ type: 'acquire' } as unknown as Parameters<typeof queue.enqueue>[0], 'party-A');
    await queue.flush();
    // First flush sent only party-A entries (2 of them). Party-B is requeued.
    expect(batches).toEqual([{ partyId: 'party-A', actionCount: 2 }]);

    await queue.flush();
    // Second flush drains party-B.
    expect(batches).toEqual([
      { partyId: 'party-A', actionCount: 2 },
      { partyId: 'party-B', actionCount: 1 },
    ]);
    queue.resetQueue();
  });
});
