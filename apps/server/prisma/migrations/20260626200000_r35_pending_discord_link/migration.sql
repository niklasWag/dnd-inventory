-- R3.5 — PendingDiscordLink: ephemeral handoff for the Discord-link OAuth
-- flow. An authenticated user clicks "Connect Discord" in Settings →
-- Linked accounts; the server writes a row keyed by a random token, then
-- redirects through the link-flow OAuth entry point. The callback
-- consumes the row to attach `discordId`/`avatarUrl` to the existing
-- session user instead of minting a new User.
--
-- No hand-tail: Prisma's diff did not touch Character or Stash, so the
-- DEFERRABLE INITIALLY DEFERRED FK on Character_inventoryStashId_fkey
-- remains intact (R3.1 + R3.2 + R3.3 invariant verified via
-- schema-invariants.test.ts).

-- CreateTable
CREATE TABLE "PendingDiscordLink" (
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingDiscordLink_pkey" PRIMARY KEY ("token")
);

-- CreateIndex
CREATE INDEX "PendingDiscordLink_userId_idx" ON "PendingDiscordLink"("userId");

-- CreateIndex
CREATE INDEX "PendingDiscordLink_expires_idx" ON "PendingDiscordLink"("expires");

-- AddForeignKey
ALTER TABLE "PendingDiscordLink" ADD CONSTRAINT "PendingDiscordLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
