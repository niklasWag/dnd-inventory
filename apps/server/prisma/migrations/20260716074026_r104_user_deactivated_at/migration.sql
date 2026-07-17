-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deactivatedAt" TIMESTAMP(3);

-- R10.4 — amend the auth-present CHECK to exempt soft-deleted accounts.
-- The original constraint (migration 20260626114447_r32_auth) required every
-- User to carry at least one auth method (`discordId IS NOT NULL OR
-- emailVerified IS NOT NULL`, SECURITY §1.2). Account deletion is a SOFT
-- delete that releases credentials (nulls email/emailVerified/discordId) and
-- stamps `deactivatedAt`, which would otherwise violate the constraint. A
-- deactivated row is intentionally credential-less and can no longer log in
-- (no session, no credentials), so it's exempted here.
ALTER TABLE "User" DROP CONSTRAINT "User_auth_present_check";
ALTER TABLE "User"
  ADD CONSTRAINT "User_auth_present_check"
  CHECK ("deactivatedAt" IS NOT NULL OR "discordId" IS NOT NULL OR "emailVerified" IS NOT NULL);
