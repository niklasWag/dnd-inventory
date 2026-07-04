import { beforeEach, describe, expect, it } from 'vitest';

import { newUuidV7 } from '@app/shared';

import { db } from '@/db/schema';
import { wipeAll } from '@/db/wipe';
import type { Action } from '@/store/types';

import { enqueueToOutbox, listOutboxByParty, removeOutbox, updateOutboxAttempt } from './outbox';

beforeEach(async () => {
  await wipeAll();
});

const stubAction = (): Action =>
  ({
    type: 'acquire',
    payload: {
      stashId: newUuidV7(),
      definitionId: 'phb-2024:torch',
      quantity: 1,
      source: 'catalog-add',
      newItemInstanceId: newUuidV7(),
    },
  }) as unknown as Action;

describe('R5.1.c — outbox helpers', () => {
  it('enqueueToOutbox persists a row and returns its assigned local id', async () => {
    const partyId = newUuidV7();
    const id = await enqueueToOutbox(partyId, [stubAction()]);
    expect(typeof id).toBe('number');
    const row = await db.outbox.get(id);
    expect(row).toBeDefined();
    expect(row!.partyId).toBe(partyId);
    expect(row!.attemptCount).toBe(0);
    expect(row!.actions).toHaveLength(1);
    expect(row!.createdAt).toMatch(/T.+Z$/);
  });

  it('listOutboxByParty returns FIFO by createdAt, scoped to the party', async () => {
    const partyA = newUuidV7();
    const partyB = newUuidV7();
    const a1 = await enqueueToOutbox(partyA, [stubAction()]);
    // Introduce a tiny gap so the createdAt strings sort deterministically.
    await new Promise((r) => setTimeout(r, 2));
    const b1 = await enqueueToOutbox(partyB, [stubAction()]);
    await new Promise((r) => setTimeout(r, 2));
    const a2 = await enqueueToOutbox(partyA, [stubAction()]);

    const rowsA = await listOutboxByParty(partyA);
    expect(rowsA.map((r) => r.id)).toEqual([a1, a2]);
    const rowsB = await listOutboxByParty(partyB);
    expect(rowsB.map((r) => r.id)).toEqual([b1]);
  });

  it('updateOutboxAttempt bumps attemptCount + lastAttemptAt', async () => {
    const id = await enqueueToOutbox(newUuidV7(), [stubAction()]);
    await updateOutboxAttempt(id);
    const row = await db.outbox.get(id);
    expect(row!.attemptCount).toBe(1);
    expect(row!.lastAttemptAt).toBeDefined();
    await updateOutboxAttempt(id);
    const row2 = await db.outbox.get(id);
    expect(row2!.attemptCount).toBe(2);
  });

  it('removeOutbox deletes the row', async () => {
    const id = await enqueueToOutbox(newUuidV7(), [stubAction()]);
    await removeOutbox(id);
    expect(await db.outbox.get(id)).toBeUndefined();
  });

  it('wipeAll clears the outbox too (Dexie-schema-v2 addition)', async () => {
    await enqueueToOutbox(newUuidV7(), [stubAction()]);
    await enqueueToOutbox(newUuidV7(), [stubAction()]);
    await wipeAll();
    expect(await db.outbox.count()).toBe(0);
  });
});
