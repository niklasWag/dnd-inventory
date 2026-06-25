/**
 * Bundled seed version for the catalog (PHB + DMG combined per R2.1).
 *
 * Bump this whenever any seed file (`data/phb-2024-mundane.json` or
 * `data/dmg-2024.json`) changes in a user-visible way — the reducer
 * uses it to detect "seed is behind the bundle" and upsert PHB/DMG
 * rows on the next boot, leaving homebrew untouched (MVP §9).
 *
 * Version history:
 * - `1` (M2): PHB 2024 mundane items only.
 * - `2` (R2.1): adds DMG 2024 magic items + rarity / attunement
 *   metadata. First boot after upgrading triggers the upsert path
 *   exactly once.
 */
export const SEED_VERSION = 2;

/**
 * @deprecated Use `SEED_VERSION` (covers both PHB and DMG).
 * Retained as an alias for any out-of-tree consumer that imported the
 * M2-era name — safe to remove once verified unused.
 */
export const PHB_SEED_VERSION = SEED_VERSION;
