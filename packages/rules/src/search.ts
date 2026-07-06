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
 *   - Per-probe scoring per field:
 *       exact substring        → highest tier
 *       word-boundary substring → mid tier
 *       full subsequence match → low tier
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
 * Score `probe` against a lowercased haystack, returning the strongest
 * tier that applies. Word-boundary is stronger than mid-word substring
 * (a match at the start of a word signals a stronger intent than a
 * random substring in the middle). Subsequence is weakest.
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
    return isWordStart ? wordScore : exactScore;
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

  const probes = normalized.split(/\s+/).filter((p) => p.length > 0);
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
