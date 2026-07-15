-- R10.1 — durable state for the user-initiated "change email" dual-OTP flow.
-- Mirrors PendingDiscordLink. See apps/server/prisma/schema.prisma for the
-- model doc. Additive only.
--
-- NOTE: `prisma migrate dev` also emitted a spurious drop+re-add of
-- `Character_inventoryStashId_fkey` (it wants to rewrite the FK to its DSL
-- default `ON DELETE RESTRICT`, undoing BUG-001's hand-tailed
-- `ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED`). Prisma's DSL can't
-- express DEFERRABLE so it re-detects that state as drift on every run —
-- see 20260630181911_bug001_character_inventory_fk_no_action. Those lines
-- were stripped from this migration so it stays purely additive.

-- CreateTable
CREATE TABLE "PendingEmailChange" (
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "newEmail" TEXT NOT NULL,
    "currentOtpConsumedAt" TIMESTAMP(3),
    "newOtpConsumedAt" TIMESTAMP(3),
    "expires" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingEmailChange_pkey" PRIMARY KEY ("token")
);

-- CreateIndex
CREATE INDEX "PendingEmailChange_expires_idx" ON "PendingEmailChange"("expires");

-- CreateIndex
CREATE UNIQUE INDEX "PendingEmailChange_userId_key" ON "PendingEmailChange"("userId");

-- AddForeignKey
ALTER TABLE "PendingEmailChange" ADD CONSTRAINT "PendingEmailChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
