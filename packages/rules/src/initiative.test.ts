import { describe, expect, it } from 'vitest';

import {
  advanceTurn,
  distinctInitiativeGroups,
  removeCombatant,
  sortByInitiative,
  type Combatant,
  type CycleState,
} from './initiative';

/**
 * R11 — Turn-cycle logic for the initiative tracker.
 *
 * Pure functions over a combatant list + a cycle pointer. Encounter
 * state is transient table-side state (outside `TransactionLog`); these
 * are the deterministic core the ephemeral encounter store calls.
 *
 * Tie rule (locked 2026-07-17): stable insertion order on equal
 * initiative; tied rows form one group and take a simultaneous turn.
 */

function pc(id: string, initiative: number | null): Combatant {
  return { id, name: id, kind: 'pc', initiative, modifier: 0, rollMode: 'normal', hp: null };
}

function monster(id: string, initiative: number | null, hp: number | null = 10): Combatant {
  return { id, name: id, kind: 'monster', initiative, modifier: 0, rollMode: 'normal', hp };
}

describe('initiative.sortByInitiative', () => {
  it('orders descending by initiative', () => {
    const out = sortByInitiative([pc('a', 5), pc('b', 20), pc('c', 12)]);
    expect(out.map((c) => c.id)).toEqual(['b', 'c', 'a']);
  });

  it('places null (unrolled) rows last', () => {
    const out = sortByInitiative([pc('a', null), pc('b', 15), pc('c', null), pc('d', 3)]);
    expect(out.map((c) => c.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('is stable on ties — preserves insertion order', () => {
    const out = sortByInitiative([pc('a', 10), pc('b', 10), pc('c', 10)]);
    expect(out.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input array', () => {
    const input = [pc('a', 5), pc('b', 20)];
    const snapshot = input.map((c) => c.id);
    sortByInitiative(input);
    expect(input.map((c) => c.id)).toEqual(snapshot);
  });
});

describe('initiative.distinctInitiativeGroups', () => {
  it('groups rows sharing an initiative value (already sorted)', () => {
    const sorted = sortByInitiative([pc('a', 15), pc('b', 15), pc('c', 10)]);
    const groups = distinctInitiativeGroups(sorted);
    expect(groups.map((g) => g.map((c) => c.id))).toEqual([['a', 'b'], ['c']]);
  });

  it('null rows form their own trailing group', () => {
    const sorted = sortByInitiative([pc('a', 12), pc('b', null), pc('c', null)]);
    const groups = distinctInitiativeGroups(sorted);
    expect(groups.map((g) => g.map((c) => c.id))).toEqual([['a'], ['b', 'c']]);
  });
});

describe('initiative.advanceTurn', () => {
  const order = [pc('a', 20), pc('b', 15), pc('c', 15), pc('d', 10)];

  it('moves the pointer to the next distinct-initiative group', () => {
    const state: CycleState = { pointerId: 'a', round: 1 };
    const next = advanceTurn(order, state);
    // b + c share 15 → the group's lead id is the pointer; still round 1.
    expect(next.pointerId).toBe('b');
    expect(next.round).toBe(1);
  });

  it('treats a tied group as one turn — advancing from any tied member skips to the next value', () => {
    const state: CycleState = { pointerId: 'b', round: 1 };
    const next = advanceTurn(order, state);
    expect(next.pointerId).toBe('d');
    expect(next.round).toBe(1);
  });

  it('wraps to the top and increments the round at cycle end', () => {
    const state: CycleState = { pointerId: 'd', round: 1 };
    const next = advanceTurn(order, state);
    expect(next.pointerId).toBe('a');
    expect(next.round).toBe(2);
  });

  it('a null pointer (fresh encounter) starts at the top without incrementing round', () => {
    const state: CycleState = { pointerId: null, round: 1 };
    const next = advanceTurn(order, state);
    expect(next.pointerId).toBe('a');
    expect(next.round).toBe(1);
  });

  it('an empty order leaves the state untouched', () => {
    const state: CycleState = { pointerId: null, round: 1 };
    expect(advanceTurn([], state)).toEqual(state);
  });
});

describe('initiative.removeCombatant', () => {
  const order = [pc('a', 20), pc('b', 15), pc('c', 10)];

  it('removes a non-current row and keeps the pointer', () => {
    const result = removeCombatant(order, { pointerId: 'a', round: 1 }, 'c');
    expect(result.order.map((c) => c.id)).toEqual(['a', 'b']);
    expect(result.state.pointerId).toBe('a');
  });

  it('removing the current combatant advances the pointer to the next group', () => {
    const result = removeCombatant(order, { pointerId: 'b', round: 1 }, 'b');
    expect(result.order.map((c) => c.id)).toEqual(['a', 'c']);
    expect(result.state.pointerId).toBe('c');
  });

  it('removing the current last-in-round wraps the pointer to the top and bumps the round', () => {
    const result = removeCombatant(order, { pointerId: 'c', round: 1 }, 'c');
    expect(result.order.map((c) => c.id)).toEqual(['a', 'b']);
    expect(result.state.pointerId).toBe('a');
    expect(result.state.round).toBe(2);
  });

  it('removing the only combatant nulls the pointer', () => {
    const result = removeCombatant([pc('a', 5)], { pointerId: 'a', round: 1 }, 'a');
    expect(result.order).toEqual([]);
    expect(result.state.pointerId).toBeNull();
  });

  it('monsters carry an hp field that survives sorting/removal', () => {
    const list = [monster('m', 12, 25), pc('p', 8)];
    const sorted = sortByInitiative(list);
    const m = sorted.find((c) => c.id === 'm');
    expect(m?.hp).toBe(25);
    const result = removeCombatant(sorted, { pointerId: null, round: 1 }, 'p');
    expect(result.order.map((c) => c.id)).toEqual(['m']);
  });
});
