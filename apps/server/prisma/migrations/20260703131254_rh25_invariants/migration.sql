-- ============================================================================
-- RH2.5 — DB-level invariant constraints (see docs/roadmap.md § RH2.5).
--
-- Five invariants that were previously reducer- or guard-only are promoted
-- to Postgres-level constraints so a future code path — a raw SQL migration,
-- an accidental persistor bypass, an emergency data fix — cannot silently
-- corrupt the data model.
--
-- Named for grep-ability:
--   Stash_inventory_per_character_uniq          — (a) partial UNIQUE index
--   Stash_recovered_loot_per_party_uniq         — (b) partial UNIQUE index
--   Party_banker_not_owner_check                — (c) CHECK constraint
--   ItemInstance_equip_attune_check_trg         — (d) BEFORE INSERT/UPDATE trigger
--   ItemInstance_container_depth_check_trg     — (e) BEFORE INSERT/UPDATE trigger
--
-- Each is paired with a presence test in
-- `apps/server/src/db/schema-invariants.test.ts` — the migration and the
-- test ship together so CI catches a drop-during-refactor immediately.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (a) Single Inventory per character (OUTLINE §4).
-- Every character has exactly one Stash with scope='character' AND
-- isCarried=true. The pre-existing `Stash_scope_invariant_check` (init
-- migration) already guarantees `ownerCharacterId IS NOT NULL` when
-- scope='character', so the partial predicate is well-defined for every
-- eligible row.
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX "Stash_inventory_per_character_uniq"
  ON "Stash" ("ownerCharacterId")
  WHERE "isCarried" = true AND "scope" = 'character';

-- ----------------------------------------------------------------------------
-- (b) Single Recovered Loot per party (OUTLINE §4).
-- Every party has exactly one Stash with scope='recovered_loot'. The DB
-- enum value is `recovered_loot` (underscore) — see schema.prisma:83.
-- The client-side Zod discriminator uses `'recovered-loot'` (hyphen);
-- the mapper in `apps/server/src/db/mappers.ts` bridges the two.
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX "Stash_recovered_loot_per_party_uniq"
  ON "Stash" ("partyId")
  WHERE "scope" = 'recovered_loot';

-- ----------------------------------------------------------------------------
-- (c) Banker != Owner (OUTLINE §3.14).
-- Party.bankerUserId may not equal Party.ownerUserId — DM cannot self-
-- appoint as Banker. Null-safe: `bankerUserId IS NULL` is the MVP-typical
-- state (no Banker until 2+ members).
--
-- A broader "banker is an active party member" check is deferred — see
-- RH2.5 — Notes in docs/roadmap.md.
-- ----------------------------------------------------------------------------
ALTER TABLE "Party"
  ADD CONSTRAINT "Party_banker_not_owner_check"
  CHECK ("bankerUserId" IS NULL OR "bankerUserId" != "ownerUserId");

-- ----------------------------------------------------------------------------
-- (d) Equip/attune only on Inventory (OUTLINE §4).
-- ItemInstance.equipped=true OR attuned=true requires the parent Stash to
-- be an Inventory (scope='character' AND isCarried=true).
--
-- Trigger over denormalisation: keeping a mirrored `stashIsCarried` on
-- ItemInstance would require touching every persistor write site + a
-- backfill migration. A BEFORE trigger is one function + one declaration,
-- costs ~10 μs per firing (single indexed PK lookup on Stash).
--
-- The `OF equipped, attuned, ownerId` clause narrows firing to the columns
-- that could actually cause a violation — quantity/notes updates never
-- fire. The early return short-circuits when both flags are false, so the
-- reducer's leave-Inventory cascade (which clears both to false; see
-- packages/rules/src/reducer/index.ts:1505) pays no lookup cost.
--
-- `currentCharges` is intentionally NOT part of this check. Per R2.3
-- amendment (reducer/index.ts:1490), items leaving Inventory keep their
-- `currentCharges` value — a wand outside Inventory still has charges.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_equip_attune_only_on_inventory()
RETURNS trigger AS $$
DECLARE
  parent_scope "StashScope";
  parent_carried boolean;
BEGIN
  IF NEW."equipped" = false AND NEW."attuned" = false THEN
    RETURN NEW;
  END IF;
  SELECT "scope", "isCarried"
    INTO parent_scope, parent_carried
    FROM "Stash"
    WHERE "id" = NEW."ownerId";
  IF parent_scope IS DISTINCT FROM 'character' OR parent_carried IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ItemInstance_equip_attune_requires_inventory: row % has equipped=% attuned=% but parent stash % is not an Inventory (scope=% isCarried=%)',
      NEW."id", NEW."equipped", NEW."attuned", NEW."ownerId", parent_scope, parent_carried
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ItemInstance_equip_attune_check_trg"
  BEFORE INSERT OR UPDATE OF "equipped", "attuned", "ownerId"
  ON "ItemInstance"
  FOR EACH ROW EXECUTE FUNCTION assert_equip_attune_only_on_inventory();

-- ----------------------------------------------------------------------------
-- (e) Container depth ≤ 1 (OUTLINE §3.6).
-- ItemInstance.containerInstanceId must reference a row whose own
-- containerInstanceId IS NULL. Prevents nested containers.
--
-- Reducer already enforces this (index.ts:1453 rejects `transfer` into a
-- container that already has a parent). This trigger is the DB-level
-- backstop for raw-SQL / persistor-bypass writes.
--
-- Trigger narrowed to fire only when `containerInstanceId` actually
-- changes — most ItemInstance updates (equip/attune/quantity) never touch
-- this column and never pay the lookup cost.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_container_depth_one_level()
RETURNS trigger AS $$
DECLARE
  parent_container text;
BEGIN
  IF NEW."containerInstanceId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "containerInstanceId"
    INTO parent_container
    FROM "ItemInstance"
    WHERE "id" = NEW."containerInstanceId";
  IF parent_container IS NOT NULL THEN
    RAISE EXCEPTION 'ItemInstance_container_depth_exceeded: row % nests inside % which itself nests inside % (one-level-deep only per OUTLINE §3.6)',
      NEW."id", NEW."containerInstanceId", parent_container
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ItemInstance_container_depth_check_trg"
  BEFORE INSERT OR UPDATE OF "containerInstanceId"
  ON "ItemInstance"
  FOR EACH ROW EXECUTE FUNCTION assert_container_depth_one_level();
