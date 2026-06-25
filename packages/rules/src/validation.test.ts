import { describe, expect, it } from 'vitest';

import * as validation from './validation';

/**
 * Equip slot conflicts (OUTLINE §6 — `validation.ts`).
 *
 * MVP `ItemDefinition` (R1.2 vintage) has no `properties.twoHanded` /
 * `properties.shield` fields — those land with R2 (DMG / weapon properties).
 * The rule therefore takes a properties-lookup map as a parameter so it
 * stays pure and the caller supplies whatever shape they have. Once R2
 * adds the schema fields, callers will derive the map from
 * `ItemDefinition.properties`.
 *
 * The only conflict R1.2 ships is "two-handed weapon + shield" (PHB 2024
 * weapon properties). R2.x will widen with armor-on-armor, etc.
 */

describe('rules.validation.validateEquip (R1.2)', () => {
  const properties = new Map<string, { twoHanded?: boolean; shield?: boolean }>([
    ['longsword', {}],
    ['greatsword', { twoHanded: true }],
    ['greataxe', { twoHanded: true }],
    ['shield', { shield: true }],
  ]);

  it('returns no issues for a lone one-handed weapon equip', () => {
    expect(validation.validateEquip('longsword', [], properties)).toEqual([]);
  });

  it('returns no issues for shield without any two-handed weapon', () => {
    expect(validation.validateEquip('shield', ['longsword'], properties)).toEqual([]);
  });

  it('flags equipping a two-handed weapon while a shield is already equipped', () => {
    const issues = validation.validateEquip('greatsword', ['shield'], properties);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('two-handed-shield-conflict');
  });

  it('flags equipping a shield while a two-handed weapon is already equipped', () => {
    const issues = validation.validateEquip('shield', ['greataxe'], properties);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe('two-handed-shield-conflict');
  });

  it('returns no issues when the new item lookup misses (unknown id treated as no properties)', () => {
    expect(validation.validateEquip('unknown', ['shield'], properties)).toEqual([]);
  });

  it('ignores already-equipped ids with no properties entry', () => {
    expect(validation.validateEquip('greatsword', ['unknown'], properties)).toEqual([]);
  });
});
