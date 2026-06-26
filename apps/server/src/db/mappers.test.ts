import { describe, it, expect } from 'vitest';

import type { ItemDefinition } from '@app/shared';

import {
  fromDbRarity,
  fromDbRechargeRule,
  fromDbStashScope,
  fromPrismaItemDefinition,
  toDbRarity,
  toDbRechargeRule,
  toDbStashScope,
  toPrismaItemDefinition,
  type ItemDefinitionRow,
} from './mappers.js';

describe('mappers: enum round-trip (Zod kebab-case ↔ Prisma underscore)', () => {
  it('Rarity — every value survives a round trip', () => {
    const values = ['common', 'uncommon', 'rare', 'very-rare', 'legendary', 'artifact'] as const;
    for (const v of values) {
      expect(fromDbRarity(toDbRarity(v))).toBe(v);
    }
  });

  it('ChargesRechargeRule — every value survives a round trip', () => {
    const values = ['dawn', 'dusk', 'long-rest', 'short-rest', 'custom', 'none'] as const;
    for (const v of values) {
      expect(fromDbRechargeRule(toDbRechargeRule(v))).toBe(v);
    }
  });

  it('StashScope — every value survives a round trip', () => {
    const values = ['character', 'party', 'recovered-loot'] as const;
    for (const v of values) {
      expect(fromDbStashScope(toDbStashScope(v))).toBe(v);
    }
  });
});

describe('mappers: ItemDefinition (R3.1)', () => {
  it('flattens cost block to costAmount + costCurrency on write', () => {
    const def: ItemDefinition = {
      id: 'phb-2024:rope',
      name: 'Rope',
      source: 'PHB',
      category: 'gear',
      cost: { amount: 1, currency: 'gp' },
    };
    const row = toPrismaItemDefinition(def);
    expect(row.costAmount).toBe(1);
    expect(row.costCurrency).toBe('gp');
  });

  it('unflattens cost block on read', () => {
    const row: ItemDefinitionRow = {
      id: 'phb-2024:rope',
      name: 'Rope',
      source: 'PHB',
      category: 'gear',
      weight: null,
      flatWeight: null,
      costAmount: 1,
      costCurrency: 'gp',
      description: null,
      tags: [],
      rarity: null,
      requiresAttunement: null,
      attunementPrereq: null,
      chargesMax: null,
      chargesRechargeRule: null,
      chargesRechargeAmount: null,
      duplicatedFromId: null,
      createdBy: null,
      partyId: null,
    };
    const def = fromPrismaItemDefinition(row);
    expect(def.cost).toEqual({ amount: 1, currency: 'gp' });
  });

  it('flattens charges block to chargesMax / chargesRechargeRule / chargesRechargeAmount', () => {
    const def: ItemDefinition = {
      id: 'dmg-2024:wand-of-magic-missiles',
      name: 'Wand of Magic Missiles',
      source: 'DMG',
      category: 'magic',
      rarity: 'uncommon',
      charges: { max: 7, rechargeRule: 'dawn', rechargeAmount: '1d6+1' },
    };
    const row = toPrismaItemDefinition(def);
    expect(row.chargesMax).toBe(7);
    expect(row.chargesRechargeRule).toBe('dawn');
    expect(row.chargesRechargeAmount).toBe('1d6+1');
    expect(row.rarity).toBe('uncommon');
  });

  it('maps the hyphenated rarity through to the DB underscore form', () => {
    const def: ItemDefinition = {
      id: 'dmg-2024:cloak-of-protection',
      name: 'Cloak of Protection',
      source: 'DMG',
      category: 'magic',
      rarity: 'very-rare',
    };
    const row = toPrismaItemDefinition(def);
    expect(row.rarity).toBe('very_rare');
  });

  it('maps hyphenated rechargeRule to underscore form', () => {
    const def: ItemDefinition = {
      id: 'dmg-2024:staff-of-power',
      name: 'Staff of Power',
      source: 'DMG',
      category: 'magic',
      rarity: 'very-rare',
      charges: { max: 20, rechargeRule: 'long-rest' },
    };
    const row = toPrismaItemDefinition(def);
    expect(row.chargesRechargeRule).toBe('long_rest');
  });

  it('round-trips a minimal PHB row (no optional fields)', () => {
    const def: ItemDefinition = {
      id: 'phb-2024:torch',
      name: 'Torch',
      source: 'PHB',
      category: 'gear',
    };
    const row = toPrismaItemDefinition(def);
    // simulate DB nulls for fields not set
    const dbRow: ItemDefinitionRow = {
      ...row,
      weight: row.weight ?? null,
      flatWeight: row.flatWeight ?? null,
      costAmount: row.costAmount ?? null,
      costCurrency: row.costCurrency ?? null,
      description: row.description ?? null,
      tags: (row.tags as string[] | undefined) ?? [],
      rarity: row.rarity ?? null,
      requiresAttunement: row.requiresAttunement ?? null,
      attunementPrereq: row.attunementPrereq ?? null,
      chargesMax: row.chargesMax ?? null,
      chargesRechargeRule: row.chargesRechargeRule ?? null,
      chargesRechargeAmount: row.chargesRechargeAmount ?? null,
      duplicatedFromId: row.duplicatedFromId ?? null,
      createdBy: row.createdBy ?? null,
      partyId: row.partyId ?? null,
    };
    const back = fromPrismaItemDefinition(dbRow);
    expect(back).toEqual(def);
  });

  it('round-trips a maximal DMG row (all optional fields set)', () => {
    const def: ItemDefinition = {
      id: 'dmg-2024:wand-of-fireballs',
      name: 'Wand of Fireballs',
      source: 'DMG',
      category: 'magic',
      weight: 1,
      flatWeight: false,
      cost: { amount: 1000, currency: 'gp' },
      description: 'A short tapered baton.',
      tags: ['wand', 'evocation'],
      rarity: 'rare',
      requiresAttunement: true,
      attunementPrereq: 'by a spellcaster',
      charges: { max: 7, rechargeRule: 'dawn', rechargeAmount: '1d6+1' },
    };
    const row = toPrismaItemDefinition(def);
    // simulate DB null-fill for fields not set
    const dbRow: ItemDefinitionRow = {
      ...row,
      weight: row.weight ?? null,
      flatWeight: row.flatWeight ?? null,
      costAmount: row.costAmount ?? null,
      costCurrency: row.costCurrency ?? null,
      description: row.description ?? null,
      tags: (row.tags as string[] | undefined) ?? [],
      rarity: row.rarity ?? null,
      requiresAttunement: row.requiresAttunement ?? null,
      attunementPrereq: row.attunementPrereq ?? null,
      chargesMax: row.chargesMax ?? null,
      chargesRechargeRule: row.chargesRechargeRule ?? null,
      chargesRechargeAmount: row.chargesRechargeAmount ?? null,
      duplicatedFromId: row.duplicatedFromId ?? null,
      createdBy: row.createdBy ?? null,
      partyId: row.partyId ?? null,
    };
    const back = fromPrismaItemDefinition(dbRow);
    expect(back).toEqual(def);
  });

  it('does NOT emit undefined keys for absent optional fields (exactOptionalPropertyTypes)', () => {
    const def: ItemDefinition = {
      id: 'phb-2024:torch',
      name: 'Torch',
      source: 'PHB',
      category: 'gear',
    };
    const row = toPrismaItemDefinition(def);
    // None of the optional column keys should be present at all.
    expect('weight' in row).toBe(false);
    expect('flatWeight' in row).toBe(false);
    expect('costAmount' in row).toBe(false);
    expect('costCurrency' in row).toBe(false);
    expect('description' in row).toBe(false);
    expect('rarity' in row).toBe(false);
    expect('requiresAttunement' in row).toBe(false);
    expect('attunementPrereq' in row).toBe(false);
    expect('chargesMax' in row).toBe(false);
    expect('chargesRechargeRule' in row).toBe(false);
    expect('chargesRechargeAmount' in row).toBe(false);
    expect('duplicatedFromId' in row).toBe(false);
    expect('createdBy' in row).toBe(false);
    expect('partyId' in row).toBe(false);
  });
});
