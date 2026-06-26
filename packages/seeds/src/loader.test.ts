import { describe, expect, it } from 'vitest';

import { itemDefinitionSchema, raritySchema } from '@app/shared';

import { loadDmgSeed, loadPhbSeed } from './loader';

describe('PHB 2024 mundane seed loader', () => {
  it('parses the bundled JSON against the seed schema', () => {
    expect(() => loadPhbSeed()).not.toThrow();
  });

  it('returns at least one entry per MVP §9 category we ship', () => {
    const defs = loadPhbSeed();
    const categories = new Set(defs.map((d) => d.category));
    // MVP §9 lists weapons, armor, gear, tools, ammunition, containers as
    // mundane-seed coverage. `consumable` / `other` are allowed by the
    // ItemCategory enum but not required to appear in the mundane seed.
    expect(categories).toContain('weapon');
    expect(categories).toContain('armor');
    expect(categories).toContain('gear');
    expect(categories).toContain('tool');
    expect(categories).toContain('ammunition');
    expect(categories).toContain('container');
  });

  it('produces only PHB-sourced entries', () => {
    const defs = loadPhbSeed();
    for (const d of defs) expect(d.source).toBe('PHB');
  });

  it('mints unique, stable ids prefixed with phb-2024:', () => {
    const defs = loadPhbSeed();
    const ids = defs.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith('phb-2024:')).toBe(true);
  });

  it('every entry validates against the shared ItemDefinition schema', () => {
    const defs = loadPhbSeed();
    for (const d of defs) {
      expect(() => itemDefinitionSchema.parse(d)).not.toThrow();
    }
  });
});

describe('DMG 2024 magic-items seed loader (R2.1)', () => {
  it('parses the bundled JSON against the seed schema', () => {
    expect(() => loadDmgSeed()).not.toThrow();
  });

  it('produces only DMG-sourced entries', () => {
    const defs = loadDmgSeed();
    expect(defs.length).toBeGreaterThan(0);
    for (const d of defs) expect(d.source).toBe('DMG');
  });

  it('mints unique, stable ids prefixed with dmg-2024:', () => {
    const defs = loadDmgSeed();
    const ids = defs.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.startsWith('dmg-2024:')).toBe(true);
  });

  it('covers every rarity tier (common through artifact)', () => {
    const defs = loadDmgSeed();
    const rarities = new Set(defs.map((d) => d.rarity));
    for (const tier of raritySchema.options) {
      expect(rarities, `rarity tier "${tier}" missing from DMG seed`).toContain(tier);
    }
  });

  it('includes at least one entry requiring attunement', () => {
    const defs = loadDmgSeed();
    const withAttunement = defs.filter((d) => d.requiresAttunement === true);
    expect(withAttunement.length).toBeGreaterThan(0);
  });

  it('ships flatWeight: true on Bag of Holding (BoH-class container)', () => {
    const defs = loadDmgSeed();
    const boh = defs.find((d) => d.id === 'dmg-2024:bag-of-holding');
    expect(boh, 'Bag of Holding missing from DMG seed').toBeDefined();
    expect(boh?.flatWeight).toBe(true);
  });

  it('ships flatWeight: true on Handy Haversack and Portable Hole', () => {
    const defs = loadDmgSeed();
    const haversack = defs.find((d) => d.id === 'dmg-2024:handy-haversack');
    const hole = defs.find((d) => d.id === 'dmg-2024:portable-hole');
    expect(haversack?.flatWeight).toBe(true);
    expect(hole?.flatWeight).toBe(true);
  });

  it('every entry validates against the shared ItemDefinition schema', () => {
    const defs = loadDmgSeed();
    for (const d of defs) {
      expect(() => itemDefinitionSchema.parse(d), `entry ${d.id} failed schema`).not.toThrow();
    }
  });

  it('rarity field is one of the six canonical tiers on every entry', () => {
    const defs = loadDmgSeed();
    for (const d of defs) {
      expect(() => raritySchema.parse(d.rarity), `entry ${d.id} has invalid rarity`).not.toThrow();
    }
  });
});

describe('DMG 2024 charges seed coverage (R2.2)', () => {
  it('Wand of Magic Missiles ships with charges { max: 7, rechargeRule: dawn, 1d6+1 }', () => {
    const defs = loadDmgSeed();
    const wand = defs.find((d) => d.id === 'dmg-2024:wand-of-magic-missiles');
    expect(wand?.charges).toEqual({
      max: 7,
      rechargeRule: 'dawn',
      rechargeAmount: '1d6+1',
    });
  });

  it('Staff of Fire ships with charges { max: 10, rechargeRule: dawn }', () => {
    const defs = loadDmgSeed();
    const staff = defs.find((d) => d.id === 'dmg-2024:staff-of-fire');
    expect(staff?.charges?.max).toBe(10);
    expect(staff?.charges?.rechargeRule).toBe('dawn');
  });

  it('Potion of Healing ships with charges { max: 1, rechargeRule: none } (single-use)', () => {
    const defs = loadDmgSeed();
    const potion = defs.find((d) => d.id === 'dmg-2024:potion-of-healing');
    expect(potion?.charges).toEqual({ max: 1, rechargeRule: 'none' });
  });

  it('every Spell Scroll variant ships with single-use charges', () => {
    const defs = loadDmgSeed();
    const scrolls = defs.filter((d) => d.id.startsWith('dmg-2024:spell-scroll-'));
    expect(scrolls.length).toBeGreaterThan(0);
    for (const scroll of scrolls) {
      expect(scroll.charges, `${scroll.id} missing charges`).toEqual({
        max: 1,
        rechargeRule: 'none',
      });
    }
  });

  it('Necklace of Fireballs ships with charges { max: 9, rechargeRule: none }', () => {
    const defs = loadDmgSeed();
    const necklace = defs.find((d) => d.id === 'dmg-2024:necklace-of-fireballs');
    expect(necklace?.charges).toEqual({ max: 9, rechargeRule: 'none' });
  });

  it('Ring of Shooting Stars recharges at dusk', () => {
    const defs = loadDmgSeed();
    const ring = defs.find((d) => d.id === 'dmg-2024:ring-of-shooting-stars');
    expect(ring?.charges?.rechargeRule).toBe('dusk');
  });

  it('every charges block in the seed has a positive integer max', () => {
    const defs = loadDmgSeed();
    const withCharges = defs.filter((d) => d.charges !== undefined);
    expect(withCharges.length).toBeGreaterThan(20);
    for (const d of withCharges) {
      expect(d.charges?.max, `${d.id} has invalid max`).toBeGreaterThan(0);
      expect(Number.isInteger(d.charges?.max), `${d.id} max is not integer`).toBe(true);
    }
  });

  it('every rechargeRule in the seed is one of the six canonical values', () => {
    const defs = loadDmgSeed();
    const validRules = new Set(['dawn', 'dusk', 'long-rest', 'short-rest', 'custom', 'none']);
    const withCharges = defs.filter((d) => d.charges !== undefined);
    for (const d of withCharges) {
      expect(validRules.has(d.charges!.rechargeRule), `${d.id} has invalid rechargeRule`).toBe(
        true,
      );
    }
  });
});


