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

describe('transactionLogEntrySchema — edit-game-session-notes (R5.2)', () => {
  const uuid = '018f4d0a-4c1a-7fff-8000-000000000001';
  const gameSessionId = '018f4d0a-4c1a-7fff-8000-000000000002';

  function makeEditNotesEntry(oldNotes: string, newNotes: string) {
    return {
      id: 'log-1',
      partyId: 'party-1',
      sessionId: uuid,
      timestamp: '2026-07-04T00:00:00.000Z',
      actorUserId: 'user-1',
      actorRole: 'dm' as const,
      type: 'edit-game-session-notes' as const,
      payload: { gameSessionId, number: 3, oldNotes, newNotes },
    };
  }

  it('accepts a well-formed edit-game-session-notes entry', () => {
    const entry = makeEditNotesEntry('', 'Boss fight!');
    expect(() => transactionLogEntrySchema.parse(entry)).not.toThrow();
    const parsed = transactionLogEntrySchema.parse(entry);
    if (parsed.type !== 'edit-game-session-notes') throw new Error('narrow failed');
    expect(parsed.payload.oldNotes).toBe('');
    expect(parsed.payload.newNotes).toBe('Boss fight!');
    expect(parsed.payload.number).toBe(3);
  });

  it('accepts empty-string oldNotes AND newNotes (round-trip through no-op is impossible at reducer, but schema is permissive)', () => {
    const entry = makeEditNotesEntry('a', '');
    expect(() => transactionLogEntrySchema.parse(entry)).not.toThrow();
  });

  it('rejects non-positive number', () => {
    const entry = {
      ...makeEditNotesEntry('', 'x'),
      payload: { gameSessionId, number: 0, oldNotes: '', newNotes: 'x' },
    };
    expect(() => transactionLogEntrySchema.parse(entry)).toThrow();
  });

  it('rejects missing gameSessionId', () => {
    const entry = {
      ...makeEditNotesEntry('', 'x'),
      payload: { number: 3, oldNotes: '', newNotes: 'x' },
    };
    expect(() => transactionLogEntrySchema.parse(entry)).toThrow();
  });
});
