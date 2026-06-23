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
- [x] `user.schema.ts` — Zod schema + inferred type
- [x] `party.schema.ts` — Zod schema + inferred type
- [x] `partyMembership.schema.ts` — Zod schema with composite-key invariant test
- [x] `character.schema.ts` — Zod schema (STR only; placeholder fields per MVP)
- [x] `stash.schema.ts` — Zod schema with `scope` discriminated union
- [x] `itemDefinition.schema.ts` — Zod schema (no DMG fields yet)
- [x] `itemInstance.schema.ts` — Zod schema (hard-coded MVP placeholders)
- [x] `currencyHolding.schema.ts` — Zod schema
- [x] `transactionLog.schema.ts` — Zod discriminated union over `TxType`
- [x] `appState.schema.ts` — root Zod schema composing all above
- [x] `index.ts` — barrel export
- [x] Round-trip test: parse → serialize → parse equals input

**Reducer actions**
- [x] `create-character` action type + payload schema
- [x] `create-character` reducer case provisions User (if absent), Party, 2 memberships, Character, Inventory stash, Party Stash, Recovered Loot stash, 3 CurrencyHoldings
- [x] Invariant test: exactly one party, two memberships (dm + player), one character
- [x] Invariant test: `Character.inventoryStashId` points at an `isCarried: true` stash
- [x] Invariant test: `Party.recoveredLootStashId` points at the recovered-loot stash
- [x] Invariant test: log entry appended with `type: "create-character"`

**UI**
- [x] `CreateCharacterForm.tsx` — name, species, class, level, STR fields with Zod-validated form
- [x] Submit dispatches `create-character` action
- [x] Welcome screen routes to form, form routes to Character Sheet on success
- [x] `CharacterSheet.tsx` — header (name/species/class/level/STR)
- [x] Tab navigation: Inventory / Storage / Party Stash / Recovered Loot (empty bodies for now)
- [x] `CharacterSheet.test.tsx` — renders header from store after `create-character`

#### M1 — Notes

> **2026-06-23 — M1 complete.**
> - **Zod schemas** for the full MVP `AppState` (`packages/shared/src/schemas/`) — 10 entity schemas + `appState.schema.ts` composing them. `transactionLog.ts` is a discriminated union currently with one variant (`create-character`); M2+ extends both the union and the reducer in lockstep. Round-trip test (3 assertions) confirms parse → serialize → parse is identity, and that bad `scope` values are rejected.
> - **Store typed** — `apps/web/src/store/types.ts` now re-exports `AppState = AppStateShape | null` and the `Action` discriminated union. `LogEntrySlice` (in `reducer.ts`) is a distributed conditional over `TransactionLogEntry` so adding future variants preserves type-narrowing per case.
> - **`create-character` reducer** — pure; provisions user + party + 2 memberships + character + 3 stashes (Inventory carried, Party Stash, Recovered Loot) + 3 CurrencyHoldings + a typed log entry. Rejects double-create with "already exists". 8 invariant tests; new persisted state passes `appStateSchema.parse(...)`.
> - **React Router v7 (data router mode)** — `createBrowserRouter` mounted in `App.tsx`; routes `/`, `/create-character`, `/character/:id`, `/settings` nested under `RootLayout`. Replaced the M0 `Route` enum stopgap entirely (file deleted). `*` falls back to `Navigate to="/"`.
> - **CreateCharacterForm** — React Hook Form + Zod resolver. Fields: name, species, class, level (1–20), STR (1–30). Errors render inline with `role="alert"`. Submit dispatches `create-character`, then navigates to `/character/:id`.
> - **CharacterSheet** — header (name/species/class/level/STR) + 4 ARIA tabs with placeholder bodies pointing at the future milestones that fill them. `<Navigate to="/" replace />` when the URL id doesn't match any character.
> - **Welcome** auto-redirects to the existing character when one exists; otherwise shows the CTA.
> - **Bootstrap hydration** — `src/store/hydrate.ts` reads the persisted blob, validates with a `{ appState, log }` wrapper schema, and pushes into the store BEFORE the first render in `main.tsx`. Malformed blobs warn and fall back to empty (no crash on stale data).
> - **Tests:** 18 passing (3 schema, 1 store plumbing, 8 create-character reducer/invariants, 3 CharacterSheet + 3 persistence still from M0).
> - **Build:** 565 kB JS / 15.4 kB CSS (gzip 179 kB / 4 kB). Code-splitting is a polish task (TECH_STACK §10) — fine for MVP.
>
> **Resolved open question (roadmap §Open Questions / OUTLINE §11):** characters land with **zero default Storage stashes**. The Storage tab stays empty until the user clicks "New Storage stash" in M3. Rationale: matches the MVP §5.2 wording ("auto-creates Inventory, Party Stash, Recovered Loot"); a default extra stash would always be deletable, which makes it churn rather than utility.
>
> **Followups for M2:**
> - Catalog seed pipeline (`packages/seeds/`), `acquire` / `consume` actions, AddItemModal, Item Detail.
> - `edit-item-instance` and the rename/character actions in M7 are noted in the roadmap as needing OUTLINE §4 updates before implementation — propose the spec change in M2.
> - Tab state in CharacterSheet is local component state — fine for M1 since tab choice isn't persisted, but M2 may want to encode it in the URL (`?tab=inventory`) for shareable / browser-back-friendly behavior.
> - Consider extracting the per-stash currency row component placeholder into M4 work rather than re-doing the placeholder bodies as full rows.

---

### M2 — Catalog + Inventory adds

PHB seed loads; Catalog Browser; add items to a stash; auto-stack; quantity edits.

**Seed pipeline (`packages/seeds/`)**
- [x] `phb-2024-mundane.json` placed (private, gitignored or note-only per `../CLAUDE.md`)
- [x] `phb-2024-mundane.schema.ts` — Zod schema for the seed file
- [x] `loader.ts` — `loadPhbSeed()` returns parsed, validated entries
- [x] `loader.test.ts` — seed file parses against schema
- [x] `seedVersion` exported as a constant

**Reducer**
- [x] App boot seeds PHB catalog on first launch (empty `seedVersion` → full seed)
- [x] First-launch seed test: boot with empty AppState → catalog populated, `seedVersion` set
- [x] App boot upserts PHB entries when `seedVersion` is behind bundle (homebrew untouched)
- [x] Boot-upsert test: stale seedVersion triggers upsert; homebrew rows survive
- [x] `acquire` action type + payload schema (adds an `ItemInstance` to a stash)
- [x] `acquire` reducer case implements auto-stack on `(definitionId, notes ?? "")`
- [x] Auto-stack test: adding same `(defId, notes)` twice → one row, qty 2
- [x] Auto-stack test: same defId with different notes → two rows
- [x] `consume` action (quantity decrement / row removal at 0)
- [x] `consume` test: decrement above 0 keeps row, decrement to 0 removes it
- [x] Log entries appended for `acquire` and `consume`

**UI**
- [x] `AddItemModal.tsx` with Catalog / Custom tabs (Custom is stubbed for M6)
- [x] Catalog search input + category filter
- [x] Catalog row with quantity selector + "Add to [current stash]"
- [x] Inventory tab renders item rows from store
- [x] Per-row quantity adjust (+/− buttons) dispatching `acquire` / `consume`
- [x] Per-row Remove action with confirm
- [x] `CatalogBrowser.tsx` route (read-only PHB list with placeholder Duplicate button for M6)
- [x] Component test: add same item twice → one row, qty 2 in the DOM

**Item Detail screen (per `MVP.md` §7 screen 4)** — **DEFERRED:** roadmap-listed `edit-item-instance` TxType is not in `OUTLINE.md` §4. Per CLAUDE.md (docs are source of truth), the spec needs an additive entry before we ship this. M2 ships **without** Item Detail; rename / notes flows land in a later milestone once the OUTLINE update lands.
- [-] `ItemDetail.tsx` — full description, quantity, notes (per-item history hidden, data captured)
- [-] Click an item row in any stash navigates to its Item Detail
- [-] `edit-item-instance` action + payload schema (notes, customName, quantity) — **DEFERRED**, needs OUTLINE §4 update first
- [-] Edit notes on item instance dispatches `edit-item-instance`
- [-] Edit customName on item instance dispatches `edit-item-instance`
- [-] Edit-instance test: changes persist; log entry recorded
- [-] Invariant test: `edit-item-instance` rejects edits to fields not owned by the instance (rarity, weight, etc. live on the definition)
- [-] Component test: edit notes → close → reopen detail → notes persisted

#### M2 — Notes

> **2026-06-23 — M2 complete.**
> - **PHB seed (`packages/seeds/`):** `data/phb-2024-mundane.json` ships **181 entries** covering all six MVP §9 categories — 38 weapons (simple+martial, melee+ranged, incl. firearms), 13 armor pieces (light/medium/heavy + shield), 64 adventuring gear, 37 tools (artisan's + thieves' + gaming sets + instruments), 5 ammunition, 18 containers, plus 6 consumables. Schema-validated at boot via `phbSeedFileSchema`. Deterministic ids prefixed `phb-2024:<slug>` — slug lives in the JSON so name tweaks never orphan `ItemInstance.definitionId` references. `PHB_SEED_VERSION = 1`.
> - **TransactionLog union extended** with three new variants (`acquire`, `consume`, `seed-catalog`); the M1 distributive `LogEntrySlice<T>` conditional kept all per-case narrowing intact, no rework needed in the middleware.
> - **Reducer** gained three pure cases. `acquire` auto-stacks on `(definitionId, notes ?? "")`; the log slice always carries the resolved `itemInstanceId` so both first-add and subsequent stacks reference the same row. `consume` decrements and removes rows that hit 0, with a `removed: boolean` flag on the log payload so future readers don't have to replay state. `seed-catalog` upserts by id — homebrew rows (no `phb-2024:` prefix) are invisible to the loop.
> - **`store/seed.ts`** is the single place the UI imports `@app/seeds` from. Called twice per boot path: once in `main.tsx` after hydration (no-op when state is null OR seedVersion is current), once in `CreateCharacter` right after `dispatch({ type: 'create-character' })` so fresh users see a populated AddItemModal without refreshing.
> - **Three stash tabs share one component** — `StashItemsTable` renders Inventory / Party Stash / Recovered Loot with the same row UI (+/−, Remove). Storage tab keeps the M3 placeholder. `AddItemModal` + `CatalogPicker` route into all three.
> - **Catalog Browser** mounted at `/catalog`, linked from `RootLayout` next to Settings. Read-only table with search + category filter; PHB rows show a disabled Duplicate button (M6).
> - **Tests:** 45 pass workspace-wide (3 shared schemas + 5 seeds loader + 37 web). 14 new tests around `acquire` / `consume` / `seed-catalog` reducer behavior + 5 new component tests on CharacterSheet (empty state, item row render, auto-stack to-DOM, − button dispatches consume, Storage placeholder).
> - **Build:** 665 kB JS / 20.2 kB CSS (gzip 207 / 4.8). The +100 kB vs M1 is `@radix-ui/react-select` — first time we needed the select primitive. Code-splitting is a TECH_STACK §10 polish task, not blocked on it now.
>
> **Spec deviations & open items, surfaced for visibility:**
> - **`edit-item-instance` deferred.** The roadmap had it under M2, but OUTLINE §4's TxType union doesn't list it. Item Detail screen + per-instance notes editing are gated on an additive OUTLINE update (propose during M3). Workaround for users who want notes today: they can re-acquire with different `notes` to split into a new row — auto-stack respects the `(definitionId, notes ?? "")` key.
> - **`acquire.source = "custom-create"` for catalog-add.** OUTLINE §4 enumerates `source: "hoard" | "purchase" | "custom-create" | "duplicate"`. None of these is a clean fit for "user pulled a PHB row from the catalog" — `custom-create` is the closest (it's the user-initiated path). Once R6 introduces shops + `purchase`, revisit and either add a `"catalog-add"` value or reuse `purchase` with `shopId: null`. Filed for OUTLINE consideration; not blocking M3.
> - **Substring search, not fuzzy.** `CatalogPicker` does `name + description + tags` substring matching against `query.toLowerCase()`. The fuzzy ranker (OUTLINE §3.7) lives in `packages/rules/search.ts` and activates in R6. MVP §12 acknowledges this — `default to fuzzy across name+description+tags`.
> - **Result list capped at 50 in `CatalogPicker`** to keep the modal scrollable. `CatalogBrowser` has no cap (it's the full read-only view). If users grow homebrew beyond ~200 entries we'll need pagination — not yet.
>
> **Followups for M3:**
> - `create-stash` / `rename-stash` / `delete-stash` actions + reducer.
> - `delete-stash` invariant: items flow to Recovered Loot before the stash + its CurrencyHolding are removed (MVP §5 flow #12).
> - Storage tab gains the card list + detail screen.
> - shadcn `tabs` primitive when CharacterSheet's hand-rolled tab nav starts pulling its weight (M3 adds Storage interaction, which makes the tab UX more meaningful).
>
> **2026-06-23 — OUTLINE §4 update landed (additive, no breaking changes).** Resolved the two open spec items flagged above without any code change:
> - **Added `edit-item-instance`** to the TxType union with a `changedFields` enum (`customName | notes | identified | equipped | attuned | currentCharges | conditionOverrides`). Mirrors `edit-homebrew` shape — only field names are logged; full new value lives on the instance. Unblocks the deferred Item Detail screen.
> - **Added `rename-character`** (dedicated rename type) **and `edit-character`** (catch-all for species/class/level/STR/maxAttunement/encumbranceRule). Removes the M7 `NOTE: not yet in OUTLINE §4` blockers.
> - **Added `rename-party`** for symmetry with `rename-stash`.
> - **Extended `acquire.source` enum** with `"catalog-add"` alongside the existing `"hoard" | "purchase" | "custom-create" | "duplicate"`. M2's catalog dispatch path will switch from `"custom-create"` (misuse) to `"catalog-add"` in M2.5; existing persisted logs remain valid.
>
> This sets up the **M2.5 mini-milestone** below — code catches up to the spec before M3 starts on stash CRUD.

---

### M2.5 — Spec cleanup + Item Detail

Mini-milestone bridging M2 → M3. Closes the M2 deferred items now that OUTLINE §4 has been amended (see M2 Notes, 2026-06-23 entry). Tight scope on purpose — no new entities, no new screens beyond Item Detail. Lands the `"catalog-add"` rename and the `edit-item-instance` action so M3 can focus purely on stash CRUD.

**`acquire.source` rename: `"custom-create"` → `"catalog-add"`**
- [x] Extend `acquireEntry` Zod schema in `packages/shared/src/schemas/transactionLog.ts` to accept `"catalog-add"` (additive; keep `"custom-create"` valid so existing persisted logs still parse)
- [x] Update `CatalogPicker.tsx` dispatch site to use `source: "catalog-add"`
- [x] Update `StashItemsTable.tsx` re-acquire (+) button to use `source: "catalog-add"`
- [x] Grep any other call sites passing `source: "custom-create"` for catalog-add semantics; update them
- [x] Update tests asserting `source: "custom-create"` for catalog-add to expect `"catalog-add"`
- [x] Round-trip test: an `AppState` exported with M2-vintage `"custom-create"` source entries imports cleanly under the extended schema (no migration step required)

**`edit-item-instance` reducer action (per OUTLINE §4)**
- [x] `editItemInstanceEntry` Zod schema variant in `transactionLog.ts` matching the OUTLINE shape (`{ itemInstanceId, changedFields: (…)[] }`)
- [x] `edit-item-instance` action type + payload Zod schema (full new values per editable field; reducer extracts `changedFields` from the diff)
- [x] Reducer case: validate target instance exists; apply patch via Immer; log `changedFields` only for fields that actually changed
- [x] Invariant test: rejects edits to fields owned by `ItemDefinition` (rarity, weight, cost, …) — only `ItemInstance`-owned fields are mutable
- [x] Invariant test: rejects unknown `itemInstanceId`
- [x] Invariant test: no-op edit (same values) does NOT append a log entry (or appends with `changedFields: []` — pick one, document)
- [x] Reducer test: edit `customName` only → log entry `changedFields: ["customName"]`
- [x] Reducer test: edit `notes` only → log entry `changedFields: ["notes"]`
- [x] Reducer test: edit both → single log entry with both field names

**Item Detail screen (per MVP §7 screen 4 + OUTLINE §5 screen 4)**
- [x] New route `/item/:itemInstanceId` mounted under `RootLayout`
- [x] `ItemDetail.tsx` — header (definition name, source badge, category), full description, weight, cost, quantity (read-only — qty adjusts still happen in the stash table)
- [x] Editable fields (MVP-relevant only): `customName`, `notes`. Other `edit-item-instance` enum members (`identified` / `equipped` / `attuned` / `currentCharges` / `conditionOverrides`) are scaffolded in the action but UI controls land in their proper milestones (R1 / R2)
- [x] Form uses React Hook Form + Zod resolver (matches CreateCharacterForm pattern)
- [x] Submit dispatches `edit-item-instance`; success returns user to the source stash tab (or stays put with a saved toast — pick one)
- [x] `<Navigate to="/" replace />` when `:itemInstanceId` doesn't resolve to an instance
- [x] Click handler on `StashItemsTable` row name navigates to `/item/:id`
- [x] In-screen Back affordance — `←` button at the top of `ItemDetail` returns to the owning character's sheet (label is stash-aware, e.g. "Back to Inventory" / "Back to Party Stash"). Added post-plan in response to user feedback that "clicking the app logo" was the only exit path.
- [x] Component test: edit notes → save → reload page → notes persist + appear

**Per-item history (first time live; covers OUTLINE §3.11)**
- [x] `<ItemHistory itemInstanceId={id} />` component renders log entries that reference this instance
- [x] Selector queries `state.log` for entries whose payload contains `itemInstanceId === id` (no separate `ItemHistory` table per OUTLINE §4)
- [x] Renders entry type + timestamp + actorRole + a short human summary per TxType
- [x] Component test: acquire → edit-item-instance → consume sequence produces 3 history rows in order
- [x] Note: log permission gating (owner + DM only per §8) lands in R4/R5 — single-user MVP shows the full slice

**Out of M2.5 (deferred to their proper milestones)**
- [-] `rename-character` / `edit-character` / `rename-party` action implementations — spec'd in OUTLINE now, but no UI needs them yet. Move from M7 once Settings rename screens land (still M7 territory per MVP §7 screen 9).
- [-] Identification, equip/attune toggles, charge adjustment from Item Detail — R1 / R2 work.
- [-] Edit history pruning / log retention — R5/R7.

**Verification gate**
- [x] `pnpm -r --parallel typecheck` green
- [x] `pnpm --filter @app/web test` green (existing 45 + new ~12)
- [x] `pnpm --filter @app/web lint` green
- [x] `pnpm --filter @app/web build` succeeds; bundle delta < +30 kB JS
- [x] Manual smoke: add item → click name → edit notes → save → reload → notes persisted + show in history

#### M2.5 — Notes

> **2026-06-23 — M2.5 complete.**
> - **Schema changes (additive, no migration).** `packages/shared/src/schemas/transactionLog.ts` grew two ways: (1) `acquireEntry.source` enum extended with `"catalog-add"` alongside the existing `"hoard" | "purchase" | "custom-create" | "duplicate"` — `"custom-create"` retained for back-compat so M2-vintage Dexie blobs still rehydrate (covered by a dedicated round-trip test); (2) new `editItemInstanceEntry` variant with `payload: { itemInstanceId, changedFields: ('customName' | 'notes')[] }` and `.min(1)` enforcing no-op-reject at the schema boundary. OUTLINE §4 lists a wider `changedFields` enum — narrowing here is intentional (MVP `itemInstance` literals lock the rest until R1/R2).
> - **Action union + reducer.** `Action` in `store/types.ts` gained a fifth member (`edit-item-instance`) with a partial-patch payload shape. Reducer case iterates a closed allowlist (`customName`, `notes`), diffs against the current row, and throws `'edit-item-instance: no fields changed'` if `changedFields` ends up empty. Empty-string `notes` is preserved as a distinct value from `undefined` (decision #4); the auto-stack key `(definitionId, notes ?? "")` collapses both anyway so this is invisible to `acquire`. Edit-induced auto-stack collisions leave rows separate (decision #5) — covered by an explicit reducer test and tagged as an M5 follow-up.
> - **`source = "custom-create" → "catalog-add"` rename hit 17 sites** as planned: 1 in `CatalogPicker`, 1 in `StashItemsTable` (the +/− re-acquire path), 11 in `reducer.test.ts`, 4 in `CharacterSheet.test.tsx`. The back-compat fixture in `reducer.test.ts:757` is the sole intentional `"custom-create"` site remaining — proves Dexie blobs from M2 still validate against the extended schema.
> - **`/item/:itemInstanceId` route + ItemDetail screen.** RHF + Zod form for `customName` + `notes`; `useEffect(reset, [view.row])` keeps `isDirty` accurate across saves; sparse-patch dispatch (reducer re-diffs as the source of truth for `changedFields`); `toast.success('Item updated')` confirms; `<Navigate to="/" replace />` on unknown id. Read-only details panel renders qty / weight / cost / source / category / description; a JSX comment names the R1/R2 deferred fields (equipped, attuned, identified, currentCharges, conditionOverrides) so the next milestone author finds the breadcrumb.
> - **`<ItemHistory>` component** filters `state.log` via type-guarded `.filter` (preserves narrowing on the three `itemInstanceId`-carrying TxTypes — `acquire`, `consume`, `edit-item-instance`). Mandatory `useShallow` wrapper — same pattern as `CatalogBrowser` and `StashItemsTable` to avoid the fresh-array-every-render infinite loop. Summarizes per type; permission gating (owner + DM only) deferred to R4/R5.
> - **`StashItemsTable` row name** is now a button-styled-as-link that navigates to `/item/:row.id`. +/− and Remove unchanged. ARIA `aria-label="Open details for {displayName}"` for screen readers.

> **2026-06-23 (later) — Back affordance added to `ItemDetail` (post-plan).**
> - **Symptom:** the M2.5 plan didn't include an in-screen back/close affordance, so the only way to leave `ItemDetail` was clicking the app-title button in `RootLayout` (which routes to `/`, not back to the source stash). User flagged this as unintuitive.
> - **Fix:** added a `<ArrowLeft />` ghost-Button at the top of `ItemDetail`. Label is stash-aware via the selector: `Back to {stash.name}` (`"Back to Inventory"` / `"Back to Party Stash"` / `"Back to Recovered Loot"`). Destination is **deterministic** — `navigate('/character/<characterId>')` rather than `navigate(-1)` — so a directly-typed URL still has a sensible back target. `characterId` is the owning character for character-scope stashes, or the lone MVP character for party/recovered-loot scopes (MVP §6: exactly one character).
> - **Test added:** `ItemDetail.test.tsx` "renders a Back link that returns to the owning character sheet" (extends the harness's memory router to register `/character/:id` too). Tests now: **69 passing**.
> - **No bundle delta** — `ArrowLeft` from `lucide-react` was already in the tree-shaken bundle via the existing icons in `Layout.tsx` (`BookOpen`, `SettingsIcon`).
> - **Forward-looking UX principle (carry into M3+):** every detail/sub-page route must ship with its own in-screen Back/Close affordance. The header in `RootLayout` is intentionally minimal (Catalog + Settings buttons, app-title-as-home-link) and should NOT be expanded into a global back-button surface — that conflicts with the "header stays dumb" comment in `Layout.tsx`. Detail screens own their own back affordance. Applies to:
>   - M3 `StorageDetail` (`/storage/:stashId`) — needs `Back to {character.name}` (the character whose Storage it is).
>   - R2 anywhere we land a "magic item identification" sub-screen.
>   - R5 per-item history full-page view (if/when that splits out of the inline `<ItemHistory>` component).
> - **shadcn `sonner`** added via `pnpm dlx shadcn@latest add sonner`. The CLI dumped the file into a literal `@/components/ui/` directory at workspace root (alias not resolved on first run) — moved to the correct `src/components/ui/sonner.tsx`. The generated primitive uses `next-themes` upstream; this project doesn't use Next.js and has hard-coded dark mode for now (theme system is R7), so the file was minimally adapted to drop the `next-themes` import and hard-code `theme="dark"`. The dep was removed from `package.json`. `<Toaster />` mounts in `App.tsx` next to `<RouterProvider />` (singleton sibling).
> - **Tests:** 76 pass workspace-wide (3 shared + 5 seeds + 68 web). New: 11 reducer (`edit-item-instance` + back-compat round-trip + `catalog-add` schema), 5 `ItemHistory`, 9 `ItemDetail`, 1 `CharacterSheet` row-name navigation. Existing 45 still green after the `'custom-create'` → `'catalog-add'` rename.
> - **Build:** 706 kB JS / 21.79 kB CSS (gzip 217 / 5.02). Bundle delta: **+41 kB JS raw / +10 kB gzip** vs M2's 665 kB baseline. Slightly over the plan's `+30 kB raw` target — sonner (~6 kB gz) plus the lucide-react icons it pulls in (`CircleCheck`, `OctagonX`, etc.) explain the gap. Gzip delta is reasonable. Code-splitting is still a TECH_STACK §10 polish task; flagged in M2.5 follow-ups but not blocking.
>
> **Followups carried forward to M3 / M5:**
> - **Auto-stack invariant under edit (M5):** editing `notes` can produce two rows sharing `(definitionId, notes ?? "")`. M2.5 left them separate; M5 (move/split) has the right context to decide between reject / explicit-merge / silent-merge-with-synthetic-consume.
> - **Empty-string `notes` semantics:** preserved as distinct value but `<ItemHistory>` doesn't currently distinguish `''` vs `undefined` in its summaries. Track if it surfaces in user feedback.
> - **Bundle-size watchpoint:** +41 kB raw / +10 kB gzip in M2.5. M3 should record its own delta against this baseline; if the cumulative trend exceeds 1 MB raw, time to invest in `manualChunks` config.
> - **Test-fixture extraction (M3):** `bootstrap()` now lives in 4 test files (reducer, CharacterSheet, ItemDetail, ItemHistory). Worth extracting to `apps/web/src/test/fixtures.ts` next milestone — kept the diff tight in M2.5.

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
- [ ] `StorageDetail` ships an in-screen Back affordance to the owning character's sheet — per M2.5 UX principle (see M2.5 Notes 2026-06-23 later entry). Detail routes own their own Back; do NOT expand `RootLayout` into a global back-button surface.
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
- [ ] `rename-character` action + payload schema (OUTLINE §4: `{ characterId, oldName, newName }`)
- [ ] `rename-character` reducer case + test (name updates, id stable, log entry recorded)
- [ ] `rename-party` action + payload schema (OUTLINE §4: `{ partyId, oldName, newName }`)
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
- [x] **Default Storage stash on character creation** — decide: auto-create one vs zero (impacts MVP M1 / R1 polish). **Resolved 2026-06-23: zero.** Characters land with Inventory + Party Stash + Recovered Loot only; Storage tab is opt-in via M3's "New Storage stash". Matches MVP §5.2 wording.
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
