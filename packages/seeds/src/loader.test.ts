import { describe, expect, it } from 'vitest';

import { itemDefinitionSchema } from '@app/shared';

import { loadPhbSeed } from './loader';

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
