import { describe, expect, it } from 'vitest';

import { actionSchema, type Action } from './action';

/**
 * R3.4.a — wire-validation smoke tests. One representative payload per
 * discriminator. The reducer's TS-side `Action` type is cross-checked
 * against this Zod schema in `packages/rules/src/reducer/types.drift.test.ts`
 * (lives on the rules side because `@app/shared` cannot depend on
 * `@app/rules` without creating a cycle).
 *
 * The point of the smoke tests below isn't field-level validation
 * (those live wherever the field shapes are tested); it's to assert
 * every discriminator is reachable through `actionSchema.parse` so the
 * server sync dispatcher never silently swallows a variant. If you
 * remove a variant from the discriminated union, the corresponding
 * sample below turns into a TS compile error.
 */
const samples: Action[] = [
  {
    type: 'create-character',
    payload: { name: 'A', species: 'Human', size: 'medium', class: 'Fighter', level: 1, str: 16 },
  },
  {
    type: 'acquire',
    payload: { stashId: 's', definitionId: 'phb-2024:rope', quantity: 1, source: 'catalog-add' },
  },
  { type: 'consume', payload: { itemInstanceId: 'i', quantity: 1 } },
  { type: 'seed-catalog', payload: { seedVersion: 1, entries: [] } },
  { type: 'edit-item-instance', payload: { itemInstanceId: 'i', patch: { notes: 'n' } } },
  { type: 'create-stash', payload: { ownerCharacterId: 'c', name: 'Backpack' } },
  { type: 'rename-stash', payload: { stashId: 's', newName: 'New' } },
  { type: 'delete-stash', payload: { stashId: 's' } },
  {
    type: 'currency-change',
    payload: { stashId: 's', delta: { cp: 0, sp: 0, ep: 0, gp: 1, pp: 0 }, reason: 'deposit' },
  },
  { type: 'transfer', payload: { itemInstanceId: 'i', toStashId: 's', quantity: 1 } },
  { type: 'split', payload: { itemInstanceId: 'i', quantity: 1 } },
  {
    type: 'currency-transfer',
    payload: { fromStashId: 'a', toStashId: 'b', delta: { cp: 0, sp: 0, ep: 0, gp: 1, pp: 0 } },
  },
  { type: 'create-homebrew', payload: { name: 'Magic Sword', category: 'magic' } },
  { type: 'edit-homebrew', payload: { definitionId: 'd', patch: { name: 'X' } } },
  { type: 'delete-homebrew', payload: { definitionId: 'd' } },
  { type: 'rename-character', payload: { characterId: 'c', newName: 'Z' } },
  { type: 'rename-party', payload: { partyId: 'p', newName: 'Z' } },
  { type: 'set-encumbrance', payload: { characterId: 'c', rule: 'phb', enforce: true } },
  { type: 'equip', payload: { itemInstanceId: 'i', characterId: 'c' } },
  { type: 'unequip', payload: { itemInstanceId: 'i', characterId: 'c' } },
  { type: 'attune', payload: { itemInstanceId: 'i', characterId: 'c' } },
  { type: 'unattune', payload: { itemInstanceId: 'i', characterId: 'c' } },
  { type: 'use-charge', payload: { itemInstanceId: 'i', characterId: 'c' } },
  { type: 'recharge', payload: { mode: 'single', itemInstanceId: 'i', characterId: 'c' } },
  { type: 'recharge', payload: { mode: 'batch', characterId: 'c', trigger: 'long-rest' } },
  { type: 'identify', payload: { itemInstanceId: 'i', identified: true } },
  { type: 'edit-character', payload: { characterId: 'c', patch: { level: 5 } } },
];

describe('actionSchema', () => {
  it('parses one sample per variant (every discriminator reachable)', () => {
    for (const sample of samples) {
      expect(() => actionSchema.parse(sample)).not.toThrow();
    }
  });

  it('rejects an unknown type', () => {
    expect(() => actionSchema.parse({ type: 'made-up', payload: {} })).toThrow();
  });

  it('rejects a known type with the wrong payload shape', () => {
    expect(() =>
      actionSchema.parse({
        type: 'acquire',
        payload: { stashId: 's', definitionId: 'd', quantity: 1 /* missing source */ },
      }),
    ).toThrow();
  });

  it('rejects an empty string where a non-empty string is required', () => {
    expect(() =>
      actionSchema.parse({
        type: 'consume',
        payload: { itemInstanceId: '', quantity: 1 },
      }),
    ).toThrow();
  });
});
