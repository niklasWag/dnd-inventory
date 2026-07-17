/**
 * R11 — Ephemeral encounter store for the initiative tracker (OUTLINE §2
 * amended 2026-07-17).
 *
 * This is a STANDALONE Zustand store, intentionally NOT part of the
 * persisted `useStore` (`store/index.ts`) and NOT wired to Dexie or the
 * debounced saver. Encounter/combat state is transient table-side state:
 * it lives outside `TransactionLog`, is never persisted, and resets on
 * reload — acceptable for a live-table tool per the R11 charter.
 *
 * All turn-order math + dice live in the pure `@app/rules` modules
 * (`initiative.ts`, `dice.ts`); this store is a thin, reactive shell.
 */
import { create } from 'zustand';

import { dice, initiative } from '@app/rules';
import type { Combatant, CycleState, RollMode } from '@app/rules';
import { newUuidV7 } from '@app/shared';
import type { Character } from '@app/shared';

interface EncounterState extends CycleState {
  combatants: Combatant[];
  /** Add one PC row per active party character (name auto-filled, manual
   * initiative — PCs roll at the table and tell the DM). Skips characters
   * already present. */
  addPartyMembers: (characters: readonly Character[]) => void;
  /** Add a blank monster/NPC row (DM fills name + modifier + rolls). */
  addMonster: () => void;
  /** Patch a single row's editable fields. */
  updateRow: (
    id: string,
    patch: Partial<Pick<Combatant, 'name' | 'modifier' | 'rollMode' | 'hp' | 'initiative'>>,
  ) => void;
  /** Roll one row's initiative (d20 per its mode + modifier). */
  rollRow: (id: string) => void;
  /** Roll every monster row + any PC row without a manual value. */
  rollAll: () => void;
  /** Move a row up/down among its ties (manual tie-break). */
  reorder: (id: string, dir: 'up' | 'down') => void;
  /** Re-sort the roster descending by initiative (nulls last). */
  sortNow: () => void;
  /** Advance the turn pointer to the next distinct-initiative group. */
  endTurn: () => void;
  /** Remove a row; adjusts the pointer if it was the current combatant. */
  removeRow: (id: string) => void;
  /** Reset the turn cycle to the start (pointer → null, round → 1) while
   * keeping the combatant roster + their rolled initiatives. */
  resetRounds: () => void;
  /** Clear the whole encounter (roster + cycle). */
  clear: () => void;
}

function blankMonster(): Combatant {
  return {
    id: newUuidV7(),
    name: '',
    kind: 'monster',
    initiative: null,
    modifier: 0,
    rollMode: 'normal',
    hp: null,
  };
}

function pcRow(character: Character): Combatant {
  return {
    id: newUuidV7(),
    name: character.name,
    kind: 'pc',
    initiative: null,
    modifier: 0,
    rollMode: 'normal',
    hp: null, // PCs track their own HP.
  };
}

export const useEncounterStore = create<EncounterState>()((set) => ({
  combatants: [],
  pointerId: null,
  round: 1,

  addPartyMembers: (characters) =>
    set((s) => {
      const present = new Set(s.combatants.map((c) => c.name));
      const additions = characters.filter((c) => !present.has(c.name)).map(pcRow);
      return { combatants: [...s.combatants, ...additions] };
    }),

  addMonster: () => set((s) => ({ combatants: [...s.combatants, blankMonster()] })),

  updateRow: (id, patch) =>
    set((s) => ({
      combatants: s.combatants.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    })),

  rollRow: (id) =>
    set((s) => ({
      combatants: s.combatants.map((c) =>
        c.id === id ? { ...c, initiative: dice.rollInitiative(c.modifier, c.rollMode) } : c,
      ),
    })),

  rollAll: () =>
    set((s) => ({
      combatants: s.combatants.map((c) => {
        // Monster rows always roll; PC rows only auto-roll when they have
        // no manually-entered value (leave DM-entered PC values untouched).
        const shouldRoll = c.kind === 'monster' || c.initiative === null;
        return shouldRoll ? { ...c, initiative: dice.rollInitiative(c.modifier, c.rollMode) } : c;
      }),
    })),

  reorder: (id, dir) =>
    set((s) => {
      const idx = s.combatants.findIndex((c) => c.id === id);
      if (idx === -1) return s;
      const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= s.combatants.length) return s;
      const next = [...s.combatants];
      const a = next[idx]!;
      const b = next[swapIdx]!;
      next[idx] = b;
      next[swapIdx] = a;
      return { combatants: next };
    }),

  sortNow: () => set((s) => ({ combatants: initiative.sortByInitiative(s.combatants) })),

  endTurn: () =>
    set((s) => {
      const next = initiative.advanceTurn(s.combatants, {
        pointerId: s.pointerId,
        round: s.round,
      });
      return { pointerId: next.pointerId, round: next.round };
    }),

  removeRow: (id) =>
    set((s) => {
      const result = initiative.removeCombatant(
        s.combatants,
        { pointerId: s.pointerId, round: s.round },
        id,
      );
      return {
        combatants: result.order,
        pointerId: result.state.pointerId,
        round: result.state.round,
      };
    }),

  resetRounds: () => set({ pointerId: null, round: 1 }),

  clear: () => set({ combatants: [], pointerId: null, round: 1 }),
}));

export type { Combatant, RollMode };
