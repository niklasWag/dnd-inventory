# Roadmap

Living checklist for shipping the D&D 5e (2024) Inventory Manager. Steps are intentionally fine-grained — one checkbox per file / function / test — so progress is visible and nothing slips. **Mark items only when fully done.**

Source of truth for *what* and *why*: `MVP.md`, `OUTLINE.md`, `TECH_STACK.md`. This doc tracks *progress*, not specs — if a step here disagrees with those docs, the docs win. The **MVP** section mirrors `MVP.md` §11 (M0–M7); the **Release** section mirrors `OUTLINE.md` §10 (M1–M7) and folds in §11 (Open Questions) + §12 (Future / Stretch).

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` skipped/dropped (note why).

---

## MVP

Mirrors `MVP.md` §11 (M0–M7). Each milestone has a trailing **Notes** block for free-form progress logging — dates, decisions, blockers, follow-ups.

### M0 — Skeleton

App boots; welcome empty state; settings page with wipe; logging plumbing in place.

**Repo & tooling**
- [x] pnpm workspace root (`pnpm-workspace.yaml`, root `package.json`)
- [x] `apps/web` Vite + React 19 + TypeScript app scaffolded
- [x] `packages/shared` package created (empty placeholder index)
- [x] `packages/rules` package created (empty placeholder index)
- [x] `packages/seeds` package created (empty placeholder index)
- [x] `infra/docker/` directory created with placeholder README
- [x] Root `tsconfig.base.json` with `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`
- [x] Per-package `tsconfig.json` extending base
- [x] ESLint config (flat config) with TS + React rules
- [x] Prettier config + `.editorconfig`
- [x] Vitest config at workspace root + `apps/web`
- [x] `pnpm typecheck` script wired across workspace
- [x] `pnpm --filter @app/web dev` runs the empty app
- [x] `pnpm --filter @app/web build` produces a production bundle
- [x] `pnpm --filter @app/web lint` passes on empty scaffold
- [x] `pnpm --filter @app/web test` runs (no tests yet, exits 0)
- [x] CI-friendly `.gitignore` (node_modules, dist, .turbo, coverage)
- [x] README with private-use disclaimer (per `../CLAUDE.md` — no PHB/DMG redistribution)

**App shell**
- [x] Tailwind + PostCSS configured in `apps/web`
- [x] shadcn-ui initialized; `components.json` committed
- [x] `src/components/ui/` populated with first primitives (button, dialog, input)
- [x] App entry (`src/main.tsx`) renders root component
- [x] Top-level layout component (header / content slot)
- [x] Empty-state **Welcome** screen ("Create your character" CTA, settings link)
- [x] **Settings** screen route (stub: app version, wipe button)
- [x] Simple in-app router/navigation between Welcome and Settings (no library beyond what's needed)

**Persistence plumbing**
- [x] Dexie added to `apps/web`
- [x] `src/db/schema.ts` — Dexie schema for `dnd-inv:v1` blob (key per `MVP.md` §6/§10)
- [x] `src/db/load.ts` — load AppState (returns `null` if absent)
- [x] `src/db/save.ts` — debounced save of AppState
- [x] `src/db/wipe.ts` — clear all stored state
- [x] Wipe button in Settings wired to `wipe.ts` with confirm dialog
- [x] App boots empty AppState when nothing is stored

**State + logging plumbing**
- [x] Zustand store created in `src/store/index.ts`
- [x] Immer middleware wired
- [x] `src/store/reducer.ts` — action dispatcher skeleton (no actions yet)
- [x] Reducer appends a `TransactionLog` entry on every action (verified by a no-op test)
- [x] Reducer triggers debounced persist after each action
- [x] `src/store/types.ts` — re-exports the `AppState` type from `packages/shared`
- [x] First placeholder reducer test (`reducer.test.ts`) proves logging + persist hooks fire

**Rules-module stubs (per `MVP.md` §8 — type signatures only, no implementation)**
- [x] `packages/rules/capacity.ts` — stub with signatures matching `OUTLINE.md` §6
- [x] `packages/rules/attunement.ts` — stub
- [x] `packages/rules/charges.ts` — stub
- [x] `packages/rules/weight.ts` — stub
- [x] `packages/rules/hoard.ts` — stub
- [x] `packages/rules/validation.ts` — stub
- [x] `packages/rules/pricing.ts` — stub
- [x] `packages/rules/search.ts` — stub
- [x] All stubs export typed signatures only; throw `not-implemented` at runtime
- [x] `packages/rules/index.ts` — barrel export
- [x] Typecheck passes across all stubs (no ripple changes needed when activated later)

#### M0 — Notes

> _Free-form progress log. Add dated entries, decisions, blockers, links to PRs, etc._
>
> **2026-06-22 — Workspace shell scaffolded.** pnpm 11.8.0 (installed via `npm i -g pnpm`), Node 24.17.0. Root `package.json`, `pnpm-workspace.yaml`, three empty `packages/*` (`@app/shared`, `@app/rules`, `@app/seeds`) + `apps/.gitkeep` + `infra/docker/.gitkeep`. TS strict base + per-package configs. ESLint flat config bans `any` per CLAUDE.md. Prettier + `.editorconfig`. Vitest wired with `--passWithNoTests` for the empty-scaffold phase. `pnpm typecheck | lint | test | format:check` all green.
>
> **Open items deferred to next M0 chunk:** `apps/web` scaffold (Vite + React + Tailwind v4 + shadcn + TanStack Router); Dexie + Zustand + Immer plumbing; Welcome + Settings screens; 8 rules-module stubs; React-specific ESLint rules; Vitest config in `apps/web`; private-use README.
>
> **Issues noted:**
> - An IDE plugin keeps re-adding an `allowBuilds:` block to `pnpm-workspace.yaml`. Harmless — pnpm 11 uses `onlyBuiltDependencies` (also present). Likely a pnpm VS Code extension; investigate or disable.
> - Dev-deps (`eslint`, `typescript`, `typescript-eslint`, `@eslint/js`, `vitest`, `@types/node`) are duplicated in every `packages/*/package.json`. Works (pnpm hoists), but cleaner pattern is root-only via `-w`. Tidy when adding `apps/web`.
>
> **2026-06-22 (later) — M0 complete.** All M0 checklist items shipped.
> - **`apps/web` scaffold:** Vite 5 + React 18 + TS strict. `tsconfig.app.json` with `@/*` path alias. `pnpm --filter @app/web dev | build | lint | test | typecheck` all green. Production build = 306 kB JS / 15 kB CSS.
> - **Stack deviations from the original M0 plan:**
>   - **Tailwind v3** instead of v4 — shadcn/ui has the most mature support for v3 today; v4 migration deferred.
>   - **No TanStack Router** — overkill for two M0 screens. A tiny `Route` enum + state lives in `App.tsx`. React Router (per TECH_STACK §2.6) lands when M1 adds the Character Sheet + detail screens.
>   - **Vite 5** (not 6) — vitest 2.x pins vite 5, and dual-version resolution failed under `exactOptionalPropertyTypes`. Bump together when vitest releases its vite-6 line.
> - **shadcn/ui:** `components.json` committed; `cn()` util in `src/lib/utils.ts`; vendored `button`, `dialog`, `input` primitives verbatim under `src/components/ui/` (CLAUDE.md rule: never hand-edited). Token set = shadcn default (Zinc); CSS vars in `src/index.css`. Dark mode forced on `<html class="dark">` for now — full theme toggle is an R7 task.
> - **Persistence:** Dexie DB `dnd-inv` with one object store per entity reserved at v1 (`meta`, `users`, `parties`, `memberships`, `characters`, `stashes`, `items`, `currencies`, `catalog`, `log`). M0 only writes to `meta` under key `appState` — entity stores are pre-declared so M1 can switch to per-entity rows via a `version().stores()` bump rather than a rewrite.
> - **Debounced save:** `createDebouncedSaver(250ms)` coalesces rapid dispatches. `flushPendingPersist()` exposed for tests + future `beforeunload` handler.
> - **Store invariant:** every mutation goes through `dispatch(action)`, which appends a typed `TransactionLogEntry` and triggers the debounced save. UI never writes store state directly. Reducer is pure `(state, action, entry) → { state, entry }`; M0 ships only the no-op path. M1 adds `case` arms per action.
> - **Tests (9 passing):** `src/db/persistence.test.ts` covers load/save round-trip, wipe, and debounce coalescing (via `fake-indexeddb`). `src/store/reducer.test.ts` covers log append, persistence trigger, and ordering.
> - **Rules stubs:** 8 files in `packages/rules/src/` — `capacity`, `attunement`, `charges`, `weight`, `hoard`, `validation`, `pricing`, `search`. Each exports typed signatures only and throws `not-implemented (<milestone>)` at runtime. Barrel `index.ts` namespace-exports them all. `currency.ts` and `inventory.ts` deliberately not stubbed — they get real implementations in M4/M5 per `MVP.md` §8.
> - **README:** added with private-use disclaimer (no PHB/DMG redistribution).
>
> **Followups for M1:**
> - Replace the placeholder `AppState = unknown` in `src/store/types.ts` with `z.infer<>` from `@app/shared` once the Zod schemas exist.
> - Decide on a real router (React Router data-mode per TECH_STACK §2.6) before adding the Character Sheet — the current `Route` enum is a deliberate two-screen stopgap.
> - Tidy duplicated devDeps across `packages/*/package.json` (still pending from the earlier M0 chunk).
> - **Open question for M1:** auto-create a default Storage stash on character creation, or zero? (Listed under Open Questions §11.)
>
> **2026-06-22 (later) — Bumped to current majors + cleared all audit findings.**
> - **React 18 → 19.2.7, Vite 5 → 8.0.16, Vitest 2 → 4.1.9.** Plus `@vitejs/plugin-react` 4→6, `@types/react`/-dom 18→19, `@testing-library/react` 16.1→16.3, `jsdom` 25→29.
> - **TECH_STACK.md updated** (React 18 → React 19 in §1 table + §2.1).
> - **Code changes:** 4 files — React 19 dropped the global `JSX` namespace, replaced `: JSX.Element` with `: ReactElement` imports in `App.tsx`, `Layout.tsx`, `Welcome.tsx`, `Settings.tsx`.
> - **Cleared the "tidy duplicated devDeps" followup along the way:** `packages/{shared,rules,seeds}/package.json` and root `package.json` were still pinning `vitest@^2.1.8`, which transitively dragged in vite 5 + esbuild 0.21. That was the source of every `pnpm audit` finding. Bumping all four to `vitest@^4` eliminated the second vite resolution and dropped the lockfile from 2× vite to 1×.
> - **Security:** `pnpm audit` → **0 vulnerabilities** (was 1 critical / 1 high / 3 moderate, all in stale transitive vite/esbuild).
> - **Workspace status:** typecheck ✓ · lint ✓ · prettier ✓ · 9/9 tests pass · build ✓.
> - **Historical note on the earlier Vite 5 / React 18 / Vitest 2 choice in this same M0:** that was a defensive "what installed cleanly on first try" pick that turned out to be unnecessary — vitest 4 + vite 8 dedupes cleanly. The original rationale in the notes above is left intact as a record.

---

### M1 — Character + auto-provisioned stashes

"Create your character" form provisions User + Party + memberships + Character + Inventory / Party Stash / Recovered Loot.

**Schemas (`packages/shared/schemas/`)**
- [ ] `user.schema.ts` — Zod schema + inferred type
- [ ] `party.schema.ts` — Zod schema + inferred type
- [ ] `partyMembership.schema.ts` — Zod schema with composite-key invariant test
- [ ] `character.schema.ts` — Zod schema (STR only; placeholder fields per MVP)
- [ ] `stash.schema.ts` — Zod schema with `scope` discriminated union
- [ ] `itemDefinition.schema.ts` — Zod schema (no DMG fields yet)
- [ ] `itemInstance.schema.ts` — Zod schema (hard-coded MVP placeholders)
- [ ] `currencyHolding.schema.ts` — Zod schema
- [ ] `transactionLog.schema.ts` — Zod discriminated union over `TxType`
- [ ] `appState.schema.ts` — root Zod schema composing all above
- [ ] `index.ts` — barrel export
- [ ] Round-trip test: parse → serialize → parse equals input

**Reducer actions**
- [ ] `create-character` action type + payload schema
- [ ] `create-character` reducer case provisions User (if absent), Party, 2 memberships, Character, Inventory stash, Party Stash, Recovered Loot stash, 3 CurrencyHoldings
- [ ] Invariant test: exactly one party, two memberships (dm + player), one character
- [ ] Invariant test: `Character.inventoryStashId` points at an `isCarried: true` stash
- [ ] Invariant test: `Party.recoveredLootStashId` points at the recovered-loot stash
- [ ] Invariant test: log entry appended with `type: "create-character"`

**UI**
- [ ] `CreateCharacterForm.tsx` — name, species, class, level, STR fields with Zod-validated form
- [ ] Submit dispatches `create-character` action
- [ ] Welcome screen routes to form, form routes to Character Sheet on success
- [ ] `CharacterSheet.tsx` — header (name/species/class/level/STR)
- [ ] Tab navigation: Inventory / Storage / Party Stash / Recovered Loot (empty bodies for now)
- [ ] `CharacterSheet.test.tsx` — renders header from store after `create-character`

#### M1 — Notes

> -

---

### M2 — Catalog + Inventory adds

PHB seed loads; Catalog Browser; add items to a stash; auto-stack; quantity edits.

**Seed pipeline (`packages/seeds/`)**
- [ ] `phb-2024-mundane.json` placed (private, gitignored or note-only per `../CLAUDE.md`)
- [ ] `phb-2024-mundane.schema.ts` — Zod schema for the seed file
- [ ] `loader.ts` — `loadPhbSeed()` returns parsed, validated entries
- [ ] `loader.test.ts` — seed file parses against schema
- [ ] `seedVersion` exported as a constant

**Reducer**
- [ ] App boot seeds PHB catalog on first launch (empty `seedVersion` → full seed)
- [ ] First-launch seed test: boot with empty AppState → catalog populated, `seedVersion` set
- [ ] App boot upserts PHB entries when `seedVersion` is behind bundle (homebrew untouched)
- [ ] Boot-upsert test: stale seedVersion triggers upsert; homebrew rows survive
- [ ] `acquire` action type + payload schema (adds an `ItemInstance` to a stash)
- [ ] `acquire` reducer case implements auto-stack on `(definitionId, notes ?? "")`
- [ ] Auto-stack test: adding same `(defId, notes)` twice → one row, qty 2
- [ ] Auto-stack test: same defId with different notes → two rows
- [ ] `consume` action (quantity decrement / row removal at 0)
- [ ] `consume` test: decrement above 0 keeps row, decrement to 0 removes it
- [ ] Log entries appended for `acquire` and `consume`

**UI**
- [ ] `AddItemModal.tsx` with Catalog / Custom tabs (Custom is stubbed for M6)
- [ ] Catalog search input + category filter
- [ ] Catalog row with quantity selector + "Add to [current stash]"
- [ ] Inventory tab renders item rows from store
- [ ] Per-row quantity adjust (+/− buttons) dispatching `acquire` / `consume`
- [ ] Per-row Remove action with confirm
- [ ] `CatalogBrowser.tsx` route (read-only PHB list with placeholder Duplicate button for M6)
- [ ] Component test: add same item twice → one row, qty 2 in the DOM

**Item Detail screen (per `MVP.md` §7 screen 4)**
- [ ] `ItemDetail.tsx` — full description, quantity, notes (per-item history hidden, data captured)
- [ ] Click an item row in any stash navigates to its Item Detail
- [ ] `edit-item-instance` action + payload schema (notes, customName, quantity) — **NOTE: new TxType not yet in `OUTLINE.md` §4 — propose adding before implementing**
- [ ] Edit notes on item instance dispatches `edit-item-instance`
- [ ] Edit customName on item instance dispatches `edit-item-instance`
- [ ] Edit-instance test: changes persist; log entry recorded
- [ ] Invariant test: `edit-item-instance` rejects edits to fields not owned by the instance (rarity, weight, etc. live on the definition)
- [ ] Component test: edit notes → close → reopen detail → notes persisted

#### M2 — Notes

> -

---

### M3 — Storage stashes

Create / rename / delete named Storage stashes; per-stash detail view.

**Reducer**
- [ ] `create-stash` action + payload schema (Storage only; Inventory/Party/Recovered are auto-provisioned)
- [ ] `create-stash` test: appends Stash + matching CurrencyHolding row
- [ ] Invariant test: cannot create a second `isCarried: true` stash for the same character
- [ ] `rename-stash` action + reducer case
- [ ] `rename-stash` test: name updates, id stable
- [ ] `delete-stash` action + reducer case
- [ ] `delete-stash` invariant: refuses to delete Inventory / Party Stash / Recovered Loot
- [ ] `delete-stash` behavior: items move to Recovered Loot, then stash + its CurrencyHolding are removed
- [ ] `delete-stash` test: items end up in Recovered Loot with provenance log entry

**UI**
- [ ] Storage tab lists Storage stashes as cards (item count + GP-equivalent placeholder until M4)
- [ ] "New Storage stash" button → modal with name input
- [ ] Click card navigates to `StorageDetail` route
- [ ] `StorageDetail.tsx` — items table, rename button, delete button (with confirm count)
- [ ] Component test: create → rename → delete flow

#### M3 — Notes

> -

---

### M4 — Currency

Per-stash coins, conversion helper, GP-equivalent totals on stash list/cards.

**Rules (`packages/rules/currency.ts`)**
- [ ] `toCopper(coins)` implemented
- [ ] `toCopper` tests cover all 5 denominations + zero + mixed
- [ ] `fromCopper(cp)` implemented (sensible denomination mix)
- [ ] `fromCopper` tests cover boundary mixes (e.g. 99 cp, 100 cp, 1000 cp)
- [ ] `toGpEquivalent(coins)` implemented
- [ ] `toGpEquivalent` test
- [ ] `convert(coins, target)` implemented
- [ ] `convert` tests cover up-conversion (cp→gp) and down-conversion (gp→cp)
- [ ] `add(a, b)` / `subtract(a, b)` implemented with negative-guard
- [ ] `subtract` test: throws / returns error when result would be negative

**Reducer**
- [ ] `currency-change` action + payload schema (target stashId, delta object)
- [ ] `currency-change` reducer applies via `add` / `subtract`
- [ ] `currency-change` test: deltas applied, log entry recorded with before/after
- [ ] `currency-change` invariant test: refuses to push any denomination negative

**UI**
- [ ] Currency row component (5 coin inputs + total GP-equivalent)
- [ ] Inline +/− buttons per denomination
- [ ] "Convert" helper (source denom → target denom, qty)
- [ ] Storage cards / Party Stash summary show GP-equivalent total
- [ ] Component test: convert 100 sp → 10 gp updates row + total

#### M4 — Notes

> -

---

### M5 — Move + Split

Move-all between any stashes; split action. Deleted-stash items flow through Recovered Loot.

**Rules (`packages/rules/inventory.ts`)**
- [ ] `addInstance(stashId, defId, qty, notes)` implemented (auto-stack)
- [ ] `addInstance` tests cover new row + stack-onto-existing
- [ ] `moveAll(itemInstanceId, toStashId)` implemented
- [ ] `moveAll` tests: same-stash no-op, cross-stash transfer, auto-stack on arrival
- [ ] `split(itemInstanceId, qty)` implemented
- [ ] `split` tests: valid split, qty >= original rejected, qty <= 0 rejected

**Reducer**
- [ ] `transfer` action + payload schema
- [ ] `transfer` reducer case wraps `moveAll`
- [ ] `transfer` test: source row decremented/removed; destination row appears or stacks
- [ ] `transfer` log entry includes from-stash, to-stash, defId, qty
- [ ] Split as a sub-mode of `transfer` (or its own action) — pick one, document in code
- [ ] Split test covered end-to-end through the reducer

**UI**
- [ ] `MoveItemModal.tsx` — target stash picker (all user-accessible stashes)
- [ ] `SplitModal.tsx` — quantity selector, in-place split
- [ ] Per-row Move / Split actions in every stash table
- [ ] Component test: move-all from Inventory → Party Stash updates both views
- [ ] Component test: split row in place; new row movable

#### M5 — Notes

> -

---

### M6 — Custom items + duplicate

Homebrew create/edit/delete with live propagation; duplicate-to-edit for PHB.

**Reducer**
- [ ] `create-homebrew` action + payload schema
- [ ] `create-homebrew` reducer adds an `ItemDefinition` with `source: "homebrew"`
- [ ] `create-homebrew` test: catalog grows by 1; log entry recorded
- [ ] `edit-homebrew` action + reducer case (PHB rows rejected)
- [ ] `edit-homebrew` propagation test: changing name updates every stash row by `definitionId` lookup
- [ ] `delete-homebrew` action + reducer case
- [ ] `delete-homebrew` invariant: cannot delete a homebrew currently referenced by any ItemInstance (or: cascade-remove instances — pick one, document)
- [ ] Duplicate-to-edit: clones PHB row as homebrew with `duplicatedFromId` set
- [ ] Duplicate test: clone has new id, `source: "homebrew"`, original untouched

**UI**
- [ ] `HomebrewForm.tsx` — all `ItemDefinition` fields, Zod-validated
- [ ] AddItemModal "Custom" tab wired to `HomebrewForm`
- [ ] Catalog Browser: PHB row shows Duplicate; homebrew row shows Edit + Delete
- [ ] Edit flow opens `HomebrewForm` pre-filled
- [ ] Delete flow has confirm; surfaces "X stashes hold this item" count
- [ ] Component test: edit homebrew name → all stash rows reflect new name

#### M6 — Notes

> -

---

### M7 — Backup

Export JSON; import with replace-all confirm. Log entries captured for all mutations.

**Export / Import**
- [ ] `src/io/export.ts` — serializes full AppState (including log) to a JSON blob
- [ ] Export validates the AppState against root Zod schema before writing
- [ ] Export attaches `version`, `seedVersion`, and an ISO timestamp
- [ ] Export tests: round-trip (export → parse → re-validate) is identity
- [ ] `src/io/import.ts` — parses file, validates against root Zod schema
- [ ] Import rejects malformed input with a user-facing error
- [ ] Import test: malformed JSON → error; valid JSON → state replaced wholesale
- [ ] Settings UI: Export button → file download
- [ ] Settings UI: Import button → file picker + replace-all confirm dialog
- [ ] Settings UI shows current `version` and `seedVersion`

**Character & party rename (per `MVP.md` §7 screen 9)**
- [ ] `rename-character` action + payload schema — **NOTE: new TxType not yet in `OUTLINE.md` §4 — propose adding before implementing**
- [ ] `rename-character` reducer case + test (name updates, id stable, log entry recorded)
- [ ] `rename-party` action + payload schema — **NOTE: new TxType not yet in `OUTLINE.md` §4 — propose adding before implementing**
- [ ] `rename-party` reducer case + test
- [ ] Settings UI: Character name field with save
- [ ] Settings UI: Party name field with save

**Definition-of-Done for MVP** (per `MVP.md` §11)
- [ ] Fresh user can: create character, add mundane items, create ≥1 Storage stash, deposit to Party Stash, move items between all four stash types
- [ ] PHB seed populates on first launch (verified by manual smoke test)
- [ ] JSON round-trip end-to-end: export → wipe → import restores state **including log** (bit-for-bit identical, asserted by a test)
- [ ] Editing a homebrew item updates display in every stash holding it (smoke test)
- [ ] Adding the same item twice yields one row, qty 2 (covered by M2 tests, smoke-verified)

#### M7 — Notes

> -

---

## Release (Post-MVP)

Sections mirror **`OUTLINE.md` §10** (M1–M7). Each release milestone adds **purely additive** changes — no MVP schema field renamed/removed. The fine-grained tasks reference the relevant OUTLINE.md subsections (§3.x features, §4 data model, §6 rules modules, §8 permissions). §11 (Open Questions) and §12 (Future / Stretch) are tracked as their own sections at the end.

> **Authority note:** If anything here drifts from `OUTLINE.md`, the outline wins. Update the outline first, then this roadmap.

### R1 — Characters & encumbrance (outline §10 M1)

Character entity (inventory-only data); equip; encumbrance (off/advisory/hard); single-level containers + Bag of Holding. Covers OUTLINE §3.3, §3.4 (equip), §3.6, §3.8 (attune slot tracking foundation), §4 `Character` / `Stash` / `ItemInstance` activations, §6 capacity/attunement/weight/validation modules.

**Schema activations (§4)**
- [ ] `ItemInstance.equipped` allowed to be `true`
- [ ] `ItemInstance.attuned` allowed to be `true`
- [ ] `Character.encumbranceRule` accepts `"advisory" | "hard"` (in addition to `"off"`)
- [ ] `Character.maxAttunement` becomes DM-editable (was display-only in MVP)
- [ ] `ItemInstance.containerInstanceId` becomes settable (single-level only)
- [ ] Migration test: MVP exports import cleanly with all placeholders preserved

**Reducer actions (§4 TransactionLog union)**
- [ ] `equip` action + payload schema (`{ itemInstanceId, characterId, slot? }`)
- [ ] `unequip` action + payload schema
- [ ] Invariant test: equip only from `scope=character, isCarried=true` stash
- [ ] `attune` action + payload schema (`{ itemInstanceId, characterId }`)
- [ ] `unattune` action + payload schema
- [ ] Attunement slot-cap invariant test (uses `Character.maxAttunement`)
- [ ] Action to set `Character.maxAttunement` (DM-only when 2+ members; per §8.1)
- [ ] Action to set `Character.encumbranceRule` (DM-only when 2+ members; per §8.1)

**Rules — activate stubs (§6)**
- [ ] `packages/rules/capacity.ts` implemented (STR × 15; encumbered > 5×STR; heavily > 10×STR)
- [ ] `capacity.ts` tests cover boundaries + `off` / `advisory` / `hard` enforcement
- [ ] `packages/rules/attunement.ts` implemented (slot tracking, prereq display string)
- [ ] `attunement.ts` tests
- [ ] `packages/rules/weight.ts` implemented (single-level container + Bag-of-Holding flat-weight exception)
- [ ] `weight.ts` tests cover normal containers and BoH-style exceptions
- [ ] `packages/rules/validation.ts` implemented (equip slot conflicts: 2H + shield, etc.)
- [ ] `validation.ts` tests

**UI (§5)**
- [ ] Capacity bar on Inventory tab (per-character; warning states matching enforcement level)
- [ ] Equipped-slots panel on Inventory tab
- [ ] Attunement counter (X/max) on Inventory tab
- [ ] Equip toggle on Inventory rows
- [ ] Attune toggle on Inventory rows
- [ ] One-level container view inside Inventory
- [ ] Encumbrance-rule selector on Character settings

#### R1 — Notes

> -

---

### R2 — Magic items (outline §10 M2)

DMG 2024 seed; attunement w/ warnings + DM cap override; charges with batch recharge. Covers OUTLINE §3.7 (DMG catalog), §3.8 (full magic-item & charge tracking), §4 `ItemDefinition` extensions, §6 `charges.ts`.

**Seed (§7)**
- [ ] `seed/dmg-2024.json` placed (private; same private-use disclaimer as PHB)
- [ ] DMG seed Zod schema
- [ ] DMG seed loader + tests
- [ ] `seedVersion` bumped; re-seed test: PHB+DMG upsert, homebrew untouched

**Schema activations (§4)**
- [ ] `ItemDefinition.rarity` becomes settable (`common`…`artifact`)
- [ ] `ItemDefinition.requiresAttunement` becomes settable
- [ ] `ItemDefinition.attunementPrereq` becomes settable (display string)
- [ ] `ItemDefinition.charges` becomes settable (`{ max, rechargeRule }`)
- [ ] `ItemInstance.identified` allowed to be `false`
- [ ] `ItemInstance.currentCharges` allowed to be a number

**Rules — activate stub (§6)**
- [ ] `packages/rules/charges.ts` implemented (dawn / dusk / long-rest / short-rest / custom)
- [ ] `charges.ts` tests cover each recharge trigger
- [ ] `charges.ts` never-negative + never-over-max invariants

**Reducer actions (§4 TransactionLog union)**
- [ ] `use-charge` action + payload schema
- [ ] `recharge` action + payload schema (per-trigger)
- [ ] `recharge` batch action (long-rest / dawn / dusk applies to all eligible items)
- [ ] `identify` action + payload schema (`{ itemInstanceId, previousHint?, newHint? }`)
- [ ] DM-only invariant test for `identify` in 2+-member parties (§8.1)

**UI (§5)**
- [ ] Rarity color coding in catalog + item rows
- [ ] Attunement prerequisite displayed as advisory text on item detail
- [ ] Charge counter + manual recharge button on Item Detail
- [ ] "Long rest" / "Dawn" / "Dusk" batch buttons on Character Sheet
- [ ] Unidentified items render as "Unknown Magic Item" + DM-set hint (display invariant per §8)
- [ ] DM identification panel (§5.13): toggle identified, edit hint text

#### R2 — Notes

> -

---

### R3 — Backend skeleton (outline §10 M3)

Self-hosted server, Discord OAuth, user model, sync of solo data, nightly snapshots. Covers OUTLINE §3.1 (Discord login), §3.13 (server backups), §9 (architecture: server-authoritative, websocket-ready), §4 `User` (discordId/avatarUrl) and `Metadata`.

**Backend bootstrap (`apps/server`)**
- [ ] `apps/server` Fastify + TypeScript scaffolded
- [ ] Postgres + Prisma set up
- [ ] Prisma schema mirrors `packages/shared/schemas` Zod definitions
- [ ] Initial migration generated and applied
- [ ] `Metadata` table tracking canonical `seedVersion` (§4)
- [ ] PHB + DMG seed runner on server boot (upsert)
- [ ] Auth.js + Discord provider wired (authorization code + PKCE, scope `identify`)
- [ ] Session cookie issuance after token exchange
- [ ] `User.id` linked via `discordId`; `avatarUrl` populated
- [ ] Per-user AppState sync endpoint (push reducer actions)
- [ ] Per-user AppState pull/snapshot endpoint
- [ ] Authoritative validation: server re-runs reducer against incoming actions
- [ ] Nightly snapshot job to disk (default 30-day retention; configurable per §11)
- [ ] User-triggered JSON export still works client-side (parity with §3.13)
- [ ] `infra/docker/` compose: web + server + postgres for local dev

**Web integration**
- [ ] Login screen: "Sign in with Discord" button (§5.1)
- [ ] Hub screen (§5.2): Create party / Join party / Create solo cards + existing parties list
- [ ] Web sync client pushes reducer actions to server
- [ ] Web reconciles server events back into the store
- [ ] Offline-first: Dexie remains primary cache; solo party works offline (§9)
- [ ] Offline banner reserved for multi-member mode (R4 will gate behavior)
- [ ] Settings: Account section shows Discord displayName + avatar (§5.17)
- [ ] Settings: Logout button clears session cookie and returns to Login screen

#### R3 — Notes

> -

---

### R4 — Multi-member parties (outline §10 M4)

Invite codes, multi-user joining, Party Stash, Recovered Loot, Banker appointment + distribution toolkit, DM/Player role split when 2+ members. Covers OUTLINE §3.1 (permissive-until-others-join), §3.2, §3.5 ("split evenly"), §3.10 (loot distribution), §3.14 (Banker), §8.1 (full permission matrix), §8.3 (leaving/kicking).

**Schema activations (§4)**
- [ ] `Party.bankerUserId` becomes settable (was always `null` in MVP)
- [ ] `Party.inviteCode` becomes user-visible / rotatable
- [ ] `PartyMembership` supports count > 2
- [ ] New parties default `isSoloShortcut: false`; legacy solo parties keep `true`
- [ ] Composite-key invariant test: `(userId, partyId, role)` allows DM+player for creator

**Reducer actions (§4 TransactionLog union)**
- [ ] `join-party` action + payload schema
- [ ] `leave-party` action: moves owned items + currency to Recovered Loot (§8.3)
- [ ] `leave-party` auto-clears `Party.bankerUserId` if departing player was Banker
- [ ] `leave-party` writes `revoke-banker` entry with `reason: "left-party"` when applicable
- [ ] `kick-player` action: same Recovered Loot transfer (§8.3)
- [ ] `kick-player` Banker auto-clear with `reason: "kicked"`
- [ ] `appoint-banker` action + payload schema
- [ ] `revoke-banker` action + payload schema
- [ ] Invariant test: DM cannot self-appoint as Banker (§3.14)
- [ ] Invariant test: Banker target must have active `role="player"` membership
- [ ] Invariant test: Banker role only legal when `memberCount >= 2`
- [ ] `dm-transfer` action + payload schema
- [ ] `delete-character` action + payload schema (`{ characterId, name, lastSessionId? }` per §4)
- [ ] `delete-character` reducer case: moves owned items + currency to Recovered Loot, clears `PartyMembership.characterId`
- [ ] `delete-character` invariant test: owning user keeps their membership (can recreate a character)
- [ ] `delete-character` log payload snapshots itemCount + currencyTotalCp (mirrors `delete-stash` pattern in §4)
- [ ] `currency-change` extended `reason` values (`split-evenly`, `gameplay-drain`)
- [ ] Action: split Party Stash currency evenly across characters
- [ ] Action: Banker gives currency / items to a specific player from Party Stash
- [ ] Action: Banker gives currency / items from Recovered Loot to a specific player
- [ ] Action: Banker takes from Party Stash / Recovered Loot into own purse
- [ ] Invariant test: when Banker active, DM cannot distribute to specific players (§8.1)
- [ ] Invariant test: when Banker active, players cannot self-claim from Party Stash / Recovered Loot (§3.14)
- [ ] Invariant test: when no Banker, players self-claim freely from both pools (§3.14)
- [ ] DM-only custom-item creation enforced once `memberCount >= 2` (§3.7, §8.1)
- [ ] `actorRole` on log derived correctly: `"banker"` if `Party.bankerUserId === actorUserId`, else membership role (§4)

**DM cross-character actions (§8.1 "Edit other players' inventory via explicit action")**
- [ ] DM-issued `acquire` / `consume` against another player's character (logged with `actorRole: "dm"`)
- [ ] DM-issued `transfer` between any two stashes in the party
- [ ] DM-issued `equip` / `unequip` on another player's character
- [ ] DM-issued `attune` / `unattune` (bypasses cap with explicit confirm; cap-override still logs)
- [ ] DM-issued `use-charge` / `recharge` on another player's item (force-recharge per §3.8)
- [ ] DM-issued character-field edits (name, species, class, level, STR) via explicit action — separate from owner self-edits
- [ ] Invariant test: every DM cross-character action writes a log entry that the affected owner can see in the party log
- [ ] Invariant test: no silent edits — UI never mutates another player's data without dispatching a logged action (§8 "DM principle")

**Server-side**
- [ ] Invite-code generation endpoint (DM-only, rotatable)
- [ ] Invite-code redemption endpoint
- [ ] Websocket join/leave channel per party (foundation for R5)
- [ ] Server authoritative checks for every action above
- [ ] Departure flow: archive empty parties (no destructive delete) per §8.3

**UI**
- [ ] Hub: Join party (paste code) flow wired
- [ ] Party Settings screen (§5.15): invite code regenerate / revoke, kick player, appoint / revoke Banker, transfer DM
- [ ] Member list with role badges (DM / Player / Banker)
- [ ] Party Stash (§5.5): Banker distribution controls (split-evenly, give-to-player, give-items-to-player)
- [ ] Party Stash for DM-when-Banker-active: distribute-to-player controls hidden; add/remove-for-gameplay visible
- [ ] Recovered Loot (§5.6): same Banker/DM split as Party Stash
- [ ] Offline banner activates for multi-member parties (§9)
- [ ] Component test: Banker toggle changes both Party Stash and Recovered Loot control sets

**DM Dashboard (§5.9)**
- [ ] `DmDashboard.tsx` route (DM-only; desktop-only per §5 form factor)
- [ ] At-a-glance grid: all characters with name + class + level + GP-equivalent
- [ ] Party Stash + Recovered Loot summary cards on the dashboard
- [ ] Total party gold (sum of all GP-equivalent across characters + pools)
- [ ] Click-through from any row navigates to that character's sheet (DM read-all)
- [ ] DM-only route guard (hidden from non-DM members)

#### R4 — Notes

> -

---

### R5 — Live sync & history (outline §10 M5)

Websocket sync; per-item history; party log with session-tag filter; offline banner in party mode. Covers OUTLINE §3.11, §3.12, §4 `Session`, §5.8 (History/Log).

**Sync**
- [ ] Websocket party-room subscription (server pushes action diffs)
- [ ] Optimistic UI: web applies action locally, reconciles on server ack
- [ ] Conflict resolution policy documented and implemented (server is authoritative)
- [ ] Reconnect flow replays missed events
- [ ] Offline banner active in multi-member parties; writes blocked while offline (§9)

**Sessions (§4 `Session`)**
- [ ] `Session` entity (id, partyId, number, date, notes, isCurrent)
- [ ] Invariant: at most one `isCurrent` session per party
- [ ] Action: `start-session` (clears previous `isCurrent`)
- [ ] Action: `end-session`
- [ ] `TransactionLog.sessionId` populated from current session at write time

**History UI**
- [ ] Party log timeline view (§5.8)
- [ ] Filters: session / character / item / action type / actorRole
- [ ] Per-item history queried directly from log (no separate table, per §4)
- [ ] Permission rule: per-item history visible to current owner + DM (§3.11, §8)
- [ ] Virtualized list / pagination for long histories
- [ ] Banker actions tagged `actorRole: "banker"` visible to all members (§3.14)

#### R5 — Notes

> -

---

### R6 — DM tools (outline §10 M6)

Loot distribution wizard (per-hoard mode), hoard generator, identification flow with hints, shop manager (static + modifiers). Covers OUTLINE §3.7 (search), §3.9, §3.10, §6 `hoard.ts` / `pricing.ts` / `search.ts`.

**Rules — activate stubs (§6)**
- [ ] `packages/rules/hoard.ts` implemented (DMG 2024 tables by CR/level band)
- [ ] `hoard.ts` tests cover representative CR bands
- [ ] `packages/rules/pricing.ts` implemented (base price × shop modifier; default 0.5× sell)
- [ ] `pricing.ts` tests cover modifier, override, and sell-to-merchant rate
- [ ] `packages/rules/search.ts` implemented (fuzzy across name + description + tags)
- [ ] `search.ts` tests cover ranking + filter combinations

**Schema activations (§4 `Shop`)**
- [ ] `Shop` entity activated (id, partyId, name, priceModifier, sellToMerchantRate, stock)
- [ ] `Shop.stock` entries: `{ itemDefinitionId, priceOverride?, quantity }` with `-1` = unlimited
- [ ] `ItemInstance.ownerType = "shop"` becomes legal
- [ ] Action: `purchase` (`{ itemInstanceId, quantity, currencyDelta, shopId }`)
- [ ] Action: `sale` (`{ itemInstanceId, quantity, currencyDelta, shopId }`)
- [ ] Purchase decrements finite shop stock; unlimited stock untouched

**Loot distribution (§3.10)**
- [ ] Loot Distribution Wizard screen (§5.10) — per-hoard choice: shared pool vs direct assign
- [ ] "Drop loot into shared pool" action (loot → Party Stash; players claim per §3.14 rules)
- [ ] "Assign loot directly to player" action (item lands in target character's Inventory or Storage)
- [ ] Wizard tags emitted log entries with the active session (§3.12)

**Hoard generator (§3.5, §5.11)**
- [ ] Hoard Generator screen using `hoard.ts`
- [ ] Output flows into the Loot Distribution Wizard

**Identification (§3.8, §5.13)**
- [ ] Identification Panel UI: list of unidentified instances in the party
- [ ] DM toggles `identified`; players see real name update via sync
- [ ] DM-set hint editable

**Shops (§3.9, §5.12)**
- [ ] Shop Manager screen: create / edit shops + stock + modifiers
- [ ] Manual purchase flow: DM resolves each buy/sell as explicit `purchase` / `sale` transfer
- [ ] Catalog Browser "Add to shop" picker

**Catalog search**
- [ ] Catalog search wired to `search.ts` (replaces M2's simple search)
- [ ] Filters by category, rarity, attunement-required, cost, source (§3.7)

#### R6 — Notes

> -

---

### R7 — Polish (outline §10 M7)

Light/dark theme, responsive player views (mobile), fuzzy multi-field search, accessibility pass. Covers OUTLINE §5 form factor, §5.17 Settings.

- [ ] Theme system with light / dark / system-default toggle (§5.17)
- [ ] Player views mobile-responsive: Character Sheet, Party Stash, Recovered Loot, Transfer Modal, Item Detail (§5)
- [ ] DM tools remain desktop-only by design (§5) — verify layout doesn't claim otherwise
- [ ] Fuzzy multi-field search live across Catalog + stash tables (uses `search.ts` from R6)
- [ ] Accessibility: keyboard navigation across all interactive elements
- [ ] Accessibility: ARIA labels on all icon-only buttons
- [ ] Accessibility: color-contrast pass against WCAG AA
- [ ] Accessibility: screen-reader audit on Character Sheet + Party Stash flows
- [ ] Performance pass on log size (capping, IndexedDB pagination if needed)
- [ ] Re-seed conflict hints ("this item has updates" on duplicated PHB/DMG rows) (per `MVP.md` §12)
- [ ] Variant-rules toggle exposed in Settings (§5.17)
- [ ] **Bulk multi-select for move / delete** on stash tables (§3.4) — checkbox column, bulk action bar
- [ ] Bulk-move test: select N items, pick target stash, all transfer with one log entry each (or a single grouped entry — decide and document)
- [ ] Bulk-delete test: select N items, confirm once, all removed

#### R7 — Notes

> -

---

### Open Questions (outline §11)

Track resolution before the relevant milestone ships. Each is a decision, not an implementation task — check once decided + linked in code.

- [ ] **Snapshot retention** — decide: hard-coded 30 days vs admin-settings-exposed (impacts R3)
- [ ] **Discord outage fallback** — decide: session validity window (N days) if OAuth unreachable (impacts R3)
- [ ] **Invite code lifetime** — decide: single-use vs reusable, time-bounded or not (impacts R4)
- [ ] **Recovered-loot pruning** — decide: grow forever vs auto-expire stale items (impacts R4/R5)
- [ ] **History detail level** — decide: ownership transitions only vs every edit on per-item history (impacts R5)
- [ ] **Default Storage stash on character creation** — decide: auto-create one vs zero (impacts MVP M1 / R1 polish)
- [ ] **DM-as-player on creation** — decide: explicit prompt vs auto-add deletable player membership (impacts R4)

#### Open Questions — Notes

> -

---

### Future / Stretch (outline §12)

Not committed; capture interest + scope creep here so it doesn't leak into M1–M7.

- [ ] Live shopping session (promote shop module from static to live; players browse + buy in real time)
- [ ] Crafting tracker (downtime, components)
- [ ] Wear-and-tear / item conditions (homebrew-friendly)
- [ ] Item wishlist per character (DM hints)
- [ ] Print-friendly inventory sheet (PDF)
- [ ] VTT integration (Foundry / Roll20 character link)
- [ ] Public party directory (opt-in) for finding open campaigns
- [ ] Light character sheet expansion (AC, HP, proficiencies for fuller display)

#### Future / Stretch — Notes

> -

---

## Cross-cutting / Standing Tasks

Not milestone-specific; revisit each release.

- [ ] `../CLAUDE.md` kept in sync with reality (rules, tech stack, invariants)
- [ ] OUTLINE.md / MVP.md kept authoritative — code never drifts ahead of docs without an update
- [ ] No `any`, `as any`, or `// @ts-ignore` introduced
- [ ] No localStorage usage (Dexie/IndexedDB only)
- [ ] No CSS-in-JS introduced (Tailwind only)
- [ ] `src/components/ui/` only modified via `shadcn-ui add`
- [ ] PHB/DMG seed files never committed to public history

#### Cross-cutting — Notes

> -
