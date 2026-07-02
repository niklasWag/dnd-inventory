-- BUG-001 — Strip `ON DELETE RESTRICT` from `Character_inventoryStashId_fkey`.
--
-- See docs/BUGS.md#BUG-001 for the full root-cause analysis.
--
-- Short version: the cascade in `cascadeCharacterToRecoveredLootDb`
-- (`apps/server/src/sync/persistor.ts`) deletes a kicked/leaving player's
-- Inventory stash AND their Character row in one transaction. The FK
-- `Character.inventoryStashId → Stash.id` was `ON DELETE RESTRICT
-- DEFERRABLE INITIALLY DEFERRED` (carried forward from the init + R3.2
-- migration tails). DEFERRABLE moves the check to COMMIT — but RESTRICT
-- rejects at the row-write level regardless of when the check fires, so
-- `Stash.deleteMany` still raised `violates RESTRICT setting of foreign
-- key constraint`.
--
-- The persistor was patched to reorder the deletes (Character first, then
-- owned stashes) so RESTRICT no longer fires. This migration is the
-- belt-and-braces companion: drop RESTRICT entirely (default NO ACTION
-- composes correctly with DEFERRABLE INITIALLY DEFERRED) so any future
-- caller doing the same operation in a different order is also safe.
--
-- Same hand-tailed-after-Prisma-DSL pattern as the init / R3.2 / R3.5
-- migrations — see apps/server/prisma/schema.prisma for the prisma#8807
-- background note.

ALTER TABLE "Character" DROP CONSTRAINT "Character_inventoryStashId_fkey";
ALTER TABLE "Character"
  ADD CONSTRAINT "Character_inventoryStashId_fkey"
  FOREIGN KEY ("inventoryStashId") REFERENCES "Stash"("id")
  ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;
