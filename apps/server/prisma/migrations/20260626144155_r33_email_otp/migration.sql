-- R3.3 — Email OTP auth + backup-email settings.
--
-- Adds:
--   1. User.needsDisplayName Boolean — gates hub access for email-only signups
--      until the user picks a display name. Discord signups bypass via the
--      events.signIn profile sync (always false). See OUTLINE §3.1 / SECURITY §1.2.
--   2. EmailAuthAttempt table — durable rate-limit / lockout state for the OTP
--      verify flow. Keyed by (email, ip) so both axes can be enforced. On 5
--      failed verify attempts within a code's lifetime, lockedUntil is set
--      `now + 15min` per SECURITY §1.2.
--
-- No hand-tail needed: Prisma's diff did not touch Character or Stash, so the
-- DEFERRABLE INITIALLY DEFERRED FK on Character_inventoryStashId_fkey remains
-- intact (verified via pg_constraint + schema-invariants.test.ts).
--
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "needsDisplayName" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "EmailAuthAttempt" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastAttempt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailAuthAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailAuthAttempt_lockedUntil_idx" ON "EmailAuthAttempt"("lockedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "EmailAuthAttempt_email_ip_key" ON "EmailAuthAttempt"("email", "ip");
