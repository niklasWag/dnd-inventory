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

import { applyBroadcast } from './socket';
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
  it('mutates state + appends server log entries for a broadcast that matches the current party', () => {
    const base = bootstrap();
    const preLogLen = useStore.getState().log.length;
    const stashInInventory = base.inventoryStashId;
    const torchDef = base.catalog.find((d) => d.id === 'phb-2024:torch');
    expect(torchDef).toBeDefined();
    if (torchDef === undefined) return;

    // Simulate the server broadcasting a peer's `acquire` action: item
    // is added to the inventory stash, log entry is server-echoed.
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
      actorUserId: base.userId,
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

  it('dedupes: the same broadcast delivered twice appends only once (self-echo protection)', () => {
    const base = bootstrap();
    const stashInInventory = base.inventoryStashId;
    const torchDef = base.catalog.find((d) => d.id === 'phb-2024:torch');
    if (torchDef === undefined) return;

    const preLogLen = useStore.getState().log.length;
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
      actorUserId: base.userId,
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
