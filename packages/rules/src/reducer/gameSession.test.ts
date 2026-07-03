import { describe, expect, it } from 'vitest';
import { newUuidV7 } from '@app/shared';
import type { AppState } from '@app/shared';

import { reduce, type ReducerContext } from './index';

/**
 * RH3.1 — GameSession reducer arms (`start-game-session` /
 * `end-game-session`).
 *
 * Tests the reducer surface only. Middleware stamping of
 * `TransactionLogEntry.sessionId` (via `currentGameSessionId`) is
 * verified in `apps/web/src/store/log-authority.test.ts`; this file
 * covers state mutations + slice emission.
 */

const CTX_NOW = '2026-07-03T12:34:56.000Z';
const CTX_DATE = '2026-07-03';

const ctx: ReducerContext = {
  now: () => CTX_NOW,
  newInviteCode: () => 'INV-GAME-SESSION-TEST',
};

function bootstrap(): NonNullable<AppState> {
  const result = reduce(
    null,
    {
      type: 'create-character',
      payload: {
        name: 'Alice',
        species: 'Human',
        size: 'medium',
        class: 'Wizard',
        level: 1,
        str: 10,
        newUserId: newUuidV7(),
        newPartyId: newUuidV7(),
        newPartyStashId: newUuidV7(),
        newRecoveredLootStashId: newUuidV7(),
        newPartyStashCurrencyId: newUuidV7(),
        newRecoveredLootCurrencyId: newUuidV7(),
        newCharacterId: newUuidV7(),
        newInventoryStashId: newUuidV7(),
        newCurrencyHoldingId: newUuidV7(),
      },
    },
    ctx,
  );
  return result.state as NonNullable<AppState>;
}

describe('reducer — start-game-session (RH3.1)', () => {
  it('appends a GameSession with number=1 + isCurrent=true when none prior exist', () => {
    const state = bootstrap();
    const newGameSessionId = newUuidV7();

    const result = reduce(
      state,
      { type: 'start-game-session', payload: { newGameSessionId } },
      ctx,
    );

    const next = result.state as NonNullable<AppState>;
    expect(next.gameSessions).toHaveLength(1);
    const session = next.gameSessions[0]!;
    expect(session.id).toBe(newGameSessionId);
    expect(session.partyId).toBe(next.party.id);
    expect(session.number).toBe(1);
    expect(session.date).toBe(CTX_DATE);
    expect(session.isCurrent).toBe(true);
    expect(session.createdAt).toBe(CTX_NOW);

    expect(result.logEntries).toHaveLength(1);
    const slice = result.logEntries[0]!;
    expect(slice.type).toBe('start-game-session');
    expect(slice.payload).toEqual({
      gameSessionId: newGameSessionId,
      number: 1,
      date: CTX_DATE,
    });
  });

  it('rejects when a session is already current and endCurrentFirst is not set', () => {
    const state = bootstrap();
    const first = newUuidV7();
    const afterFirst = reduce(
      state,
      { type: 'start-game-session', payload: { newGameSessionId: first } },
      ctx,
    );

    expect(() =>
      reduce(
        afterFirst.state,
        { type: 'start-game-session', payload: { newGameSessionId: newUuidV7() } },
        ctx,
      ),
    ).toThrow(/session_already_current/);
  });

  it('endCurrentFirst demotes the prior session + emits synthetic end-game-session slice', () => {
    const state = bootstrap();
    const first = newUuidV7();
    const afterFirst = reduce(
      state,
      { type: 'start-game-session', payload: { newGameSessionId: first } },
      ctx,
    );

    const second = newUuidV7();
    const result = reduce(
      afterFirst.state,
      {
        type: 'start-game-session',
        payload: { newGameSessionId: second, endCurrentFirst: true },
      },
      ctx,
    );

    const next = result.state as NonNullable<AppState>;
    expect(next.gameSessions).toHaveLength(2);
    const priorSession = next.gameSessions.find((s) => s.id === first)!;
    const newSession = next.gameSessions.find((s) => s.id === second)!;
    expect(priorSession.isCurrent).toBe(false);
    expect(priorSession.number).toBe(1);
    expect(newSession.isCurrent).toBe(true);
    expect(newSession.number).toBe(2);

    expect(result.logEntries).toHaveLength(2);
    expect(result.logEntries[0]!.type).toBe('end-game-session');
    expect(result.logEntries[0]!.payload).toEqual({
      gameSessionId: first,
      number: 1,
    });
    expect(result.logEntries[1]!.type).toBe('start-game-session');
    expect(result.logEntries[1]!.payload).toEqual({
      gameSessionId: second,
      number: 2,
      date: CTX_DATE,
    });
  });

  it('rejects when state is null (no bootstrap-via-session)', () => {
    expect(() =>
      reduce(null, { type: 'start-game-session', payload: { newGameSessionId: newUuidV7() } }, ctx),
    ).toThrow(/start-game-session/);
  });

  it('accepts an explicit date payload', () => {
    const state = bootstrap();
    const result = reduce(
      state,
      {
        type: 'start-game-session',
        payload: { newGameSessionId: newUuidV7(), date: '2026-01-15' },
      },
      ctx,
    );
    const next = result.state as NonNullable<AppState>;
    expect(next.gameSessions[0]!.date).toBe('2026-01-15');
  });
});

describe('reducer — end-game-session (RH3.1)', () => {
  it('flips isCurrent to false + emits a single end-game-session slice', () => {
    const state = bootstrap();
    const gameSessionId = newUuidV7();
    const afterStart = reduce(
      state,
      { type: 'start-game-session', payload: { newGameSessionId: gameSessionId } },
      ctx,
    );

    const result = reduce(afterStart.state, { type: 'end-game-session', payload: {} }, ctx);
    const next = result.state as NonNullable<AppState>;
    expect(next.gameSessions).toHaveLength(1);
    expect(next.gameSessions[0]!.isCurrent).toBe(false);

    expect(result.logEntries).toHaveLength(1);
    expect(result.logEntries[0]!.type).toBe('end-game-session');
    expect(result.logEntries[0]!.payload).toEqual({
      gameSessionId,
      number: 1,
    });
  });

  it('rejects when no session is current', () => {
    const state = bootstrap();
    expect(() => reduce(state, { type: 'end-game-session', payload: {} }, ctx)).toThrow(
      /no_current_session/,
    );
  });
});
