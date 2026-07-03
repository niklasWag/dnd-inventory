import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { newUuidV7 } from '@app/shared';
import type { AppState, ItemInstance } from '@app/shared';

import { reduce, type ReducerContext } from './index';

/**
 * RH2.2 — reducer cascade determinism (property-based).
 *
 * Both `deleteStash` (`index.ts:~1195`) and `cascadeCharacterToRecoveredLoot`
 * (`index.ts:~2944`) filter `s.items` and emit N `transfer` log slices in
 * one `.map`. Before RH2.2 the slice order tracked `s.items` insertion order,
 * which is a function of dispatch history — non-deterministic across two
 * clients whose histories diverged. RH2.2 inserts a `.sort(byId)` at both
 * sites so the emitted sequence is a pure function of `(items, cascade-arm)`.
 *
 * This test proves the property by permuting `s.items` and asserting the
 * emitted `transfer` slice sequence is invariant. If either sort is removed
 * the test fails with a counterexample listing the shuffled input and the
 * emitted (non-sorted) output.
 *
 * Scoped to `s.items` only per the RH2.2 plan — currency and stash slice
 * order is already deterministic (single emit per cascade); `s.stashes`
 * ordering doesn't feed the log fan-out.
 */

const ctx: ReducerContext = {
  now: () => '2026-07-03T00:00:00.000Z',
  newInviteCode: () => 'INV-DETERMINISM-TEST',
};

/**
 * Bootstrap a valid AppState via `create-character` + `create-stash`
 * (both real reducer paths — no hand-crafted Zod bypass) ONCE. Return
 * a helper that stamps an item list into the same base state so
 * property runs share every id EXCEPT the items being permuted.
 */
function makeBaseFixture(): {
  base: NonNullable<AppState>;
  storageStashId: string;
  characterId: string;
} {
  const bootstrap = reduce(
    null,
    {
      type: 'create-character',
      payload: {
        name: 'Tester',
        species: 'Human',
        size: 'medium',
        class: 'Fighter',
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
  const bootstrapped = bootstrap.state as NonNullable<AppState>;
  const characterId = bootstrapped.characters[0]!.id;

  // Add a Storage stash so we have a deletable target (Inventory /
  // Party Stash / Recovered Loot are guarded).
  const withStorage = reduce(
    bootstrapped,
    {
      type: 'create-stash',
      payload: {
        ownerCharacterId: characterId,
        name: 'Chest',
        newStashId: newUuidV7(),
        newCurrencyHoldingId: newUuidV7(),
      },
    },
    ctx,
  );
  const base = withStorage.state as NonNullable<AppState>;
  const storageStashId = base.stashes.at(-1)!.id;

  return { base, storageStashId, characterId };
}

/**
 * Stamp `itemIds` into the given base state as `ItemInstance` rows
 * owned by `storageStashId`. Direct assignment is safe because the
 * reducer never observes the intermediate state and both cascade sites
 * read `s.items` verbatim.
 */
function withItems(
  base: NonNullable<AppState>,
  storageStashId: string,
  itemIds: readonly string[],
): NonNullable<AppState> {
  const items: ItemInstance[] = itemIds.map((id) => ({
    id,
    definitionId: 'phb-2024:torch',
    ownerType: 'stash',
    ownerId: storageStashId,
    containerInstanceId: null,
    quantity: 1,
    equipped: false,
    attuned: false,
    identified: true,
    currentCharges: null,
  }));
  return { ...base, items };
}

/**
 * Extract the `itemInstanceId` sequence from a cascade result's
 * `transfer` log slices, in emit order.
 */
function transferSequence(result: ReturnType<typeof reduce>): string[] {
  return result.logEntries
    .filter((e) => e.type === 'transfer')
    .map((e) => {
      if (e.type !== 'transfer') throw new Error('unreachable');
      return e.payload.itemInstanceId;
    });
}

describe('RH2.2 — cascade log-slice determinism', () => {
  it('delete-stash: transfer slices are emitted in id-sorted order regardless of s.items insertion order', () => {
    const { base, storageStashId } = makeBaseFixture();
    const itemIds = Array.from({ length: 5 }, () => newUuidV7());
    const referenceOrder = [...itemIds].sort((a, b) => a.localeCompare(b));

    fc.assert(
      fc.property(fc.shuffledSubarray(itemIds, { minLength: itemIds.length }), (shuffled) => {
        const state = withItems(base, storageStashId, shuffled);
        const result = reduce(
          state,
          { type: 'delete-stash', payload: { stashId: storageStashId } },
          ctx,
        );
        expect(transferSequence(result)).toEqual(referenceOrder);
      }),
      { numRuns: 50 },
    );
  });

  it('delete-character: transfer slices are emitted in id-sorted order regardless of s.items insertion order', () => {
    const { base, storageStashId, characterId } = makeBaseFixture();
    const itemIds = Array.from({ length: 5 }, () => newUuidV7());
    const referenceOrder = [...itemIds].sort((a, b) => a.localeCompare(b));

    fc.assert(
      fc.property(fc.shuffledSubarray(itemIds, { minLength: itemIds.length }), (shuffled) => {
        const state = withItems(base, storageStashId, shuffled);
        const result = reduce(state, { type: 'delete-character', payload: { characterId } }, ctx);
        expect(transferSequence(result)).toEqual(referenceOrder);
      }),
      { numRuns: 50 },
    );
  });

  it('post-cascade state is identical across permutations of s.items (delete-stash)', () => {
    const { base, storageStashId } = makeBaseFixture();
    const itemIds = Array.from({ length: 5 }, () => newUuidV7());
    let reference: NonNullable<AppState> | undefined;

    fc.assert(
      fc.property(fc.shuffledSubarray(itemIds, { minLength: itemIds.length }), (shuffled) => {
        const state = withItems(base, storageStashId, shuffled);
        const result = reduce(
          state,
          { type: 'delete-stash', payload: { stashId: storageStashId } },
          ctx,
        );
        const nextState = result.state as NonNullable<AppState>;
        // Normalise `items` order for comparison — state-shape equality
        // isn't order-dependent, only the log-slice fan-out is.
        const normalised = {
          ...nextState,
          items: [...nextState.items].sort((a, b) => a.id.localeCompare(b.id)),
        };
        if (reference === undefined) {
          reference = normalised;
        } else {
          expect(normalised).toEqual(reference);
        }
      }),
      { numRuns: 25 },
    );
  });
});
