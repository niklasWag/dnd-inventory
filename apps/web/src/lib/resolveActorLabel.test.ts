import { describe, expect, it } from 'vitest';

import type { AppState } from '@app/shared';

import { resolveActorLabel } from './resolveActorLabel';

const BASE_TS = '2026-07-04T10:00:00.000Z';

function makeState(): AppState {
  return {
    version: 1,
    seedVersion: 0,
    user: { id: 'me', discordId: 'me', displayName: 'Me the DM', createdAt: BASE_TS },
    party: {
      id: 'p1',
      name: 'P',
      ownerUserId: 'me',
      inviteCode: 'INV-ABCDEF',
      recoveredLootStashId: 'rl',
      bankerUserId: null,
      createdAt: BASE_TS,
    },
    memberships: [],
    characters: [
      {
        id: 'char-a',
        partyId: 'p1',
        ownerUserId: 'u-player-a',
        name: 'Aeryn',
        species: 'Human',
        size: 'medium',
        class: 'Fighter',
        level: 1,
        abilityScores: { STR: 16 },
        maxAttunement: 3,
        encumbranceRule: 'off',
        enforceEncumbrance: false,
        inventoryStashId: 'inv-a',
      },
    ],
    gameSessions: [],
    stashes: [],
    catalog: [],
    items: [],
    currencies: [],
    log: [],
  };
}

describe('resolveActorLabel', () => {
  const state = makeState();

  it('current user with a character resolves to character name (BUG-010 uniformity)', () => {
    // Add a character owned by `me` so the character-first rule fires.
    const stateWithMyChar: AppState = {
      ...state,
      characters: [
        ...state.characters,
        {
          id: 'char-me',
          partyId: 'p1',
          ownerUserId: 'me',
          name: 'My Wizard',
          species: 'Human',
          size: 'medium',
          class: 'Wizard',
          level: 1,
          abilityScores: { STR: 10 },
          maxAttunement: 3,
          encumbranceRule: 'off',
          enforceEncumbrance: false,
          inventoryStashId: 'inv-me',
        },
      ],
    };
    expect(resolveActorLabel('me', stateWithMyChar)).toBe('My Wizard');
  });

  it('current user without a character resolves to displayName', () => {
    // No character owned by `me` in makeState(); falls through to
    // displayName.
    expect(resolveActorLabel('me', state)).toBe('Me the DM');
  });

  it('returns character name for a party player (other user with a character)', () => {
    expect(resolveActorLabel('u-player-a', state)).toBe('Aeryn');
  });

  it('falls back to short-uuid prefix', () => {
    expect(resolveActorLabel('01000000-abcd-7000-8000-000000000000', state)).toBe('01000000');
  });
});
