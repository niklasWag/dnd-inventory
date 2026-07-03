import { describe, expect, it } from 'vitest';

import { transactionLogEntrySchema } from './transactionLog';

/**
 * RH3.1 — `TransactionLog.sessionId` widened from `z.null()` to
 * `z.string().uuid().nullable()`. Historical entries with `sessionId:
 * null` still parse (the "Untagged" bucket per OUTLINE §3.12); new
 * entries carry the active `GameSession.id`.
 */

function makeBaseEntry(sessionId: string | null) {
  return {
    id: 'log-1',
    partyId: 'party-1',
    sessionId,
    timestamp: '2026-07-03T00:00:00.000Z',
    actorUserId: 'user-1',
    actorRole: 'player' as const,
    type: 'acquire' as const,
    payload: {
      stashId: 'stash-1',
      itemInstanceId: 'item-1',
      definitionId: 'phb-2024:torch',
      quantity: 1,
      source: 'catalog-add' as const,
    },
  };
}

describe('transactionLogEntrySchema — sessionId widening (RH3.1)', () => {
  it('accepts sessionId: null (Untagged bucket)', () => {
    const entry = makeBaseEntry(null);
    expect(() => transactionLogEntrySchema.parse(entry)).not.toThrow();
    const parsed = transactionLogEntrySchema.parse(entry);
    expect(parsed.sessionId).toBeNull();
  });

  it('accepts sessionId: valid UUID', () => {
    const uuid = '018f4d0a-4c1a-7fff-8000-000000000001';
    const entry = makeBaseEntry(uuid);
    expect(() => transactionLogEntrySchema.parse(entry)).not.toThrow();
    const parsed = transactionLogEntrySchema.parse(entry);
    expect(parsed.sessionId).toBe(uuid);
  });

  it('rejects sessionId: non-UUID string', () => {
    const entry = makeBaseEntry('not-a-uuid');
    expect(() => transactionLogEntrySchema.parse(entry)).toThrow();
  });

  it('rejects sessionId: numeric value', () => {
    const entry = { ...makeBaseEntry(null), sessionId: 42 };
    expect(() => transactionLogEntrySchema.parse(entry)).toThrow();
  });
});
