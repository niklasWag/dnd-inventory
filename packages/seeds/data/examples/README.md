# Seed file examples

The real PHB / DMG seed JSON files are **not redistributed** in this repo
(gitignored per `.gitignore` and CLAUDE.md — WotC-copyrighted content is
for private use only). These two files show the **expected shape** of the
seed data the loader expects at:

- `packages/seeds/data/phb-2024-mundane.json`
- `packages/seeds/data/dmg-2024.json`

## Usage

Copy an example into the parent `data/` directory and rename:

```bash
cd packages/seeds/data
cp examples/phb-2024-mundane.example.json phb-2024-mundane.json
cp examples/dmg-2024.example.json         dmg-2024.json
```

Then run the app / server — the loader will pick them up on next boot
(the reducer's `seed-catalog` action upserts every row and bumps the
persisted `seedVersion`).

## File shape

Each file is a **top-level JSON array** of entries. The Zod schemas
authoritatively describe the shape:

- PHB entries → `packages/seeds/src/phb-2024-mundane.schema.ts`
  (`phbSeedFileSchema`)
- DMG entries → `packages/seeds/src/dmg-2024.schema.ts`
  (`dmgSeedFileSchema`)

The loader (`packages/seeds/src/loader.ts`) mints stable ids by combining
a source prefix with the entry's `slug`:

- `phb-2024:<slug>` for PHB rows
- `dmg-2024:<slug>` for DMG rows

**Keep slugs stable across edits.** Renaming a `slug` after items have
been created against the old id will orphan every `ItemInstance` that
references it. Renaming `name` / `description` / `weight` / etc. is
safe — those aren't part of the id.

## PHB entry (mundane items)

Required fields: `slug`, `name`, `category`.
Optional: `weight`, `cost`, `description`, `tags`.

```json
{
  "slug": "rope-hempen-50ft",
  "name": "Rope, Hempen (50 ft)",
  "category": "gear",
  "weight": 10,
  "cost": { "amount": 1, "currency": "gp" },
  "description": "A coil of hempen rope.",
  "tags": ["adventuring-gear"]
}
```

**`category`** must be one of: `weapon | armor | gear | tool |
ammunition | consumable | magic | currency | container | other`
(see `packages/shared/src/schemas/itemDefinition.ts:itemCategorySchema`).

**`cost.currency`** must be one of: `cp | sp | ep | gp | pp`.

**`slug`** must match `^[a-z0-9][a-z0-9-]*$` (lowercase kebab-case).

## DMG entry (magic items)

Required fields: `slug`, `name`, `category`, `rarity`.
Optional: `weight`, `cost`, `description`, `tags`, `requiresAttunement`,
`attunementPrereq`, `flatWeight`, `charges`.

```json
{
  "slug": "wand-of-magic-missiles",
  "name": "Wand of Magic Missiles",
  "category": "magic",
  "rarity": "uncommon",
  "weight": 1,
  "requiresAttunement": false,
  "description": "This wand has 7 charges. Expend 1 or more to cast Magic Missile.",
  "tags": ["wand"],
  "charges": {
    "max": 7,
    "rechargeRule": "dawn",
    "rechargeAmount": "1d6+1"
  }
}
```

**`rarity`** must be one of: `common | uncommon | rare | very-rare |
legendary | artifact`.

**`charges.rechargeRule`** must be one of: `dawn | dusk | long-rest |
short-rest | custom | none`. Use `none` for single-use consumables
(potions / scrolls / necklace beads) — when their `currentCharges`
decrements to 0 the reducer auto-emits a synthetic `consume` entry to
remove the row.

**`flatWeight: true`** marks Bag-of-Holding-style containers whose
contents are ignored by the encumbrance calculation (only the
container's own `weight` counts). See OUTLINE §3.6.

**`attunementPrereq`** is an advisory display string (e.g. "Requires
attunement by a wizard"). It's shown in the UI; the reducer's `attune`
action does NOT check it — DMs can always allow it via cap-override.

## Boot behavior

On every server startup (and every web boot in local mode) the loader:

1. Parses + validates both JSON files against the Zod schemas.
   **Any parse failure is a hard error** — a malformed seed refuses to
   boot the server (or the web app) rather than silently skipping rows.
2. Compares each entry against the persisted `AppState.catalog`:
   - Row missing → added
   - Row present but content changed → updated (except homebrew rows,
     which are user-owned and never overwritten)
   - Row present + unchanged → skipped
3. Emits ONE `seed-catalog` log entry summarizing the delta
   (`addedDefinitionIds`, `updatedDefinitionIds`) and bumps
   `AppState.seedVersion` if the bundled `SEED_VERSION` moved forward.

## Testing

Adding entries doesn't require test updates — `packages/seeds/src/loader.test.ts`
exercises the loader against the real files. If you replace them with
these examples for a personal fork, the tests will still pass as long
as the shape is valid.
