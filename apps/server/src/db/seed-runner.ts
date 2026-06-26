/**
 * Boot-time seed runner — idempotent, version-gated upsert of the
 * PHB+DMG catalog into the server's Postgres. Mirrors the client's
 * `seed-catalog` reducer action (MVP §9, R2.1 amendment) so the server's
 * canonical `ItemDefinition` rows always match `@app/seeds` at the
 * version stamped in `Metadata.seedVersion`.
 *
 * Design:
 *   1. Read `Metadata.seedVersion` → short-circuit when it already
 *      matches the bundle's `SEED_VERSION` (cheap re-run on every boot).
 *   2. Otherwise: load PHB + DMG bundles via `@app/seeds`, map each row
 *      through `toPrismaItemDefinition` (handles cost/charges flatten,
 *      hyphen→underscore enums, `exactOptionalPropertyTypes` discipline),
 *      and upsert by id inside a single `$transaction`. Partial failure
 *      rolls the whole upsert back.
 *   3. Stamp `Metadata.seedVersion`. Future boots with the same bundle
 *      short-circuit at step 1.
 *
 * Idempotency: upsert-by-id means re-running with the same bundle is a
 * no-op (each row's update payload is identical to its current value).
 * Bumping `SEED_VERSION` in `@app/seeds` forces the next boot to re-walk
 * every row, reverting hand-edits to PHB/DMG entries (homebrew rows
 * are untouched — they have no PHB/DMG id and we only iterate the
 * bundled definitions).
 */
import { SEED_VERSION, loadDmgSeed, loadPhbSeed } from '@app/seeds';
import type { ItemDefinition } from '@app/shared';

import type { PrismaClient } from '../../prisma/generated/prisma/client.js';

import { toPrismaItemDefinition } from './mappers.js';

/** Single canonical key in the `Metadata` table for the seed version. */
const META_KEY = 'seedVersion';

export interface SeedResult {
  /** True when the persisted version already matched the bundle — no writes were made. */
  skipped: boolean;
  /** The version stored in `Metadata` before this run; `null` on a fresh DB. */
  previousVersion: number | null;
  /** The `SEED_VERSION` from `@app/seeds` at the time of this run. */
  newVersion: number;
  /** Number of `ItemDefinition` rows upserted (PHB + DMG combined); zero on skip. */
  upsertedCount: number;
}

/**
 * Run the seed upsert. Safe to call on every server boot. Returns a
 * structured result the caller can one-line-log.
 */
export async function runSeed(prisma: PrismaClient): Promise<SeedResult> {
  const current = await prisma.metadata.findUnique({ where: { key: META_KEY } });
  const previousVersion = readVersion(current?.value);

  if (previousVersion === SEED_VERSION) {
    return {
      skipped: true,
      previousVersion,
      newVersion: SEED_VERSION,
      upsertedCount: 0,
    };
  }

  const defs: ItemDefinition[] = [...loadPhbSeed(), ...loadDmgSeed()];

  await prisma.$transaction(async (tx) => {
    for (const def of defs) {
      const row = toPrismaItemDefinition(def);
      await tx.itemDefinition.upsert({
        where: { id: def.id },
        create: row,
        update: row,
      });
    }
    await tx.metadata.upsert({
      where: { key: META_KEY },
      create: { key: META_KEY, value: SEED_VERSION },
      update: { value: SEED_VERSION },
    });
  });

  return {
    skipped: false,
    previousVersion,
    newVersion: SEED_VERSION,
    upsertedCount: defs.length,
  };
}

/**
 * Pull a numeric version out of the JSONB blob. The `Metadata.value`
 * column is `Json` to keep the table key/value-shaped (future keys can
 * store any JSON shape); for the canonical `seedVersion` key we store a
 * raw integer.
 */
function readVersion(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  return null;
}
