-- CreateEnum
CREATE TYPE "CreatureSize" AS ENUM ('tiny', 'small', 'medium', 'large', 'huge', 'gargantuan');

-- CreateEnum
CREATE TYPE "EncumbranceRule" AS ENUM ('off', 'phb', 'variant');

-- CreateEnum
CREATE TYPE "ItemCategory" AS ENUM ('weapon', 'armor', 'gear', 'tool', 'ammunition', 'consumable', 'magic', 'currency', 'container', 'other');

-- CreateEnum
CREATE TYPE "ItemSource" AS ENUM ('PHB', 'DMG', 'homebrew');

-- CreateEnum
CREATE TYPE "Rarity" AS ENUM ('common', 'uncommon', 'rare', 'very_rare', 'legendary', 'artifact');

-- CreateEnum
CREATE TYPE "CurrencyDenomination" AS ENUM ('cp', 'sp', 'ep', 'gp', 'pp');

-- CreateEnum
CREATE TYPE "ChargesRechargeRule" AS ENUM ('dawn', 'dusk', 'long_rest', 'short_rest', 'custom', 'none');

-- CreateEnum
CREATE TYPE "StashScope" AS ENUM ('character', 'party', 'recovered_loot');

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('dm', 'player');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "inviteCode" TEXT NOT NULL,
    "recoveredLootStashId" TEXT NOT NULL,
    "bankerUserId" TEXT,
    "isSoloShortcut" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyMembership" (
    "userId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "characterId" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "PartyMembership_pkey" PRIMARY KEY ("userId","partyId","role")
);

-- CreateTable
CREATE TABLE "Character" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "species" TEXT NOT NULL,
    "size" "CreatureSize" NOT NULL,
    "class" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "strScore" INTEGER NOT NULL,
    "maxAttunement" INTEGER NOT NULL,
    "encumbranceRule" "EncumbranceRule" NOT NULL,
    "enforceEncumbrance" BOOLEAN NOT NULL,
    "inventoryStashId" TEXT NOT NULL,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stash" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isCarried" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scope" "StashScope" NOT NULL,
    "ownerCharacterId" TEXT,
    "partyId" TEXT,

    CONSTRAINT "Stash_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemDefinition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" "ItemSource" NOT NULL,
    "category" "ItemCategory" NOT NULL,
    "weight" DOUBLE PRECISION,
    "flatWeight" BOOLEAN,
    "costAmount" DOUBLE PRECISION,
    "costCurrency" "CurrencyDenomination",
    "description" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rarity" "Rarity",
    "requiresAttunement" BOOLEAN,
    "attunementPrereq" TEXT,
    "chargesMax" INTEGER,
    "chargesRechargeRule" "ChargesRechargeRule",
    "chargesRechargeAmount" TEXT,
    "duplicatedFromId" TEXT,
    "createdBy" TEXT,
    "partyId" TEXT,

    CONSTRAINT "ItemDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemInstance" (
    "id" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "containerInstanceId" TEXT,
    "quantity" INTEGER NOT NULL,
    "equipped" BOOLEAN NOT NULL,
    "attuned" BOOLEAN NOT NULL,
    "identified" BOOLEAN NOT NULL,
    "hint" TEXT,
    "currentCharges" INTEGER,
    "customName" TEXT,
    "notes" TEXT,
    "conditionOverrides" JSONB,

    CONSTRAINT "ItemInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurrencyHolding" (
    "id" TEXT NOT NULL,
    "stashId" TEXT NOT NULL,
    "cp" INTEGER NOT NULL,
    "sp" INTEGER NOT NULL,
    "ep" INTEGER NOT NULL,
    "gp" INTEGER NOT NULL,
    "pp" INTEGER NOT NULL,

    CONSTRAINT "CurrencyHolding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionLog" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "sessionId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "actorRole" "MembershipRole" NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "TransactionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Metadata" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,

    CONSTRAINT "Metadata_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "Party_inviteCode_key" ON "Party"("inviteCode");

-- CreateIndex
CREATE INDEX "Party_ownerUserId_idx" ON "Party"("ownerUserId");

-- CreateIndex
CREATE INDEX "PartyMembership_partyId_idx" ON "PartyMembership"("partyId");

-- CreateIndex
CREATE UNIQUE INDEX "Character_inventoryStashId_key" ON "Character"("inventoryStashId");

-- CreateIndex
CREATE INDEX "Character_partyId_idx" ON "Character"("partyId");

-- CreateIndex
CREATE INDEX "Character_ownerUserId_idx" ON "Character"("ownerUserId");

-- CreateIndex
CREATE INDEX "Stash_ownerCharacterId_idx" ON "Stash"("ownerCharacterId");

-- CreateIndex
CREATE INDEX "Stash_partyId_idx" ON "Stash"("partyId");

-- CreateIndex
CREATE INDEX "ItemDefinition_source_idx" ON "ItemDefinition"("source");

-- CreateIndex
CREATE INDEX "ItemDefinition_category_idx" ON "ItemDefinition"("category");

-- CreateIndex
CREATE INDEX "ItemInstance_definitionId_idx" ON "ItemInstance"("definitionId");

-- CreateIndex
CREATE INDEX "ItemInstance_ownerId_idx" ON "ItemInstance"("ownerId");

-- CreateIndex
CREATE INDEX "ItemInstance_ownerId_definitionId_idx" ON "ItemInstance"("ownerId", "definitionId");

-- CreateIndex
CREATE UNIQUE INDEX "CurrencyHolding_stashId_key" ON "CurrencyHolding"("stashId");

-- CreateIndex
CREATE INDEX "TransactionLog_partyId_timestamp_idx" ON "TransactionLog"("partyId", "timestamp");

-- CreateIndex
CREATE INDEX "TransactionLog_type_idx" ON "TransactionLog"("type");

-- AddForeignKey
ALTER TABLE "Party" ADD CONSTRAINT "Party_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyMembership" ADD CONSTRAINT "PartyMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyMembership" ADD CONSTRAINT "PartyMembership_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyMembership" ADD CONSTRAINT "PartyMembership_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_inventoryStashId_fkey" FOREIGN KEY ("inventoryStashId") REFERENCES "Stash"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stash" ADD CONSTRAINT "Stash_ownerCharacterId_fkey" FOREIGN KEY ("ownerCharacterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stash" ADD CONSTRAINT "Stash_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemInstance" ADD CONSTRAINT "ItemInstance_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "ItemDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemInstance" ADD CONSTRAINT "ItemInstance_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Stash"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrencyHolding" ADD CONSTRAINT "CurrencyHolding_stashId_fkey" FOREIGN KEY ("stashId") REFERENCES "Stash"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionLog" ADD CONSTRAINT "TransactionLog_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransactionLog" ADD CONSTRAINT "TransactionLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ====================================================================
-- R3.1 hand-tail — appended after `prisma migrate dev --name init`.
-- These CHECK constraints + the deferrable FK encode invariants that
-- the Prisma DSL can't express. They are part of the canonical
-- migration; do not delete or reorder them. See:
--   - packages/shared/src/schemas/*.ts (Zod source of truth)
--   - docs/OUTLINE.md §4 (data model)
-- ====================================================================

-- (1) Break the Character ↔ Stash FK cycle: Character.inventoryStashId is
--     declared as a real FK to Stash.id, but Stash.ownerCharacterId references
--     Character.id. Inside `create-character` (R3.4) we need to create both
--     rows in one transaction. DEFERRABLE INITIALLY DEFERRED lets the FK
--     check wait until COMMIT, so the order of inserts inside the txn doesn't
--     matter.
ALTER TABLE "Character"
  DROP CONSTRAINT "Character_inventoryStashId_fkey";
ALTER TABLE "Character"
  ADD CONSTRAINT "Character_inventoryStashId_fkey"
  FOREIGN KEY ("inventoryStashId") REFERENCES "Stash"("id")
  DEFERRABLE INITIALLY DEFERRED;

-- (2) Character — domain constraints from Zod (character.ts).
ALTER TABLE "Character"
  ADD CONSTRAINT "Character_level_check"
  CHECK ("level" BETWEEN 1 AND 20);
ALTER TABLE "Character"
  ADD CONSTRAINT "Character_strScore_check"
  CHECK ("strScore" BETWEEN 1 AND 30);
ALTER TABLE "Character"
  ADD CONSTRAINT "Character_maxAttunement_check"
  CHECK ("maxAttunement" >= 0);

-- (3) ItemInstance — domain constraints from Zod (itemInstance.ts).
ALTER TABLE "ItemInstance"
  ADD CONSTRAINT "ItemInstance_quantity_check"
  CHECK ("quantity" > 0);
ALTER TABLE "ItemInstance"
  ADD CONSTRAINT "ItemInstance_currentCharges_check"
  CHECK ("currentCharges" IS NULL OR "currentCharges" >= 0);

-- (4) CurrencyHolding — all denominations non-negative integers
--     (currencyHolding.ts). CLAUDE.md security rule: currency math is
--     integer CP only; pre-commit check ensures no resulting balance is
--     negative.
ALTER TABLE "CurrencyHolding"
  ADD CONSTRAINT "CurrencyHolding_nonneg_check"
  CHECK ("cp" >= 0 AND "sp" >= 0 AND "ep" >= 0 AND "gp" >= 0 AND "pp" >= 0);

-- (5) ItemDefinition — weight non-negative when present.
ALTER TABLE "ItemDefinition"
  ADD CONSTRAINT "ItemDefinition_weight_check"
  CHECK ("weight" IS NULL OR "weight" >= 0);

-- (6) ItemDefinition.cost — paired nullability (both fields set or both null).
ALTER TABLE "ItemDefinition"
  ADD CONSTRAINT "ItemDefinition_cost_pair_check"
  CHECK (
    ("costAmount" IS NULL AND "costCurrency" IS NULL) OR
    ("costAmount" IS NOT NULL AND "costCurrency" IS NOT NULL)
  );

-- (7) ItemDefinition.charges — paired nullability of (chargesMax,
--     chargesRechargeRule); chargesRechargeAmount is independent (optional
--     even when the block is present).
ALTER TABLE "ItemDefinition"
  ADD CONSTRAINT "ItemDefinition_charges_pair_check"
  CHECK (
    ("chargesMax" IS NULL AND "chargesRechargeRule" IS NULL) OR
    ("chargesMax" IS NOT NULL AND "chargesRechargeRule" IS NOT NULL)
  );

-- (8) Stash — 3-arm discriminated-union invariant from stash.ts:
--       scope='character'       → ownerCharacterId set, partyId null
--       scope='party'           → partyId set, ownerCharacterId null, isCarried=false
--       scope='recovered_loot'  → partyId set, ownerCharacterId null, isCarried=false
ALTER TABLE "Stash"
  ADD CONSTRAINT "Stash_scope_invariant_check"
  CHECK (
    (
      "scope" = 'character'
      AND "ownerCharacterId" IS NOT NULL
      AND "partyId" IS NULL
    ) OR (
      "scope" = 'party'
      AND "partyId" IS NOT NULL
      AND "ownerCharacterId" IS NULL
      AND "isCarried" = false
    ) OR (
      "scope" = 'recovered_loot'
      AND "partyId" IS NOT NULL
      AND "ownerCharacterId" IS NULL
      AND "isCarried" = false
    )
  );
