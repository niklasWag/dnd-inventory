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
 * - `3` (R2.2): adds `charges` blocks to ~40-50 DMG entries (wands,
 *   staves, rings, single-use consumables). The schema activations
 *   are additive — older Dexie blobs upsert cleanly to gain the new
 *   fields on PHB/DMG rows; homebrew rows are untouched.
 */
export const SEED_VERSION = 3;
