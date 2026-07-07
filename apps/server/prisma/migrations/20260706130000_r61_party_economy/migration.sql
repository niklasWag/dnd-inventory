-- R6.1 (2026-07-06) — per-party economy controls (OUTLINE §3.5).
--
-- Adds `Party.priceModifier` (Float, default 1.0) and `Party.baseCurrency`
-- (enum default 'gp'). `priceModifier` scales PHB/DMG seed prices at
-- display + purchase time; homebrew items skip it per §3.5 line 133.
-- `baseCurrency` is the display ceiling for `formatPrice`
-- canonicalisation.
--
-- Docs updated in the same slice: roadmap.md R6.1 Notes.
--
-- Per CLAUDE.md "no legacy-data debt" the project is WIP with no
-- production users, so existing Party rows receive the defaults at
-- ALTER time.

-- Enum for baseCurrency values. Matches the Zod
-- `currencyDenominationSchema` values 1:1.
CREATE TYPE "CurrencyDenom" AS ENUM ('cp', 'sp', 'ep', 'gp', 'pp');

-- Additive: both columns have defaults so existing rows backfill cleanly.
-- Defaults stay on the column (unlike BUG-011, which dropped them post-
-- alter) because the server persistor may create Party rows through
-- Prisma without spelling every default — matching how the reducer's
-- bootstrap already sets these to 1.0 / 'gp' explicitly on the Zod side.
ALTER TABLE "Party" ADD COLUMN "priceModifier" DOUBLE PRECISION NOT NULL DEFAULT 1.0;
ALTER TABLE "Party" ADD COLUMN "baseCurrency" "CurrencyDenom" NOT NULL DEFAULT 'gp';

-- CHECK constraint: priceModifier must be strictly positive. Mirrors
-- the Zod `.positive()` at the DB level so a malformed direct-INSERT
-- (bypassing the persistor) can't land a zero or negative modifier
-- that would break `pricing.buyPrice` invariants.
ALTER TABLE "Party" ADD CONSTRAINT "Party_priceModifier_positive_check"
  CHECK ("priceModifier" > 0);
