-- R4.1.e — Add `Party.archivedAt` column for the sole-member archive flow.
--
-- Per OUTLINE §8.3: "When the DM leaves: If no other members exist, the
-- party is archived (no destructive delete; data preserved for the DM's
-- records)". `GET /sync/parties` filters archived rows out; `POST
-- /sync/actions` rejects further mutations on an archived party.
ALTER TABLE "Party" ADD COLUMN "archivedAt" TIMESTAMP(3);
CREATE INDEX "Party_archivedAt_idx" ON "Party"("archivedAt");
