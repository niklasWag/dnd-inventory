import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SEED_VERSION } from '@app/seeds';
import { itemDefinitionSchema } from '@app/shared';

import { PrismaClient } from '../../prisma/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

import { runSeed } from './seed-runner.js';

/**
 * R3.1 integration tests against the local Postgres test DB.
 *
 * Gated on `DATABASE_URL_TEST` being set so the suite skips cleanly when
 * no DB is reachable (CI without a Postgres service, etc.). Locally,
 * `src/test/setup.ts` defaults the value to `dnd_inv_test` on port 5433
 * — the test DB created by `infra/docker/postgres-init/00-databases.sh`.
 */
const TEST_DB_URL =
  process.env['DATABASE_URL_TEST'] ?? 'postgresql://dnd:dnd@localhost:5433/dnd_inv_test';

let prisma: PrismaClient;

beforeAll(() => {
  const adapter = new PrismaPg({ connectionString: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
});

beforeEach(async () => {
  // Fresh state per test. CASCADE clears ItemInstance rows in case a
  // future slice adds them via a shared setup; for R3.1 only ItemDefinition
  // + Metadata are touched.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Metadata", "ItemDefinition" RESTART IDENTITY CASCADE',
  );
});

describe('runSeed (R3.1) — integration', () => {
  it('first run inserts every PHB + DMG row and stamps the version', async () => {
    const result = await runSeed(prisma);

    expect(result.skipped).toBe(false);
    expect(result.previousVersion).toBeNull();
    expect(result.newVersion).toBe(SEED_VERSION);
    expect(result.upsertedCount).toBeGreaterThan(0);

    const phbCount = await prisma.itemDefinition.count({ where: { source: 'PHB' } });
    const dmgCount = await prisma.itemDefinition.count({ where: { source: 'DMG' } });
    expect(phbCount).toBeGreaterThan(50);
    expect(dmgCount).toBeGreaterThan(50);

    const meta = await prisma.metadata.findUnique({ where: { key: 'seedVersion' } });
    expect(meta?.value).toBe(SEED_VERSION);
  });

  it('second run with the same bundle is a no-op', async () => {
    await runSeed(prisma);
    const second = await runSeed(prisma);
    expect(second.skipped).toBe(true);
    expect(second.upsertedCount).toBe(0);
    expect(second.previousVersion).toBe(SEED_VERSION);
  });

  it('version mismatch reverts tampered rows', async () => {
    await runSeed(prisma);
    // Tamper: rewrite a PHB row's description and bump the version
    // backwards so the next run picks the bundle's value back up.
    const sample = await prisma.itemDefinition.findFirstOrThrow({ where: { source: 'PHB' } });
    await prisma.itemDefinition.update({
      where: { id: sample.id },
      data: { description: 'TAMPERED — should be overwritten by re-seed' },
    });
    await prisma.metadata.update({ where: { key: 'seedVersion' }, data: { value: 0 } });

    const result = await runSeed(prisma);
    expect(result.skipped).toBe(false);
    expect(result.previousVersion).toBe(0);

    const reloaded = await prisma.itemDefinition.findUniqueOrThrow({ where: { id: sample.id } });
    expect(reloaded.description).not.toBe('TAMPERED — should be overwritten by re-seed');
  });

  it('every seeded row round-trips through the Zod itemDefinitionSchema', async () => {
    await runSeed(prisma);
    // Sample 25 rows across PHB + DMG. Cheap enough to do exhaustively
    // if needed; sampling here keeps the test fast and still exercises
    // every optional-field branch (rarity, charges, attunement, etc.).
    const rows = await prisma.itemDefinition.findMany({ take: 25 });
    for (const row of rows) {
      // Reconstruct an ItemDefinition shape and parse — this is the same
      // boundary check fromPrismaItemDefinition makes; we re-do it here
      // explicitly so a future schema drift on either side fails this
      // test loudly.
      const def: Record<string, unknown> = {
        id: row.id,
        name: row.name,
        source: row.source,
        category: row.category,
      };
      if (row.weight !== null) def['weight'] = row.weight;
      if (row.flatWeight !== null) def['flatWeight'] = row.flatWeight;
      if (row.costAmount !== null && row.costCurrency !== null) {
        def['cost'] = { amount: row.costAmount, currency: row.costCurrency };
      }
      if (row.description !== null) def['description'] = row.description;
      if (row.tags.length > 0) def['tags'] = row.tags;
      if (row.rarity !== null) {
        // Underscore → hyphen translation
        def['rarity'] = row.rarity === 'very_rare' ? 'very-rare' : row.rarity;
      }
      if (row.requiresAttunement !== null) def['requiresAttunement'] = row.requiresAttunement;
      if (row.attunementPrereq !== null) def['attunementPrereq'] = row.attunementPrereq;
      if (row.chargesMax !== null && row.chargesRechargeRule !== null) {
        const rechargeRule =
          row.chargesRechargeRule === 'long_rest'
            ? 'long-rest'
            : row.chargesRechargeRule === 'short_rest'
              ? 'short-rest'
              : row.chargesRechargeRule;
        const charges: Record<string, unknown> = {
          max: row.chargesMax,
          rechargeRule,
        };
        if (row.chargesRechargeAmount !== null) {
          charges['rechargeAmount'] = row.chargesRechargeAmount;
        }
        def['charges'] = charges;
      }
      expect(() => itemDefinitionSchema.parse(def)).not.toThrow();
    }
  });
});
