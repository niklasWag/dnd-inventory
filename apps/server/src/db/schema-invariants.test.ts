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
      { conname: string; condeferrable: boolean; condeferred: boolean; confdeltype: string }[]
    >(
      `SELECT conname, condeferrable, condeferred, confdeltype::text AS confdeltype
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
    // BUG-001: the FK must NOT use ON DELETE RESTRICT ('r'). The cascade in
    // `cascadeCharacterToRecoveredLootDb` drops the Inventory stash inside the
    // same transaction as the Character — RESTRICT rejects at the row-write
    // level regardless of DEFERRABLE, raising a 500. The hand-tailed
    // migrations drop + re-add this FK without `ON DELETE RESTRICT` so the
    // default NO ACTION (confdeltype 'a') composes correctly with DEFERRABLE.
    expect(
      fk.confdeltype,
      [
        'Character_inventoryStashId_fkey is NOT `ON DELETE NO ACTION` (got confdeltype',
        `'${fk.confdeltype}', expected 'a').`,
        '',
        'Prisma emits non-cascaded relations as `ON DELETE RESTRICT` ("r") by',
        'default, which breaks `cascadeCharacterToRecoveredLootDb` (BUG-001 — see',
        'docs/BUGS.md). The most recent migration must include the canonical tail:',
        '',
        '  ALTER TABLE "Character" DROP CONSTRAINT "Character_inventoryStashId_fkey";',
        '  ALTER TABLE "Character"',
        '    ADD CONSTRAINT "Character_inventoryStashId_fkey"',
        '    FOREIGN KEY ("inventoryStashId") REFERENCES "Stash"("id")',
        '    ON UPDATE CASCADE',
        '    DEFERRABLE INITIALLY DEFERRED;',
      ].join('\n'),
    ).toBe('a');
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

describe('schema invariants — RH2.5 constraint promotions', () => {
  /**
   * RH2.5 — DB-level invariants promoted from reducer/guard-only to
   * Postgres constraints. See `apps/server/prisma/migrations/*_rh25_invariants/`
   * and `docs/roadmap.md` § RH2.5 for the full charter.
   *
   * Each `it` verifies the constraint exists in the catalog. Two of the
   * five constraints also carry a **negative-path** integration test
   * that attempts a real violating INSERT and expects Postgres to
   * reject with the corresponding SQLSTATE (23505 unique / 23514 check).
   */

  it('(a) Stash_inventory_per_character_uniq — partial UNIQUE index present', async () => {
    const rows = await prisma.$queryRawUnsafe<{ indexname: string; indexdef: string }[]>(
      `SELECT indexname, indexdef
       FROM pg_indexes
       WHERE tablename = 'Stash' AND indexname = 'Stash_inventory_per_character_uniq'`,
    );
    expect(
      rows,
      'Stash_inventory_per_character_uniq missing — the RH2.5 migration did not run.',
    ).toHaveLength(1);
    // Sanity-check the partial predicate is present. `indexdef` looks like
    // `CREATE UNIQUE INDEX ... WHERE (("isCarried" = true) AND ("scope" = 'character'))`.
    expect(rows[0]!.indexdef).toContain('UNIQUE');
    expect(rows[0]!.indexdef).toContain('WHERE');
    expect(rows[0]!.indexdef).toContain('isCarried');
    expect(rows[0]!.indexdef).toContain('character');
  });

  it('(b) Stash_recovered_loot_per_party_uniq — partial UNIQUE index present', async () => {
    const rows = await prisma.$queryRawUnsafe<{ indexname: string; indexdef: string }[]>(
      `SELECT indexname, indexdef
       FROM pg_indexes
       WHERE tablename = 'Stash' AND indexname = 'Stash_recovered_loot_per_party_uniq'`,
    );
    expect(
      rows,
      'Stash_recovered_loot_per_party_uniq missing — the RH2.5 migration did not run.',
    ).toHaveLength(1);
    expect(rows[0]!.indexdef).toContain('UNIQUE');
    expect(rows[0]!.indexdef).toContain('WHERE');
    expect(rows[0]!.indexdef).toContain('recovered_loot');
  });

  it('(c) Party_banker_not_owner_check — CHECK constraint present', async () => {
    const rows = await prisma.$queryRawUnsafe<{ conname: string; contype: string }[]>(
      `SELECT conname, contype::text
       FROM pg_constraint
       WHERE conname = 'Party_banker_not_owner_check'`,
    );
    expect(
      rows,
      'Party_banker_not_owner_check missing — the RH2.5 migration did not run.',
    ).toHaveLength(1);
    expect(rows[0]!.contype, 'expected c (check constraint)').toBe('c');
  });

  it('(d) ItemInstance_equip_attune_check_trg — BEFORE INSERT/UPDATE trigger present', async () => {
    const rows = await prisma.$queryRawUnsafe<
      { tgname: string; tgenabled: string; tgtype: number }[]
    >(
      `SELECT t.tgname, t.tgenabled::text, t.tgtype::int
       FROM pg_trigger t
       JOIN pg_class c ON t.tgrelid = c.oid
       WHERE c.relname = 'ItemInstance'
         AND t.tgname = 'ItemInstance_equip_attune_check_trg'`,
    );
    expect(
      rows,
      'ItemInstance_equip_attune_check_trg missing — the RH2.5 migration did not run.',
    ).toHaveLength(1);
    // tgenabled: 'O' = enabled (default). Not 'D' (disabled).
    expect(rows[0]!.tgenabled, 'trigger should be enabled').toBe('O');
    // pg_trigger.tgtype bitmask: bit 1 (TRIGGER_TYPE_BEFORE), bit 2 (ROW),
    // bit 4 (INSERT), bit 16 (UPDATE). We only assert BEFORE + ROW since
    // the exact INSERT|UPDATE combination + `OF <columns>` narrowing is
    // exercised by the negative-path integration test below.
    const TG_TYPE_BEFORE = 1 << 1;
    const TG_TYPE_ROW = 1 << 0;
    expect(rows[0]!.tgtype & TG_TYPE_BEFORE, 'trigger should be BEFORE').toBeGreaterThan(0);
    expect(rows[0]!.tgtype & TG_TYPE_ROW, 'trigger should be FOR EACH ROW').toBeGreaterThan(0);
  });

  it('(e) ItemInstance_container_depth_check_trg — BEFORE INSERT/UPDATE trigger present', async () => {
    const rows = await prisma.$queryRawUnsafe<{ tgname: string; tgenabled: string }[]>(
      `SELECT t.tgname, t.tgenabled::text
       FROM pg_trigger t
       JOIN pg_class c ON t.tgrelid = c.oid
       WHERE c.relname = 'ItemInstance'
         AND t.tgname = 'ItemInstance_container_depth_check_trg'`,
    );
    expect(
      rows,
      'ItemInstance_container_depth_check_trg missing — the RH2.5 migration did not run.',
    ).toHaveLength(1);
    expect(rows[0]!.tgenabled).toBe('O');
  });

  /**
   * Negative-path integration tests. Actually attempt a violating write
   * against a real DB and assert Postgres rejects with the expected
   * SQLSTATE. The presence tests above catch missing constraints; these
   * tests catch a subtly-broken constraint (wrong predicate, wrong
   * trigger event) that would show up as "constraint exists but doesn't
   * fire when it should."
   *
   * Each test seeds a minimal graph via `$executeRawUnsafe` inside a
   * fresh transaction-ish sequence, then attempts the violating write
   * and expects the raw Postgres error.
   */

  async function bootstrapMinimalCharacter(): Promise<{
    userId: string;
    partyId: string;
    characterId: string;
    inventoryStashId: string;
    partyStashId: string;
    recoveredStashId: string;
  }> {
    // Fresh IDs per invocation. `newUuidV7` isn't imported here to keep
    // this file focused; the ids don't need to be UUID v7 for these
    // tests (the guard-layer clock-skew check is a route-layer concern).
    const userId = `usr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const partyId = `p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const characterId = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const inventoryStashId = `s-inv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const partyStashId = `s-p-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const recoveredStashId = `s-rl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO "User" ("id", "discordId", "displayName", "needsDisplayName")
         VALUES ($1, $1, 'Tester', false)`,
        userId,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "Party" ("id", "name", "ownerUserId", "inviteCode", "recoveredLootStashId")
         VALUES ($1, 'Test Party', $2, $3, $4)`,
        partyId,
        userId,
        `INV-${partyId}`,
        recoveredStashId,
      );
      // Party-scope stashes first (Recovered Loot + Party Stash) — no FK
      // dependency on Character.
      await tx.$executeRawUnsafe(
        `INSERT INTO "Stash" ("id", "name", "isCarried", "scope", "partyId")
         VALUES ($1, 'Recovered Loot', false, 'recovered_loot'::"StashScope", $2),
                ($3, 'Party Stash',    false, 'party'::"StashScope",         $2)`,
        recoveredStashId,
        partyId,
        partyStashId,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "CurrencyHolding" ("id", "stashId", "cp", "sp", "ep", "gp", "pp")
         VALUES ($1, $2, 0, 0, 0, 0, 0),
                ($3, $4, 0, 0, 0, 0, 0)`,
        `ch-${recoveredStashId}`,
        recoveredStashId,
        `ch-${partyStashId}`,
        partyStashId,
      );
      // Character + Inventory stash. The `Character.inventoryStashId` FK
      // is DEFERRABLE INITIALLY DEFERRED so we can insert them in either
      // order within the same transaction (see the DEFERRABLE test above).
      await tx.$executeRawUnsafe(
        `INSERT INTO "Character" ("id", "partyId", "ownerUserId", "name", "species", "size",
           "class", "level", "strScore", "maxAttunement", "encumbranceRule", "enforceEncumbrance",
           "inventoryStashId")
         VALUES ($1, $2, $3, 'Tester', 'Human', 'medium'::"CreatureSize", 'Fighter', 1, 10, 3,
                 'off'::"EncumbranceRule", false, $4)`,
        characterId,
        partyId,
        userId,
        inventoryStashId,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "Stash" ("id", "name", "isCarried", "scope", "ownerCharacterId")
         VALUES ($1, 'Inventory', true, 'character'::"StashScope", $2)`,
        inventoryStashId,
        characterId,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "CurrencyHolding" ("id", "stashId", "cp", "sp", "ep", "gp", "pp")
         VALUES ($1, $2, 0, 0, 0, 0, 0)`,
        `ch-${inventoryStashId}`,
        inventoryStashId,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO "PartyMembership" ("userId", "partyId", "role", "characterId")
         VALUES ($1, $2, 'dm'::"MembershipRole",     $3),
                ($1, $2, 'player'::"MembershipRole", $3)`,
        userId,
        partyId,
        characterId,
      );
    });

    return { userId, partyId, characterId, inventoryStashId, partyStashId, recoveredStashId };
  }

  it('(f) rejects a second Inventory stash for the same character with SQLSTATE 23505', async () => {
    const { characterId } = await bootstrapMinimalCharacter();
    const secondInvId = `s-inv2-${Date.now()}`;
    // Prisma surfaces the PG SQLSTATE via the underlying driver's error;
    // the shape is provider-specific but always exposes the code somewhere.
    // A substring match on the message is the most portable assertion.
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "Stash" ("id", "name", "isCarried", "scope", "ownerCharacterId")
         VALUES ($1, 'Second Inventory', true, 'character'::"StashScope", $2)`,
        secondInvId,
        characterId,
      ),
    ).rejects.toThrow(/23505|Stash_inventory_per_character_uniq|unique/i);
  });

  it('(g) rejects INSERT of equipped=true item into a non-Inventory stash with SQLSTATE 23514', async () => {
    const { partyStashId } = await bootstrapMinimalCharacter();
    // Seed an ItemDefinition to satisfy the ItemInstance.definitionId FK.
    const defId = `def-torch-${Date.now()}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "ItemDefinition" ("id", "name", "source", "category")
       VALUES ($1, 'Test Torch', 'PHB'::"ItemSource", 'gear'::"ItemCategory")`,
      defId,
    );

    const itemId = `it-eq-${Date.now()}`;
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "ItemInstance" ("id", "definitionId", "ownerType", "ownerId",
           "containerInstanceId", "quantity", "equipped", "attuned", "identified", "currentCharges")
         VALUES ($1, $2, 'stash', $3, NULL, 1, true, false, true, NULL)`,
        itemId,
        defId,
        partyStashId,
      ),
    ).rejects.toThrow(/23514|ItemInstance_equip_attune_requires_inventory|check/i);
  });

  // -------- RH3.1 partial UNIQUE --------

  it('(f) GameSession_isCurrent_uniq — partial UNIQUE index present', async () => {
    const rows = await prisma.$queryRawUnsafe<{ indexname: string; indexdef: string }[]>(
      `SELECT indexname, indexdef
       FROM pg_indexes
       WHERE tablename = 'GameSession' AND indexname = 'GameSession_isCurrent_uniq'`,
    );
    expect(
      rows,
      'GameSession_isCurrent_uniq missing — the RH3.1 migration did not run.',
    ).toHaveLength(1);
    // Sanity-check the partial predicate is present.
    expect(rows[0]!.indexdef).toContain('UNIQUE');
    expect(rows[0]!.indexdef).toContain('WHERE');
    expect(rows[0]!.indexdef).toContain('isCurrent');
  });
});
