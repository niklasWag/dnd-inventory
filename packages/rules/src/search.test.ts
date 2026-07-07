import { describe, expect, it } from 'vitest';

import { search, type SearchResult } from './search';

/**
 * R6.5 — Catalog search (OUTLINE §3.7 + §6). Subsequence + word-boundary
 * scorer over `name > description > tags` with tie-break by shorter name.
 */

interface Item {
  name: string;
  description?: string;
  tags?: readonly string[];
}

function names(results: SearchResult<Item>[]): string[] {
  return results.map((r) => r.item.name);
}

const CATALOG: readonly Item[] = [
  { name: 'Longsword', description: 'A versatile martial weapon.', tags: ['sword', 'martial'] },
  { name: 'Shortsword', description: 'A finesse martial weapon.', tags: ['sword', 'finesse'] },
  { name: 'Rope, Hempen (50 ft)', description: 'Twisted hemp rope.', tags: ['tool'] },
  { name: 'Cloak of Protection', description: 'You gain +1 to AC and saves.', tags: ['magic'] },
  { name: 'Longbow', description: 'A ranged martial weapon.', tags: ['ranged', 'martial'] },
];

describe('search — empty query', () => {
  it('returns every item at score 0 in input order', () => {
    const r = search('', CATALOG);
    expect(r.map((x) => x.item.name)).toEqual(CATALOG.map((x) => x.name));
    for (const row of r) expect(row.score).toBe(0);
  });

  it('treats whitespace-only query as empty', () => {
    const r = search('   ', CATALOG);
    expect(r).toHaveLength(CATALOG.length);
  });
});

describe('search — name matching', () => {
  it('finds exact-substring on name', () => {
    const r = search('longsword', CATALOG);
    expect(r[0]!.item.name).toBe('Longsword');
    expect(r[0]!.score).toBeGreaterThan(0);
  });

  it('is case-insensitive', () => {
    const r = search('LONGSWORD', CATALOG);
    expect(r[0]!.item.name).toBe('Longsword');
  });

  it('finds word-boundary match on multi-word names', () => {
    const r = search('rope', CATALOG);
    expect(names(r)).toContain('Rope, Hempen (50 ft)');
  });

  it('finds full-subsequence match ("lgsw" → "longsword")', () => {
    const r = search('lgsw', CATALOG);
    expect(names(r)).toContain('Longsword');
  });

  it('ranks exact-substring above word-boundary above subsequence for the same query length', () => {
    const items: Item[] = [
      { name: 'zzz abc zzz' }, // word-boundary "abc"
      { name: 'zzabczz' }, // exact substring "abc"
      { name: 'axbxcx' }, // subsequence a-b-c
    ];
    const r = search('abc', items);
    expect(r[0]!.item.name).toBe('zzabczz');
    expect(r[1]!.item.name).toBe('zzz abc zzz');
    expect(r[2]!.item.name).toBe('axbxcx');
  });
});

describe('search — description matching', () => {
  it('finds description hits when name does not match', () => {
    const r = search('twisted', CATALOG);
    expect(names(r)).toContain('Rope, Hempen (50 ft)');
  });

  it('name match outranks description match for the same query', () => {
    // Both entries have "rope" — one in name, one in description.
    const items: Item[] = [{ name: 'Rope' }, { name: 'Coil', description: 'A very long rope.' }];
    const r = search('rope', items);
    expect(r[0]!.item.name).toBe('Rope');
    expect(r[1]!.item.name).toBe('Coil');
  });
});

describe('search — tag matching', () => {
  it('finds tag hits when name and description miss', () => {
    const r = search('ranged', CATALOG);
    expect(names(r)).toContain('Longbow');
  });

  it('tag match is the weakest field: description outranks tag', () => {
    const items: Item[] = [
      { name: 'A', description: 'foo' },
      { name: 'B', tags: ['foo'] },
    ];
    const r = search('foo', items);
    expect(r[0]!.item.name).toBe('A');
    expect(r[1]!.item.name).toBe('B');
  });
});

describe('search — no matches', () => {
  it('returns empty array for a query nothing matches', () => {
    const r = search('nonesuch-xyz', CATALOG);
    expect(r).toEqual([]);
  });
});

describe('search — tie-break', () => {
  it('breaks ties by shorter name.length (assumes it is a stronger match)', () => {
    const items: Item[] = [{ name: 'Sword of Legend and Distinction' }, { name: 'Sword' }];
    const r = search('sword', items);
    expect(r[0]!.item.name).toBe('Sword');
    expect(r[1]!.item.name).toBe('Sword of Legend and Distinction');
  });
});

describe('search — multi-word query', () => {
  it('treats "long sword" as two probes; matches must hit both', () => {
    const r = search('long sword', CATALOG);
    // Longsword should match (contains "long" and "sword" as
    // substring/subsequence). Shortsword should NOT match on "long".
    expect(names(r)).toContain('Longsword');
    expect(names(r)).not.toContain('Shortsword');
    expect(names(r)).not.toContain('Rope, Hempen (50 ft)');
  });
});

describe('search — robustness', () => {
  it('handles empty catalog', () => {
    expect(search('anything', [])).toEqual([]);
  });

  it('does not throw on punctuation-heavy query', () => {
    expect(() => search('sword+!@#', CATALOG)).not.toThrow();
  });

  it('items with no description or tags still get scored on name', () => {
    const items: Item[] = [{ name: 'Sword' }];
    const r = search('sword', items);
    expect(r).toHaveLength(1);
    expect(r[0]!.score).toBeGreaterThan(0);
  });

  it('short probes (< 3 chars) do not subsequence-match to avoid noise', () => {
    // 'of' should NOT subsequence-match items lacking an 'of' substring.
    // In CATALOG, 'Cloak of Protection' contains 'of' as a substring →
    // matches. But 'Longsword' should NOT match on 'of' via subsequence
    // ('o' at pos 3, 'f' NOT present) — actually longsword has no 'f',
    // pick a clearer case:
    const items: Item[] = [
      { name: 'Cloak of Protection' }, // contains 'of'
      { name: 'Kobold' }, // has 'o' and no 'f' — not subseq-match either
      { name: 'Portable Forge' }, // 'o'..'f' subsequence — must NOT match
    ];
    const r = search('of', items);
    // Only the exact-substring hit survives.
    expect(names(r)).toEqual(['Cloak of Protection']);
  });

  it('subsequence span cap rejects widely-scattered matches ("rapier" vs. long descriptions)', () => {
    // The subsequence span cap (max(needle.length + 2, needle.length × 3))
    // bounds how far apart the matched characters can be. A 6-char probe
    // ('rapier') gets a cap of max(8, 18) = 18 haystack positions.
    //
    // "a martial melee weapon" (22 chars) contains r-a-…-…-…-e-r as
    // scattered subseq positions but they span the whole string, which
    // exceeds the cap — must NOT match.
    // "long swordfighting rapier practice" starts with 'rapier' as an
    // exact substring — must match.
    // "prapiere" is 8 chars containing rapier at span 6 (r-a-p-i-e-r
    // adjacent) — under the cap, must match via substring.
    const items: Item[] = [
      { name: 'A', description: 'a martial melee weapon' },
      { name: 'B', description: 'long swordfighting rapier practice' },
      { name: 'C', description: 'prapiere' },
    ];
    const r = search('rapier', items);
    const matched = names(r);
    expect(matched).toContain('B');
    expect(matched).toContain('C');
    expect(matched).not.toContain('A');
  });

  it('subsequence span cap admits close-together matches ("lgsw" → "longsword")', () => {
    // 'lgsw' is 4 chars → span cap of max(6, 12) = 12. In 'longsword'
    // (9 chars) the l-g-s-w positions span 8 chars, well under the cap.
    const items: Item[] = [{ name: 'Longsword' }];
    const r = search('lgsw', items);
    expect(names(r)).toEqual(['Longsword']);
  });
});
