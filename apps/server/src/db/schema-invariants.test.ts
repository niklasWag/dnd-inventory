import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../prisma/generated/prisma/client.js';

/**
 * R3.2 — DB-level invariant assertions that the Prisma DSL cannot express.
 *
 * Every migration the migrate engine generates re-emits the Character FK
 * without DEFERRABLE (prisma#8807). The R3.1/R3.2 migrations append a tail
 * that re-applies DEFERRABLE INITIALLY DEFERRED, but any FUTURE migration
 * that touches Character or Stash will reintroduce the regression unless
 * the contributor remembers to append the same tail.
 *
 * This suite is the contract that catches that mistake the next time it
 * happens — CI fails with a clear message rather than R3.4's create-character
 * transaction blowing up at runtime.
 *
 * Pattern is open-ended: add more DB-level invariant assertions here as
 * future slices append CHECK constraints / deferrable FKs / etc. The test
 * is intentionally read-only (pg_constraint catalog queries) so it costs
 * nothing and never mutates data.
 */
const TEST_DB_URL =
  process.env['DATABASE_URL_TEST'] ?? 'postgresql://dnd:dnd@localhost:5434/dnd_inv_test';

let prisma: PrismaClient;

beforeAll(() => {
  const adapter = new PrismaPg({ connectionString: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('schema invariants — DB-level (hand-tailed in migration.sql)', () => {
  it('Character.inventoryStashId FK is DEFERRABLE INITIALLY DEFERRED', async () => {
    const rows = await prisma.$queryRawUnsafe<
      { conname: string; condeferrable: boolean; condeferred: boolean }[]
    >(
      `SELECT conname, condeferrable, condeferred
       FROM pg_constraint
       WHERE conname = 'Character_inventoryStashId_fkey'`,
    );

    expect(
      rows,
      'Character_inventoryStashId_fkey not found — was the init migration applied?',
    ).toHaveLength(1);

    const fk = rows[0]!;
    expect(
      fk.condeferrable,
      [
        'Character_inventoryStashId_fkey is NOT marked DEFERRABLE.',
        '',
        'Prisma (#8807) re-emits this FK without DEFERRABLE on every migration that',
        'touches Character or Stash. The most recent migration is missing the',
        'hand-tailed re-DEFERRABLE block. Append the canonical block to that',
        "migration's migration.sql — see apps/server/prisma/migrations/*_r32_auth/",
        'migration.sql for the pattern.',
      ].join('\n'),
    ).toBe(true);
    expect(
      fk.condeferred,
      'Character_inventoryStashId_fkey is DEFERRABLE but not INITIALLY DEFERRED.',
    ).toBe(true);
  });

  it('User has the discordId-or-emailVerified CHECK constraint (R3.2)', async () => {
    const rows = await prisma.$queryRawUnsafe<{ conname: string }[]>(
      `SELECT conname
       FROM pg_constraint
       WHERE conname = 'User_auth_present_check' AND contype = 'c'`,
    );
    expect(
      rows,
      'User_auth_present_check missing — the R3.2 migration tail did not run.',
    ).toHaveLength(1);
  });

  it('User.needsDisplayName column is BOOLEAN NOT NULL DEFAULT false (R3.3)', async () => {
    const rows = await prisma.$queryRawUnsafe<
      {
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }[]
    >(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_name = 'User' AND column_name = 'needsDisplayName'`,
    );
    expect(rows, 'User.needsDisplayName missing — R3.3 migration did not run.').toHaveLength(1);
    const col = rows[0]!;
    expect(col.data_type).toBe('boolean');
    expect(col.is_nullable).toBe('NO');
    expect(col.column_default).toBe('false');
  });

  it('EmailAuthAttempt table exists with (email, ip) UNIQUE (R3.3)', async () => {
    const tableRows = await prisma.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_name = 'EmailAuthAttempt'`,
    );
    expect(tableRows, 'EmailAuthAttempt table missing — R3.3 migration did not run.').toHaveLength(
      1,
    );

    // Confirm the composite UNIQUE index is present. Postgres stores the
    // constraint as an index with `indisunique = true` and a `conname` row
    // in pg_constraint. We query the simpler pg_indexes view here.
    const idxRows = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname
       FROM pg_indexes
       WHERE tablename = 'EmailAuthAttempt' AND indexname = 'EmailAuthAttempt_email_ip_key'`,
    );
    expect(
      idxRows,
      'EmailAuthAttempt (email, ip) UNIQUE index missing — schema drift.',
    ).toHaveLength(1);
  });
});
