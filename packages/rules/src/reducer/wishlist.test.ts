import { describe, expect, it } from 'vitest';
import { newUuidV7 } from '@app/shared';
import type { AppState, ItemDefinition } from '@app/shared';

import { reduce, type ReducerContext } from './index';

/**
 * R10.5 — item-wishlist reducer arms (`wishlist-add` / `wishlist-remove`).
 * Pure state + log-slice coverage (the server persistor + §8.1 guard have
 * their own tests). Bootstraps a party-of-one, then exercises catalog +
 * free-text entries, dedupe, and the error branches.
 */

const CTX_NOW = '2026-07-16T12:00:00.000Z';
const ctx: ReducerContext = {
  now: () => CTX_NOW,
  newInviteCode: () => 'INV-WISHLIST-TEST',
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

const SWORD: ItemDefinition = {
  id: 'def-flame-tongue',
  name: 'Flame Tongue',
  source: 'DMG',
  category: 'weapon',
  weight: 3,
  rarity: 'rare',
  requiresAttunement: true,
  tags: [],
};

/** Seed a catalog entry so `kind:'catalog'` wishlist adds can resolve it. */
function withCatalog(state: NonNullable<AppState>): NonNullable<AppState> {
  return { ...state, catalog: [...state.catalog, SWORD] };
}

function characterId(state: NonNullable<AppState>): string {
  return state.characters[0]!.id;
}

describe('reducer — wishlist-add (R10.5)', () => {
  it('appends a catalog entry and logs with the item name as label', () => {
    const state = withCatalog(bootstrap());
    const cid = characterId(state);
    const entryId = newUuidV7();
    const result = reduce(
      state,
      {
        type: 'wishlist-add',
        payload: {
          characterId: cid,
          entry: { id: entryId, kind: 'catalog', definitionId: SWORD.id },
        },
      },
      ctx,
    );
    const ch = result.state!.characters.find((c) => c.id === cid)!;
    expect(ch.wishlist).toEqual([{ id: entryId, kind: 'catalog', definitionId: SWORD.id }]);
    expect(result.logEntries).toEqual([
      {
        type: 'wishlist-add',
        payload: { characterId: cid, entryId, kind: 'catalog', label: 'Flame Tongue' },
      },
    ]);
  });

  it('appends a free-text entry and logs the text as label', () => {
    const state = bootstrap();
    const cid = characterId(state);
    const entryId = newUuidV7();
    const result = reduce(
      state,
      {
        type: 'wishlist-add',
        payload: {
          characterId: cid,
          entry: { id: entryId, kind: 'text', text: 'a flaming sword' },
        },
      },
      ctx,
    );
    const ch = result.state!.characters.find((c) => c.id === cid)!;
    expect(ch.wishlist).toEqual([{ id: entryId, kind: 'text', text: 'a flaming sword' }]);
    expect(result.logEntries[0]).toEqual({
      type: 'wishlist-add',
      payload: { characterId: cid, entryId, kind: 'text', label: 'a flaming sword' },
    });
  });

  it('rejects an unknown characterId', () => {
    const state = bootstrap();
    expect(() =>
      reduce(
        state,
        {
          type: 'wishlist-add',
          payload: { characterId: 'nope', entry: { id: newUuidV7(), kind: 'text', text: 'x' } },
        },
        ctx,
      ),
    ).toThrow(/unknown characterId/);
  });

  it('rejects a duplicate entry id', () => {
    const state = bootstrap();
    const cid = characterId(state);
    const entryId = newUuidV7();
    const once = reduce(
      state,
      {
        type: 'wishlist-add',
        payload: { characterId: cid, entry: { id: entryId, kind: 'text', text: 'x' } },
      },
      ctx,
    );
    expect(() =>
      reduce(
        once.state,
        {
          type: 'wishlist-add',
          payload: { characterId: cid, entry: { id: entryId, kind: 'text', text: 'y' } },
        },
        ctx,
      ),
    ).toThrow(/duplicate entry id/);
  });

  it('rejects a catalog entry whose definitionId is not in the catalog', () => {
    const state = bootstrap(); // empty catalog
    const cid = characterId(state);
    expect(() =>
      reduce(
        state,
        {
          type: 'wishlist-add',
          payload: {
            characterId: cid,
            entry: { id: newUuidV7(), kind: 'catalog', definitionId: 'ghost' },
          },
        },
        ctx,
      ),
    ).toThrow(/unknown definitionId/);
  });
});

describe('reducer — wishlist-remove (R10.5)', () => {
  it('removes an entry by id and logs it', () => {
    const state = bootstrap();
    const cid = characterId(state);
    const entryId = newUuidV7();
    const added = reduce(
      state,
      {
        type: 'wishlist-add',
        payload: { characterId: cid, entry: { id: entryId, kind: 'text', text: 'x' } },
      },
      ctx,
    );
    const removed = reduce(
      added.state,
      { type: 'wishlist-remove', payload: { characterId: cid, entryId } },
      ctx,
    );
    const ch = removed.state!.characters.find((c) => c.id === cid)!;
    expect(ch.wishlist).toEqual([]);
    expect(removed.logEntries).toEqual([
      { type: 'wishlist-remove', payload: { characterId: cid, entryId } },
    ]);
  });

  it('rejects removing an entry that is not present', () => {
    const state = bootstrap();
    const cid = characterId(state);
    expect(() =>
      reduce(
        state,
        { type: 'wishlist-remove', payload: { characterId: cid, entryId: 'nope' } },
        ctx,
      ),
    ).toThrow(/not in wishlist/);
  });
});
