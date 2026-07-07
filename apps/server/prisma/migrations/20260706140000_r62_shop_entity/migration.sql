-- R6.2 (2026-07-06) — Shop entity + stock entries (OUTLINE §3.9).
--
-- Definition-level static catalog: each Shop has zero or more
-- ShopStockEntry rows. `priceOverride` (integer CP) replaces the base
-- price when set. `quantity = -1` means unlimited. `isOpen` toggles
-- player visibility (DM-only writes; players view + transact when open).
--
-- Shops have no CurrencyHolding per OUTLINE §3.9 amendment
-- (2026-06-24). Purchase debits the buyer's stash; sale credits it.
-- ItemInstance.ownerType stays locked to 'stash' — shops don't hold
-- instances directly.

CREATE TABLE "Shop" (
  "id"                  TEXT PRIMARY KEY,
  "partyId"             TEXT NOT NULL,
  "name"                TEXT NOT NULL,
  "priceModifier"       DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  "sellToMerchantRate"  DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "isOpen"              BOOLEAN NOT NULL DEFAULT false,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Shop_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "Shop_partyId_idx" ON "Shop"("partyId");

-- Positive-modifier CHECK constraints mirror the Zod `.positive()`
-- refinements. Belt-and-braces alongside client-side + reducer checks.
ALTER TABLE "Shop" ADD CONSTRAINT "Shop_priceModifier_positive_check"
  CHECK ("priceModifier" > 0);
ALTER TABLE "Shop" ADD CONSTRAINT "Shop_sellToMerchantRate_positive_check"
  CHECK ("sellToMerchantRate" > 0);

CREATE TABLE "ShopStockEntry" (
  "id"                TEXT PRIMARY KEY,
  "shopId"            TEXT NOT NULL,
  "itemDefinitionId"  TEXT NOT NULL,
  "priceOverride"     INTEGER,
  "quantity"          INTEGER NOT NULL,
  CONSTRAINT "ShopStockEntry_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ShopStockEntry_shopId_idx" ON "ShopStockEntry"("shopId");

-- `quantity` must be either -1 (unlimited) or non-negative. Matches the
-- Zod refine on `shopStockEntrySchema`.
ALTER TABLE "ShopStockEntry" ADD CONSTRAINT "ShopStockEntry_quantity_check"
  CHECK ("quantity" = -1 OR "quantity" >= 0);

-- `priceOverride`, when set, must be non-negative (a negative override
-- would be a "shop pays buyer to take item" scenario — not in v1).
ALTER TABLE "ShopStockEntry" ADD CONSTRAINT "ShopStockEntry_priceOverride_nonnegative_check"
  CHECK ("priceOverride" IS NULL OR "priceOverride" >= 0);
