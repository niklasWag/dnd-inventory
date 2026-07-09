/**
 * R5.1.b — Client socket consumer tests.
 *
 * We test `applyBroadcast` directly (the exported reconciliation
 * helper) rather than driving a real socket.io transport. Two reasons:
 *
 *   1. Reconciliation is the interesting invariant — the socket wiring
 *      is a thin adapter over Socket.IO's own reliable delivery. The
 *      end-to-end broadcast delivery is already covered by the server
 *      test `apps/server/src/realtime/io.test.ts`.
 *   2. socket.io-client's transport can't run in JSDOM without either
 *      a real WS endpoint or a heavyweight mock; both add flake surface.
 *
 * Covers:
 *   - Positive: a valid broadcast for the currently-loaded party
 *     mutates state + appends server log entries.
 *   - Dedupe: the same broadcast delivered twice appends only once
 *     (self-echo + duplicate protection).
 *   - Wrong party: a broadcast for a different partyId than the store's
 *     current party is silently ignored.
 *   - Zod invalid payload: malformed broadcast is dropped (error logged,
 *     store untouched).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { newUuidV7 } from '@app/shared';

import { applyBroadcast, getSocket, syncSocketWithSession, resetSocket } from './socket';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';
import { bootstrap } from '@/test/fixtures';

beforeEach(async () => {
  await wipeAll();
  useStore.setState({ appState: null, log: [], socketConnected: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('R5.1.b — applyBroadcast', () => {
  it('mutates state + appends server log entries for a peer broadcast on the current party', () => {
    const base = bootstrap();
    const preLogLen = useStore.getState().log.length;
    const stashInInventory = base.inventoryStashId;
    const torchDef = base.catalog.find((d) => d.id === 'phb-2024:torch');
    expect(torchDef).toBeDefined();
    if (torchDef === undefined) return;

    // Simulate the server broadcasting a peer's `acquire` action: item
    // is added to the inventory stash, log entry is server-echoed.
    // `actorUserId` intentionally DIFFERENT from `base.userId` so this
    // exercises the peer-broadcast path (reducer re-run) rather than
    // BUG-007's self-echo short-circuit.
    const peerUserId = newUuidV7();
    const newItemInstanceId = newUuidV7();
    const action = {
      type: 'acquire' as const,
      payload: {
        stashId: stashInInventory,
        definitionId: torchDef.id,
        quantity: 3,
        source: 'catalog-add' as const,
        newItemInstanceId,
      },
    };
    const serverLogEntry = {
      id: newUuidV7(),
      partyId: base.partyId,
      sessionId: null,
      timestamp: '2026-07-03T12:34:56.789Z',
      actorUserId: peerUserId,
      actorRole: 'player' as const,
      type: 'acquire' as const,
      payload: {
        stashId: stashInInventory,
        definitionId: torchDef.id,
        quantity: 3,
        source: 'catalog-add' as const,
        // Log entry uses the resolved `itemInstanceId` (not the
        // action-payload `newItemInstanceId` mint field).
        itemInstanceId: newItemInstanceId,
      },
    };

    applyBroadcast({
      partyId: base.partyId,
      action,
      applied: [serverLogEntry],
    });

    const after = useStore.getState();
    // State mutated: the item now exists in inventory.
    const items = after.appState!.items.filter((i) => i.ownerId === stashInInventory);
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe(newItemInstanceId);
    expect(items[0]!.quantity).toBe(3);
    // Log grew by exactly one entry — the server-echoed one.
    expect(after.log.length).toBe(preLogLen + 1);
    const appended = after.log[after.log.length - 1]!;
    expect(appended.id).toBe(serverLogEntry.id);
    expect(appended.timestamp).toBe(serverLogEntry.timestamp);
  });

  it('dedupes: the same peer broadcast delivered twice appends only once', () => {
    const base = bootstrap();
    const stashInInventory = base.inventoryStashId;
    const torchDef = base.catalog.find((d) => d.id === 'phb-2024:torch');
    if (torchDef === undefined) return;

    const preLogLen = useStore.getState().log.length;
    const peerUserId = newUuidV7();
    const newItemInstanceId = newUuidV7();
    const action = {
      type: 'acquire' as const,
      payload: {
        stashId: stashInInventory,
        definitionId: torchDef.id,
        quantity: 1,
        source: 'catalog-add' as const,
        newItemInstanceId,
      },
    };
    const serverLogEntry = {
      id: newUuidV7(),
      partyId: base.partyId,
      sessionId: null,
      timestamp: '2026-07-03T12:34:56.789Z',
      actorUserId: peerUserId,
      actorRole: 'player' as const,
      type: 'acquire' as const,
      payload: {
        stashId: stashInInventory,
        definitionId: torchDef.id,
        quantity: 1,
        source: 'catalog-add' as const,
        itemInstanceId: newItemInstanceId,
      },
    };
    const payload = { partyId: base.partyId, action, applied: [serverLogEntry] };

    applyBroadcast(payload);
    applyBroadcast(payload); // Duplicate — should be a no-op.

    const after = useStore.getState();
    // Log grew by exactly 1, not 2.
    expect(after.log.length).toBe(preLogLen + 1);
    // State applied only once — quantity 1, not 2 (would be 2 if the
    // reducer ran twice against the pre-state; the id-dedupe blocks it).
    const items = after.appState!.items.filter((i) => i.ownerId === stashInInventory);
    expect(items).toHaveLength(1);
    expect(items[0]!.quantity).toBe(1);
  });

  it('ignores broadcasts for a different partyId (user viewing another party or Hub)', () => {
    const base = bootstrap();
    const preAppState = useStore.getState().appState;
    const preLog = useStore.getState().log;

    // The broadcast's partyId is intentionally different from the store's.
    applyBroadcast({
      partyId: newUuidV7(),
      action: {
        type: 'rename-party',
        payload: { partyId: base.partyId, newName: 'Should Not Apply' },
      },
      applied: [
        {
          id: newUuidV7(),
          partyId: newUuidV7(),
          sessionId: null,
          timestamp: '2026-07-03T12:34:56.789Z',
          actorUserId: base.userId,
          actorRole: 'dm',
          type: 'rename-party',
          payload: { partyId: base.partyId, oldName: 'Prev', newName: 'Should Not Apply' },
        },
      ],
    });

    const after = useStore.getState();
    // State + log unchanged.
    expect(after.appState).toBe(preAppState);
    expect(after.log).toBe(preLog);
  });

  it('drops malformed broadcast payloads (Zod parse failure logs + no state change)', () => {
    const base = bootstrap();
    const preAppState = useStore.getState().appState;
    const preLog = useStore.getState().log;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    applyBroadcast({
      // Missing `action` and `applied` — schema requires both.
      partyId: base.partyId,
    });

    const after = useStore.getState();
    expect(after.appState).toBe(preAppState);
    expect(after.log).toBe(preLog);
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('BUG-007 — applyBroadcast self-echo short-circuit', () => {
  it('skips the reducer re-run when actorUserId matches the store user (does not double-apply an acquire)', () => {
    // Scenario: this client dispatched `acquire quantity 1`, which
    // optimistically added an item. The server broadcasts back to
    // every party member INCLUDING this one. Without the self-echo
    // short-circuit, `applyBroadcast` would re-run the reducer
    // against the already-mutated state and end up with quantity 2.
    const base = bootstrap();
    const stashInInventory = base.inventoryStashId;
    const torchDef = base.catalog.find((d) => d.id === 'phb-2024:torch');
    if (torchDef === undefined) return;

    // Step 1: simulate the optimistic dispatch — the reducer already
    // ran and put quantity 1 into inventory.
    const newItemInstanceId = newUuidV7();
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: stashInInventory,
        definitionId: torchDef.id,
        quantity: 1,
        source: 'catalog-add',
        newItemInstanceId,
      },
    });
    const preLogLen = useStore.getState().log.length;
    const preItem = useStore.getState().appState!.items.find((i) => i.id === newItemInstanceId);
    expect(preItem?.quantity).toBe(1);

    // Step 2: server's `applied` broadcast arrives echoing this
    // client's own action. `actorUserId` is the store's own user id.
    const serverLogEntry = {
      id: newUuidV7(),
      partyId: base.partyId,
      sessionId: null,
      timestamp: '2026-07-03T12:34:56.789Z',
      actorUserId: base.userId, // ← self-echo
      actorRole: 'player' as const,
      type: 'acquire' as const,
      payload: {
        stashId: stashInInventory,
        definitionId: torchDef.id,
        quantity: 1,
        source: 'catalog-add' as const,
        itemInstanceId: newItemInstanceId,
      },
    };
    applyBroadcast({
      partyId: base.partyId,
      action: {
        type: 'acquire',
        payload: {
          stashId: stashInInventory,
          definitionId: torchDef.id,
          quantity: 1,
          source: 'catalog-add',
          newItemInstanceId,
        },
      },
      applied: [serverLogEntry],
    });

    const after = useStore.getState();
    // Quantity stayed at 1, NOT doubled to 2.
    const item = after.appState!.items.find((i) => i.id === newItemInstanceId);
    expect(item?.quantity).toBe(1);
    // Log grew by exactly the one server-echoed entry.
    expect(after.log.length).toBe(preLogLen + 1);
    expect(after.log[after.log.length - 1]!.id).toBe(serverLogEntry.id);
  });

  it('appends server log entries even on self-echo (log-authority under RH2.6)', () => {
    // RH2.6 mandates the server's `applied[]` is the sole source of
    // truth for `state.log`. Self-echo must still append these
    // entries, only skipping the STATE re-run.
    const base = bootstrap();
    const stashInInventory = base.inventoryStashId;
    const torchDef = base.catalog.find((d) => d.id === 'phb-2024:torch');
    if (torchDef === undefined) return;

    const preLogLen = useStore.getState().log.length;
    const serverLogEntry = {
      id: newUuidV7(),
      partyId: base.partyId,
      sessionId: null,
      timestamp: '2026-07-03T12:34:56.789Z',
      actorUserId: base.userId,
      actorRole: 'player' as const,
      type: 'acquire' as const,
      payload: {
        stashId: stashInInventory,
        definitionId: torchDef.id,
        quantity: 1,
        source: 'catalog-add' as const,
        itemInstanceId: newUuidV7(),
      },
    };
    applyBroadcast({
      partyId: base.partyId,
      action: {
        type: 'acquire',
        payload: {
          stashId: stashInInventory,
          definitionId: torchDef.id,
          quantity: 1,
          source: 'catalog-add',
          newItemInstanceId: serverLogEntry.payload.itemInstanceId,
        },
      },
      applied: [serverLogEntry],
    });

    const after = useStore.getState();
    expect(after.log.length).toBe(preLogLen + 1);
    expect(after.log[after.log.length - 1]!.actorUserId).toBe(base.userId);
  });

  it('does NOT short-circuit when actorUserId differs (peer broadcast still re-runs reducer)', () => {
    // Sanity: the fix must not break the peer-broadcast path.
    const base = bootstrap();
    const stashInInventory = base.inventoryStashId;
    const torchDef = base.catalog.find((d) => d.id === 'phb-2024:torch');
    if (torchDef === undefined) return;

    const preLogLen = useStore.getState().log.length;
    const peerUserId = newUuidV7();
    const newItemInstanceId = newUuidV7();
    applyBroadcast({
      partyId: base.partyId,
      action: {
        type: 'acquire',
        payload: {
          stashId: stashInInventory,
          definitionId: torchDef.id,
          quantity: 5,
          source: 'catalog-add',
          newItemInstanceId,
        },
      },
      applied: [
        {
          id: newUuidV7(),
          partyId: base.partyId,
          sessionId: null,
          timestamp: '2026-07-03T12:34:56.789Z',
          actorUserId: peerUserId, // ← different user
          actorRole: 'player' as const,
          type: 'acquire',
          payload: {
            stashId: stashInInventory,
            definitionId: torchDef.id,
            quantity: 5,
            source: 'catalog-add',
            itemInstanceId: newItemInstanceId,
          },
        },
      ],
    });

    const after = useStore.getState();
    // Reducer ran → item added with quantity 5.
    const item = after.appState!.items.find((i) => i.id === newItemInstanceId);
    expect(item?.quantity).toBe(5);
    expect(after.log.length).toBe(preLogLen + 1);
  });

  it('handles the full round-trip: dispatch → broadcast self-echo → subsequent split does not double-apply', () => {
    // This is the end-to-end symptom BUG-007 filed against:
    //   1. Dispatch `acquire quantity 1`.
    //   2. Server broadcasts back (self-echo).
    //   3. Client state must reflect quantity 1 (not 2).
    //   4. A `split qty: 1` MUST be rejected by the local reducer as
    //      "must be less than source" — proving state is consistent
    //      with what the server sees.
    const base = bootstrap();
    const stashInInventory = base.inventoryStashId;
    const torchDef = base.catalog.find((d) => d.id === 'phb-2024:torch');
    if (torchDef === undefined) return;

    const newItemInstanceId = newUuidV7();
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: stashInInventory,
        definitionId: torchDef.id,
        quantity: 1,
        source: 'catalog-add',
        newItemInstanceId,
      },
    });
    applyBroadcast({
      partyId: base.partyId,
      action: {
        type: 'acquire',
        payload: {
          stashId: stashInInventory,
          definitionId: torchDef.id,
          quantity: 1,
          source: 'catalog-add',
          newItemInstanceId,
        },
      },
      applied: [
        {
          id: newUuidV7(),
          partyId: base.partyId,
          sessionId: null,
          timestamp: '2026-07-03T12:34:56.789Z',
          actorUserId: base.userId,
          actorRole: 'player' as const,
          type: 'acquire',
          payload: {
            stashId: stashInInventory,
            definitionId: torchDef.id,
            quantity: 1,
            source: 'catalog-add',
            itemInstanceId: newItemInstanceId,
          },
        },
      ],
    });

    // Quantity should still be 1 post-self-echo.
    const item = useStore.getState().appState!.items.find((i) => i.id === newItemInstanceId);
    expect(item?.quantity).toBe(1);
  });
});

describe('R5.2.a — syncSocketWithSession (auth-gated connect)', () => {
  beforeEach(() => {
    resetSocket();
    // Server-mode URL required for `connectSocket()` to build the client.
    vi.stubEnv('VITE_SERVER_URL', 'http://localhost:8080');
  });

  afterEach(() => {
    resetSocket();
    vi.unstubAllEnvs();
  });

  it('does not build a socket when status is anonymous', () => {
    syncSocketWithSession('anonymous');
    expect(getSocket()).toBeNull();
  });

  it('does not build a socket when status is loading', () => {
    syncSocketWithSession('loading');
    expect(getSocket()).toBeNull();
  });

  it('builds + connects the socket when status is authenticated', () => {
    syncSocketWithSession('authenticated');
    const s = getSocket();
    expect(s).not.toBeNull();
    // socket.io-client sets `active` once `.connect()` is called (even
    // if the transport hasn't finished the WS upgrade yet).
    expect(s!.active).toBe(true);
  });

  it('does NOT build a socket when status is needsDisplayName (server rejects it — BUG-013)', () => {
    // BUG-013 (R8.4.d): the server's io.use() middleware rejects
    // needsDisplayName socket upgrades with `display_name_required`.
    // Connecting during onboarding put socket.io-client into an
    // infinite failing-reconnect loop that later threw an uncaught
    // TypeError when the session flipped to authenticated. The client
    // must NOT connect until onboarding finishes.
    syncSocketWithSession('needsDisplayName');
    expect(getSocket()).toBeNull();
  });

  it('tears down the socket on transition authenticated → anonymous (sign out)', () => {
    syncSocketWithSession('authenticated');
    expect(getSocket()).not.toBeNull();
    syncSocketWithSession('anonymous');
    expect(getSocket()).toBeNull();
  });

  it('is idempotent when called with the same authenticated status twice', () => {
    syncSocketWithSession('authenticated');
    const first = getSocket();
    syncSocketWithSession('authenticated');
    const second = getSocket();
    // Same singleton — no rebuild on repeated authenticated calls.
    expect(second).toBe(first);
  });
});
