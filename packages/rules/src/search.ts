/**
 * R6.5 — Catalog search (OUTLINE §3.7 + §6).
 *
 * Subsequence + word-boundary fuzzy ranker over `{ name, description?,
 * tags? }` records. Pure — no dependencies, no state, deterministic.
 *
 * Design:
 *   - Query is trim + toLowerCase'd once. Empty query returns every
 *     input in original order at score 0 (caller controls display order
 *     for the empty case; e.g. CatalogBrowser sorts alphabetically).
 *   - Multi-word queries split on whitespace into probes; each probe is
 *     scored independently across all fields; a probe with zero hits on
 *     any field disqualifies the item entirely (AND across probes).
 *   - **R7.5.b — stopword filter.** Common short English glue words
 *     (`of`, `the`, `a`, `an`, `and`, `to`, `in`, `on`, `for`, `with`,
 *     `or`) are dropped from the probe list before scoring so a query
 *     like `"ring of protection"` doesn't count `of` against items whose
 *     names happen not to contain it. If the entire query is stopwords,
 *     the result is the empty-query behaviour.
 *   - **R7.5.b — short-probe gate.** Probes of ≤ 4 chars require a
 *     word-boundary substring match (start of string, or preceded by a
 *     non-alphanumeric). Mid-word matches like `ring` inside `wearing`
 *     no longer score. Long probes (≥ 5 chars) keep the mid-word tier
 *     because accidental embeddings of long words in unrelated words
 *     are vanishingly rare.
 *   - Per-probe scoring per field (long probes):
 *       exact substring (mid-word)  → mid tier
 *       word-boundary substring     → high tier
 *       full subsequence match      → low tier
 *     Field weight: name > description > tags. All hits sum.
 *   - Tie-break: shorter `name.length` wins (assumes stronger relative
 *     match on a shorter string).
 *   - Items with score > 0 (post-summation across all probes) are
 *     returned in descending score order.
 */

export interface SearchResult<T> {
  item: T;
  score: number;
}

/**
 * Minimum shape a search-scorable item must have. Fields are widened
 * with `| undefined` and read-only-tolerant so that objects with
 * strict-optional-typed fields (per `exactOptionalPropertyTypes`) or
 * `readonly` arrays flow through the generic without TS assignability
 * complaints.
 */
export interface Searchable {
  name: string;
  description?: string | undefined;
  tags?: ReadonlyArray<string> | undefined;
}

const SCORE_NAME_EXACT = 100;
const SCORE_NAME_WORD = 80;
const SCORE_NAME_SUBSEQ = 40;
const SCORE_DESC_EXACT = 20;
const SCORE_DESC_WORD = 15;
const SCORE_DESC_SUBSEQ = 10;
const SCORE_TAG_EXACT = 8;
const SCORE_TAG_WORD = 5;
const SCORE_TAG_SUBSEQ = 3;

/**
 * R7.5.b — glue words that carry no semantic content on their own.
 * When a user types `"ring of protection"`, the `of` should not
 * disqualify items whose descriptions omit it (e.g. `Ring of
 * Protection` itself has `of` in the name but nothing in description,
 * whereas a made-up `"Ringworm Ointment"` with no `of` anywhere would
 * be dropped for the wrong reason).
 *
 * Kept intentionally small — only unambiguous glue words. Item-noun
 * words like `sword`, `armor`, `ring` are NOT here and remain probes.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'for',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

/**
 * R7.5.b — short probes (≤ this length) require a word-boundary match.
 * A `ring` probe should hit `Ring of Protection` (word-boundary) but
 * not `Cloak of Protection` (matches `ring` mid-word inside `wearing`
 * in the description text). Long probes (≥ 5 chars) still accept
 * mid-word substrings because accidental embeddings of long words in
 * unrelated words are vanishingly rare.
 */
const SHORT_PROBE_MAX_LEN = 4;

/**
 * Score `probe` against a lowercased haystack, returning the strongest
 * tier that applies. Word-boundary is stronger than mid-word substring
 * (a match at the start of a word signals a stronger intent than a
 * random substring in the middle). Subsequence is weakest.
 *
 * R7.5.b — for short probes (≤ `SHORT_PROBE_MAX_LEN`), mid-word matches
 * do not score. The most common noise case is a 3-4 char probe
 * accidentally embedding inside a longer unrelated word.
 */
function scoreField(
  haystack: string,
  probe: string,
  exactScore: number,
  wordScore: number,
  subseqScore: number,
): number {
  if (probe === '' || haystack === '') return 0;
  const idx = haystack.indexOf(probe);
  if (idx !== -1) {
    // Word-boundary hit if match is at start of haystack, or preceded
    // by a non-alphanumeric character.
    const before = idx === 0 ? '' : (haystack[idx - 1] ?? '');
    const isWordStart = idx === 0 || !/[a-z0-9]/.test(before);
    if (isWordStart) return wordScore;
    // Mid-word substring. Short probes are too noisy at this tier
    // (e.g. `ring` inside `wearing`) — drop them; long probes keep it.
    if (probe.length <= SHORT_PROBE_MAX_LEN) return 0;
    return exactScore;
  }
  // Subsequence match is the weakest tier and requires probe length ≥ 3
  // to avoid noise: 2-char probes like 'of' or 'in' trivially
  // subsequence-match any word containing those two letters in order.
  // For short probes, absence of substring means no match.
  if (probe.length < 3) return 0;
  return isSubsequence(haystack, probe) ? subseqScore : 0;
}

/**
 * True iff every character of `needle` appears in `haystack` in order
 * (not necessarily adjacent), AND the total matched span is at most
 * `MAX_SPAN_MULTIPLIER × needle.length`. The span cap is the "not too
 * far apart" heuristic that stops long descriptions from
 * subseq-matching short probes coincidentally — e.g. "martial weapon"
 * (14 chars) would otherwise subsequence-match "rapier" (6 chars) via
 * scattered r-a-p-…. Adjacency-preferring, tuned so 'lgsw' → 'longsword'
 * (span 8, probe 4 → 2×) still matches.
 */
const MAX_SPAN_MULTIPLIER = 3;

function isSubsequence(haystack: string, needle: string): boolean {
  if (needle.length === 0) return true;
  if (needle.length > haystack.length) return false;
  const maxSpan = Math.max(needle.length + 2, needle.length * MAX_SPAN_MULTIPLIER);
  let ni = 0;
  let firstMatch = -1;
  for (let hi = 0; hi < haystack.length && ni < needle.length; hi += 1) {
    if (haystack[hi] === needle[ni]) {
      if (firstMatch === -1) firstMatch = hi;
      // If the span from the first match already exceeds our cap,
      // restart the search from the next haystack position by resetting
      // ni to 0 and forgetting the current firstMatch. This is a
      // greedy heuristic — it works because we care about "some window
      // of the haystack subseq-matches" rather than "any global
      // subseq-match".
      if (hi - firstMatch >= maxSpan) {
        ni = 0;
        firstMatch = -1;
        // Reprocess the current character in case it matches needle[0].
        if (haystack[hi] === needle[0]) {
          firstMatch = hi;
          ni = 1;
        }
        continue;
      }
      ni += 1;
    }
  }
  return ni === needle.length;
}

/**
 * Score a single probe against one item across all fields.
 * Returns 0 if the probe misses every field.
 */
function scoreProbeAgainstItem<T extends Searchable>(item: T, probe: string): number {
  const name = item.name.toLowerCase();
  const description = (item.description ?? '').toLowerCase();
  const tags = item.tags ?? [];

  let score = 0;

  score += scoreField(name, probe, SCORE_NAME_EXACT, SCORE_NAME_WORD, SCORE_NAME_SUBSEQ);

  const descriptionScore = scoreField(
    description,
    probe,
    SCORE_DESC_EXACT,
    SCORE_DESC_WORD,
    SCORE_DESC_SUBSEQ,
  );
  score += descriptionScore;

  // Tags: score the best-matching tag only, so a five-tag item isn't
  // scored higher than a one-tag item that hits equally well.
  let bestTagScore = 0;
  for (const raw of tags) {
    const tag = raw.toLowerCase();
    const tagScore = scoreField(tag, probe, SCORE_TAG_EXACT, SCORE_TAG_WORD, SCORE_TAG_SUBSEQ);
    if (tagScore > bestTagScore) bestTagScore = tagScore;
  }
  score += bestTagScore;

  return score;
}

/**
 * Fuzzy search over a catalog-like collection.
 *
 * @param query   Free-text query. Split on whitespace into probes;
 *                every probe must hit some field on an item for that
 *                item to be included (AND semantics).
 * @param items   Collection to score. Order is preserved when `query`
 *                is empty; otherwise sorted by descending score with
 *                shorter names winning ties.
 */
export function search<T extends Searchable>(
  query: string,
  items: ReadonlyArray<T>,
): SearchResult<T>[] {
  const normalized = query.trim().toLowerCase();
  if (normalized === '') {
    return items.map((item) => ({ item, score: 0 }));
  }

  // R7.5.b — split, then drop stopwords. A query that is ONLY stopwords
  // (`"and the"`) has no content probes and falls through to the empty-
  // query pass-through so the user isn't left staring at "no results"
  // for what was effectively an empty search.
  const rawProbes = normalized.split(/\s+/).filter((p) => p.length > 0);
  const probes = rawProbes.filter((p) => !STOPWORDS.has(p));
  if (probes.length === 0) {
    return items.map((item) => ({ item, score: 0 }));
  }

  const scored: SearchResult<T>[] = [];
  for (const item of items) {
    let total = 0;
    let disqualified = false;
    for (const probe of probes) {
      const p = scoreProbeAgainstItem(item, probe);
      if (p === 0) {
        disqualified = true;
        break;
      }
      total += p;
    }
    if (!disqualified) scored.push({ item, score: total });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.item.name.length - b.item.name.length;
  });

  return scored;
}
