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

  it('for long probes, ranks exact-substring above word-boundary above subsequence', () => {
    // R7.5.b — the `SHORT_PROBE_MAX_LEN` gate rejects mid-word matches
    // for probes of ≤ 4 chars. Test the tier ordering with a 5-char
    // probe so all three tiers remain scorable.
    const items: Item[] = [
      { name: 'zzz abcde zzz' }, // word-boundary "abcde"
      { name: 'zzabcdezz' }, // mid-word substring "abcde"
      { name: 'axbxcxdxex' }, // subsequence a-b-c-d-e
    ];
    const r = search('abcde', items);
    expect(r[0]!.item.name).toBe('zzabcdezz');
    expect(r[1]!.item.name).toBe('zzz abcde zzz');
    expect(r[2]!.item.name).toBe('axbxcxdxex');
  });

  it('R7.5.b — short probes (≤ 4 chars) skip mid-word substring matches', () => {
    // `abc` (3 chars) matching inside `zzabczz` used to score 100
    // (mid-word substring). Now it's gated out — only word-boundary
    // and subsequence tiers apply.
    const items: Item[] = [
      { name: 'zzz abc zzz' }, // word-boundary → 80
      { name: 'zzabczz' }, // mid-word only → 0 (dropped)
      { name: 'axbxcx' }, // subsequence a-b-c → 40
    ];
    const r = search('abc', items);
    const matched = names(r);
    expect(matched).toContain('zzz abc zzz');
    expect(matched).toContain('axbxcx');
    expect(matched).not.toContain('zzabczz');
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
    // `xy` is 2 chars — subsequence tier disabled by length; only
    // substring hits count. `xy` is NOT a stopword, so it survives the
    // R7.5.b filter and still gets scored.
    const items: Item[] = [
      { name: 'Axylotl' }, // contains 'xy' as substring (word-boundary at 'a-**xy**...' — mid-word)
      { name: 'Kobold' }, // no 'xy' substring, no subseq relevant
      { name: 'Xylophone' }, // starts with 'xy' → word-boundary
    ];
    const r = search('xy', items);
    // Both substring hits survive; Kobold has neither.
    // R7.5.b: `Axylotl` has 'xy' mid-word which for a 2-char probe is
    // still allowed under the current substring path (the short-probe
    // gate applies to ≤ 4 char probes MID-WORD; 2-char probes go
    // through the same gate — so `Axylotl` is dropped too, only
    // word-boundary `Xylophone` survives).
    expect(names(r)).toEqual(['Xylophone']);
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

// -------------------- R7.5.b — stopwords + short-probe gate --------------------

describe('search — R7.5.b stopword filter', () => {
  it('drops "of" from the probe list; `"ring of protection"` needs only ring + protection', () => {
    // Regression for the reported defect: user typed `"ring of protection"`
    // and Cloak of Protection surfaced because `ring` matched inside
    // `wearing` in the cloak description AND `of`/`protection` hit
    // the cloak's name. Under R7.5.b, `of` is filtered as a stopword
    // and `ring` (4 chars) is gated to word-boundary — so `ring`
    // inside `wearing` no longer scores.
    const items: Item[] = [
      {
        name: 'Ring of Protection',
        description: 'A magical ring granting +1 to AC and saves.',
        tags: ['ring', 'magic'],
      },
      {
        name: 'Cloak of Protection',
        description: 'You gain a +1 bonus to AC and saving throws while wearing this cloak.',
        tags: ['cloak', 'enhancement'],
      },
    ];
    const r = search('ring of protection', items);
    expect(names(r)).toEqual(['Ring of Protection']);
  });

  it('all-stopwords query falls through to the empty-query pass-through', () => {
    const items: Item[] = [{ name: 'A' }, { name: 'B' }];
    const r = search('and the', items);
    // Two probes, both stopwords → empty probe list → all items at score 0.
    expect(r).toHaveLength(2);
    for (const row of r) expect(row.score).toBe(0);
  });

  it('non-stopword short words still probe normally', () => {
    // `sword` is a 5-char content word; not a stopword.
    const items: Item[] = [{ name: 'Longsword' }, { name: 'Rope' }];
    const r = search('sword', items);
    expect(names(r)).toEqual(['Longsword']);
  });
});

describe('search — R7.5.b short-probe word-boundary gate', () => {
  it('4-char probe does NOT match mid-word substring in a description', () => {
    // `ring` in `wearing` used to score `SCORE_DESC_EXACT` (20). Now
    // it scores 0 — the item has to have `ring` at a word boundary
    // somewhere (name, description, or tag) to qualify.
    const items: Item[] = [
      {
        name: 'Cloak of Protection',
        description: 'You gain a +1 bonus while wearing this cloak.',
        tags: ['cloak'],
      },
      { name: 'Ring of Protection', description: 'Magical ring.', tags: ['ring'] },
    ];
    const r = search('ring', items);
    expect(names(r)).toEqual(['Ring of Protection']);
  });

  it('5-char probe DOES match mid-word substring (long probes retain the old tier)', () => {
    // Long probes are much less likely to false-positive; a probe of
    // this length matching mid-word is usually intentional.
    const items: Item[] = [
      { name: 'A', description: 'The character has thermal protection.' }, // 'therm' inside 'thermal' — mid-word
    ];
    const r = search('therm', items);
    expect(names(r)).toContain('A');
  });

  it('short probe at a word boundary still scores normally', () => {
    // `ring` at the start of `Ring of Protection` is a word-boundary
    // hit and scores the full name-word tier.
    const items: Item[] = [{ name: 'Ring of Protection' }];
    const r = search('ring', items);
    expect(names(r)).toEqual(['Ring of Protection']);
    expect(r[0]!.score).toBeGreaterThan(0);
  });
});
