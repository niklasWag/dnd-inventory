-- ============================================================================
-- RH3.1 — GameSession entity + TransactionLog.sessionId FK
-- See docs/roadmap.md § RH3 for the full slice charter.
--
-- Adds the D&D-gameplay session entity (called `GameSession` in code —
-- see OUTLINE §4 naming note; disambiguates from the Auth.js `Session`
-- model). Adds a FK from `TransactionLog.sessionId → GameSession(id)`
-- with `ON DELETE SET NULL` so deleting a session doesn't orphan its
-- history (entries become "Untagged" per OUTLINE §3.12).
--
-- Named artifacts (for grep-ability):
--   GameSession                              — table
--   GameSession_partyId_idx                  — partyId lookup
--   GameSession_partyId_number_idx           — session-number ordering
--   GameSession_isCurrent_uniq               — partial UNIQUE index (tail)
--   TransactionLog_sessionId_idx             — sessionId lookup on log
--   TransactionLog_sessionId_fkey            — FK ON DELETE SET NULL
--   GameSession_partyId_fkey                 — FK ON DELETE CASCADE
--
-- Character FK re-tail: `prisma migrate` emitted a DROP+ADD pair on
-- Character_inventoryStashId_fkey (Prisma DSL can't express DEFERRABLE
-- — prisma#8807; see schema.prisma comment on Character.inventoryStashId).
-- The re-tail restores the BUG-001-established `NO ACTION ... DEFERRABLE
-- INITIALLY DEFERRED` shape.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Prisma-generated section
-- ----------------------------------------------------------------------------

-- DropForeignKey
ALTER TABLE "Character" DROP CONSTRAINT "Character_inventoryStashId_fkey";

-- CreateTable
CREATE TABLE "GameSession" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "notes" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GameSession_partyId_idx" ON "GameSession"("partyId");

-- CreateIndex
CREATE INDEX "GameSession_partyId_number_idx" ON "GameSession"("partyId", "number");

-- CreateIndex
CREATE INDEX "TransactionLog_sessionId_idx" ON "TransactionLog"("sessionId");

-- AddForeignKey
ALTER TABLE "TransactionLog" ADD CONSTRAINT "TransactionLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "GameSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ----------------------------------------------------------------------------
-- Hand-tailed section
-- ----------------------------------------------------------------------------

-- Re-establish Character.inventoryStashId FK with DEFERRABLE INITIALLY
-- DEFERRED + default NO ACTION delete behavior. Same tail as
-- 20260630181911_bug001_character_inventory_fk_no_action; Prisma's DSL
-- cannot express either directive (prisma#8807) so it emits a bare
-- `ON DELETE RESTRICT` on every migration touching Character or Stash.
ALTER TABLE "Character"
  ADD CONSTRAINT "Character_inventoryStashId_fkey"
  FOREIGN KEY ("inventoryStashId") REFERENCES "Stash"("id")
  ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

-- Partial UNIQUE index: at most one GameSession per party has
-- `isCurrent = true` (OUTLINE §3.12 / §4 "only one per party at a time").
-- Prisma DSL cannot express partial-predicate unique indexes; mirrors
-- the RH2.5 pattern (`Stash_inventory_per_character_uniq` etc. in
-- 20260703131254_rh25_invariants/migration.sql).
CREATE UNIQUE INDEX "GameSession_isCurrent_uniq"
  ON "GameSession" ("partyId")
  WHERE "isCurrent" = true;
