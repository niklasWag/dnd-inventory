-- BUG-011 (2026-07-06) — move encumbrance rule + enforce flag from
-- Character to Party. Encumbrance is a party-wide house rule, not a
-- per-character setting.
--
-- Per CLAUDE.md "no legacy-data debt" the project is WIP with no
-- production users, so we don't preserve pre-existing per-character
-- values. Defaults ('off' / false) are applied to any surviving Party
-- rows in the WIP DB.
--
-- Docs updated in the same slice: OUTLINE.md §3.3/§3.6/§4, MVP.md,
-- USER_FLOWS.md, roadmap.md R1.1 Notes, CLAUDE.md.

-- Add the two columns on Party. Use `DEFAULT` so existing rows get a
-- deterministic value at ALTER time; drop the defaults immediately after
-- (the reducer / server persistor writes them explicitly on new-party
-- creation, and the schema is `NOT NULL` without a default).
ALTER TABLE "Party" ADD COLUMN "encumbranceRule" "EncumbranceRule" NOT NULL DEFAULT 'off';
ALTER TABLE "Party" ADD COLUMN "enforceEncumbrance" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Party" ALTER COLUMN "encumbranceRule" DROP DEFAULT;
ALTER TABLE "Party" ALTER COLUMN "enforceEncumbrance" DROP DEFAULT;

-- Drop the columns from Character.
ALTER TABLE "Character" DROP COLUMN "encumbranceRule";
ALTER TABLE "Character" DROP COLUMN "enforceEncumbrance";
