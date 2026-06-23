/**
 * Bundled PHB-2024 mundane-items seed version. Bump this whenever
 * `data/phb-2024-mundane.json` changes in a user-visible way — the reducer
 * uses it to detect "seed is behind the bundle" and upsert PHB rows on the
 * next boot, leaving homebrew untouched (MVP §9).
 *
 * Start at 1; M0 left `seedVersion: 0` on freshly created characters, which
 * means every first boot in M2 triggers the seed path exactly once.
 */
export const PHB_SEED_VERSION = 1;
