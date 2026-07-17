/**
 * R11 — Turn-cycle logic for the initiative tracker (OUTLINE §2 amended
 * 2026-07-17). Pure functions over a combatant list + a cycle pointer.
 *
 * Encounter/combat state is transient table-side state — it lives OUTSIDE
 * the audit-logged `TransactionLog` model and is never persisted. These
 * helpers are the deterministic core the ephemeral encounter store calls.
 *
 * Tie rule (locked 2026-07-17): rows sharing an initiative value form one
 * group and take a **simultaneous** turn; sort is **stable** so insertion
 * order is preserved within a tie (the DM reorders manually if desired).
 * The pointer always references the *lead* member of the active group.
 */

import type { RollMode } from './dice';

export interface Combatant {
  id: string;
  name: string;
  kind: 'pc' | 'monster';
  /** Null until rolled (PCs) or entered. Null rows sort last. */
  initiative: number | null;
  modifier: number;
  rollMode: RollMode;
  /** Monster/NPC hit points. Always null for PC rows (players track own HP). */
  hp: number | null;
}

export interface CycleState {
  /** Lead id of the active distinct-initiative group, or null pre-start. */
  pointerId: string | null;
  round: number;
}

/**
 * Descending by initiative, nulls (unrolled) last. Stable on ties — the
 * input order is preserved for equal values. Does not mutate the input.
 */
export function sortByInitiative(list: readonly Combatant[]): Combatant[] {
  // Decorate-sort-undecorate keeps the sort stable across engines and
  // isolates the null-last rule from the numeric compare.
  return list
    .map((c, i) => ({ c, i }))
    .sort((x, y) => {
      const a = x.c.initiative;
      const b = y.c.initiative;
      if (a === null && b === null) return x.i - y.i;
      if (a === null) return 1;
      if (b === null) return -1;
      if (a !== b) return b - a;
      return x.i - y.i;
    })
    .map((d) => d.c);
}

/**
 * Split a *sorted* list into groups of consecutive rows that share an
 * initiative value. Null rows group together as the trailing group.
 */
export function distinctInitiativeGroups(sorted: readonly Combatant[]): Combatant[][] {
  const groups: Combatant[][] = [];
  for (const c of sorted) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last[0]!.initiative === c.initiative) {
      last.push(c);
    } else {
      groups.push([c]);
    }
  }
  return groups;
}

/** Index of the group whose lead id === pointerId, or -1 if not present. */
function activeGroupIndex(groups: Combatant[][], pointerId: string | null): number {
  if (pointerId === null) return -1;
  return groups.findIndex((g) => g.some((c) => c.id === pointerId));
}

/**
 * Advance the pointer to the next distinct-initiative group. Wraps to the
 * top and increments the round at cycle end. A null pointer starts at the
 * top without incrementing (fresh encounter). An empty order is a no-op.
 */
export function advanceTurn(order: readonly Combatant[], state: CycleState): CycleState {
  const sorted = sortByInitiative(order);
  const groups = distinctInitiativeGroups(sorted);
  if (groups.length === 0) return state;

  const leadOf = (i: number): string => groups[i]![0]!.id;

  if (state.pointerId === null) {
    return { pointerId: leadOf(0), round: state.round };
  }

  const current = activeGroupIndex(groups, state.pointerId);
  // Pointer's group vanished (e.g. row removed elsewhere) → restart at top,
  // no round bump.
  if (current === -1) {
    return { pointerId: leadOf(0), round: state.round };
  }

  const nextIndex = current + 1;
  if (nextIndex >= groups.length) {
    return { pointerId: leadOf(0), round: state.round + 1 };
  }
  return { pointerId: leadOf(nextIndex), round: state.round };
}

export interface RemoveResult {
  order: Combatant[];
  state: CycleState;
}

/**
 * Remove a combatant. If it was the current pointer (its group's lead),
 * the pointer advances to where the turn would next land — so removing the
 * active combatant never strands the highlight, and removing the last row
 * in the round wraps + bumps the round. Removing the only row nulls the
 * pointer.
 */
export function removeCombatant(
  order: readonly Combatant[],
  state: CycleState,
  id: string,
): RemoveResult {
  const removingCurrent = state.pointerId === id;
  const nextOrder = order.filter((c) => c.id !== id);

  if (nextOrder.length === 0) {
    return { order: nextOrder, state: { pointerId: null, round: state.round } };
  }

  if (!removingCurrent) {
    return { order: nextOrder, state };
  }

  // Removing the current combatant: compute where the turn advances to,
  // using the PRE-removal order so the round-wrap decision reflects the
  // combatant's original position in the cycle. Then confirm the target
  // still exists post-removal (it may have been the same id in a tie — but
  // a tie shares the lead only for one id, so the advanced target differs).
  const advanced = advanceTurn(order, state);
  const targetExists =
    advanced.pointerId !== null && nextOrder.some((c) => c.id === advanced.pointerId);
  if (targetExists) {
    return { order: nextOrder, state: advanced };
  }
  // Fallback: recompute against the trimmed order (advanced target was the
  // removed row itself — only possible when it was the sole group member).
  const restart = advanceTurn(nextOrder, { pointerId: null, round: advanced.round });
  return { order: nextOrder, state: restart };
}
