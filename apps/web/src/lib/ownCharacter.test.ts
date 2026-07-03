import { describe, it, expect } from 'vitest';

import { getOwnCharacter } from './ownCharacter';
import type { AppState } from '@app/rules';

function makeAppState(opts: {
  actorUserId: string;
  memberships: Array<{
    userId: string;
    role: 'dm' | 'player';
    characterId: string | null;
    leftAt?: string | null;
  }>;
  characterIds: string[];
}): NonNullable<AppState> {
  const { actorUserId, memberships, characterIds } = opts;
  return {
    version: 1,
    seedVersion: 0,
    user: {
      id: actorUserId,
      discordId: actorUserId,
      displayName: 'X',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    party: {
      id: 'p1',
      name: 'P',
      ownerUserId: actorUserId,
      inviteCode: 'INV-XXXXXX',
      recoveredLootStashId: 'rl',
      bankerUserId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    memberships: memberships.map((m) => ({
      userId: m.userId,
      partyId: 'p1',
      role: m.role,
      characterId: m.characterId,
      joinedAt: '2026-01-01T00:00:00.000Z',
      leftAt: m.leftAt ?? null,
    })),
    characters: characterIds.map((id) => ({
      id,
      partyId: 'p1',
      ownerUserId: 'dont-care',
      name: id,
      species: 'Human',
      size: 'medium' as const,
      class: 'Fighter',
      level: 1,
      abilityScores: { STR: 10 },
      maxAttunement: 3,
      encumbranceRule: 'off' as const,
      enforceEncumbrance: false,
      inventoryStashId: `inv-${id}`,
    })),
    gameSessions: [],
    stashes: [],
    catalog: [],
    items: [],
    currencies: [],
    log: [],
  };
}

describe('getOwnCharacter', () => {
  it('returns null when appState is null', () => {
    expect(getOwnCharacter(null)).toBeNull();
  });

  it("returns the actor's character via their player membership", () => {
    const state = makeAppState({
      actorUserId: 'u1',
      memberships: [
        { userId: 'u1', role: 'dm', characterId: null },
        { userId: 'u1', role: 'player', characterId: 'char-u1' },
      ],
      characterIds: ['char-u1'],
    });
    const result = getOwnCharacter(state);
    expect(result).not.toBeNull();
    expect(result!.id).toBe('char-u1');
  });

  it('returns null when the actor has a player row with characterId: null (joiner pre-create)', () => {
    const state = makeAppState({
      actorUserId: 'u2',
      memberships: [
        { userId: 'u1', role: 'dm', characterId: null },
        { userId: 'u1', role: 'player', characterId: 'char-u1' },
        { userId: 'u2', role: 'player', characterId: null },
      ],
      characterIds: ['char-u1'],
    });
    // characters[0] exists (char-u1) but it isn't the actor's.
    expect(state.characters).toHaveLength(1);
    expect(getOwnCharacter(state)).toBeNull();
  });

  it('returns null when the actor has only a dm row (DM-only DM)', () => {
    const state = makeAppState({
      actorUserId: 'dm',
      memberships: [{ userId: 'dm', role: 'dm', characterId: null }],
      characterIds: [],
    });
    expect(getOwnCharacter(state)).toBeNull();
  });

  it('skips a left player membership (leftAt set)', () => {
    const state = makeAppState({
      actorUserId: 'u1',
      memberships: [
        { userId: 'u1', role: 'dm', characterId: null },
        {
          userId: 'u1',
          role: 'player',
          characterId: 'char-u1',
          leftAt: '2026-06-30T00:00:00.000Z',
        },
      ],
      characterIds: ['char-u1'],
    });
    expect(getOwnCharacter(state)).toBeNull();
  });

  it("returns the actor's own character even when another player's character is first in the array", () => {
    const state = makeAppState({
      actorUserId: 'u2',
      memberships: [
        { userId: 'u1', role: 'dm', characterId: null },
        { userId: 'u1', role: 'player', characterId: 'char-u1' },
        { userId: 'u2', role: 'player', characterId: 'char-u2' },
      ],
      // char-u1 is at index 0 — the bug we're guarding against is
      // picking it for u2.
      characterIds: ['char-u1', 'char-u2'],
    });
    const result = getOwnCharacter(state);
    expect(result!.id).toBe('char-u2');
  });
});
