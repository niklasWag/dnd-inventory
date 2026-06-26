/*
  Warnings:

  - A unique constraint covering the columns `[discordId]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[email]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
ALTER TYPE "MembershipRole" ADD VALUE 'banker';

-- DropForeignKey
ALTER TABLE "Character" DROP CONSTRAINT "Character_inventoryStashId_fkey";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "discordId" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "emailVerified" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "User_discordId_key" ON "User"("discordId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_inventoryStashId_fkey" FOREIGN KEY ("inventoryStashId") REFERENCES "Stash"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- R3.2 hand-tail — appended after `prisma migrate dev --name r32_auth --create-only`.
-- Mirrors the R3.1 init migration's hand-tail style for DB-level invariants
-- that Prisma's DSL cannot express. Re-applies the DEFERRABLE FK that Prisma
-- regenerated above without the deferral.
-- ============================================================================

-- R3.1 carryforward — Character ↔ Stash inventory cycle still needs the FK
-- to be DEFERRABLE INITIALLY DEFERRED so R3.4's create-character transaction
-- can insert both rows in either order. Prisma re-emits the FK with default
-- (immediate) semantics every time it regenerates, so we drop + re-add it
-- here too.
ALTER TABLE "Character" DROP CONSTRAINT "Character_inventoryStashId_fkey";
ALTER TABLE "Character"
  ADD CONSTRAINT "Character_inventoryStashId_fkey"
  FOREIGN KEY ("inventoryStashId") REFERENCES "Stash"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

-- R3.2 — SECURITY §1.2 / OUTLINE §4 invariant: every User row must have at
-- least one valid auth credential. Email-only users (R3.3) populate
-- emailVerified; Discord users populate discordId.
--
-- Backfill: dev/test DBs created during R3.1 have zero User rows (only
-- ItemDefinition was seeded), so the UPDATE below is a no-op there. The
-- statement is kept for any environment where R3.1 tests left rows behind —
-- it sets discordId to the existing User.id so the CHECK doesn't reject
-- pre-existing rows that have no OAuth identity yet. New rows go through
-- the Auth.js adapter which always populates discordId on Discord sign-in.
UPDATE "User"
  SET "discordId" = "id"
  WHERE "discordId" IS NULL AND "emailVerified" IS NULL;

ALTER TABLE "User"
  ADD CONSTRAINT "User_auth_present_check"
  CHECK ("discordId" IS NOT NULL OR "emailVerified" IS NOT NULL);
