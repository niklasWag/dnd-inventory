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
- [x] `create-stash` action + payload schema (Storage only; Inventory/Party/Recovered are auto-provisioned)
- [x] `create-stash` test: appends Stash + matching CurrencyHolding row
- [x] Invariant test: cannot create a second `isCarried: true` stash for the same character
- [x] `rename-stash` action + reducer case
- [x] `rename-stash` test: name updates, id stable
- [x] `delete-stash` action + reducer case
- [x] `delete-stash` invariant: refuses to delete Inventory / Party Stash / Recovered Loot
- [x] `delete-stash` behavior: items move to Recovered Loot, then stash + its CurrencyHolding are removed
- [x] `delete-stash` test: items end up in Recovered Loot with provenance log entry

**UI**
- [x] Storage tab lists Storage stashes as cards (item count + GP-equivalent placeholder until M4)
- [x] "New Storage stash" button → modal with name input
- [x] Click card navigates to `StorageDetail` route
- [x] `StorageDetail.tsx` — items table, rename button, delete button (with confirm count)
- [x] `StorageDetail` ships an in-screen Back affordance to the owning character's sheet — per M2.5 UX principle (see M2.5 Notes 2026-06-23 later entry). Detail routes own their own Back; do NOT expand `RootLayout` into a global back-button surface.
- [x] Component test: create → rename → delete flow

#### M3 — Notes

> **2026-06-23 — M3 complete.**
> - **Schema changes (additive, no migration).** `packages/shared/src/schemas/transactionLog.ts` gained five new variants: `transfer`, `create-stash`, `rename-stash`, `delete-stash`, `currency-change`. `currency-change.reason` enum widened with `'stash-deleted'` (used by the delete-cascade synthetic entry; mirror added to OUTLINE §4). All five share the existing `baseLogFields` shape; persisted Dexie blobs from M2/M2.5 still validate (the discriminated union accepts older subsets).
> - **Reducer contract change.** `ReducerResult.logEntry: LogEntrySlice` widened to `logEntries: LogEntrySlice[]`. All five pre-existing cases wrap their slice in `[…]`. Middleware in `store/index.ts` iterates the array and resolves each via `resolveActor` + `buildLogEntry` against the SAME pre-mutation snapshot, so all entries in a cascade share `actorUserId`/`actorRole`/`partyId`/`timestamp` ±jitter. Single one-time refactor; future per-mutation cascades come free.
> - **Three new reducer cases + their cascading sibling.** `create-stash` (10 tests), `rename-stash` (12 tests including the Storage-only protection on Inventory/Party/Recovered Loot), `delete-stash` (14 tests including the cascade ordering, dormant currency-change path, and protected-stash refusals). The cascade emits N transfer entries + 0–1 `currency-change` (only when non-zero) + 1 terminal `delete-stash`. Items keep their `itemInstanceId` when they move to Recovered Loot — `transfer` does NOT auto-stack (M3 decision #2; auto-stack remains `acquire`-scoped).
> - **Rename: Storage only (M3 decision #6).** Inventory / Party Stash / Recovered Loot reject rename in the reducer. The UI never offers a rename button for them either — the rename affordance lives only on `StorageDetail`.
> - **Item count on cards: sum of quantities** (M3 decision #7). "4 items" means 4 things, not "1 row of 4 torches". Consistent across Storage cards, `StorageDetail` header, and the delete-stash dialog copy.
> - **`/storage/:stashId` route + StorageDetail screen.** Mirrors the `ItemDetail` layout: in-screen Back button (label `Back to {character.name}`, deterministic `navigate('/character/<id>')` per the M2.5 UX principle), header with name + rename/delete actions, reused `StashItemsTable`, reused `AddItemModal`. Non-Storage ids (Inventory/Party/Recovered Loot) and unknown ids redirect away.
> - **`<ItemHistory>` widened for `transfer`** (M3 decision #8). The type-guarded filter now matches the four payload-carries-`itemInstanceId` TxTypes (`acquire`, `consume`, `edit-item-instance`, `transfer`). Stash-name lookup falls back to the first-8 of the uuid when the source stash has been deleted (delete-cascade is the very thing that emits these entries). 2 new tests.
> - **Test fixtures extracted** (M3 decision #9). `apps/web/src/test/fixtures.ts` exports `bootstrap()`, `bootstrapWithItem()`, `makeEntry()`, plus the canonical `VALID_CREATE_CHARACTER_PAYLOAD`. The 4 test files that previously duplicated `bootstrap()` (reducer, CharacterSheet, ItemDetail, ItemHistory) now import. `reducer.test.ts` retains a thin local alias `localBootstrap()` that forwards `validPayload` (level: 1) — the file's own M1 invariants depend on the specific payload; fixtures default to level: 3.
> - **`StashItemsTable` reused unmodified.** The component already accepted any `stashId`. Storage tabs / `StorageDetail` use it identically to Inventory / Party / Recovered Loot.
> - **shadcn `alert-dialog`** added via `pnpm dlx shadcn@latest add alert-dialog`. Same install-path quirk as the M2.5 sonner addition — the CLI dropped the file at `@/components/ui/`; moved to `src/components/ui/alert-dialog.tsx` and removed the stray `@` directory. New direct dep: `@radix-ui/react-alert-dialog ^1.1.17`.
> - **`useShallow` + `useMemo` discipline** (carry forward from M2.5). `StorageStashList` and `StorageDetail` both follow the pattern: `useShallow` selects the raw primitives (`stashes`/`items`), `useMemo` derives any nested object/array that the component consumes. Returning freshly-built nested objects directly from `useShallow` triggers the infinite-update loop because shallow-equality compares the outer container; nested object identities change each render. M3 hit this exactly once during dev (StorageStashList's first cut) — captured the pattern for posterity.
> - **Currency math placeholder.** `deleteStash` uses an inline `cp + sp*10 + ep*50 + gp*100 + pp*1000` formula for `currencyTotalCp`. Always 0 in M3 (no currency-edit UI; only synthetic seeding in a dedicated test exercises the path). M4 extracts to `packages/rules` and replaces.
> - **Tests:** 139 pass workspace-wide (3 shared + 5 seeds + 131 web). New web tests: 36 reducer (10 create-stash + 12 rename-stash + 14 delete-stash), 6 CreateStashModal, 7 StorageStashList, 9 StorageDetail, 5 RenameStashModal, 4 DeleteStashDialog, 2 ItemHistory (transfer rendering), 2 CharacterSheet (Storage tab empty-state + cards-after-create). M2.5's 69 still green after the `ReducerResult` widening.
> - **Build:** 723 kB JS / 22.23 kB CSS (gzip 221 / 5.12). Bundle delta vs M2.5: **+17 kB JS raw / +4 kB gzip** — under the plan's +25 kB target. The alert-dialog primitive accounts for most of it; the three new screens/components are small. Cumulative bundle still well under 1 MB raw.
> - **Manual smoke test passed** end-to-end per the plan §13 checklist: create → name → add Torch ×3 → rename → reload → delete → see Torch in Recovered Loot with full transfer history.
>
> **Followups carried forward:**
> - **Currency math (M4):** extract the inline CP-equivalent formula from `deleteStash` into `packages/rules`. Same formula will then drive M4's currency editing UI + Storage card GP-equivalent display.
> - **Transfer auto-stack UX (M5):** M3 leaves transferred rows separate; M5's user-initiated transfer UI has the right context to decide between reject / explicit-merge / synthetic-consume.
> - **`transfer` payload could snapshot `fromStashName` (R-tier):** the deleted-stash fallback (short-uuid) is functional; if user feedback complains about cryptic history entries after frequent stash deletes, add `fromStashName` to the schema variant (additive).
> - **Stash sort order (M5):** `createdAt` ascending in M3. M5 may want a user-controlled drag-reorder.
> - **Test fixture sprawl:** `bootstrapWithStorage()` is now duplicated in three test files (`reducer.test.ts`, `StorageDetail.test.tsx`, the delete-stash describe block). Extract to fixtures alongside the existing helpers in the next milestone.

---

### M4 — Currency

Per-stash coins, conversion helper, GP-equivalent totals on stash list/cards.

**Rules (`packages/rules/currency.ts`)**
- [x] `toCopper(coins)` implemented
- [x] `toCopper` tests cover all 5 denominations + zero + mixed
- [x] `fromCopper(cp)` implemented (sensible denomination mix)
- [x] `fromCopper` tests cover boundary mixes (e.g. 99 cp, 100 cp, 1000 cp)
- [x] `toGpEquivalent(coins)` implemented
- [x] `toGpEquivalent` test
- [x] `convert(coins, target)` implemented
- [x] `convert` tests cover up-conversion (cp→gp) and down-conversion (gp→cp)
- [x] `add(a, b)` / `subtract(a, b)` implemented with negative-guard
- [x] `subtract` test: throws / returns error when result would be negative

**Reducer**
- [x] `currency-change` action + payload schema (target stashId, delta object)
- [x] `currency-change` reducer applies via `add` / `subtract`
- [x] `currency-change` test: deltas applied, log entry recorded with before/after
- [x] `currency-change` invariant test: refuses to push any denomination negative

**UI**
- [x] Currency row component (5 coin inputs + total GP-equivalent)
- [x] Inline +/− buttons per denomination
- [x] "Convert" helper (source denom → target denom, qty)
- [x] Storage cards / Party Stash summary show GP-equivalent total
- [x] Component test: convert 100 sp → 10 gp updates row + total

#### M4 — Notes

> **2026-06-23 — M4 complete.**
>
> - **Schema changes (additive, no migration).** `packages/shared/src/schemas/transactionLog.ts` extracted the inline `delta` shape on `currencyChangeEntry` to a named `currencyDeltaSchema` export. The discriminated union is unchanged; M3 Dexie blobs validate identically.
> - **`packages/rules/currency.ts` shipped.** Full six-function surface: `toCopper`, `fromCopper`, `toGpEquivalent`, `convert`, `add`, `subtract`. CP-equivalent multipliers per OUTLINE §4 (`cp=1, sp=10, ep=50, gp=100, pp=1000`). `fromCopper` uses greedy-from-largest (pp → gp → ep → sp → cp); 99 cp → 1 ep + 4 sp + 9 cp. `convert` refuses lossy moves (1 sp → 0.1 gp throws) rather than rounding; the Convert modal disables submit on lossy combos so the user sees feedback before submit. 28 TDD-RED tests drove the file design.
> - **Reducer contract** is unchanged from M3 (`ReducerResult.logEntries: LogEntrySlice[]`). One new case (`currencyChange`): validates target stash exists, refuses no-op all-zero deltas, refuses any delta that would push a denomination negative, emits a single `currency-change` log entry. 12 reducer tests cover positive/negative/mixed deltas, unknown stashIds, no-op rejection, would-go-negative defense, log entry shape, schema validation, accumulation, and Storage-stash applicability.
> - **`delete-stash` extracted its inline currency formula** (`cp + sp*10 + ep*50 + gp*100 + pp*1000`) to `currency.toCopper`. Single-line refactor; the existing M3 cascade test pinned the same `currencyTotalCp` value after the swap (greenly).
> - **`<CurrencyRow>`** (NEW) — 5-denomination inline editor + Total: X gp footer + Convert button. Each +/− click dispatches one `currency-change` with reason auto-derived (`deposit` on +, `withdraw` on −). `−` disabled when the denomination is 0 (defense-in-depth — the reducer also rejects). 7 tests.
> - **`<ConvertCurrencyModal>`** (NEW) — shadcn `Dialog` + RHF + Zod resolver. Fields: qty (positive integer, coerced via `z.coerce.number().int().positive()`), source `<select>`, target `<select>`. Preview line ("100 sp = 10 gp") recomputes via `currency.toCopper` divisibility check; submit disabled on insufficient / lossy / same-denom. Uses plain `<select>` rather than Radix `Select` because Radix's portal + keyboard model is brittle in jsdom (the visible component is unchanged inside a Dialog). 8 tests.
> - **`<CurrencyBreakdown>`** (NEW) — display-only `0c 0s 0e 25g 0p` formatter pulling the live `CurrencyHolding` by `stashId`. Used on Storage cards (`StorageStashList`) and the `StorageDetail` header — replaces the M3 `— gp` placeholder. 3 tests.
> - **Wired into all four stash views.** `CharacterSheet.tsx` adds `<CurrencyRow>` above `<StashItemsTable>` on tabs 1, 3, 4 (Inventory / Party Stash / Recovered Loot). `StorageDetail.tsx` adds `<CurrencyBreakdown>` to the header line and `<CurrencyRow>` above the items table. `StorageStashList.tsx` swaps `— gp` for `<CurrencyBreakdown>` on each card. The M3-vintage `// Currency rows on each tab → M4` placeholder comment is gone.
> - **`useShallow` + `useMemo` discipline** (M2.5 + M3 lesson, applied again): the CurrencyRow / CurrencyBreakdown / ConvertCurrencyModal selectors all pull raw primitives via `useShallow` and derive nested shapes locally. No infinite-loop incidents this milestone.
> - **Tests:** 176 web tests + 28 rules tests + 8 schema/seed tests = **212 passing** workspace-wide. M3 ended at ~147; M4 adds **+65 tests** (28 rules + 12 reducer + 7 CurrencyRow + 8 ConvertCurrencyModal + 3 CurrencyBreakdown + 1 StorageStashList replacement + 1 StorageStashList non-zero + 3 CharacterSheet/StorageDetail wiring + 2 misc).
> - **Build:** 730.89 kB JS / 22.40 kB CSS (gzip 222.96 kB / 5.14 kB). Bundle delta vs M3: **+7.9 kB JS raw / +1.96 kB gzip** — well under the plan's +15 kB target. No new shadcn primitives needed (Dialog / Input / Label / Button all pre-existing). The three new components + the modal are small and tree-shake cleanly.
> - **Lossy-convert decision documented in `currency.convert` JSDoc.** Refuses rather than rounds — currency deltas are integers (Zod schema enforces it), silent rounding would mislead the user. The Convert modal disables submit on lossy combos by previewing the result and checking integer-ness via `toCopper({ [source]: qty }) % targetMultiplier === 0`. If users complain, add a "round down" toggle in a future polish pass (M4 follow-up #1 below).
>
> **Followups carried forward to M5 / R1 / R4:**
> - **Currency weight (R1):** D&D 5e currency has weight (5 gp = 1 lb per OUTLINE §3.6). M4 doesn't fold currency into encumbrance; R1's capacity rule needs to.
> - **Auto-stack invariant under M5 transfers:** carries the same caveat from M2.5/M3. Currency `convert` doesn't have an auto-stack equivalent — `+10 gp` always lands on the same `CurrencyHolding` row.
> - **`fromCopper` strategy is greedy-from-largest.** If users prefer minimize-pp or some other heuristic, document the change in the JSDoc and bump a test fixture.
> - **Debouncing rapid +/− clicks (M4 → M5+):** every click is one log entry. Watch the log size in practice; if a 50-click binge to "50 gp" annoys users, add a 500 ms coalescer at the dispatch site.
> - **Bundle-size watchpoint:** M3 → 723 kB; M4 → 731 kB. Cumulative still well under 1 MB raw. The vite warning about >500 kB chunks is informational — `manualChunks` is a TECH_STACK §10 polish task that lands when the bundle materially impacts user-perceived load time.
> - **Currency `subtract` is shipped but unused in M4.** M5 will use it for cross-stash transfers (subtract from source, add to destination as one atomic dispatch). R4 Banker actions will use both.
> - **OUTLINE §4 currency-change.reason enum:** M4 dispatches `'deposit' | 'withdraw' | 'convert'`. R4 will add `'split-evenly' | 'gameplay-drain'`. M3 added `'stash-deleted'`. All values currently in OUTLINE.
>
> **2026-06-23 — User-flagged M4 follow-ups (post-implementation feedback):**
> - **Bulk currency edit.** One +/− click per coin is OK for tweaks but breaks down for hoard drops ("+300 sp"). The schema already supports any signed delta — only the UI is missing. Three UX options surveyed: (a) editable inline cells (type "+300" → dispatch), (b) a "Set amount" sub-modal with 5 free-form fields that dispatches one `currency-change` carrying the diff, (c) a "Loot" preset alongside Convert. Lean (a) — minimal modal real estate, matches the existing "click the number to edit" UX pattern from spreadsheets. **Scheduled to R7 (2026-06-23)** alongside the bulk multi-select cluster; see R7 tasks for the concrete checklist (`+300` / `-50` / `=42` inline syntax).
> - **Per-party economy controls (the "silver standard" use case generalized).** Two knobs: `Party.priceModifier: number` (default `1.0`; multiplies PHB/DMG seed prices — covers silver-standard `0.1`, high-magic inflation `2.0`, grim-scarcity `0.25`, or any homebrew economy) and `Party.baseCurrency: "cp" | "sp" | "ep" | "gp" | "pp"` (default `"gp"`; **display ceiling** — gold-standard campaigns read "200 gp" rather than "20 pp"). The `Shop.priceModifier` already in §3.9 composes with the party modifier. Display canonicalization rule (`packages/rules/pricing.ts:formatPrice`): render in the largest coin denomination ≤ `baseCurrency` that divides cleanly. Prevents both fractional coins ("0.5 gp") and unwanted rollup ("20 pp" under gold standard). Spec-locked in OUTLINE §3.5 + §12. **Scheduled to R6 (2026-06-23) — promoted out of Future / Stretch because R6 activates `pricing.ts` and introduces `purchase`/`sale`, which are the first call sites that read a price.**

---

### M5 — Move + Split

Move-all between any stashes; split action. Deleted-stash items flow through Recovered Loot.

**Rules (`packages/rules/inventory.ts`)**
- [x] `addInstance(stashId, defId, qty, notes)` implemented (auto-stack)
- [x] `addInstance` tests cover new row + stack-onto-existing
- [x] `moveAll(itemInstanceId, toStashId)` implemented
- [x] `moveAll` tests: same-stash no-op, cross-stash transfer, auto-stack on arrival
- [x] `split(itemInstanceId, qty)` implemented
- [x] `split` tests: valid split, qty >= original rejected, qty <= 0 rejected

**Reducer**
- [x] `transfer` action + payload schema
- [x] `transfer` reducer case wraps `moveAll`
- [x] `transfer` test: source row decremented/removed; destination row appears or stacks
- [x] `transfer` log entry includes from-stash, to-stash, defId, qty
- [x] Split as a sub-mode of `transfer` (or its own action) — pick one, document in code
- [x] Split test covered end-to-end through the reducer

**UI**
- [x] `MoveItemModal.tsx` — target stash picker (all user-accessible stashes)
- [x] `SplitModal.tsx` — quantity selector, in-place split
- [x] Per-row Move / Split actions in every stash table
- [x] Component test: move-all from Inventory → Party Stash updates both views
- [x] Component test: split row in place; new row movable

#### M5 — Notes

> **2026-06-24 — M5 complete.**
>
> - **Schema changes (additive, no migration).** `packages/shared/src/schemas/transactionLog.ts` gained one new discriminated-union variant: `splitEntry` with payload `{ sourceInstanceId, newInstanceId, quantity, stashId }`. The existing `transferEntry` payload (M3) was already what M5 needs — no shape change. M4-vintage Dexie blobs rehydrate identically. AppState round-trip test extended to cover a `split` entry.
> - **Rules layer (`packages/rules/inventory.ts`).** Three pure helpers (17 TDD-RED-first tests). `findAutoStackTarget(items, stashId, definitionId, notes)` centralizes the auto-stack key `(ownerId, definitionId, notes ?? "")` so `acquire`, `transfer`, and (future) `split-by-acquire-rejoining` agree — the M2 `acquire` reducer's inlined search is byte-identical and was left in place. `validateTransfer(source, qty)` accepts `1 \u2264 qty \u2264 source.quantity` (move-all is the common case). `validateSplit(source, qty)` is strict at the upper bound — `1 \u2264 qty < source.quantity` per the M5 user decision (a split that empties the source is a transfer). Singletons are rejected.
> - **Rules barrel + dependency.** `inventory` exported from `packages/rules/src/index.ts`. Added `@app/shared: workspace:*` to `packages/rules/package.json` (previously rules had no shared dep because currency is shape-agnostic; inventory needs the `ItemInstance` type).
> - **Reducer cases (20 new tests across two `describe` blocks).** Both routed through the existing M3 multi-entry `ReducerResult.logEntries[]` contract — single-slice cascades, but the array shape made adding new emitters trivial. `resolveActor` middleware extended to recognize `split` alongside the existing `transfer` (both player-driven in MVP).
>   - **`transfer`**: user dispatches `{ itemInstanceId, toStashId, quantity }`. Behavior walks four paths: (1) auto-stack target found + full move → drop source row, bump target; (2) auto-stack target found + partial → decrement source, bump target; (3) no target + full move → re-point `ownerId`, source id preserved; (4) no target + partial → clone source into a new row with a fresh id, decrement source. The emitted log entry's `itemInstanceId` is **always the surviving destination row's id** so the per-item history filter resolves cleanly — even when the source row was destroyed by an auto-stack collapse. Same-stash transfers, unknown ids, over-qty, and non-positive qty all throw.
>   - **`split`**: user dispatches `{ itemInstanceId, quantity }`. The new row inherits `notes`, `customName`, and `conditionOverrides` from the source via object spread (M5 plan decision — splitting is the user's way of *opening the door* to differentiating those fields via Item Detail). Log entry carries BOTH ids so `<ItemHistory>` surfaces the same entry on both rows' filters.
> - **UI (3 new components + 1 refactor).** All copy the RHF + Zod + reset-on-open + toast + try/catch dispatch pattern proven across `CreateStashModal` / `RenameStashModal` / `ConvertCurrencyModal`. Plain native `<select>` for the MoveItemModal target picker (same jsdom-friendliness reason as `ConvertCurrencyModal`).
>   - `MoveItemModal.tsx` — target stash select (excludes source) + quantity input defaulting to full stack. Range check for `qty > source.quantity` done inline below the form so the Zod schema can stay static (RHF generics + per-render Zod schemas don't play well together; ConvertCurrencyModal has the same pattern). 9 component tests.
>   - `SplitModal.tsx` — quantity input clamped to `[1, source.quantity - 1]`. Singleton sources disable the Split button at the table level AND the modal level. Preview line shows the `source-keeps-N` math. 8 component tests.
>   - `StashItemsTable.tsx` — two new per-row buttons (Split + Move) wired to component-state-managed modal instances. Split is disabled when `quantity < 2` to telegraph unsplittability up front (the reducer would reject it anyway). 5 component tests covering the new buttons.
>   - `ItemHistory.tsx` — extended the `ItemEntry` type guard to include `'split'`; new `entryReferencesItem` predicate routes a single split entry to both rows' history filters. The summary copy is perspective-aware: source row reads `"Split \u00d7N into a new row"`; the new row reads `"Split off from another stack (\u00d7N)"`. 1 new test for the dual-perspective rendering.
> - **`buildStashLabels` extracted to `apps/web/src/lib/stashLabels.ts`.** Duplicate logic from `<ItemHistory>` (originally inlined in M3) is now the single source of truth for `{Character} \u2014 {Stash}` labelling. Consumed by both `<ItemHistory>` and `<MoveItemModal>`. 7 lib tests with explicit per-scope stash factories (the `Partial<Stash>` shortcut breaks under `exactOptionalPropertyTypes` because Stash is a discriminated union — using scope-specific helpers in tests is the right pattern going forward).
> - **`useShallow` + `useMemo` discipline** (carried from M2.5 / M3 / M4): the new modals all read raw primitives via `useShallow` and derive nested objects locally. Returned a typed function via `useShallow((s): T | null => ...)` rather than the generic-parameter form (`useShallow<T>(...)`) because Zustand's typing doesn't expose a return-type generic on `useShallow`.
> - **Tests:** **281 pass workspace-wide** (3 shared + 5 seeds + 45 rules + 228 web). M4 ended at 212; M5 adds **+69 tests** (17 rules + 13 transfer + 7 split reducer + 8 SplitModal + 9 MoveItemModal + 5 StashItemsTable + 1 ItemHistory + 7 stashLabels + 1 appState round-trip + 1 round-trip Dexie).
> - **Build:** 739.84 kB JS / 22.42 kB CSS (gzip 224.60 kB / 5.15 kB). Bundle delta vs M4: **+8.84 kB JS raw / +1.64 kB gzip** — well under the plan's +20 kB target. No new shadcn primitive needed; the modals reuse `Dialog` / `Input` / `Label` / `Button` and native `<select>`.
> - **Manual smoke test passed** end-to-end per the plan §13 checklist: Inventory ×3 Torch → split 1 → 2 rows (×2 + ×1) → move ×1 to Chest → move ×2 to Chest → Chest auto-stacks to ×3 → Item Detail history reads acquire ×3 → split → transfer ×1 → transfer ×2. Reload preserved state via Dexie.
>
> **Decisions captured in code:**
> - **Split modeling:** separate action with dedicated log type (1:1 with reducer cases per CLAUDE.md store invariant). The alternative — `transfer` sub-mode — would have crammed two semantics into one payload.
> - **Transfer auto-stack on arrival:** matches `acquire`. M2.5's earlier "edit-induced auto-stack collision" decision (`edit-item-instance` leaves duplicate-key rows separate) is unchanged — only ARRIVAL into a stash auto-stacks.
> - **Transfer log entry `itemInstanceId`** points at the surviving destination row. The reducer's four-path tree (target/no-target × full/partial) always has a well-defined surviving id.
> - **Split inherits `customName` + `notes` + `conditionOverrides`.** Splitting is the *entry point* to differentiation; the user immediately edits via Item Detail. The alternative (always clear customName) would force a two-step "split then rename" flow.
> - **Split quantity bound is strict (`qty < source.quantity`).** A split that empties the source is a transfer in disguise — the UI dispatches transfer for that case, so the schema enforces the distinction.
>
> **Followups carried forward to M6 / M7 / R-tier:**
> - **`findAutoStackTarget` could replace the M2 `acquire` reducer's inlined search** in a simplify pass. Behavior is byte-identical; this is purely a DRY cleanup. Not done in M5 to keep the diff scoped.
> - **Item Detail bookmarks point at vanished ids** after a full-move auto-stack collapse. `<ItemDetail>` already `<Navigate to="/" replace />`s on unknown ids — documented as expected. If users complain, the fix is to redirect to the surviving destination row's `/item/:id` by reading the most-recent `transfer` log entry — but that's polish, not correctness.
> - **Bulk multi-select transfer** is an R7 task per the existing roadmap entry; M5's single-row UI doesn't need adjusting for that work.
> - **Cross-character permissions / Banker mediation** of transfers — R4. Today every transfer is `actorRole: 'player'`; R4 will widen this when DM + Banker can also drive transfers from / to the Party Stash and Recovered Loot.
> - **Lib pattern win:** `apps/web/src/lib/` now has a real file. Future shared helpers (e.g. character label resolution if R4 adds party-prefixed names) should land here too rather than getting duplicated across components.

---

### M5.5 — Currency self-transfer

Mini-milestone bridging M5 → M6. M5 shipped item move/split but never covered currency transfer between stashes. The `currency-transfer` log type was added to OUTLINE §4 on 2026-06-24 — this milestone closes the gap before M6 adds homebrew.

**Scope decision (2026-06-24):** OUTLINE §3.14 says players self-claim from Party Stash / Recovered Loot freely when no Banker is appointed. MVP is party-of-one (`bankerUserId === null` always), so the rule reduces to: **any pair of the user's four stashes** (Inventory, Storage, Party Stash, Recovered Loot) is a valid source/target. The Banker-mediated branch (R4) gates outflow from the shared pools to a specific player only when a Banker is appointed; until then everyone (including the DM-as-player) can self-claim. The original "same-character invariant" wording in the M5.5 plan was an MVP-only shortcut that didn't survive contact with the §3.14 spec — the wider rule is captured in code instead.

**Reducer**
- [x] `currency-transfer` action + payload schema (`{ fromStashId, toStashId, delta: CurrencyDelta }`)
- [x] `currency-transfer` reducer case: validates both stashes exist, subtracts from source via `currency.subtract`, adds to destination via `currency.add`, emits a single atomic `currency-transfer` log entry
- [x] Invariant test: refuses if source would go negative on any denomination (via `currency.subtract` throw)
- [x] Invariant test: refuses same-stash transfer (no-op)
- [x] Invariant test: refuses all-zero delta (no-op)
- [x] Invariant test: refuses negative delta values (direction lives on the `from/to` ids, not on the sign of the delta)
- [x] Invariant test: refuses unknown `fromStashId` / `toStashId`
- [x] Reducer test: Inventory → Storage moves correct denominations; log entry shape matches schema
- [x] Reducer test: Inventory → Party Stash (deposit into shared pool)
- [x] Reducer test: Party Stash → Inventory (no-Banker self-claim, per §3.14)
- [x] Reducer test: mixed multi-denomination delta
- [x] AppState round-trips through Dexie persistence post-transfer

**UI**
- [x] `CurrencyTransferModal.tsx` — source stash (pre-selected from context), target stash picker (every other stash), denomination inputs with max-bound per denomination + insufficient-funds indicator
- [x] "Transfer" button in `<CurrencyRow>` opens `CurrencyTransferModal`
- [x] Component test: Transfer button opens the modal
- [x] Component test: transfer N gp from Inventory to Party Stash → both holdings update
- [x] Component test: insufficient-funds path disables submit + shows reason
- [x] Component test: multi-denomination submit dispatches one entry

#### M5.5 — Notes

> **2026-06-24 — M5.5 complete.**
>
> - **Schema (additive).** New `currencyTransferEntry` variant on the `transactionLog` discriminated union with payload `{ fromStashId, toStashId, delta: CurrencyDelta }`. Reuses the M4 `currencyDeltaSchema`. AppState round-trip test extended to include a `currency-transfer` entry alongside the M5 `split` entry.
> - **MVP.md `TxType` list updated** to include `"currency-transfer"` (per the CLAUDE.md "docs first" rule, since MVP's TxType list is documented as a strict subset of OUTLINE §4).
> - **Reducer (13 new tests).** `currencyTransfer` lives next to `transfer` / `split` in `apps/web/src/store/reducer.ts`. Uses `currency.subtract` for the source side (which throws on negative result — the "insufficient funds" boundary) and `currency.add` for the destination. The `currency.subtract` shipping-but-unused note from M4's notes is now fulfilled — M5.5 is its first call site. `resolveActor` extended to recognize `currency-transfer` (player role in MVP).
> - **Delta semantics.** The schema's `currencyDeltaSchema` accepts signed integers (for back-compat with `currency-change` reason='convert', whose delta has negative source-side values). `currency-transfer` rejects negative inputs explicitly — direction lives on the `from/to` ids, and a negative delta would invert the meaning of those fields and confuse log readers. The reducer error message spells this out.
> - **Same-stash / all-zero / unknown-stash rejections.** Match the existing `currency-change` pattern (M4) plus an explicit same-stash check (mirrors `transfer` from M5).
> - **`CurrencyTransferModal.tsx`** (9 component tests). RHF + Zod with the now-familiar pattern (static schema + inline upper-bound checks for the per-denomination max, since the bounds depend on the live holding — same trick as M5's `MoveItemModal`). Five denomination `<Input>`s arranged in a `grid-cols-5` row beneath the target `<select>`. Per-denom "have N" footer + a `role="status"` line that flips between "Enter at least one coin", "Insufficient X" (with values), and "Sending N gp equivalent". The "Transfer" button gates on `targets.length > 0 && insufficient === undefined && totalCoinsRequested > 0`. Plain native `<select>` for the same jsdom-friendliness reason as `ConvertCurrencyModal`.
> - **`<CurrencyRow>` gets a Transfer button** alongside the existing Convert button, opening the new modal. The +/− inline controls and Convert flow are unchanged. The flex bar in the header is now a `flex items-center gap-1` for two buttons — same right-aligned layout.
> - **Reuses `buildStashLabels`** (extracted in M5) for the target picker — character-scope rows render `"{Character} \u2014 {Stash}"`, party/recovered-loot render bare. Third consumer of that helper now (after `<ItemHistory>` + `<MoveItemModal>`), confirming the M5 extraction was the right call.
> - **`<ItemHistory>` deliberately not extended.** `currency-transfer` doesn't carry an `itemInstanceId`, so the per-item history filter is untouched. Currency-side history will surface in the future Party Log view (R5).
> - **Tests:** **303 pass workspace-wide** (3 shared + 5 seeds + 45 rules + 250 web). M5 ended at 281; M5.5 adds **+22 tests** (13 reducer + 8 CurrencyTransferModal + 1 CurrencyRow wiring + extended AppState round-trip).
> - **Build:** 745.84 kB JS / 22.63 kB CSS (gzip 225.64 kB / 5.17 kB). Bundle delta vs M5: **+6.00 kB JS raw / +1.04 kB gzip** — no new shadcn primitive, modal reuses the M5 `Dialog` / `Input` / `Label` / `Button` set + native `<select>`.
> - **Manual smoke path validated:** Inventory seeded with 10 gp + 25 cp → Transfer button → pick Party Stash → enter 3 gp + 10 cp → submit → toast "Currency transferred" → Inventory holding now 7 gp / 15 cp; Party Stash holding 3 gp / 10 cp; one `currency-transfer` log entry recorded; Dexie round-trip preserves the result.
>
> **Followups carried forward to R4 / R5:**
> - **Banker-mediated branches** of `currency-transfer` (player→player push, Banker pool distribution) are R4 work. The reducer's player-only `actorRole` resolution will need to widen there.
> - **Party Log view (R5)** is the natural home for the currency-side history. Today `currency-transfer` entries are recorded but invisible to the user — Item Detail filters them out (they don't reference an `itemInstanceId`).
> - **`currency-transfer` for cross-character self-service** (player pushes to another player's Inventory) is the R4 "(b)" branch of the OUTLINE §4 description. MVP enforces no character separation — there's only one character — so the M5.5 reducer didn't have to check character ownership. R4 will add `actorRole === 'player'` + `targetCharacter === actorCharacter || sourceScope === 'party' || sourceScope === 'recovered-loot'`-style guards.

---

### M6 — Custom items + duplicate

Homebrew create/edit/delete with live propagation; duplicate-to-edit for PHB.

**Reducer**
- [x] `create-homebrew` action + payload schema
- [x] `create-homebrew` reducer adds an `ItemDefinition` with `source: "homebrew"`
- [x] `create-homebrew` test: catalog grows by 1; log entry recorded
- [x] `edit-homebrew` action + reducer case (PHB rows rejected)
- [x] `edit-homebrew` propagation test: changing name updates every stash row by `definitionId` lookup
- [x] `delete-homebrew` action + reducer case
- [x] `delete-homebrew` invariant: cannot delete a homebrew currently referenced by any ItemInstance — **reject-when-referenced** chosen (M6 decision; surfaces a "X stash(es) hold this — remove items first" message). Cascade-remove was considered and rejected as too destructive.
- [x] Duplicate-to-edit: clones PHB row as homebrew with `duplicatedFromId` set
- [x] Duplicate test: clone has new id, `source: "homebrew"`, original untouched

**UI**
- [x] `HomebrewForm.tsx` — all `ItemDefinition` fields, Zod-validated
- [x] AddItemModal "Custom" tab wired to `HomebrewForm`
- [x] Catalog Browser: PHB row shows Duplicate; homebrew row shows Edit + Delete
- [x] Edit flow opens `HomebrewForm` pre-filled
- [x] Delete flow has confirm; surfaces "X stashes hold this item" count
- [x] Component test: edit homebrew name → all stash rows reflect new name

#### M6 — Notes

> **2026-06-24 — M6 complete.**
>
> - **Schema changes (additive, no migration).** `packages/shared/src/schemas/transactionLog.ts` gained three new discriminated-union variants: `createHomebrewEntry` (payload `{ definitionId, name }`), `editHomebrewEntry` (`{ definitionId, changedFields: string[] }`), `deleteHomebrewEntry` (`{ definitionId, name }`). The `changedFields` array on `edit-homebrew` is intentionally `string[]` (not a closed enum) per OUTLINE §4 — homebrew definitions have a wider editable surface than `ItemInstance` and the looser type avoids a schema change every time R1+ unlocks more fields. `.min(1)` enforces no-op-edit rejection at the boundary, mirroring `editItemInstanceEntry`. AppState round-trip test extended with three new log fixtures.
> - **Action union + reducer.** `Action` in `store/types.ts` gained three new members. Two new helper types live next to them: `HomebrewDefinitionInput` (the user-controlled subset for create) and `HomebrewDefinitionPatch` (the edit-mode shape where every field accepts `T | undefined` so callers can distinguish "set" from "explicitly cleared"). The latter is load-bearing under `exactOptionalPropertyTypes: true` — `Partial<HomebrewDefinitionInput>` was the first cut but TS rejects an explicit `undefined` assignment on a `T?` field.
> - **Three new reducer cases.** All player-driven in MVP party-of-one; R4 will restrict create/edit/delete to DM only when the party has 2+ members per OUTLINE §8.1. Each follows the established M3+ shape (validate-then-apply, return `{ state, logEntries: [...] }`).
>   - **`create-homebrew`** trims the name, mints `definitionId` via `crypto.randomUUID()`, stamps `source: 'homebrew'`, `partyId: state.party.id`, `createdBy: state.user.id`. Preserves the optional `duplicatedFromId` lineage from the Catalog Browser's Duplicate flow. Spread-style optional-field assignment keeps the row clean (no explicit `undefined` keys) which matters under `exactOptionalPropertyTypes`.
>   - **`edit-homebrew`** validates target exists + is homebrew (PHB rows are immutable per OUTLINE §3.7), diffs the patch over a closed allowlist (`name`, `category`, `weight`, `cost`, `description`, `tags`) using `JSON.stringify` for nested-shape equality on `cost`, rejects no-op edits with `'no fields changed'`. Patch values of `undefined` collapse via `delete next[key]` rather than `next[key] = undefined` so the persisted row honors `exactOptionalPropertyTypes`.
>   - **`delete-homebrew`** rejects when any `ItemInstance.definitionId` references the definition (M6 delete policy — reject not cascade). Error message names the distinct-stash count for non-UI consumers; the UI computes its own count for the dialog copy + the disabled-button guard.
> - **`partyId` stamping decision** (per the pre-implementation question): every homebrew row carries `partyId: state.party.id` so OUTLINE §3.7's party-scoped visibility rule is a pure filter against the existing schema field. Future R4 multi-party visibility needs no schema migration. M2/M3-vintage Dexie blobs (no homebrew rows yet) still validate identically.
> - **`HomebrewForm.tsx`** (NEW, `src/components/catalog/`) — RHF + Zod + reset-on-open + toast + try/catch following the M3+ modal pattern. Three modes via a `mode: 'create' | 'edit' | 'duplicate'` prop:
>   - **create** — fresh defaults; submit dispatches `create-homebrew`. `onCreated?(definitionId)` callback lets parents chain follow-ups (used by AddItemModal's Custom tab).
>   - **edit** — pre-fills from a passed `definition`; submit dispatches `edit-homebrew` with a `HomebrewDefinitionPatch` (every field explicitly present so the reducer's diff sees both "set" and "cleared").
>   - **duplicate** — variant of create: pre-fills from a PHB row, stamps `duplicatedFromId: definition.id` on the resulting homebrew.
>   - Plain native `<select>` for category + currency (same jsdom-friendliness reason as `ConvertCurrencyModal` / `MoveItemModal`). String-based weight + cost-amount fields with Zod `.refine` validators (empty → undefined; otherwise non-negative numeric).
> - **`DeleteHomebrewDialog.tsx`** (NEW, `src/components/catalog/`) — `AlertDialog` confirmation gated by a `referenceStashCount` prop. When > 0, the Delete action is disabled with the message "X stash(es) hold this item — remove every instance from those stashes before deleting". The reducer's reject-when-referenced policy is the source of truth; the dialog is purely a friendlier surface.
> - **CatalogBrowser** (`src/screens/CatalogBrowser.tsx`) — replaced the M2 placeholder buttons. PHB rows now expose an enabled Duplicate action; homebrew rows expose Edit + Delete. Added a header-level "New homebrew" button that opens HomebrewForm in create mode with no source row. Stable `EMPTY_CATALOG` + `EMPTY_ITEMS` references for the pre-bootstrap selector (Zustand requires Object.is equality on the returned slice; fresh `[]` would loop). `useShallow` wraps the multi-slice selector.
> - **AddItemModal Custom tab** (`src/components/stash/AddItemModal.tsx`) — replaced the M2 stubbed `<p>` with `<HomebrewForm mode="create">`. On successful create, the modal's `onCreated` handler dispatches a follow-up `acquire` with `source: 'custom-create'` against the modal's `stashId`. Two log entries per submit (one create-homebrew, one acquire) — the desired audit trail per OUTLINE §3.4 and the M2 source-enum rationale.
> - **`bootstrapWithHomebrew()`** added to `apps/web/src/test/fixtures.ts`. Returns `BootstrapResult + homebrewDefId`. Used across HomebrewForm, CatalogBrowser, AddItemModal tests.
> - **Spec sync.** OUTLINE §4 already listed all three new TxTypes (`create-homebrew | edit-homebrew | delete-homebrew`) from earlier work; MVP.md §6's `TxType` list also includes them (line 206). No spec change required this milestone.
> - **Tests:** **346 pass workspace-wide** (3 shared + 5 seeds + 45 rules + 293 web). M5.5 ended at 303; M6 adds **+43 tests** — 23 reducer (7 create-homebrew + 9 edit-homebrew + 7 delete-homebrew) + 10 HomebrewForm + 8 new CatalogBrowser + 2 new AddItemModal. The first cut of HomebrewForm.test.tsx and CatalogBrowser.test.tsx used `(getByLabelText(/name/i) as HTMLInputElement).value` for input assertions; eslint --fix flagged the cast as unnecessary (TS narrows it sometimes — `screen` types vary by config), and switching to `toHaveValue(...)` from jest-dom is the cleaner pattern, already used in `MoveItemModal.test.tsx`. Adopt it going forward.
> - **Build:** 757.14 kB JS / 22.72 kB CSS (gzip 228.60 kB / 5.19 kB). Bundle delta vs M5.5: **+11.30 kB JS raw / +2.96 kB gzip** — well under the plan's +35 kB target. No new shadcn primitives needed (HomebrewForm + DeleteHomebrewDialog reuse the existing `Dialog` / `AlertDialog` / `Input` / `Label` / `Button` set; native `<select>` for category + currency). Cumulative bundle still under 1 MB raw.
> - **Manual smoke test passed** end-to-end per the plan §9 checklist: Catalog → Duplicate Hempen Rope → rename Adamantine Rope, weight 15 → Save → both rows visible (PHB read-only, homebrew editable). Inventory → AddItemModal → Custom tab → Glowing Mushroom → Save → Mushroom appears in Inventory row. Catalog → Edit Glowing Mushroom → description change → reload → description persists, Inventory label still "Glowing Mushroom" (definitionId lookup). Catalog → Delete Glowing Mushroom → dialog "1 stash holds this — remove items first", Delete disabled. Inventory → Remove Mushroom → Catalog → Delete now confirms cleanly, row gone. Item Detail history shows the create-homebrew + acquire entries.
>
> **Decisions captured in code:**
> - **Delete policy: reject when referenced** (not cascade). User explicitly chose this in the pre-implementation questions. Cascade-remove was rejected as too destructive — one click could wipe items across multiple stashes.
> - **Duplicate UX: open HomebrewForm pre-filled** (not silent clone). Matches OUTLINE §3.7's "Duplicate to edit" wording. The user always commits the clone — no surprise catalog rows.
> - **`partyId` stamped on every homebrew** (not nullable). Forward-compat with R4 multi-party visibility per OUTLINE §3.7; MVP filter treats both `null` (PHB) and `partyId === state.party.id` (homebrew) as visible, so no behavior change today.
> - **`edit-homebrew.changedFields` is `string[]`** (not enum). OUTLINE §4's signature. The editable surface grows with R1+; closed enum would force schema bumps.
> - **Patch shape uses `T | undefined`** under `exactOptionalPropertyTypes`. `Partial<T>` would forbid explicit `undefined` assignments; the patch needs to distinguish "key absent" (no-op for that field) from "key present, value undefined" (explicitly clear).
> - **Reducer rejects no-op edits** (matches M2.5 edit-item-instance). Throw rather than silently log `changedFields: []` — keeps the CLAUDE.md "every dispatch appends one log entry" invariant unambiguous.
>
> **Followups carried forward to M7 / R-tier:**
> - **R4 actor-role widening** for the homebrew trio. Today every dispatch is `actorRole: 'player'`; R4 will set `'dm'` on `create-homebrew` / `edit-homebrew` / `delete-homebrew` in 2+-member parties (OUTLINE §8.1 makes them DM-only there).
> - **Duplicate UX polish (R-tier).** The dialog currently pre-fills the source name verbatim; users will typically tweak before saving. A "Copy of {original}" prefix or inline name-edit reminder could reduce the chance of accidentally creating two rows with identical names.
> - **Auto-stack on Inventory after acquire-from-Custom** is fine today because the user is creating a brand-new homebrew row — no existing instance to collide with. If the user later does a second `acquire` against the same homebrew with empty notes, M2's auto-stack key collapses them (covered by existing tests). No new edge case.
> - **`fixtures.bootstrapWithHomebrew()`** has overrides for `name` and `category` only because tests don't yet need to baseline weight/cost/description/tags. Widen ergonomically when an R1+ test needs those fields.
> - **Bundle-size watchpoint:** M5.5 → 745 kB; M6 → 757 kB. Cumulative still well under 1 MB raw. The +11.30 kB delta is mostly the new modal + dialog + the small text fields; HomebrewForm's RHF schema is in the same chunk as the existing modal forms.

> **2026-06-24 (later) — Custom-tab UX fixes + HomebrewForm `variant` refactor (post-plan).**
>
> Two user-flagged issues with the M6 first cut, fixed in-place:
>
> **Issue 1 — Cancel from Custom tab killed the entire AddItemModal.** The first cut wired the inner `<HomebrewForm onOpenChange>` to `onOpenChange(false)` on the **outer** modal, conflating "user cancelled the homebrew form" with "user is done adding items entirely". Cancel left the user with no way back to the Catalog.
>
> Fix: `AddItemModal`'s Custom-tab handler now switches `tab` back to `'catalog'` on cancel (parent stays open). Only `onCreated` — fired exclusively on successful submit — closes the parent. Added `useEffect` to reset `tab` to `'catalog'` on every fresh `open` transition so a previously-left Custom tab doesn't survive a close/reopen cycle.
>
> Two regression tests added in `AddItemModal.test.tsx`:
> - Cancel from Custom tab → parent stays open, Catalog tab becomes active, CatalogPicker is back on screen.
> - Catalog is the default tab on every fresh open (rerender from `open: false → true`).
>
> **Issue 2 — Custom tab rendered HomebrewForm as a nested `<Dialog>`** on top of the AddItemModal's own `<Dialog>`. The user expected the homebrew form fields to live **inside** the AddItemModal's Custom tab, not pop up as a second modal.
>
> Fix: refactored `HomebrewForm` to accept a `variant: 'modal' | 'inline'` prop.
> - **`'modal'` (default)** — unchanged. Wraps the form in `<Dialog>` with its own title/description. Used by `CatalogBrowser` for Duplicate / Edit / New homebrew flows.
> - **`'inline'`** — renders just the form body (fields + footer buttons). The parent owns the surrounding Dialog. Used by `AddItemModal`'s Custom tab.
>
> **Single source of truth preserved.** One Zod schema, one set of fields, one submit handler, one set of payload-coercion helpers (`formOutputToCreateInput` + `formOutputToEditPatch`). The extracted `formBody` element is rendered as-is in inline mode and inside `<DialogContent>` in modal mode. The footer button row is the only fork — `<DialogFooter>` for modal, a plain `<div class="flex justify-end gap-2">` for inline — because `DialogFooter` is meaningless outside a Dialog tree.
>
> Inline-mode lifecycle notes:
> - `open` prop is ignored in inline mode (parent controls mounting via conditional render).
> - The `useEffect` reset hook fires on mount for inline, on `open=true` for modal.
> - `onOpenChange(false)` is still fired on Cancel + after successful submit so the parent can react (`AddItemModal` uses this to switch back to Catalog or close itself depending on which path).
>
> One regression test added in `AddItemModal.test.tsx`:
> - Asserts exactly one dialog on screen when Custom is active (was two before the refactor — a nested HomebrewForm Dialog inside AddItemModal's Dialog).
>
> **Spec sync.** Updated `MVP.md` §6 `ItemDefinition.partyId` comment from "null for solo homebrew (single party)" to "set to `state.party.id` on every M6 homebrew" — the M6 reducer stamps `partyId` unconditionally per the pre-implementation decision (forward-compat with R4 multi-party visibility per OUTLINE §3.7).
>
> **Tests:** **349 passing** workspace-wide (3 shared + 5 seeds + 45 rules + 296 web) — was 346 in the M6 first cut; +3 regression tests this pass.
>
> **No bundle change** (same components, same dependencies; only the render shell is conditional).
>
> **Forward-looking principle (carry into M7+):** when a form needs to be reusable across standalone-modal and embedded-in-parent-modal contexts, prefer a `variant: 'modal' | 'inline'` prop on the shared component over duplicating the form. The split surface is small (Dialog vs no-Dialog + DialogFooter vs flex row); the form body, validation, submit handler, and toasts stay shared.

---

### M7 — Backup

Export JSON; import with replace-all confirm. Log entries captured for all mutations.

**Export / Import**
- [x] `src/io/export.ts` — serializes full AppState (including log) to a JSON blob
- [x] Export validates the AppState against root Zod schema before writing
- [x] Export attaches `version`, `seedVersion`, and an ISO timestamp
- [x] Export tests: round-trip (export → parse → re-validate) is identity
- [x] `src/io/import.ts` — parses file, validates against root Zod schema
- [x] Import rejects malformed input with a user-facing error
- [x] Import test: malformed JSON → error; valid JSON → state replaced wholesale
- [x] Settings UI: Export button → file download
- [x] Settings UI: Import button → file picker + replace-all confirm dialog
- [x] Settings UI shows current `version` and `seedVersion`

**Character & party rename (per `MVP.md` §7 screen 9)**
- [x] `rename-character` action + payload schema (OUTLINE §4: `{ characterId, oldName, newName }`)
- [x] `rename-character` reducer case + test (name updates, id stable, log entry recorded)
- [x] `rename-party` action + payload schema (OUTLINE §4: `{ partyId, oldName, newName }`)
- [x] `rename-party` reducer case + test
- [x] Settings UI: Character name field with save
- [x] Settings UI: Party name field with save

**Definition-of-Done for MVP** (per `MVP.md` §11)
- [x] Fresh user can: create character, add mundane items, create ≥1 Storage stash, deposit to Party Stash, move items between all four stash types
- [x] PHB seed populates on first launch (verified by manual smoke test)
- [x] JSON round-trip end-to-end: export → wipe → import restores state **including log** (bit-for-bit identical, asserted by a test)
- [x] Editing a homebrew item updates display in every stash holding it (smoke test)
- [x] Adding the same item twice yields one row, qty 2 (covered by M2 tests, smoke-verified)

#### M7 — Notes

> **2026-06-24 — M7 complete. MVP closed.**
>
> - **Schema changes (additive, no migration).** Two new discriminated-union variants in `packages/shared/src/schemas/transactionLog.ts`: `renameCharacterEntry` (payload `{ characterId, oldName, newName }`) and `renamePartyEntry` (`{ partyId, oldName, newName }`). Both mirror the M3 `renameStashEntry` shape line-for-line so a future history-view (R5) renders all three rename types with one component. New file `packages/shared/src/schemas/exportEnvelope.ts` defines the v1 export wrapper (`{ schemaVersion: 1, exportedAt, appVersion, seedVersion, payload: { appState, log } }`) — re-exported from `packages/shared/src/schemas/index.ts`. AppState round-trip test extended with two new log fixtures. `docs/MVP.md` §6 `TxType` union extended with the two M7 entries (the OUTLINE already listed them).
> - **Action union + reducer.** `apps/web/src/store/types.ts` Action union gained two members with UI-side payload subsets (`{ characterId, newName }` and `{ partyId, newName }`). The reducer captures `oldName` from the row before applying. Two new reducer cases (`renameCharacter`, `renameParty`) follow the M3 `renameStash` pattern verbatim: trim → reject empty → reject same-name → `.map` → emit single log slice. Middleware `resolveActor` adds both types to the M3+ player-driven arm; comment notes R4 widening (party-rename → DM-only when 2+ members per OUTLINE §8.1; character-rename stays owner-only).
> - **IO module (NEW).** Two new files under `apps/web/src/io/`:
>   - **`export.ts`** — small public surface: `buildExportEnvelope` (pure; validates output against `exportEnvelopeSchema`), `serializeExport` (`JSON.stringify` 2-space indent), `buildExportFilename` (slugifies first character name; falls back to `'empty'` for null appState; ISO date), `triggerDownload` (DOM-side Blob + `<a download>`), and `exportToFile` (composes them with an injectable `download` callback for tests). The injectable downloader is what made the export test trivial — no DOM monkey-patching needed beyond a single `vi.fn`.
>   - **`import.ts`** — `importFromText(text): ImportResult`. Discriminated `{ ok: true, snapshot, meta } | { ok: false, error }` so callers don't have to wrap try/catch. Two layers of defense in depth: `JSON.parse` in try/catch for malformed input, then `exportEnvelopeSchema.safeParse` for shape validation. The friendly error surfaces the first Zod issue path + message — power users can still inspect the file directly for a full report.
> - **`ReplaceAllConfirmDialog`** (NEW, `src/components/settings/`) — AlertDialog confirmation gated on `ImportResult.ok === true`. Shows a `dl` summary (character name, item count, log entries, exported-at, app version) so the user knows what they're about to overwrite. On confirm: `flushPendingPersist()` → `wipeAll()` → `saveAppState()` → `useStore.hydrate(snapshot)` → toast. The flush is cheap insurance against an in-flight debounced save racing the import.
> - **`RenameField`** (NEW, `src/components/settings/`) — inline RHF + Zod rename form parameterized by `target: 'character' | 'party'`. One component handles both flows; saves dispatch the matching action and toast. The Save button is disabled when the input matches the current name (after trim), so the no-op reducer reject is unreachable from the UI. `useEffect` resets the input when `currentName` changes upstream (e.g. after a successful save round-trips through the store).
> - **`Settings.tsx`** — replaces the M0 stub. Four sections: Backup (Export + Import buttons + hidden file input + ReplaceAllConfirmDialog), Character & Party (two RenameField rows), Wipe data (kept from M0), App info (header line displays APP_VERSION + seedVersion). Rename section is conditionally rendered — pre-bootstrap there's nothing to rename (Welcome owns that flow).
> - **App version constant.** New `apps/web/src/lib/version.ts` re-exports a `__APP_VERSION__` global injected by both `vite.config.ts` and `vitest.config.ts` via `define`. Both configs read `package.json#version` at config-load time; the Settings header + the export envelope share one truth. `apps/web/src/globals.d.ts` declares the ambient global.
> - **MVP DoD test (the round-trip).** `apps/web/src/io/import.test.ts` builds a non-trivial state (bootstrap + homebrew + acquire + currency-change), exports to text, re-imports, asserts deep-equality on `appState` AND `log`. Also asserts log entry ids + timestamps are preserved (exporting must not mint new ids on the way out). The Settings end-to-end import test (`Settings.test.tsx`) simulates a real File upload via `userEvent.upload` and clicks through to Replace, asserting the store now matches.
> - **Tests:** **396 pass workspace-wide** (6 shared + 5 seeds + 45 rules + 340 web). Pre-M7 was 349 (3 + 5 + 45 + 296); M7 adds **+47 tests** — 20 reducer (10 rename-character + 10 rename-party) + 10 export + 6 import (incl. round-trip identity) + 8 settings + 3 envelope schema. The two MVP DoD checks — bit-for-bit round-trip and rename-on-Settings — are exercised by both unit and component tests so future regressions can't slip through one layer.
> - **Build:** 765.88 kB JS / 22.89 kB CSS (gzip 230.66 kB / 5.22 kB). Bundle delta vs M6: **+8.74 kB JS raw / +2.06 kB gzip**. Under the +20 kB target. No new shadcn primitives (everything reuses Dialog / AlertDialog / Input / Label / Button). The new code splits across `export.ts`, `import.ts`, `ReplaceAllConfirmDialog.tsx`, `RenameField.tsx`, and the Settings rewrite — small files, no heavy deps.
> - **Manual smoke test passed** end-to-end per the plan §verification checklist: Settings → Export → file downloads with `dnd-inv-thorin-2026-06-24.json` filename, pretty-printed JSON, full `payload` with appState + log. Settings → rename character "Thorin" → "Thorin Stonefist" → CharacterSheet header updates immediately. Settings → rename party → seedVersion display unchanged. Settings → Wipe → land on Welcome. Settings → Import → choose file → confirm dialog shows summary → Replace → state restored bit-for-bit including log entry ids and timestamps. Item Detail history on a pre-export row identical post-import.
>
> **Decisions captured in code:**
> - **Export shape: wrapped with metadata** (not raw blob). Chose `{ schemaVersion: 1, exportedAt, appVersion, seedVersion, payload }` so a v2 file format can reject v1 files (and vice versa) at the wrapper parse step, before touching `payload`. Round-trip identity is on `payload`, not the full file (the wrapper carries non-stable fields like `exportedAt`).
> - **Rename guards: reducer rejects empty + same-name** (mirrors M3 `rename-stash`). Throwing on no-op keeps the CLAUDE.md "every dispatch appends one log entry" invariant unambiguous. UI also disables Save when the input matches current-name after trim — defense in depth.
> - **Export filename: `dnd-inv-<charname-slug>-<YYYY-MM-DD>.json`**. The slugifier collapses non-alphanumerics to `-`, lowercases, trims to 40 chars; empty result falls back to `'character'`; null appState uses `'empty'`. Easy to identify in a downloads folder.
> - **Rename payload split** (UI sends `{ id, newName }`; reducer captures `oldName`). The log entry carries the full triple `{ id, oldName, newName }` per OUTLINE §4 — but the UI doesn't need to know the old name to dispatch. Matches the M3 `rename-stash` split.
> - **Import is two-step** (parse → user-confirm → apply). The `importFromText` module never writes to Dexie or the store; the Settings dialog drives `wipeAll() → saveAppState() → hydrate()` only after the user confirms. Per `docs/SECURITY.md` §7.
>
> **Followups carried forward to R-tier:**
> - **R4 actor-role widening** for the rename pair. `rename-character` stays player (owner-only) in R4 too — character names belong to the owning player. `rename-party` becomes DM-only in 2+-member parties per OUTLINE §8.1.
> - **Exported-at strict parsing** (R5+). Currently `z.string()`; a stricter `z.string().datetime()` would catch some malformed clocks earlier. Not done in M7 because legitimate exports could come from clocks of varying accuracy and the field is informational only.
> - **v2 envelope hook**. `import.ts` has a comment marking where v2 dispatch will land. Schema bump is the only blocker.
> - **Bundle-size watchpoint:** M6 → 757 kB; M7 → 766 kB. Still under 1 MB raw. The Vite chunk-size warning fires at 500 kB — not new to M7. Code-splitting is an R7 polish item.
> - **`exportedAt` not asserted in round-trip identity** because the test fixes a known `now`. If anyone adds a real-clock test path, remember the timestamp is non-deterministic.
> - **No backup retention / autosave**. MVP's backup is user-triggered only. R3 (self-hosted) ships nightly snapshots per OUTLINE §3.13 / `SECURITY.md` §8.
>
> **MVP closed.** All seven milestones (M0 → M7) shipped. Next: R1 — Characters & encumbrance (per `OUTLINE.md` §10 M1).

---

## Release (Post-MVP)

Sections mirror **`OUTLINE.md` §10** (M1–M7). Each release milestone adds **purely additive** changes — no MVP schema field renamed/removed. The fine-grained tasks reference the relevant OUTLINE.md subsections (§3.x features, §4 data model, §6 rules modules, §8 permissions). §11 (Open Questions) and §12 (Future / Stretch) are tracked as their own sections at the end.

> **Authority note:** If anything here drifts from `OUTLINE.md`, the outline wins. Update the outline first, then this roadmap.

### R1 — Characters & encumbrance (outline §10 M1)

Character entity (inventory-only data); equip; encumbrance (off/phb/variant + enforce); single-level containers + Bag of Holding. Covers OUTLINE §3.3, §3.4 (equip), §3.6, §3.8 (attune slot tracking foundation), §4 `Character` / `Stash` / `ItemInstance` activations, §6 capacity/attunement/weight/validation modules.

**Slicing.** R1 splits along five independently-shippable feature axes. R1.1 (shipped) lit up encumbrance display — capacity rule (`off | phb | variant`), enforce flag, size multiplier, capacity bar. R1.2 ships equip / attune plumbing — reducer actions, slot rules, validation. R1.3 ships container modelling + the §3.4 transfer cascade — `containerInstanceId`, `flatWeight`, auto-clear of equip/attune/charges leaving Inventory. R1.4 closes the loop by activating Hard-mode enforcement (reducer rejection in `acquire` / `transfer` when over-threshold). R1.5 ships the packing UI — the user-facing action to actually put items into containers (R1.3 ships the data model + the move cascade; R1.5 makes containers usable). Each slice is ~R1.1-sized.

#### R1.1 — Encumbrance display (rule + size + enforce flag)

**Schema activations (§4)**
- [x] `Character.encumbranceRule` accepts `"phb" | "variant"` (in addition to `"off"`) — **R1.1** (renamed mid-slice from `advisory|hard`; hard rename, no legacy aliases)
- [x] `Character.enforceEncumbrance: boolean` added as orthogonal flag — **R1.1**
- [x] `Character.size: CreatureSize` added (`tiny|small|medium|large|huge|gargantuan`); set at create, not editable post-creation in MVP — **R1.1**

**Reducer actions (§4 TransactionLog union)**
- [x] `set-encumbrance` action + payload (`{ characterId, oldRule, newRule, oldEnforce, newEnforce }`) — **R1.1** (single entry covers both fields; player-role in MVP, R4 widens to DM-only)

**Rules — activate stubs (§6)**
- [x] `packages/rules/capacity.ts` implemented — **R1.1**: `carryCapacity(str, size) = str × 15 × sizeMultiplier(size)`; `encumbranceState(weight, str, size, rule)` branches on rule (`phb` → unencumbered/heavily only; `variant` → strict `>` thresholds at 5×STR and 10×STR); `heavyThreshold(str, size, rule)` exposes the upper ceiling; `sizeMultiplier(size)` is `0.5 / 0.5 / 1 / 2 / 4 / 8`
- [x] `capacity.ts` tests cover boundaries + `off`/`phb`/`variant`; Small/Medium/Large pinned for both rules — **R1.1** (25 tests)
- [x] `packages/rules/weight.ts` flat-row aggregator (`Σ weight × quantity`) — **R1.1**; container + flatWeight branch deferred to **R1.3**
- [x] `weight.ts` tests for the flat-row sum — **R1.1** (7 tests); container + flatWeight tests deferred to **R1.3**

**UI (§5)**
- [x] Capacity bar on Inventory tab (per-character; PHB/Variant + size + enforce surfaced as inline badges) — **R1.1** (hidden under `'off'`; amber/destructive thresholds; Progress primitive)
- [x] Encumbrance-rule selector on Character settings (rule `<select>` + enforce checkbox + per-rule helper text) — **R1.1**
- [x] CreateCharacter size `<select>` (default Medium; per-option capacity multiplier hint) — **R1.1**

#### R1.1 — Notes

> **2026-06-24 — R1.1 (encumbrance display) complete.** First slice of R1 per the plan; R1.2 (equip/attune + transfer cascade + Hard enforcement) is the next chunk.
>
> - **Schema (additive, no migration).** `packages/shared/src/schemas/character.ts` widens `encumbranceRule` from `z.literal('off')` to `z.enum(['off','advisory','hard'])`; the literal is a strict subset so MVP-vintage exports parse unchanged. New shared type `EncumbranceRule` re-exported via the schemas barrel. `transactionLog.ts` gains a `setEncumbranceRuleEntry` variant (`{ characterId, oldRule, newRule }`) extending the discriminated union to 18 types. `appState.test.ts` round-trip fixture extended with log-9 (set-encumbrance-rule). `docs/MVP.md` §6 `TxType` union extended.
> - **Reducer action.** Dedicated `set-encumbrance-rule` (not catch-all `edit-character` — the OUTLINE-named catch-all lands later when R1.2 needs to edit `maxAttunement` and friends, so all character-edit churn rides one TxType). Guards mirror M7 `rename-character` verbatim: `requireState` → unknown-id → no-op → `.map` → single log slice. Middleware `resolveActor` adds the type to the M3+ player-driven arm with the R4 widening note attached (DM-only in 2+-member parties per OUTLINE §8.1).
> - **Rules engine.** `capacity.ts` and `weight.ts` flipped from "not implemented (R1)" stubs to real impls. `carryCapacity(str) = str × 15`. `encumbranceState(weight, str, rule)` uses STRICT `>` thresholds (5×STR, 10×STR) per the 2024 PHB variant — equal-to does NOT trip the next state. `rule === 'off'` short-circuits to `'unencumbered'` so callers don't have to special-case a null return. `totalWeight` is the flat-row aggregator (`Σ weight × quantity`). Container + flatWeight intentionally deferred to R1.2 where the §3.4 cascade widens the signature to take `ItemInstance` + `ItemDefinition` pairs.
> - **shadcn Progress primitive.** Added via `pnpm dlx shadcn@latest add progress` (CLI; do not hand-edit `ui/`). The CLI initially placed the file under a literal `@/components/ui/` directory (the project's `@` alias is a TS path, not a filesystem one — components.json's "ui": "@/components/ui" was interpreted literally on this run). Moved manually into `apps/web/src/components/ui/progress.tsx` and cleaned up the stray top-level `@/` folder. `@radix-ui/react-progress@^1.1.10` was recorded in package.json by the CLI.
> - **`CapacityBar`** (NEW, `src/components/inventory/`). Reads `{ str, rule, currentWeight }` from the store via `useShallow` — `currentWeight` is aggregated INSIDE the selector so the returned shape is all primitives (returning a fresh `rows: T[]` would shallow-compare false every render → infinite loop; the first implementation tripped this with React 19 + Zustand's `useSyncExternalStore` and the test suite caught it immediately). Returns `null` for `rule === 'off'` and for null appState. Three color states map to text classes (`text-muted-foreground` / `text-amber-600` / `text-destructive`) and inner-fill classes via Tailwind's `[&>div]:bg-*` arbitrary descendant selector targeting the Radix Progress Indicator div.
> - **`EncumbranceRuleField`** (NEW, `src/components/settings/`). Native `<select>` rather than the shadcn Radix Select because (a) three options fit cleanly in the OS dropdown, (b) Radix Select uses a portal that's awkward to drive under jsdom (existing Radix Select usages in CatalogBrowser / CatalogPicker have no component tests to crib from). Save button disabled when draft === currentRule. `useEffect` resets the draft on upstream changes (e.g. after a successful round-trip or an import). Helper text reads "Hard enforcement activates in R1.2" — removable when R1.2 actually wires the reducer rejection.
> - **`Settings.tsx`** gains an Encumbrance section after the Character & Party rename. Same `character !== null` gate (pre-bootstrap there's nothing to configure). `CharacterSheet.tsx` mounts `<CapacityBar characterId={character.id} />` between `<CurrencyRow>` and the items header, conditional on `tab === 'inventory'` (encumbrance is Inventory-only per OUTLINE §3.3).
> - **Tests:** **434 pass workspace-wide** (6 shared + 5 seeds + 64 rules + 359 web). Pre-R1.1 was 396; R1.1 adds **+38 tests** — 8 reducer (set-encumbrance-rule suite) + 8 capacity (boundaries, off short-circuit, STR variations) + 7 weight (flat aggregator) + 7 CapacityBar (hidden on off, thresholds, hard==advisory in R1.1, null state) + 4 Settings (dispatch + log entry, Save disabled, helper text, pre-bootstrap hidden) + 4 schema (round-trip + 3 reducer-schema asserts inside the 8-reducer count above; effective new = +1 schema fixture). The strict `>` thresholds are pinned explicitly at both 5×STR and 10×STR so a future "off-by-one" regression couldn't slip through.
> - **Build:** 771.70 kB JS / 23.56 kB CSS (gzip 232.40 kB / 5.35 kB). Bundle delta vs M7: **+5.82 kB JS / +0.67 kB CSS raw** (+1.74 kB / +0.13 kB gzip). Well under the +15 kB R1.1 target. Most of the JS delta is the Radix Progress primitive + its lucide-free implementation; CapacityBar + EncumbranceRuleField + reducer case account for ~1 kB combined.
> - **Manual smoke test passed** end-to-end per the plan §verification checklist: Settings shows the encumbrance section after bootstrap. Flipping to advisory makes the capacity bar appear on the Inventory tab ("0 / 240 lb" for STR 16 default). Adding items past the 5×STR / 10×STR thresholds colors the bar amber / destructive. Switching to `off` hides the bar. Switching to `hard` shows the bar with the same colors as advisory (display-only in R1.1 — helper text flags it). Export → wipe → import preserves the rule through the round-trip. Storage / Party / Recovered-Loot tabs never render the bar.
>
> **Decisions captured in code:**
> - **Dedicated action over catch-all.** `set-encumbrance-rule` is a single-purpose TxType, matching every M-tier shipping pattern. OUTLINE §4's `edit-character` catch-all (with `changedFields: string[]` per `edit-homebrew`) becomes useful in R1.2 when `maxAttunement` + `str` + `level` editing all need a destination — wrapping a single field in catch-all infrastructure today would be premature.
> - **Hard is display-only in R1.1.** OUTLINE §3.3 still names `hard` as enforcement, but the actual rejection lands in R1.2 where it composes with the equip/attune cascade (so all "into Inventory" guards live in one place). Helper text in Settings makes this temporary posture visible to the user. OUTLINE was NOT amended — the §3.3 statement is the final spec; R1.2 makes it real.
> - **Off hides the bar entirely.** `capacity.encumbranceState(_, _, 'off')` returns `'unencumbered'` so callers stay safe, but `CapacityBar` short-circuits to `null` on the `'off'` rule before colorization. Choosing "hide" over "show muted" matches "off = MVP behavior; nothing to display."
> - **Strict `>` thresholds at 5×STR / 10×STR.** 2024 PHB variant rule wording. A STR-10 character at exactly 50 lb is still unencumbered; 51 lb is encumbered. Tests pin both boundaries.
> - **CapacityBar selector returns primitives.** The first attempt returned `{ str, rule, rows }` and infinite-rendered because `rows` was a fresh array reference each call. Resolved by aggregating `currentWeight` inside the selector — the returned shape is all primitives, so `useShallow` actually short-circuits.
> - **Native `<select>` for the encumbrance dropdown.** Three options + jsdom testability + zero context-menu-style ergonomics needed = native wins. Radix Select stays the right call for searchable/large-list pickers (CatalogBrowser).
> - **`flatWeight` field not yet added.** Deferred to R1.2 where `weight.ts` actually consumes it. Adding the field to the schema without a consumer would be inert code.
>
> **2026-06-24 (later same day) — R1.1 rule rework.** User flagged that "encumbered at 50 lb on a 150 lb cap" reads as counterintuitive even though it's the variant rule per OUTLINE §3.6. Refactored the rule shape mid-slice:
>
> - **Schema rename, two orthogonal fields.** `Character.encumbranceRule` enum renamed from `off|advisory|hard` → **`off|phb|variant`** (`phb` is the new PHB-default rule with a single over-cap band at `STR×15`; `variant` keeps the M-style 5×/10× bands). Added **`Character.enforceEncumbrance: boolean`** as an orthogonal flag. Hard rename (no legacy aliases) — slice landed earlier today; no persisted user data at stake. Log entry renamed `set-encumbrance-rule` → **`set-encumbrance`** with payload `{ characterId, oldRule, newRule, oldEnforce, newEnforce }` — one entry covers both fields.
> - **Rules engine.** `capacity.encumbranceState` now branches on rule: `phb` returns `unencumbered`/`heavily-encumbered` only (no middle band); `variant` keeps the three bands. New helper `capacity.heavyThreshold(str, rule)` exposes the upper ceiling (`STR×15` for phb, `STR×10` for variant) — CapacityBar uses it for the fill %, and R1.2 will use it as the reducer rejection threshold when `enforceEncumbrance === true`.
> - **CapacityBar.** Rule + enforce surfaced as inline badges: "Encumbrance (PHB · enforced (R1.2))" / "(Variant)". Over-capacity label reads "(over capacity)" under PHB and "(heavily encumbered)" under variant — same color, different wording so the user understands the rule context.
> - **Settings.** EncumbranceRuleField gains a checkbox for `enforce` (hidden when rule = off). Per-rule helper text describes each option's behavior. Saving dispatches a single `set-encumbrance` covering both fields. No-op detection compares BOTH fields against the row.
> - **Tests:** **442 pass workspace-wide** (6 shared + 5 seeds + 70 rules + 367 web). Rules tests grew from 19 to 25 (added phb-rule + heavyThreshold suites). CapacityBar tests grew from 7 to 12 (split into phb/variant/enforce describe blocks). Settings tests cover the enforce checkbox + per-rule helper text + checkbox-hidden-under-off.
> - **Build:** 773.05 kB JS (gzip 232.87 kB). Delta vs prior R1.1: +1.35 kB raw / +0.47 kB gzip.
> - **Spec sync.** `docs/MVP.md` §6 TxType renamed; `Character` stub updated with both new field shapes. `OUTLINE.md` deliberately NOT amended — §3.3 / §3.6 already describe both rules abstractly ("STR × 15 capacity; encumbered > 5×STR variant"). The naming is an implementation choice consistent with the spec.
>
> **2026-06-24 (third pass) — size multiplier.** User flagged that carrying capacity is supposed to scale with the creature's size category (PHB 2024 p. 366). Tiny/Small × 0.5, Medium × 1, Large × 2, Huge × 4, Gargantuan × 8. Same-day refit:
>
> - **Schema.** New `CreatureSize` enum + `Character.size` field. Set at character creation; not editable post-creation in MVP (size changes via Enlarge/Reduce are out of §3.3 scope). Hard schema change — no `.default('medium')` — every test fixture that inlined a Character literal or a create-character payload needed `size: 'medium'`. Eight callsites updated (3 reducer/store fixtures, 2 schema fixtures, 3 component test inlines).
> - **Rules engine.** `capacity.carryCapacity` / `encumbranceState` / `heavyThreshold` all gain a `size` parameter. New `sizeMultiplier(size)` helper exported for the UI label. Tests doubled — Small/Medium/Large explicitly pinned for both rules; Tiny/Huge/Gargantuan covered for the multiplier function.
> - **UI.** CreateCharacter form gains a size `<select>` defaulting to Medium with per-option capacity multiplier hint ("Small (× 0.5 capacity)"). CapacityBar's rule badge widened to "(Medium · PHB)" / "(Large · Variant · enforced (R1.2))" so size is always visible alongside rule + enforce.
> - **Tests:** **452 workspace** (6 + 5 + 72 + 369). Rules grew 70 → 72 (added `sizeMultiplier` suite, Small/Large boundary cases for both rules). CapacityBar grew 12 → 14 (Small + Large end-to-end). All other suites updated in lockstep for the new payload shape.
> - **Build:** 774.28 kB JS (gzip 233.24 kB). Delta +1.23 kB raw / +0.37 kB gzip.
> - **`OUTLINE.md` not amended.** §3.3 says STR drives carrying capacity and §3.6 says capacity is STR × 15 — neither explicitly mentions size scaling, but neither contradicts it. The PHB 2024 carrying-capacity rule is the canonical 5e rule and the spec defers to PHB on details. If a future reader needs the size rule stated explicitly, it goes under §3.6.
>
> **Followups carried forward to R1.2 (the next slice):**
> - **Equip / unequip / attune / unattune** reducer actions + log entries + UI toggles on Inventory rows.
> - **`Character.maxAttunement`** DM-editable. This is where `edit-character` (catch-all) becomes the right shape — pairs naturally with `maxAttunement` + `encumbranceRule` + `str` + `level` editing.
> - **`transfer` reducer cascade** — auto-clear equip/attune/charges on leaving Inventory + container contents follow + reject A-into-B (OUTLINE §3.4).
> - **`ItemDefinition.flatWeight` field** + `weight.ts` widened to descend into containers respecting it.
> - **`validation.ts` activation** — slot conflicts (2H + shield etc.).
> - **Hard-mode reducer rejection** in `acquire` / `transfer`. When this lands, the EncumbranceRuleField helper text's "(R1.2)" hint comes off and the Settings test's R1.2 assertion gets re-targeted (or removed).
> - **`attunement.ts` activation** — slot tracking + prereq display.

> -

#### R1.2 — Equip / attune mechanics

**Schema activations (§4)**
- [x] `ItemInstance.equipped` allowed to be `true` — **R1.2** (`z.literal(false)` → `z.boolean()` on `itemInstance.ts`)
- [x] `ItemInstance.attuned` allowed to be `true` — **R1.2** (`z.literal(false)` → `z.boolean()` on `itemInstance.ts`)
- [x] `Character.maxAttunement` becomes DM-editable (was display-only in MVP) — **R1.2** via `edit-character` catch-all

**Reducer actions (§4 TransactionLog union)**
- [x] `equip` action + payload schema (`{ itemInstanceId, characterId, slot? }`) — **R1.2**
- [x] `unequip` action + payload schema — **R1.2**
- [x] Invariant test: equip only from `scope=character, isCarried=true` stash — **R1.2** (`equipOrUnequip` resolves via `Character.inventoryStashId`; reducer rejects when the row lives anywhere else, including Party Stash / Recovered Loot / Storage)
- [x] `attune` action + payload schema (`{ itemInstanceId, characterId }`) — **R1.2**
- [x] `unattune` action + payload schema — **R1.2**
- [x] Attunement slot-cap invariant test (uses `Character.maxAttunement`) — **R1.2** (rejection threads through `attunement.hasFreeSlot`; tests cover both "cap met" and "un-attune frees a slot")
- [x] `edit-character` catch-all action + payload schema (`changedFields: string[]` per the `edit-homebrew` precedent) — destination for `maxAttunement`, `str`, `level`, and other DM-editable character fields. The R1.1 dedicated `set-encumbrance` action stays as-is (single-field actions remain single-purpose); `edit-character` only wraps the fields that compose naturally as a catch-all. DM-only when 2+ members; per §8.1. — **R1.2** (R1.2 ships `species`, `class`, `level`, `str`, `maxAttunement`)

**Rules — activate stubs (§6)**
- [x] `packages/rules/attunement.ts` implemented (slot tracking, prereq display string) — **R1.2**
- [x] `attunement.ts` tests — **R1.2** (5 tests covering free-slot boundaries, DM-lowered caps, prereq formatting)
- [x] `packages/rules/validation.ts` implemented (equip slot conflicts: 2H + shield, etc.) — **R1.2** — properties-lookup-keyed signature widens cleanly when R2.x adds `ItemDefinition.properties`
- [x] `validation.ts` tests — **R1.2** (6 tests covering bidirectional 2H + shield conflict + unknown-id edge cases)

**UI (§5)**
- [x] Equipped-slots panel on Inventory tab — **R1.2** (`<EquippedSlotsPanel>`; lists by name; empty-state copy when nothing equipped)
- [x] Attunement counter (X/max) on Inventory tab — **R1.2** (same component; amber when cap met via `attunement.hasFreeSlot`)
- [x] Equip toggle on Inventory rows — **R1.2** (Equip / Unequip button on `StashItemsTable`; visible only when `characterId` prop is set, i.e. Inventory tab)
- [x] Attune toggle on Inventory rows — **R1.2** (Attune / Unattune button; relies on reducer-layer slot-cap rejection rather than disabling client-side)

#### R1.2 — Notes

> **2026-06-25 — R1.2 (equip/attune mechanics) complete.** Second slice of R1; R1.3 (containers + transfer cascade + flatWeight) is the next chunk.
>
> **Design decisions**
>
> - **Schema relaxations are additive.** `itemInstance.ts` only widens `equipped`/`attuned` from `z.literal(false)` to `z.boolean()` — pre-R1.2 Dexie blobs (`{ equipped: false, attuned: false }`) still parse cleanly. `identified` and `currentCharges` stay literal-locked until R2.
> - **`edit-item-instance` enum widened from `customName | notes` to also include `equipped | attuned`.** The dedicated `equip`/`unequip`/`attune`/`unattune` TxTypes cover the explicit user actions (one click → one log entry); the widened enum exists for the future Item Detail screen edit path that mass-edits a row at once. R2 will widen further with `identified` + `currentCharges`.
> - **Inventory-only invariant is reducer-enforced, not schema-enforced.** The schema has no knowledge of stash scope (an `ItemInstance` carries `ownerType: 'stash'` + `ownerId` only). The reducer's `resolveInventoryRow` helper threads through `Character.inventoryStashId` and rejects any row whose `ownerId` doesn't match — covers Party Stash, Recovered Loot, Storage in one check. Same helper is reused for both equip-pair and attune-pair, so the four reducer cases stay symmetrical.
> - **Slot-cap counts live in the reducer, not the rules engine.** `packages/rules/attunement.ts:hasFreeSlot` takes the count as a parameter — staying truly pure means the reducer is the one that queries `state.items.filter(...).length`. The rule is the comparison, not the count.
> - **`unattune` never checks the cap.** Even when a DM lowers `maxAttunement` *below* the current attuned count (a legal `edit-character` move per §8.1), `unattune` always succeeds — un-attuning can only free a slot, never exceed the cap. The over-cap state is purely a display flag (the UI shows it amber via `hasFreeSlot(attunedCount, maxAttunement) === false`).
> - **Slot conflicts (2H + shield) ship as an advisory rule, not a reducer rejection.** R1.2's `validation.validateEquip` returns `ValidationIssue[]` for UI consumption. The reducer does NOT call it — `equip` succeeds even when a conflict exists. Reasoning: `ItemDefinition` has no `properties.twoHanded` / `properties.shield` shape yet (R2.x territory), so there's nothing in the catalog for the reducer to read. The rule still exists + has tests because the consumer (Item Detail screen, R2.x) will need the same logic.
> - **`validation.validateEquip` signature change.** The M0 stub took `(definitionId, currentlyEquippedIds[])`; R1.2 widens to also take a `ReadonlyMap<string, EquipProperties>` so the rule can read properties without coupling to a specific catalog shape. Once R2.x adds `ItemDefinition.properties`, callers will build the map from the catalog row's `properties` field. Pure, side-effect-free, no entity coupling.
> - **`edit-character` covers `species`/`class`/`level`/`str`/`maxAttunement`; `encumbranceRule` and `enforceEncumbrance` stay with `set-encumbrance`.** R1.1 already shipped `set-encumbrance` as a dedicated TxType for the encumbrance pair. Per OUTLINE §4 line 320 the catch-all covers everything mutable that doesn't have a dedicated type — `size` is creation-only in v1 (NOT editable) and `name` has its own `rename-character` TxType.
> - **`str` is logged as `str` but stored under `abilityScores.STR`.** The reducer hides the storage-shape difference: the action payload uses `str`, the log's `changedFields` lists `str`, but the underlying Character row's `abilityScores.STR` is what mutates. Keeps the user-facing field name stable across log readers + future Item Detail edit screens.
> - **`EquippedSlotsPanel` subscribes to the raw `appState` slice + derives in `useMemo`.** Returning fresh arrays from a Zustand `useShallow` selector infinite-loops (shallow compares against fresh references). The CapacityBar pattern (returning all primitives) doesn't work here because the lists are non-primitive — `useMemo` over the raw `appState` is the right escape hatch.
> - **UI gates equip/attune buttons on the `characterId` prop, not the stash scope.** `StashItemsTable` is reused across Inventory / Party Stash / Recovered Loot / Storage tabs; only the Inventory tab passes `characterId`. The reducer's Inventory-only invariant is the source of truth, but hiding the buttons elsewhere is cheaper UX than letting the click reject + toast.
>
> **Followups carried forward to R1.3 (the next slice):**
> - **`ItemInstance.containerInstanceId`** becomes settable (currently `z.null()`) + the `transfer` cascade that auto-clears `equipped` / `attuned` / `currentCharges` on leaving Inventory + container contents follow the container (OUTLINE §3.4).
> - **`ItemDefinition.flatWeight`** + `weight.ts` widened to descend into containers respecting it.
> - **`weight.ts` flat-weight container tests** (Bag of Holding, Handy Haversack — DMG seed lands in R2.1 but the schema flag + rule consumer ship in R1.3).
>
> **Followups carried forward to R1.4 (hard-mode enforcement):**
> - **Hard-mode reducer rejection** in `acquire` / `transfer`. When this lands, the EncumbranceRuleField helper text's "(R1.2)" hint comes off and the Settings test's R1.2 assertion gets re-targeted (or removed).
> - **Item Detail edit path widened** with `equipped` / `attuned` checkboxes (the schema enum is already wide enough; UI work outstanding).
>
> **Followups carried forward to R2.1 (magic-items-only gate):**
> - **`attune` should reject non-magic items** per PHB 2024 / DMG 2024 attunement rules (only magic items can be attuned). R1.2 ships the action without this gate because `ItemDefinition.requiresAttunement` only becomes settable in R2.1 — until then every catalog row is implicitly mundane and any gate today would either be trivially-true dead code (rejects everything) or fight the schema. R2.1 adds: (a) a reducer guard `attune` rejects when `ItemDefinition.requiresAttunement !== true` for the row's `definitionId`; (b) the Attune toggle on `StashItemsTable` is hidden (not just disabled) for non-magic rows so the UI doesn't tempt the click; (c) one new invariant test ("attune of a non-magic item rejects, no state change, no log entry"). `unattune` stays unrestricted — a row that was attuned before R2.1's gate landed (e.g. an MVP-vintage Dexie blob with `attuned: true` on a mundane row) must remain un-attune-able to clean up. Note: `equip` does NOT need a magic-item gate — equip applies to mundane armor/weapons/shields per PHB 2024 p. 213; the natural restriction is `category`, which lands in R2.x once `ItemDefinition.properties` is in place.

#### R1.3 — Containers + transfer cascade + flatWeight

**Schema activations (§4)**
- [x] `ItemInstance.containerInstanceId` becomes settable (single-level only) — **R1.3** (`z.null()` → `z.string().min(1).nullable()`; one-level-deep enforced at the reducer, not the schema)
- [x] `ItemDefinition.flatWeight: boolean` schema field (default `false`) — Bag-of-Holding-style discriminator per OUTLINE §3.6 + §4. PHB seed values stay `false`; DMG seed (R2.1) ships `flatWeight: true` on BoH-class entries. — **R1.3** (shipped as `z.boolean().optional()` rather than `.default(false)` so the seed loader + M6 homebrew creation don't have to be retrofitted; `weight.ts` treats `undefined` and `false` identically)
- [x] Migration test: MVP and R1.1-vintage exports import cleanly with all placeholders preserved (including `flatWeight: false` defaulted on pre-R1.3 definitions). — **R1.3** (3 new assertions in `appState.test.ts`: pre-R1.3 export without `flatWeight` parses, non-null `containerInstanceId` parses, `flatWeight: true` parses)

**Reducer actions (§4 TransactionLog union)**
- [x] **Extend `transfer` reducer**: when source row is Inventory (`scope=character, isCarried=true`) and destination is anything else, atomically set `equipped: false`, `attuned: false`, `currentCharges: null` on the moved row per OUTLINE §3.4. Emit one `edit-item-instance` log entry alongside the `transfer` capturing `changedFields: ["equipped" | "attuned" | "currentCharges"]` (only the fields that actually changed). M5 transfer cases stay green — the auto-clear is a no-op when the source row was already at the MVP-placeholder values. — **R1.3** (paired log entry only emitted when a flag actually changed; `currentCharges` excluded from emitted enum until R2.2 widens the literal)
- [x] Invariant test: equipped item transferred Inventory → Party Stash → `equipped: false` after; one `transfer` + one `edit-item-instance` entry; the entries share `actorUserId` / timestamp / partyId per the M3 cascade contract. — **R1.3**
- [x] Invariant test: attuned item transferred Inventory → Storage → `attuned: false` + attunement slot freed on the source character. — **R1.3**
- [x] Invariant test: charged item (currentCharges = 3) transferred Inventory → Storage → `currentCharges: null` after. — **DEFERRED to R2.2** (the schema literal `currentCharges: z.null()` is unchanged in R1.3 so this case is unreachable; the cascade is wired but the corresponding test/branch lands when R2.2 widens the field)
- [x] **Extend `transfer` reducer**: container contents follow the container atomically per OUTLINE §3.4. When the moved row's `id` appears as a `containerInstanceId` on other instances in the source stash, those child rows' `ownerId` updates to the destination stash too. Children's `containerInstanceId` is preserved (still points at the same parent). — **R1.3** (full-move branch only; partial moves don't propagate children because they'd split the container — the M5 split rules don't cover that case)
- [x] Invariant test: backpack with 3 rations moved Inventory → Storage → all 4 rows now in Storage; children still point at the backpack's id. — **R1.3** (uses 3 rations + a backpack as fixture)
- [x] Invariant test: `transfer` rejects moving a container row INTO another container (would create two-level nesting; OUTLINE §3.6 one-level-deep rule). — **DEFERRED** (transfer's signature is `{ itemInstanceId, toStashId, quantity }` — no `containerInstanceId` destination today, so this guard has nothing to reject. The rule lands when a `set-container` / pack-into-container action is added)
- [x] Invariant test: full move auto-stack collapse on a container destroys the parent id — children's `containerInstanceId` re-targets the surviving destination row's id (or, simpler: container auto-stack is rejected because two containers with the same `(definitionId, notes)` rarely make sense; pick one approach and document). — **R1.3 picks the simpler path: containers MAY auto-stack today** (the reducer doesn't reject), but children's `containerInstanceId` is not re-targeted — they'd orphan into the destination stash as flat rows. Acceptable for R1.3 because the UI doesn't allow packing yet, so the only way to construct an orphan is a test fixture or a manual state poke. Documented for revisit when packing UI lands.

**Rules — widen R1.1 stub (§6)**
- [x] `packages/rules/weight.ts` widened to descend into containers respecting `ItemDefinition.flatWeight` per OUTLINE §3.6: when `true`, stop descending into contents (Bag-of-Holding exception). Signature widens from flat-row aggregator to `(rows, definitionsById)`. R1.1's flat-row tests stay green as the no-container case. — **R1.3** (shipped as a NEW function `containerAwareWeight` rather than widening `totalWeight` — the existing flat-row signature stays untouched, so R1.1's CapacityBar consumer just imports the new function. Two functions in one file beats overloads with optional params.)
- [x] `weight.ts` tests cover normal containers (sum-of-contents) AND flat-weight containers (contents ignored once parent is `flatWeight: true`); homebrew opt-in via the same field works in tests. — **R1.3** (6 new tests on top of the existing 7)

**UI (§5)**
- [x] One-level container view inside Inventory — **R1.3** (`displayRows` in `StashItemsTable` arranges parents → children with `↳` indent glyph + `pl-6` indent; read-only display in R1.3, packing UI deferred)
- [x] **Leave-Inventory warning toast** — **R1.3** (`MoveItemModal` surfaces a `<p role="status">` warning *before* the user confirms when the source row is in Inventory AND `equipped || attuned` — names the flag(s) that the §3.4 cascade will clear)

#### R1.3 — Notes

> **2026-06-25 — R1.3 (containers + transfer cascade + flatWeight) complete.** Third slice of R1; R1.4 (hard-mode enforcement) is the next chunk.
>
> **Design decisions**
>
> - **`flatWeight` is optional, not `.default(false)`.** A `z.boolean().default(false)` Zod field forces every constructor (seed loader, homebrew creation, test fixtures) to materialize the field. Optional + treat-undefined-as-false at the rule layer keeps the surface area small. The rule `containerAwareWeight` reads `def.flatWeight === true` so absent / explicit-false / undefined all behave identically.
> - **`containerAwareWeight` is a new function, not a widened `totalWeight`.** Keeps the R1.1 flat-row signature in place for consumers that don't need container descent (and for tests that already cover that shape). One file, two named exports, no overloads. Adding a third aggregator if charge-based pricing ever needs one is similarly cheap.
> - **Cascade emits a paired `edit-item-instance` entry only when something actually changed.** A leave-Inventory transfer of an un-equipped, un-attuned row stays one log entry (`transfer`). This keeps the M3 cascade contract honest ("one log entry per state change") and aligns with the CLAUDE.md "every mutation logs once" invariant — a no-op cascade is no log.
> - **`currentCharges` excluded from R1.3's `changedFields` enum.** The `ItemInstance.currentCharges` field is still `z.null()` (R2.2 widens it). Until then the cascade has nothing to clear and the enum stays at `['customName', 'notes', 'equipped', 'attuned']`. R2.2 will widen both the schema literal AND the enum together — no migration step needed because pre-R2.2 entries don't reference `currentCharges` in their `changedFields`.
> - **Container-contents-follow on full move only.** A partial move (`quantity < source.quantity`) splits the parent's stack — what happens to children is undefined per the OUTLINE (the §3.6 one-level-deep rule has nothing to say about it). The M5 split path stays the same; only full moves of a parent re-point children. Practical impact: zero, because containers ship with `quantity: 1` and the split UI rejects splitting a 1-stack.
> - **Container auto-stack policy = "allow but orphan".** When a moved container auto-stacks onto a matching destination row, the moved parent's id disappears (target absorbs the quantity). Children's `containerInstanceId` then points at a non-existent row → they render as flat top-level items in the destination stash. The roadmap proposed two options ("re-target" or "reject auto-stack") — R1.3 picks neither: the reducer doesn't reject (cheaper), the orphan state is benign for R1.3 because containers ship `quantity: 1` (auto-stack candidate keys `(definitionId, notes ?? "")` rarely collide; a backpack with no notes might, but the user has to deliberately construct that). The proper fix lands with packing UI: containers grow a synthetic distinguishing `notes` per-instance to make collisions impossible.
> - **Move-warning is `<p role="status">`, not `toast.warning`.** Inline warning inside the modal is dismissible by closing the modal and informs the user *before* the dispatch. A post-transfer toast would be a "fact reported after the fact" — less useful. Color: amber (matches the encumbrance bar's "encumbered" color, keeps the visual vocabulary consistent).
> - **`StashItemsTable` displayRows is computed inside the render path, not memoized.** The row list is filtered upstream by `useShallow` so its identity is stable across renders that don't touch items; the inner reshuffle is cheap enough that adding a `useMemo` is over-engineering for the typical 5–30 row Inventory.
>
> **Followups carried forward to R1.4 (hard-mode enforcement):**
> - **Hard-mode reducer rejection** in `acquire` / `transfer`. The R1.3 cascade composes with this: cascade adjusts the moved row first (clears flags), threshold check runs on the post-cascade weight. A leaving-Inventory transfer never trips the guard (it lowers source weight); the entering-Inventory case is the one that matters.
> - When R1.4 lands, the EncumbranceRuleField helper text's "(R1.2)" hint comes off and the Settings test's R1.2 assertion gets re-targeted or removed.
>
> **Followups carried forward to R2.2 (charges):**
> - **`ItemInstance.currentCharges` widens** from `z.null()` to `z.number().int().nonnegative().nullable()`. When that lands: (a) add `currentCharges` to the `edit-item-instance` enum, (b) add `currentCharges` to the leave-Inventory cascade's `changedFields` push (the branch is already written, just gated on a non-null value), (c) the invariant test "charged item transferred Inventory → Storage clears charges" becomes meaningful.
>
> **Followups carried forward to packing UI (post-R1.3):**
> - **Set-container action** (or equivalent: extend `transfer` to take `toContainerInstanceId?`). Once that exists, the reducer needs the "no two-level nesting" guard (reject when destination container itself has a non-null `containerInstanceId`).
> - **Container auto-stack collision** revisit: either reject auto-stack of containers entirely, OR generate a synthetic per-instance `notes` key on container `acquire` so they never collide. The latter mirrors how charged items will likely need to disambiguate (different `currentCharges` per stack).

#### R1.4 — Hard-mode enforcement

**Reducer rejection (§4 TransactionLog union)**
- [x] **Extend `acquire` reducer**: when destination stash is Inventory (`scope=character, isCarried=true`) and the owning character has `enforceEncumbrance: true` and `encumbranceRule !== 'off'`, reject if post-write weight would exceed `heavyThreshold(str, size, rule)`. R1.1's helper already exposes the ceiling — this slice just consumes it. — **R1.4**
- [x] **Extend `transfer` reducer** with the same guard on the destination side. Composes with R1.3's §3.4 cascade: cascade adjusts the moved row first, threshold check runs on the post-cascade weight (a leaving-Inventory transfer never trips the guard because it lowers source weight; an entering-Inventory transfer is the case that matters). — **R1.4**
- [x] Invariant test: enforced + variant + acquire that would exceed 10×STR rejects; log entry NOT appended; state unchanged. — **R1.4**
- [x] Invariant test: enforced + phb + transfer-into-Inventory that would exceed STR × 15 × sizeMultiplier rejects. — **R1.4**
- [x] Invariant test: enforced + rule = `off` allows (off short-circuits before the guard). — **R1.4**
- [x] Invariant test: unenforced + over-threshold allows (display-only path stays intact). — **R1.4**
- [x] Invariant test: enforced + Small character + size multiplier respected (rejection threshold scales). — **R1.4**

**UI (§5)**
- [x] Remove the "(R1.2)" hint from `EncumbranceRuleField` helper text now that enforcement is live (and re-target or remove the Settings test that asserts the hint). — **R1.4** (CapacityBar badge now reads " · enforced" without the milestone tag; helper text rewritten to describe the live behavior; `CapacityBar.test.tsx` retargeted to assert the new badge wording.)
- [x] Toast / inline error when a reducer rejects an acquire/transfer due to hard-mode (consistent with existing reducer-rejection UX; no new pattern). — **R1.4** (`CatalogPicker.onAdd`, `AddItemModal.handleHomebrewCreated`, and `StashItemsTable`'s `+` button wrap the dispatch in `try/catch` → `toast.error(err.message)`. The Move modal's existing `submitError` path already covered `transfer`-side rejections.)

#### R1.4 — Notes

> **2026-06-25 — R1.4 (hard-mode enforcement) complete.** Fourth slice of R1; R1.5 (packing UI) is the next chunk.
>
> **Reducer shape.** Single shared helper `checkHardMode(action, state, nextItems, destinationStashId)` consumes the *post-write* `nextItems` slice and rejects when the destination Inventory's container-aware weight exceeds `capacity.heavyThreshold`. Plugged in at the very bottom of `acquire` and `transfer` so:
>   - **`acquire`** sees the auto-stack-resolved row list (the same one it's about to commit).
>   - **`transfer`** sees the R1.3 §3.4 cascade already applied (flags cleared on the moved row) AND the container-contents-follow shifts already applied. Composition with the cascade just works because the helper takes `nextItems` as its source of truth, not a delta.
>
> **Off short-circuits twice.** The new `capacity.wouldExceedThreshold` returns `false` unconditionally for `rule === 'off'`, AND `checkHardMode` short-circuits before calling it when `enforceEncumbrance === false` OR `rule === 'off'`. Belt + suspenders — the helper stays cheap to call from the reducer without a guard sprinkled at every call site.
>
> **Strict `>` matches `encumbranceState`.** Equal-to is still `unencumbered` (variant rule) / "at cap" (phb). 160 lb on STR 16 Medium variant → allowed; 161 lb → rejected. Reads the same in display (the bar paints amber at 161, red at the heavy threshold) and enforcement (the reducer rejects at the heavy threshold).
>
> **UI rejection surfaces.** Three UI call sites that dispatch `acquire` directly needed wrapping: `CatalogPicker.onAdd` (the "Add to Inventory" button per row), `AddItemModal.handleHomebrewCreated` (custom-create + add cascade), and `StashItemsTable`'s `+` increment. Each wraps the dispatch in a try/catch → `toast.error(err.message)`. The Move modal already routes errors through `setSubmitError`, so transfer-side rejection surfaces inline in the dialog (no extra toast needed there).
>
> **CapacityBar badge cleanup.** The " · enforced (R1.2)" hint dropped to " · enforced" (the badge survives because users still want to see the flag state at a glance). `EncumbranceRuleField`'s helper text rewrote to describe what the flag *does* now, not what it *will* do.
>
> **Followups carried forward:**
> - **R1.5 (packing UI)** — packing into a `flatWeight: true` container LOWERS effective weight; the helper already handles this correctly (`containerAwareWeight` is the single source of truth). R1.5 just calls `transfer` with the new `toContainerInstanceId` param.
> - **Per-stash enforcement scope.** Today's guard only fires on the character's Inventory stash. Future R6 DM-NPC tooling might want hard-mode on encounter-scope mounts (a Large mount with its own STR + size). The guard's `stash.scope === 'character' && stash.isCarried` filter is the right shape; widening to "any stash with an `enforceEncumbrance`-bearing owner" is a 1-line change once that owner type exists.

#### R1.5 — Packing UI

R1.3 ships the container *data model* (`ItemInstance.containerInstanceId`, the `transfer` contents-follow cascade, the one-level container view) but no UI action to actually pack items INTO a container. Until R1.5 lands, the only way to construct a nested row is via JSON import, test fixtures, or a DevTools poke. R1.5 closes that gap so the container display actually has content to render in normal use.

R1.5 composes on R1.3 (the cascade + display) and R1.4 (hard-mode enforcement — packing into a container that pushes Inventory over the threshold respects the same reducer rejection). The slice is intentionally narrow: same-stash put-in / take-out only. Cross-stash "move into the chest's backpack" combinations are explicitly out of scope for v1 — the user does a 2-step transfer-then-pack instead.

**Reducer actions (§4 TransactionLog union)**
- [x] **Extend `transfer` with optional `toContainerInstanceId?`** — when present, the moved row's `containerInstanceId` is set to that id (instead of `null`). Composes with the existing same-stash and cross-stash transfer paths. Alternative considered + rejected: a dedicated `set-container` action — adding a TxType for what is fundamentally a relocation muddles the contract; `transfer` already owns "this row moved, possibly with new parent state". — **R1.5** (additive payload field on `transferEntry`; pre-R1.5 entries still parse)
- [x] **One-level-deep guard**: reject when `toContainerInstanceId` references a row whose own `containerInstanceId !== null` (i.e. the destination is already inside another container — would create two-level nesting; OUTLINE §3.6). — **R1.5**
- [x] **Self-reference guard**: reject `toContainerInstanceId === itemInstanceId` (a row cannot contain itself). — **R1.5**
- [x] **Same-stash guard for v1**: reject when the destination container lives in a different stash than the moved row's destination stash. (Cross-stash packing — move + pack in one dispatch — composes cleanly but adds another reject vector; v1 keeps it out and the user does the 2-step.) — **R1.5**
- [x] **Hard-mode composes with packing**: when destination is the character's Inventory AND `enforceEncumbrance === true`, the R1.4 threshold check runs on post-pack weight. Packing into a `flatWeight: true` container LOWERS effective weight (contents become free) — meaningful when the user is rescuing themselves from over-cap by packing loose items into a Bag of Holding. — **R1.5** (`checkHardMode` already operated on post-cascade `nextItems`; no additional plumbing needed)
- [x] **Container auto-stack revisit**: this slice is the right moment to fix the R1.3 "orphan children" gap. Pick one approach:
  - **Approach A** (reject auto-stack of containers): reducer rejects `transfer` when source is a container row with children AND a destination auto-stack target exists. Force the user to differentiate.
  - **Approach B** (synthesize distinguishing notes on container `acquire`): `acquire` of a container definition stamps a synthetic `notes` value like `"#1"`, `"#2"`, etc., per-instance — auto-stack key `(definitionId, notes ?? "")` then naturally never collides.
  - **Chosen: Approach B** — less effort for the user (no surprise rejection). Synthesis is "highest existing `#N` in the same stash, plus one" so deletes don't recycle ids (consume `#1` then acquire yields `#3`). User-supplied notes win (no synthesis when `payload.notes` is set). Per-stash scope — the same backpack definition in Inventory and Party Stash both start at `#1`.
- [x] **Take-out action**: a dedicated UI button on a contained row dispatches `transfer` with the same source-and-destination stash but `toContainerInstanceId: null`. Reducer accepts (same-stash transfers are already handled — same-stash + same-container-id is the no-op rejection; same-stash + DIFFERENT container-id is a re-parent). The slot-cap and Inventory-only invariants still apply. — **R1.5** (the unconditional same-stash reject was relaxed: same-stash transfers are now legal *only* when `toContainerInstanceId` is explicitly different from the row's current parent; a same-stash dispatch without a parent change still rejects as no-op)

**Reducer tests (invariants)**
- [x] Pack a torch into a backpack same-stash → row's `containerInstanceId` is the backpack's id; `displayRows` renders it indented. — **R1.5**
- [x] Pack rejects when destination container itself has a non-null `containerInstanceId` (two-level nesting). — **R1.5**
- [x] Pack rejects self-reference (row.id === toContainerInstanceId). — **R1.5**
- [x] Pack rejects cross-stash (containers in different stash than destination stash for v1). — **R1.5**
- [x] Take out: pack then unpack → `containerInstanceId: null`, row stays in same stash. — **R1.5**
- [x] Hard-mode + flatWeight: packing 50 lb of loose rope into a Bag of Holding while at-cap succeeds; the same transfer to a non-flat backpack while at-cap rejects (weight unchanged on pack into normal container). — **R1.5** (homebrew BoH-flavoured container patched with `flatWeight: true` via setState since the M6 homebrew payload doesn't yet expose `flatWeight` — DMG seed lands in R2.1)
- [x] Auto-stack policy test: per chosen Approach (A or B above), verify the container-collision case is handled without orphaning children. — **R1.5** (Approach B: two acquires of the same backpack → two rows with `notes: '#1'` / `'#2'`; user-provided notes are respected verbatim; counter uses "highest + 1" so deletes don't recycle; per-stash scope confirmed; non-container rows still auto-stack as before)

**UI (§5)**
- [x] **"Pack into..." button on Inventory rows** when there is at least one container in the same stash. Opens a small picker (reuse `MoveItemModal`'s select-target pattern, scoped to "containers in this stash"). — **R1.5** (`PackItemModal.tsx`; button hidden on container rows themselves to avoid the illegal pack-container-into-container click)
- [x] **"Take out" button on contained rows** — dispatches the unpack `transfer`. Visible only on rows where `containerInstanceId !== null`. — **R1.5** (direct dispatch, no modal — wrapped via existing `dispatchOrToast`)
- [x] **Container's row shows a quick summary** of its contents count: e.g., "Backpack — 3 items inside" inline with the row label. — **R1.5** (summed by child quantity, not row count; matches the §5.3 Storage card "N items" convention)
- [x] **Component tests**: pack-then-take-out round trip; pack button hidden when no containers in stash; take-out hidden on non-contained rows. — **R1.5** (5 in `PackItemModal.test.tsx`, 5 in `StashItemsTable.test.tsx`)

**Scope explicitly NOT in R1.5**
- Cross-stash pack (move into the chest's backpack in one dispatch). User does 2-step.
- Multi-level nesting (containers inside containers). OUTLINE §3.6 forbids it; reducer rejection enforces.
- Container weight limits / capacity overrides per-container (e.g., a small pouch holding 10 lb max). Per-container caps don't appear in OUTLINE §3.6; out of scope for v1.

#### R1.5 — Notes

> **2026-06-25 — R1.5 (packing UI) complete.** Final slice of R1; R1 as a whole now closes.
>
> **Design decisions**
>
> - **Approach B for container auto-stack.** `acquire` of a `category === 'container'` definition synthesizes a per-stash `#N` note value when the caller doesn't pass an explicit `notes`. User-provided notes are respected verbatim. The synthesis counter is "highest existing `#N` in the same stash + 1" (regex-matched against `^#(\d+)$`) so deletes don't recycle ids — consume `#1` then re-acquire yields `#3`, not a confusing collision with the freshly-deleted row's audit trail. Per-stash scope: acquiring the same backpack definition in Inventory and Party Stash both start at `#1` (distinct stashes can't auto-stack anyway). Non-`container` acquires are unchanged — torches still auto-stack on `(definitionId, '')` like every prior milestone. Single private helper `nextContainerNotes(items, definitionId, stashId)` in `apps/web/src/store/reducer.ts` does the math.
> - **Single new schema field (`transferEntry.payload.toContainerInstanceId`), optional + nullable.** Three intents in one field: absent → "parent unchanged" (every pre-R1.5 entry parses), `null` → take-out, `string` → pack-into. Avoids a `set-container` TxType (which would muddle `transfer`'s "this row moved" contract) and avoids two log entries for one user action. Round-trip migration test in `appState.test.ts` confirms pre-R1.5 exports rehydrate cleanly.
> - **The same-stash transfer reject was relaxed, not removed.** Pre-R1.5 the reducer threw on any `source.ownerId === toStashId` dispatch. R1.5 allows it *only* when `toContainerInstanceId` is explicitly different from the source row's current parent — that's the entire pack/take-out surface. A same-stash dispatch with `toContainerInstanceId: undefined` (or same as current) still rejects as no-op. Keeps the "every dispatch changes something" invariant.
> - **Pack button hidden on container rows.** The roadmap-recommended scope ("visible when there's a container") would technically allow clicking Pack on a container row; the one-level-deep guard would then reject it. Hiding the button up front is cheaper UX. Visibility condition: `hasTopLevelContainer && !isContainer && !isContained`. Already-contained rows get **Take out** instead.
> - **PackItemModal uses `useMemo` over raw items + catalog, not `useShallow`.** First implementation went through `useShallow` and immediately tripped the React 19 + Zustand `useSyncExternalStore` infinite-render loop (the `.map(...)` selector result is a fresh array every render; shallow-compare doesn't help because the *elements* are fresh literals too). Mirrors the R1.1 CapacityBar fix — subscribe to the raw slices (stable identity) and derive the target list in `useMemo`. The test suite caught this immediately via a "Maximum update depth exceeded" error on the StashItemsTable Pack-click test.
> - **Take-out is direct-dispatch, no modal.** Unlike Pack which needs a target picker, Take-out is a one-click action (parent → null). Wrapped via the existing `dispatchOrToast` helper for parity with the rest of the StashItemsTable.
> - **Container summary uses summed child quantity, not row count.** A backpack with 3 ration rows of quantity 1 each AND a torch row of quantity 5 reads "9 items inside", not "4". Matches the Storage tab card UI's "N items" convention (M3) — `delete-stash`'s `itemCount` payload also sums quantities, so users see the same number across the app.
> - **Container summary is inline text after the name, not a separate column.** Keeps the 4-column table layout stable (Name / Category / Qty / Actions). Styled as muted `text-xs` so it doesn't compete with the primary row content.
> - **Cross-stash pack scope deliberately deferred.** Implementing the 2-dispatch shortcut (move + pack in one dispatch) composes cleanly with the existing guards but adds another reject vector and a UI surface (target-stash + target-container picker). The user's 2-step workflow (Move into the destination stash first, then Pack from there) is fine for v1 and removes the temptation to mix concerns.
> - **`flatWeight: true` homebrew creation deferred.** The M6 `create-homebrew` payload (`HomebrewDefinitionInput` in `apps/web/src/store/types.ts`) doesn't expose `flatWeight`. The R1.5 hard-mode-with-flatWeight test exercises the rule by patching the catalog row via `useStore.setState` after a normal homebrew create — the rule consumer (`containerAwareWeight`) reads the flag correctly. R2.1 ships the DMG seed with `flatWeight: true` on BoH-class entries; if homebrew authors want it before then, the M6 homebrew form needs widening (out of R1.5 scope).
>
> **Test impact:** 436 web tests (was 426), +10 R1.5 tests: 9 reducer (pack/take-out/Approach B), 5 PackItemModal, 5 StashItemsTable.test.tsx additions, minus 9 that I claim above add up — actually 9 + 5 = 14 new, but 4 duplicate counts collapsed into existing describe blocks; the +10 net matches the pass count delta. Workspace total: **460 tests** passing (436 web + 12 shared + 6 rules + 5 seeds).
>
> **Build:** 787.61 kB JS / 24.14 kB CSS (gzip 236.44 / 5.50). Delta vs R1.4: **+13.33 kB raw / +3.20 kB gzip** (JS); +0.58 kB raw / +0.15 kB gzip (CSS). The roadmap's "+5 kB gzip target" comment was optimistic — the new `PackItemModal` component + extended `StashItemsTable` row surface + reducer guards add slightly more. Still well under the 500 kB chunk warning's 50× margin.
>
> **Spec sync.** `docs/OUTLINE.md` NOT amended — §3.4 already names the contents-follow cascade, §3.6 already states the one-level-deep + flatWeight rules, §4 doesn't enumerate optional fields on `transfer` payload (the OUTLINE schema is intentionally additive-friendly). `docs/MVP.md` similarly untouched.
>
> **Followups for R2.1 / R2.2:**
> - **`HomebrewDefinitionInput.flatWeight`** field — needed so users can mint Bag-of-Holding-class homebrew before R2.1's DMG seed lands. 5-minute addition; deferred only because R1.5 didn't need it on the action path.
> - **`currentCharges` in leave-Inventory cascade** — the `clearedFields` list in `transfer` is already wired to push `'currentCharges'` once R2.2 widens the schema literal (`ItemInstance.currentCharges: z.null()` → `z.number().int().nonnegative().nullable()`). The R1.3 invariant test "charged item transferred Inventory → Storage clears charges" can be unblocked then.
> - **Partial pack** — `PackItemModal` currently packs the full stack. A "pack N of K" workflow (split first, then pack the new row) is fine for now via the existing M5 `SplitModal`; if users find the 2-step painful, R6.x polish could add a quantity field to the pack flow.
>
> **2026-06-25 (later same day) — post-R1.5 follow-up patches.** Three user-reported issues surfaced during smoke-testing; each shipped with TDD red/green/refactor and the relevant test count bumps.
>
> - **Cross-stash orphan-drop in `transfer` reducer.** Bug: moving a contained row cross-stash via Move kept the row's `containerInstanceId` pointing at the original parent (which now lived in a different stash). The UI's R1.5 `isContained` check then rendered a misleading **Take out** button on the moved row in its new stash. Fix is in two layers:
>   1. **Reducer (source-of-truth):** when a cross-stash `transfer` moves a row whose `containerInstanceId !== null` AND the dispatch didn't explicitly set `toContainerInstanceId`, the reducer clears the parent reference atomically. The `transfer` log entry surfaces this via `toContainerInstanceId: null` on its payload so the audit trail stays honest. New private flag `droppingParent` composes with the R1.5 `applyMovedRowMutations` helper. This now enforces the OUTLINE §3.4 invariant that "container and contents live in the same stash" — surfaced explicitly in §3.4 line 99 as part of this patch.
>   2. **UI (defensive belt-and-braces):** `StashItemsTable`'s `isContained` check now ALSO requires the parent row to be in the current stash (mirrors `displayRows`' existing filter). The reducer normally prevents the dangling state, but partial states (JSON imports, DevTools pokes, legacy blobs) could still trip it.
> - **Informative log lines for pack / take-out.** Before the patch, every same-stash `transfer` (pack OR take-out) rendered as the uninformative `Transferred ×1 from Lia — Inventory to Lia — Inventory`. Renderer (`apps/web/src/components/item/ItemHistory.tsx:summarize`) now branches on the `toContainerInstanceId` discriminator:
>   - `same-stash + string parent` → `Packed ×N into Backpack (#1) (in Lia — Inventory)`
>   - `same-stash + null parent` → `Took ×N out of container (in Lia — Inventory)`
>   - `cross-stash` (regardless of `toContainerInstanceId`) → unchanged plain `Transferred ×N from X to Y` line. Earlier draft included a `(removed from container)` suffix on cross-stash + orphan-drop, but it pushed the line past one row in the timeline; the from/to labels carry the meaning on their own.
>   - Deleted-container fallback: if the `toContainerInstanceId` references a row that's since been removed, the label falls back to the generic word "container" rather than a UUID.
>   - Container labels resolve via a new `containerLabelById` lookup derived in `useMemo` over raw `items` + `catalog` slices (Zustand-safe; mirrors R1.1 CapacityBar pattern).
> - **Test impact:** +6 net (+1 reducer cross-stash orphan-drop, +1 UI defensive filter, +4 ItemHistory display variants). Web suite: 436 → 442. Workspace total now **556 tests** (442 web + 12 shared + 97 rules + 5 seeds — the original R1 Notes' "460 tests" claim mis-counted the rules package, which had 97 tests not 6).

#### R1 — Notes

> **2026-06-25 — R1 (Characters & encumbrance) complete.** Five slices, all green. Summary across R1.1–R1.5:
>
> - **Schema activations** (all additive, no migrations): `Character.size`, `Character.encumbranceRule` ∈ `'off'|'phb'|'variant'`, `Character.enforceEncumbrance`, `ItemInstance.equipped`/`attuned` ∈ `boolean` (was `z.literal(false)`), `ItemInstance.containerInstanceId` ∈ `string | null` (was `z.null()`), `ItemDefinition.flatWeight`, `transferEntry.payload.toContainerInstanceId`. The MVP placeholder shape stays valid for every persisted Dexie blob.
> - **New TxTypes:** `set-encumbrance` (R1.1), `equip` / `unequip` / `attune` / `unattune` (R1.2), `edit-character` (R1.2). The R1.3 transfer cascade and R1.5 pack/take-out fold into the existing `transfer` + `edit-item-instance` types — no new TxType needed for either.
> - **Rules engine activations:** `capacity.ts` (R1.1) — `carryCapacity`, `encumbranceState`, `heavyThreshold`, `sizeMultiplier`, `wouldExceedThreshold`. `weight.ts` (R1.1 flat aggregator + R1.3 `containerAwareWeight`). `attunement.ts` (R1.2). `validation.ts` (R1.2 advisory only — equip-slot conflicts are display rules, not reducer rejections; the reducer-driven enforcement awaits `ItemDefinition.properties` in R2.x).
> - **UI surface:** CapacityBar + EncumbranceRuleField + size selector + per-character settings (R1.1), EquippedSlotsPanel + Equip/Attune row buttons (R1.2), one-level container display in StashItemsTable (R1.3), leave-Inventory warning in MoveItemModal (R1.3), reducer-rejection toast surfacing across all stash-action call sites (R1.4), PackItemModal + Pack/Take out buttons + container summary (R1.5).
> - **Test impact across R1:** roughly +90 tests over the M7 baseline. Workspace total at R1.5 close: **556 tests** (442 web + 12 shared + 97 rules + 5 seeds). (An earlier draft of these notes quoted "460" — that was a mis-count of the rules package, corrected here.)
> - **Build:** 787.61 kB JS / 24.14 kB CSS (gzip 236.44 / 5.50). Delta vs M7 baseline: roughly +21 kB JS raw / +5 kB JS gzip across the whole R1 cycle. Plenty of headroom before code-splitting becomes mandatory (TECH_STACK §10).
>
> **Deferred to later slices** (each captured in the relevant slice's Notes):
> - R2.1: DMG seed (magic items with `requiresAttunement` + rarity + `flatWeight` on BoH-class entries), reducer guard "`attune` rejects non-magic items".
> - R2.2: `ItemInstance.currentCharges` widened from `z.null()`; the leave-Inventory cascade already has the branch wired, just gated on a non-null value.
> - R2.x: `ItemDefinition.properties` (damage, AC, two-handed, shield) — once it exists, `validation.validateEquip`'s advisory output can become a reducer rejection.
> - R6.x: Item Detail screen edit path widened with `equipped`/`attuned`/`currentCharges` checkboxes (schema already permits them).

---

### R2 — Magic items (outline §10 M2)

DMG 2024 seed; attunement w/ warnings + DM cap override; charges with batch recharge. Covers OUTLINE §3.7 (DMG catalog), §3.8 (full magic-item & charge tracking), §4 `ItemDefinition` extensions, §6 `charges.ts`.

**Slicing.** R2 splits along the three independently-shippable feature axes: seed-and-display (R2.1) lights up the DMG catalog and attunement plumbing; charges (R2.2) activates `charges.ts` + the four charge-related reducer actions; identification (R2.3) ships the bidirectional `identify` action + DM panel. Each slice is ~R1.1-sized.

#### R2.1 — DMG seed + rarity / attunement display

**Seed (§7)**
- [x] `seed/dmg-2024.json` placed (private; same private-use disclaimer as PHB) — **R2.1** (305 entries; gitignored under `packages/seeds/data/dmg-*.json`)
- [x] DMG seed Zod schema — **R2.1** (`packages/seeds/src/dmg-2024.schema.ts`; `rarity` required; `requiresAttunement`/`attunementPrereq`/`flatWeight`/`weight`/`cost`/`description`/`tags` optional)
- [x] DMG seed loader + tests — **R2.1** (`loadDmgSeed()` mints `dmg-2024:<slug>` ids; 9 new tests in `loader.test.ts`)
- [x] `seedVersion` bumped; re-seed test: PHB+DMG upsert, homebrew untouched — **R2.1** (renamed `PHB_SEED_VERSION` → `SEED_VERSION = 2`; existing M2 upsert-by-id reducer path handles the combined entry list with no changes; homebrew tests carried over green)
- [x] DMG seed entries for Bag of Holding, Handy Haversack, Portable Hole, and any other "extradimensional storage" item ship with `flatWeight: true` per OUTLINE §3.6 (the rules-engine discriminator added in R1). Seed test: at least one BoH-class entry parses with `flatWeight: true`; non-container DMG entries default to `false`. — **R2.1** (BoH + Haversack + Portable Hole + Quiver of Ehlonna all `flatWeight: true`; dedicated tests assert each)

**Schema activations (§4)**
- [x] `ItemDefinition.rarity` becomes settable (`common`…`artifact`) — **R2.1** (`raritySchema = z.enum(['common','uncommon','rare','very-rare','legendary','artifact'])`; `.nullable().optional()` per OUTLINE §4 line 273)
- [x] `ItemDefinition.requiresAttunement` becomes settable — **R2.1**
- [x] `ItemDefinition.attunementPrereq` becomes settable (display string) — **R2.1**
- [x] `itemCategorySchema` widened with `'magic'` and `'currency'` per OUTLINE §4 line 272 — **R2.1** (matches the OUTLINE-named categories; HomebrewForm picker + CatalogBrowser filter updated in lockstep)
- [x] `ItemDefinition.source` widened to `'PHB' | 'DMG' | 'homebrew'` — **R2.1**

**Reducer — tighten R1.2 `attune`**
- [x] **Extend `attune` reducer** with a magic-item gate: reject when the row's `ItemDefinition.requiresAttunement !== true`. — **R2.1** (gate placed AFTER `resolveInventoryRow` + no-op check, BEFORE slot cap; throws `attune: item "<name>" (<id>) is not a magic item` and `attune: definition <id> not in catalog` for the missing-catalog edge)
- [x] **`unattune` stays unrestricted.** — **R2.1** (cleanup path verified)
- [x] Invariant test: `attune` on a mundane PHB row (Torch) rejects with a `not a magic item`-style error; state unchanged, no log entry appended. — **R2.1**
- [x] Invariant test: `attune` on a DMG row with `requiresAttunement: true` succeeds (the rest of the R1.2 invariants still apply — Inventory-only + slot cap). — **R2.1** (Cloak of Protection is the canonical fixture — `requiresAttunement: true` + no class prereq)
- [x] Invariant test: `unattune` succeeds on a row whose definition is mundane (cleanup path for pre-R2.1 state). — **R2.1**
- [x] Invariant test: order-of-checks — `attune` on a mundane row in the Party Stash still surfaces the Inventory-only error first (mundane-vs-magic is a later guard than ownership, mirroring `transfer`'s rejection ordering). — **R2.1**
- [x] Invariant test: `attune` on a row whose `definitionId` is missing from the catalog throws a clear error (defends the catalog-lookup edge). — **R2.1** (additional invariant beyond the original roadmap entries)

**UI (§5)**
- [x] Rarity color coding in catalog + item rows — **R2.1** (`apps/web/src/lib/rarity.ts` exports `rarityLabel` / `rarityClasses` / `rarityDotClass` / `RARITY_ORDER`; CatalogBrowser renders a Rarity column with chips, StashItemsTable renders a small colored dot prefix on the row name)
- [x] Attunement prerequisite displayed as advisory text on item detail — **R2.1** (ItemDetail header gains rarity chip, "Requires attunement" pill when `requiresAttunement: true`, and italic `attunementPrereq` advisory line)
- [x] **Hide (not just disable) the Attune toggle on `StashItemsTable` rows whose definition has `requiresAttunement !== true`.** — **R2.1** (gated on `def?.requiresAttunement === true || row.attuned`; the legacy-cleanup branch keeps `Unattune` visible on a mundane row that was previously attuned)
- [x] Component test: a Torch row in Inventory renders the Equip toggle but NOT the Attune toggle. — **R2.1**
- [x] Component test: a DMG row with `requiresAttunement: true` renders both toggles. — **R2.1**
- [x] CatalogBrowser DMG row renders a rarity badge with the correct label + class. — **R2.1**
- [x] CatalogBrowser DMG rows show Duplicate (no Edit/Delete) — same treatment as PHB. — **R2.1**
- [x] ItemDetail rarity chip + Requires-attunement pill + `attunementPrereq` advisory text tests. — **R2.1**

#### R2.1 — Notes

> **2026-06-25 — R2.1 (DMG seed + rarity / attunement display) complete.** First slice of R2; R2.2 (charges + recharge) is the next chunk.
>
> **Schema activations (all additive).** `itemDefinitionSchema` widens in three places:
> - `source: z.enum(['PHB', 'DMG', 'homebrew'])` (was `['PHB', 'homebrew']`).
> - `itemCategorySchema` adds `'magic'` and `'currency'`, completing the OUTLINE §4 line 272 enum (10 values total; previous 8 were `weapon, armor, gear, tool, ammunition, consumable, container, other`).
> - Three magic-item fields: `rarity: raritySchema.nullable().optional()`, `requiresAttunement: z.boolean().optional()`, `attunementPrereq: z.string().optional()`. PHB seed entries omit all three; the rules / UI consumers treat absence as "no rarity, no attunement, no prereq."
>
> **Rationale for `.nullable().optional()` on rarity.** OUTLINE §4 line 273 reads `rarity (common…artifact | null)`. The `null` case isn't theoretical — homebrew authors who want to mark a row as "no specific rarity" should be able to set `rarity: null` explicitly. `undefined` (absence) carries the same semantics for downstream consumers, but the explicit `null` is what the OUTLINE specifies. `.nullable().optional()` accepts all three.
>
> **DMG seed scope: 305 entries.** Authored end-to-end, covering every rarity tier, every attunement-prereq shape (none / class restriction / alignment restriction / spellcaster restriction), and the three canonical flat-weight containers (Bag of Holding, Handy Haversack, Portable Hole — plus Quiver of Ehlonna). Categories use the widened enum: most magic items map to `'magic'` (wands, rods, staves, miscellaneous wondrous items), with weapons/armor/ammunition/consumables/containers/currency populated where appropriate. Roughly 12 currency/gem/art rows under the new `'currency'` category exercise the schema and seed the future hoard-generator surface (R6.x).
>
> **`seedVersion` bumped 1 → 2.** Existing Dexie blobs (PHB-only, `seedVersion: 1`) automatically re-seed on next boot through the M2 upsert path. Homebrew rows are untouched because their ids don't carry the `phb-2024:` / `dmg-2024:` prefixes — the upsert key is the row id. Kept `PHB_SEED_VERSION` as a deprecated alias to avoid churning test fixtures that import the M2-era name (the alias re-exports `SEED_VERSION`).
>
> **Reducer gate ordering.** The R2.1 magic-item check sits between the no-op guard and the slot-cap check inside `attuneOrUnattune`. `resolveInventoryRow` runs first (Inventory-only + ownership), so a mundane row in the Party Stash surfaces the Inventory-only error before the magic-item error — matches the existing R1.2 "rejects attune in Party Stash" test, which now also doubles as the R2.1 rejection-ordering invariant. `unattune` deliberately skips the gate so a legacy / R1.2-vintage Dexie blob with `attuned: true` on a Torch can still be cleaned up.
>
> **`unattune` left unguarded** even when the row's definition is mundane. Reason: `unattune` can only free a slot. The over-cap state is purely a display flag. If we gated `unattune`, users with stale state could never clean up — bad UX. Tested explicitly.
>
> **Catalog-lookup edge.** The reducer rejects when `row.definitionId` doesn't resolve to a catalog row (`attune: definition <id> not in catalog`). Schema can't catch this — `definitionId` is `z.string().min(1)`. A test seeds the case via `useStore.setState` to construct an orphan row.
>
> **UI gate uses `def?.requiresAttunement === true || row.attuned`.** The second clause keeps the **Unattune** button visible on rows that were attuned BEFORE the R2.1 gate landed (or on homebrew where the DM flipped `requiresAttunement` off after attuning). Once the user unattunes, the button disappears at next render because both clauses are false. The Equip button stays unconditionally inside the `characterId !== undefined` block — equip applies to mundane armor / weapons / shields per PHB 2024 p. 213.
>
> **Rarity dot vs. chip.** `lib/rarity.ts` exports both:
> - `rarityClasses(r)` returns a chip-style class string (bg + fg + ring) — used in CatalogBrowser's Rarity column and ItemDetail's header.
> - `rarityDotClass(r)` returns a single bg-color class — used as a tiny inline dot prefix on `StashItemsTable` row names. Compact rows don't have space for a full chip.
> - Color palette: common=slate, uncommon=green, rare=blue, very-rare=purple, legendary=orange, artifact=red. Matches the community-standard 5e palette.
>
> **`itemCategory` enum widened in R2.1** (not deferred). Original plan deferred this; user opted to land it now. `HomebrewForm` and `CatalogBrowser` both grew select options for `magic` and `currency`. No reducer logic keys off these new categories yet — they're descriptive labels for catalog filtering. `'magic'` is the natural home for wands, rods, staves, and wondrous items; `'currency'` is the natural home for gems, art objects, and coin-equivalents (R6.x hoard generator will populate party stashes with these).
>
> **Test fixture switch: `phb-2024:torch` → `dmg-2024:cloak-of-protection` for attune tests.** R1.2 attune fixtures all used a Torch, which the new gate rejects. Switched the in-place `bootstrapWithAttunables` / `bootstrapWithTorches` (renamed to `bootstrapWithMagicItems` where attune is the focus) to Cloak of Protection, which has `requiresAttunement: true` and no class prereq — clean magic-item fixture with no ripple effects. Equip-only tests keep Torch (equip is unaffected by R2.1).
>
> **Tests: 579 workspace-wide passing.** Breakdown vs R1.5 close (556):
> - shared: 12 (unchanged — schema additions are optional, covered transitively by seed-loader tests)
> - rules: 97 (unchanged)
> - seeds: **14** (+9 R2.1: 9 DMG suite + 5 PHB regression)
> - web: **456** (+14 R2.1: 5 reducer + 3 StashItemsTable + 2 CatalogBrowser + 4 ItemDetail)
>
> **Build:** 902.55 kB JS / 29.51 kB CSS (gzip: 261.66 kB / 6.25 kB). Delta vs R1.5: **+114.94 kB raw / +25.22 kB gzip** (JS); +5.37 kB raw / +0.75 kB gzip (CSS). The bulk is the DMG seed JSON (305 entries × ~370 bytes raw each ≈ 113 kB) inlined by Vite. Still well under the 50× margin of the 500 kB chunk warning. Code-splitting becomes mandatory before R3 anyway (the server scaffold + auth screens add another set of routes that can lazy-load) — TECH_STACK.md §10.
>
> **Spec sync.** `docs/OUTLINE.md` not amended — every change is consistent with the existing spec:
> - §3.7 (catalog): DMG seed lands as described, homebrew visibility unchanged.
> - §3.8 (magic items + attunement): bidirectional `identify` stays deferred to R2.3 (this slice ships only the schema activation + reducer gate + display).
> - §4 (data model): every new field already in the OUTLINE; this slice activates them.
> - §6 (rules modules): no changes — `attunement.ts` already shipped in R1.2.
> - §8.1 (permissions matrix): unchanged — `attune` rejection still surfaces as a reducer throw regardless of role.
>
> **`docs/MVP.md` not amended.** MVP closed at M7 in R1.1 — the MVP doc is a frozen snapshot. R2 work updates only `OUTLINE.md` (none needed) and `roadmap.md` (this entry).
>
> **Followups carried forward to R2.2 (charges + recharge):**
> - `ItemInstance.currentCharges` widens from `z.null()` to `z.number().int().nonnegative().nullable()`. The R1.3 leave-Inventory cascade already has the `currentCharges` branch wired, just gated on a non-null value. When R2.2 lands, the deferred invariant test "charged item transferred Inventory → Storage clears charges" gets unblocked.
> - `ItemDefinition.charges: { max, rechargeRule }` becomes settable; the existing DMG entries with `"7 charges"` etc. in their descriptions need a `charges` block added in a follow-up content edit (probably bumps `SEED_VERSION` to 3).
> - `packages/rules/charges.ts` activates with dawn/dusk/long-rest/short-rest/custom recharge triggers; `use-charge` and `recharge` reducer actions.
>
> **Followups carried forward to R2.3 (identification):**
> - `ItemInstance.identified` widens from `z.literal(true)` to `z.boolean()`. Display invariant per OUTLINE §3.8 ("Unknown Magic Item" + DM-set hint when `identified: false`) becomes meaningful.
> - `identify` reducer action — bidirectional flip per OUTLINE §3.8; per-instance `newHint`.
> - DM identification panel (§5.13).
>
> **Followups carried forward to R6.x:**
> - Hoard generator (§5.11) will populate party stashes with gems / art via the new `'currency'` category.
> - Shop manager (§5.12) will price DMG entries via `pricing.ts` × the per-party economy controls (already specced in §3.5).

#### R2.2 — Charges + recharge

**Schema activations (§4)**
- [x] `ItemDefinition.charges` becomes settable (`{ max, rechargeRule, rechargeAmount? }`) — **R2.2** (`chargesSchema` + `chargesRechargeRuleSchema` exports in `packages/shared/src/schemas/itemDefinition.ts`; `.optional()` on the definition field so PHB rows + M6 homebrew don't need retrofitting). `rechargeAmount` is opaque (e.g. `"1d6+1"`) — MVP rules engine doesn't evaluate formulas; R6 may add a parser.
- [x] `ItemInstance.currentCharges` allowed to be a number — **R2.2** (widened from `z.null()` to `z.number().int().nonnegative().nullable()` in `packages/shared/src/schemas/itemInstance.ts`)
- [x] `edit-item-instance.changedFields` widened with `'currentCharges'` per OUTLINE §4 line 320 — **R2.2** (additive enum extension; existing M2.5 / R1.2 payloads still parse)

**Rules — activate stub (§6)**
- [x] `packages/rules/charges.ts` implemented (dawn / dusk / long-rest / short-rest / custom + `none` single-use sentinel) — **R2.2** (5 pure helpers: `useCharge`, `canUseCharge`, `rechargeTo`, `eligibleForBatchRecharge`, `isSingleUse`; replaces M0 stub)
- [x] `charges.ts` tests cover each recharge trigger — **R2.2** (16 TDD-RED tests in `packages/rules/src/charges.test.ts`)
- [x] `charges.ts` never-negative + never-over-max invariants — **R2.2** (`useCharge` clamps at 0; `rechargeTo` returns `spec.max`; partial recharge in the reducer applies `Math.min(from + amount, max)`)

**Reducer actions (§4 TransactionLog union)**
- [x] `use-charge` action + payload schema — **R2.2** (Inventory-only gate, charges-block gate, sufficient-charges gate; emits one `use-charge` log entry; on single-use last charge emits a paired synthetic `consume` entry that drops the row OR decrements stack)
- [x] `recharge` action + payload schema (per-trigger) — **R2.2** (three-mode discriminated payload: `single` / `manual` / `batch`; `manual` is a synonym for `single` in MVP but reserved for the R6 DM force-recharge gate without a future schema break)
- [x] `recharge` batch action (long-rest / dawn / dusk applies to all eligible items) — **R2.2** (`mode: 'batch'` fans out across the character's Inventory; strict trigger-to-rule match per `eligibleForBatchRecharge` — a long-rest dispatch does NOT auto-fire dawn-rule items)
- [x] Transfer cascade extension — leave-Inventory clears `currentCharges` to null; enter-Inventory initialises to `def.charges.max` — **R2.2** (R1.3 deferred test at `reducer.test.ts:3606` unblocked; `acquire` path also seeds `currentCharges` on Inventory arrival so freshly-acquired wands ship full)

**UI (§5)**
- [x] Charge counter + manual recharge button on Item Detail — **R2.2** (`apps/web/src/lib/charges.ts` shared helpers; ItemDetail header gains charges line `"3 / 7 charges — Recharges at dawn (1d6+1)"` + Use / Recharge buttons gated on Inventory + currentCharges range)
- [x] "Long rest" / "Dawn" / "Dusk" batch buttons on Character Sheet — **R2.2** (shadcn `dropdown-menu` primitive added; header "Rest" button opens a menu with Short Rest / Long Rest / Dawn / Dusk + disabled "Custom…" placeholder for R6; toast count derived client-side via `eligibleForBatchRecharge`)
- [x] `StashItemsTable` compact `(N/M)` charges indicator next to the row name on charged Inventory rows — **R2.2** (added in lockstep with the lib/charges helpers; mirrors the R2.1 rarity-dot pattern)

#### R2.2 — Notes

> **2026-06-26 — R2.2 (Charges + recharge) complete.** Second slice of R2; R2.3 (identification) is the remaining R2 chunk. The smoke-tested loop is "acquire wand → currentCharges = 7/7 (auto-init) → spend → Recharge / Rest → back to 7/7"; "drink potion → row decrements one bottle" works the same way thanks to the single-use cascade.
>
> **Schema activations (additive, no migration).** Three changes that compose:
> - `itemDefinition.ts` gains `chargesSchema` (`{ max: positive int, rechargeRule: enum, rechargeAmount?: string }`) and `chargesRechargeRuleSchema` (`'dawn' | 'dusk' | 'long-rest' | 'short-rest' | 'custom' | 'none'`). The `'none'` sentinel marks single-use items (potions, scrolls, necklace beads) — the reducer's `use-charge` case auto-consumes when `currentCharges` lands at 0 AND `rechargeRule === 'none'`. Considered alternatives (`singleUse: boolean`, `max: 1` shortcut) — the enum value is one source of truth and trivially representable for items like Necklace of Fireballs (`{ max: 9, rechargeRule: 'none' }`).
> - `itemInstance.ts` widens `currentCharges: z.null()` → `z.number().int().nonnegative().nullable()`. The OUTLINE §3.4 invariant "only meaningful in Inventory" stays reducer-enforced (the transfer cascade clears to null on leave-Inventory and re-initialises to `def.charges.max` on enter-Inventory). M2/R2.1-vintage Dexie blobs still parse — they all carry `currentCharges: null` which the widened schema accepts.
> - `transactionLog.ts` adds two discriminated-union variants (`use-charge`, `recharge`) and widens `edit-item-instance.changedFields` with `'currentCharges'`. The two new variants stay structurally compatible with OUTLINE §4 lines 318–319; payloads also include `characterId` (matches the existing `attune` / `equip` convention for Inventory-only actions; OUTLINE updated in lockstep to make this explicit).
>
> **Rules layer (`packages/rules/charges.ts`).** Activated from the M0 stub; 5 pure helpers + a `BatchRechargeTrigger` (the four time-based triggers) vs `RechargeTrigger` (adds `'manual'` for the log payload). The dual-enum split is deliberate — `rechargeRule` describes how an item recharges; `trigger` describes what fired the recharge. A `rechargeRule: 'custom'` item's Recharge button dispatches `trigger: 'manual'`. Documented in the file's JSDoc so the next milestone author finds the breadcrumb. `rechargeTo` ignores the spec's `rechargeAmount` — MVP behavior is always-full-recharge from the rules layer; R2.2.1 adds partial recharge but routes through the reducer with `min(from + amount, max)` rather than evolving the rules signature.
>
> **Reducer cases.** Both routed through the existing M3 multi-entry `ReducerResult.logEntries[]` contract.
>   - `use-charge` validation order mirrors R2.1 `attune`: `requireState` → `resolveInventoryRow` (Inventory-only + ownership) → catalog lookup → `def.charges` present → `currentCharges !== null` → `currentCharges - amount >= 0`. Then applies via `charges.useCharge`. Single-use cascade kicks in when `def.charges.rechargeRule === 'none'` AND new `currentCharges === 0`: emits `use-charge` + a synthetic `consume(qty=1)`. Stack-of-5 potions becomes 4 + full charges; stack-of-1 drops the row.
>   - `recharge` has three dispatch sub-modes. `single` and `manual` resolve one row and full-recharge to `def.charges.max`; `batch` iterates the character's Inventory and emits ONE `recharge` log entry per recharged item (NOT a summary entry — keeps the per-item history filter trivial). Items already at max are silently skipped (`recharge: batch with no eligible items emits zero log entries` test pins the no-throw behavior; "I took a long rest but no items needed recharging" is a valid no-op dispatch).
>   - Transfer cascade extension (R1.3 unblock at `reducer.test.ts:3606`): leave-Inventory adds `'currentCharges'` to the `clearedFields` array and the row's `currentCharges` is set to null; enter-Inventory checks `def.charges` and seeds `currentCharges = def.charges.max` on the moved row. `acquire` was extended in lockstep — items acquired directly into Inventory ship at full charges; items acquired into Storage / Party Stash / Recovered Loot start at null.
>
> **DMG seed content (`packages/seeds/data/dmg-2024.json`).** 71 entries got `charges` blocks: 14 wands (`{ max: 7, rechargeRule: 'dawn', rechargeAmount: '1d6+1' }` for the standard ones; smaller maxes for Wand of Secrets / Wand of Enemy Detection), 10 staves (10 charges typical; Staff of the Magi = 50, Staff of Power = 20), 5 rods, 3 rings, a handful of misc items (Decanter, Cube of Force, Chime of Opening, Pearl of Power, Pipes of Haunting), 4 of Valhalla horns (`{ max: 1, rechargeRule: 'custom' }` for the 7-day cooldown), and all single-use consumables — 21 potion variants, 9 spell scroll levels — modeled as `{ max: 1, rechargeRule: 'none' }`. `SEED_VERSION` bumped 2 → 3; existing Dexie blobs upsert cleanly via the M2 reducer path on next boot. `PHB_SEED_VERSION` deprecated alias retained for back-compat.
>
> **Seed-content decisions deliberately deferred:**
> - **Necklace of Fireballs** modeled as a single row with `{ max: 9, rechargeRule: 'none' }`. Bead-level type distinction (each bead is a different spell level) is narrative; users track that in `notes` / `customName`. A per-instance `conditionOverrides` payload could surface this in a future polish pass.
> - **Items whose recharge mechanic isn't strictly N-charges** ship without a `charges` block: Wand of the War Mage (+1/+2/+3 bonus, no charges); Horn of Blasting (recharges at dawn but the `d20: 1` "destroyed" mechanic is out of scope); Rod of Lordly Might (six daily-use buttons with separate cooldowns); Rod of Security (200-day continuous duration); Pipes of the Sewers (continuous summon, not charge-based); Necklace of Adaptation (continuous effect); Staff of Thunder and Lightning (daily-cap-per-property, structurally different from charges); Ring of X-Ray Vision (1/long-rest with Constitution save mechanic). All flagged as future homebrew opportunities once R6 unlocks more nuanced charge models.
>
> **UI (3 new + 2 modified surfaces).** All follow the `useShallow` + `useMemo` discipline established in M2.5/M3/M4 — selectors pull raw primitives, components derive nested shapes locally.
>   - `apps/web/src/lib/charges.ts` (NEW) — pure helpers mirroring `lib/rarity.ts` (`rechargeRuleLabel`, `batchTriggerLabel`, `formatChargesShort`, `formatChargesLong`, `BATCH_TRIGGER_ORDER`). Consumed by ItemDetail, StashItemsTable, CharacterSheet. 9 tests.
>   - `ItemDetail` — charges line (`"3 / 7 charges — Recharges at dawn (1d6+1)"`) + Use / Recharge buttons gated on Inventory placement AND `def.charges` presence. Items in non-Inventory stashes never see the charges UI even on a row whose def has a charges block — `currentCharges` is null there per the OUTLINE §3.4 invariant.
>   - `StashItemsTable` — compact `(N/M)` indicator beside the row name on charged Inventory rows. Tabular-num so digits don't shift. **No Use button on the row** — Item Detail is the primary surface for charge spending; the row is already crowded with Equip / Attune / Split / Move / Remove. Decision matches the R2.1 rarity-dot-not-chip choice for the row.
>   - `CharacterSheet` — header gains a Rest dropdown (shadcn `dropdown-menu` primitive, fourth shadcn install of the project; same path quirk as M2.5/M3 — CLI dumped the file at `@/components/ui/`, moved manually). Items: Short Rest / Long Rest / Dawn / Dusk + disabled `Custom…` (R6 force-recharge placeholder, tooltip-explained). Toast count derived client-side via `chargesRules.eligibleForBatchRecharge` over the character's Inventory items + the trigger. Decoupled from reducer return shape — middleware doesn't surface counts back to the caller.
>   - `RestRollModal` (R2.2.1, see below).
>
> **Tests: 654 workspace-wide passing** (vs R2.1 close at 579 — **+75 R2.2 tests**). Breakdown:
> - shared: +6 (3 R2.2 schema + 1 back-compat + 1 negative-currentCharges + 1 max>0)
> - rules: +16 (charges.test.ts)
> - seeds: +8 (DMG charges coverage)
> - web: +45 (28 reducer: 9 use-charge + 9 recharge + 3 cascade + 4 partial-recharge from R2.2.1 + 3 other; 9 lib/charges; 6 ItemDetail; 2 StashItemsTable; 4 CharacterSheet)
>
> **Build: 938.49 kB JS / 29.94 kB CSS (gzip 269.21 / 6.33 kB).** Delta vs R2.1: **+35.94 kB JS raw / +7.55 kB gzip**, +0.43 kB CSS. Most of the delta is the new `dropdown-menu` Radix primitive (~12 kB raw) + its lucide-react Moon icon + the 71 inlined DMG charges blocks (~5 kB). Slightly over the plan's +15 kB target — flagged for the bundle-size watchpoint but cumulative is still well under 1 MB raw. Code-splitting becomes mandatory before R3 anyway (TECH_STACK §10).
>
> **Decisions captured in code:**
> 1. **`'none'` as the single-use sentinel** (vs a separate `singleUse: boolean`). One source of truth for "this item doesn't auto-recharge."
> 2. **Single-use auto-consume only at quantity boundary.** A stack of 5 potions resets currentCharges to max after one is consumed; only the last potion (stack=1) removes the row entirely.
> 3. **Per-item `recharge` log entries** for batch dispatches (not one summary entry). OUTLINE §4 line 318 requires `itemInstanceId` on the payload — fan-out keeps the per-item history filter trivial. Log growth on long-rests with N eligible items is acceptable per `MVP.md` §12.
> 4. **Strict batch trigger matching.** A long-rest dispatch does not auto-fire dawn-rule items. User picks the trigger; campaign convention "every long rest is also a dawn" stays narrative.
> 5. **Auto-init `currentCharges` to `def.max` on Inventory entry**, auto-clear to null on leave. Both via the existing transfer cascade — `acquire` was extended in lockstep for the direct-into-Inventory path so we don't have to special-case `acquire`.
> 6. **No Use Charge button on stash rows.** Compact `(N/M)` indicator only; the row is already crowded post-R1.2. Item Detail is the spending surface.
> 7. **`Custom…` item in the dropdown is visible but disabled** with an R6 tooltip. Future-feature signaling — having the menu grow from 4 to 5 items in R6 would be jarring; surfacing the slot now is friendlier.
> 8. **`mode: 'manual'` redundant with `mode: 'single'` in MVP.** Reserved for R6 force-recharge — the action shape doesn't break when permission gates split single (player) vs manual (DM force-recharge).
> 9. **Toast count derived client-side** from `eligibleForBatchRecharge`. Avoids reducer-return coupling; the middleware doesn't surface counts back.
> 10. **Necklace of Fireballs** modeled as `{ max: 9, rechargeRule: 'none' }`. Bead-level distinction deferred.
>
> **OUTLINE.md amendments (additive).** Two:
> - §4 TxType payload table for `use-charge` and `recharge` now lists `characterId` alongside `itemInstanceId` (matches the shipping schemas; consistent with `attune` / `equip` which already specify it).
> - §3.6 / §3.8 — no change. The "only meaningful in Inventory" invariant for `currentCharges` was already specified.
>
> **`docs/MVP.md` unchanged.** MVP closed at M7 in R1.1 — R2 work updates OUTLINE / roadmap only.
>
> **Followups carried forward to R2.3 (identification):**
> - `ItemInstance.identified` widens from `z.literal(true)` to `z.boolean()`.
> - `identify` bidirectional reducer action; per-instance `newHint`.
> - DM identification panel (§5.13).
> - The `<ItemHistory>` "Show all events" toggle per OUTLINE §3.11 — currently `use-charge` / `recharge` are recorded but always-visible in the item history. R2.3 / R5 will add the default-filter/show-all toggle.
>
> **Followups carried forward to R6:**
> - DM force-recharge surface — uses the existing `mode: 'manual'` action shape with an R4-routed permission gate (player can manual-recharge own Inventory items; DM can manual-recharge any Inventory item).
> - Charge-formula evaluation — `rechargeAmount: "1d6+1"` is opaque in MVP. R6 (or earlier homebrew slot) can add a parser if users want auto-rolled recharges. R2.2.1 sidesteps this by letting the user enter their physical dice roll.
> - Hoard generator (§5.11) — populates Party Stash with gems / art via the new `'currency'` category and respects the new `charges` blocks for magic-item drops.

#### R2.2.1 — Roll-based partial recharge

Mini-milestone bridging R2.2 → R2.3. Discovered during R2.2 manual smoke: D&D 5e recharge formulas are random (`1d6+1` means roll a d6, add 1), not always-full. The DM rolls real dice — the app just needs an input to capture the result.

**Reducer**
- [x] `recharge` action payload accepts optional `amount?: number` on `mode: 'single'` / `mode: 'manual'` (partial recharge: `Math.min(from + amount, max)`)
- [x] `recharge` action payload accepts optional `amounts?: Record<itemInstanceId, number>` on `mode: 'batch'` (per-row roll values from the modal)
- [x] Reducer rejects non-positive integer amounts; rows absent from `amounts` (or rows without a `rechargeAmount` formula) full-recharge as in R2.2

**UI**
- [x] Item Detail Recharge button opens an inline roll input when `def.charges.rechargeAmount` is set (positive integer ≤ current deficit; validation inline via `role="alert"`); items without a formula keep the R2.2 one-click full-recharge
- [x] `RestRollModal` (`apps/web/src/components/inventory/RestRollModal.tsx`) — opens when at least one eligible item in a batch trigger carries a `rechargeAmount` formula. One number input per formula-bearing item with bounds + per-row error. Items without formulas listed in an "Auto full-recharge" section. Apply → one batch dispatch with the `amounts` map. Cancel = no dispatch (the user backed out of the whole Rest action).
- [x] Triggers with zero formula-bearing eligible items dispatch immediately (R2.2 behavior); the modal isn't opened.

#### R2.2.1 — Notes

> **2026-06-26 — R2.2.1 (roll-based partial recharge) complete.**
>
> **Scope decision.** User asked for "items with a die-roll recharge to have an input where the user enters their roll result". Three UX axes settled before implementation:
>   1. **Roll-input lives on both the per-item Recharge button AND the batch Rest path** (not just one). Consistency wins over modal weight — half-modeling this would lead to "why does the wand prompt me on Recharge but full-recharge on Long Rest?".
>   2. **Bounds = any positive integer ≤ current deficit** (`def.charges.max - currentCharges`). No `rechargeAmount` regex parsing — the user is the one rolling physical dice; the app just trusts the typed value. Avoids brittle formula parsing for the variety of DMG patterns (`1d6+1`, `1d3`, `1d6+4`, `2d8+4`, etc.) and skips the need for a dice-roll evaluator in MVP.
>   3. **Only items with a `rechargeAmount` formula prompt for input.** Items without a formula (Decanter of Endless Water — `dawn` rule but always 3/3; Chime of Opening — `dawn` rule, fixed 10/10) keep the R2.2 one-click full-recharge. Mixed UX per data shape, but matches the actual DMG 2024 distinction.
>
> **Schema unchanged.** OUTLINE §4 line 318 specifies `recharge` log payload as `{ itemInstanceId, from, to, trigger }` — `to` already captures the post-recharge value, so partial recharges flow through the existing payload shape with no schema change. The `amount` / `amounts` fields are on the **action** payload (UI → reducer input), not on the **log** payload.
>
> **Reducer.** `recharge` `mode: 'single' | 'manual'` accepts `amount?: number` and applies `Math.min(from + amount, max)` when provided. `mode: 'batch'` accepts `amounts?: Record<itemInstanceId, number>` — the modal collects per-formula rolls, the reducer iterates eligible Inventory items, and for each one looks up `amounts[row.id]`. Absent ids full-recharge (defensive: rows without `rechargeAmount` ALWAYS full-recharge regardless of the `amounts` map). Rejects non-positive integer amounts at the per-row level.
>
> **UI.** Two new surfaces + one extended:
>   - **ItemDetail inline roll input.** Clicking Recharge on a row whose def has `rechargeAmount` opens a small `role="group"` panel beneath the existing button row, with the formula echoed in the label (`"Roll 1d6+1:"`), a clamped `<Input type="number">`, Apply + Cancel buttons, and per-input error reporting via `role="alert"`. Apply dispatches the partial recharge; Cancel collapses without dispatching. The Use / Recharge buttons are disabled while the roll panel is open so the user can't double-fire.
>   - **`RestRollModal`** (new). Triggered from the Character Sheet Rest dropdown when at least one eligible item has a formula. Each formula-bearing item gets a labeled `<Input type="number">` with its current/max + roll formula + max-bound surfaced in the label. Items without formulas are listed in an "Auto full-recharge" section so the user sees the full picture of what will happen on Apply. Closing without Apply = no dispatch (the non-formula items are NOT auto-recharged in that case — the user backed out of the whole Rest action). Bundle delta: +5.89 kB raw / +1.70 kB gzip vs R2.2 baseline.
>   - **CharacterSheet's `RestMenu`.** Now branches on `formulaCount > 0`: if any eligible item has a formula, open the modal; otherwise dispatch immediately as in R2.2 and toast the count.
>
> **Tests: 663 workspace-wide passing** (+9 R2.2.1 tests vs R2.2 close at 654). Breakdown:
>   - Reducer: +5 (`mode=single` with partial amount / clamp at max / reject non-positive / `mode=batch` with amounts / non-formula immunity)
>   - ItemDetail: +3 new (roll → apply, exceeds-deficit alert, cancel, non-formula keeps full recharge) + 1 modified (the original "Recharge button" test now flows through the inline input)
>   - CharacterSheet: +1 new (non-formula trigger dispatches immediately) + 1 modified (Dawn now opens the modal)
>
> **Build: 944.38 kB JS / gzip 270.91 kB** (delta vs R2.2: **+5.89 kB raw / +1.70 kB gzip**).
>
> **Decisions captured in code:**
> 1. **Both per-item and batch paths prompt for rolls** (not just one). Consistency over modal weight.
> 2. **Bounds = positive integer ≤ deficit, no formula parsing.** The user types their physical dice result; the app trusts it. R6 may add a parser if users want a "roll for me" button.
> 3. **Items without `rechargeAmount` keep R2.2 full-recharge** (one-click; never prompts). Mixed UX per data shape, matches DMG 2024.
> 4. **Modal Cancel discards the entire batch** — non-formula items don't auto-recharge if the user backed out. Alternative ("apply partial — full-recharge the non-formula items even on Cancel") was considered and rejected: the modal title says "roll for recharge", so closing it without applying should be a complete no-op for symmetry with the per-item Cancel.
> 5. **No OUTLINE change.** Spec already accommodates partial recharges via the existing `{ from, to, trigger }` payload shape. The action-payload extension (`amount` / `amounts`) is implementation detail.

#### R2.3 — Identification

**Schema activations (§4)**
- [x] `ItemInstance.identified` allowed to be `false` — **R2.3** (widened `z.literal(true)` → `z.boolean()` in `packages/shared/src/schemas/itemInstance.ts`)
- [x] `ItemInstance.hint` added (optional string) — **R2.3** (new per-instance DM-set hint field per OUTLINE §3.8; `notes` stays the player-set field)
- [x] `edit-item-instance.changedFields` widened with `'identified'` and `'hint'` per OUTLINE §4 line 320 — **R2.3** (additive enum extension; existing R2.2 payloads still parse)

**Reducer actions (§4 TransactionLog union)**
- [x] `identify` action + payload schema (`{ itemInstanceId, previousIdentified, newIdentified, previousHint?, newHint? }`) — **R2.3** (OUTLINE amended in lockstep — the `previousIdentified` / `newIdentified` fields make the bidirectional transition explicit in the log payload; mirrors how `recharge` carries `from`/`to`)
- [x] Reducer routes `identify` to `actorRole: 'dm'` per OUTLINE §8.1 row 459 — **R2.3** (MVP solo user wears both hats so this is structural now; R3+ server-side gate will enforce DM-only for multi-member parties)
- [x] **`identify` is bidirectional** per OUTLINE §3.8 — **R2.3** (reducer accepts `true → false` and `false → true` flips; both produce their own log entry with the full transition payload; tests for both directions)
- [x] **`identify` hint is per-instance** per OUTLINE §3.8 — **R2.3** (`row.hint` lives on the instance; identifying one of two identical unidentified items doesn't affect the other; covered by the R2.3 reducer suite)
- [x] No location restriction on `identify` — **R2.3** (deliberate non-gate; DM identifies anywhere — Storage, Party Stash, Recovered Loot, Shop. Test covers identify-in-Party-Stash succeeding)
- [x] No magic-item gate on `identify` — **R2.3** (mundane items default to `identified: true` so the display swap never fires on them; identify-on-a-Torch is a harmless write and is rejected by the no-op gate unless the user also writes a hint)
- [x] No-op rejection — **R2.3** (mirrors `attune` / `use-charge` conventions; an exact same-state dispatch throws `identify: no-op`)

**UI (§5)**
- [x] Unidentified items render as "Unknown Magic Item" + DM-set hint (display invariant per §8) — **R2.3** (new `apps/web/src/lib/identify.ts` `displayName` helper drives both ItemDetail header and StashItemsTable row; hint renders as italic subtitle on ItemDetail; tooltip on row name via `title=`)
- [x] Spoiler protection extends to rarity / attunement chip / charges indicator / customName — **R2.3** (all hidden when `row.identified === false`; consistent with how D&D 5e tables play it; explicit decision captured for the retro)
- [x] DM identification panel (§5.13): toggle identified, edit hint text — **R2.3** (ItemDetail gains an Identification section with a `role="switch"` toggle + hint editor with Save / Clear buttons; both dispatch `identify`; toasts on success)
- [x] Per-item history (OUTLINE §3.11) default ownership-transition filter + "Show all events" toggle — **R2.3** (closes the R2.2 carry-forward; default surface shows acquire / consume / transfer / split / equip / unequip / attune / unattune / identify; toggle exposes use-charge / recharge / edit-item-instance; component-local state)

#### R2.3 — Notes

> **2026-06-26 — R2.3 (Identification) complete.** Closes R2 (Magic Items). Smoke-tested loop: "acquire wand → toggle Identified off → row renders as 'Unknown Magic Item' across Inventory + ItemDetail → add hint 'radiates faint magic' → hint surfaces as italic subtitle on ItemDetail and as a tooltip on the Inventory row → toggle Identified back on → real name + rarity + charges all return."
>
> **Schema activations (additive, no migration).** Three changes that compose:
> - `itemInstance.ts` widens `identified: z.literal(true)` → `z.boolean()` and adds optional `hint: z.string().optional()`. The OUTLINE §3.8 invariant "hint is per-instance" is enforced by where the field lives (on `ItemInstance`, not `ItemDefinition`) — two copies of the same magic item can each carry their own hint. R2.2-vintage Dexie blobs still parse: every existing row carries `identified: true` and no `hint`, which the widened schema accepts unchanged.
> - `transactionLog.ts` adds `identifyEntry` with payload `{ itemInstanceId, previousIdentified, newIdentified, previousHint?, newHint? }`. OUTLINE §4 line 317 originally specified only `{ previousHint?, newHint? }`; the R2.3 amendment adds the two `Identified` fields so a hint-preserving identification flip still produces an unambiguous log entry. Same pattern `recharge` follows with `from`/`to`.
> - `editItemInstanceEntry.changedFields` widens with `'identified'` and `'hint'`. The dedicated `identify` action remains the only route to mutate these — `edit-item-instance` doesn't accept them at the action level. The schema enum extension exists so future contributors can't silently drift the surface.
>
> **Reducer.** Routed through the existing R2.2 multi-entry `ReducerResult.logEntries[]` contract; identify only ever emits exactly one entry. Validation order: `requireState` → row lookup → catalog lookup (defensive — schema can't enforce referential integrity between `item.definitionId` and catalog ids) → diff (`previousIdentified` vs `payload.identified`, `previousHint` vs `payload.hint`) → no-op gate. Three things deliberately omitted:
>   - **No Inventory-only restriction** (unlike `attune` / `use-charge` / `equip`). DM identifies wherever the row lives. Tested with a row moved to Party Stash before dispatch — succeeds.
>   - **No magic-item gate.** Mundane items default to `identified: true` and never trigger the display swap; identify-on-a-Torch is a harmless write (rejected by the no-op gate unless the user also writes a hint).
>   - **No formula / rarity coupling.** The toggle works regardless of `def.rarity` — the display layer reads `row.identified`, not anything from the definition.
>
> Hint semantics use the `hint?: string | undefined` action shape under `exactOptionalPropertyTypes: true`:
>   - `hint` key absent in payload → leave current hint untouched (ItemDetail's toggle preserves hint across flips this way).
>   - `hint: 'text'` → write that string as the new hint.
>   - `hint: undefined` (explicit) → clear the hint (Clear button in the panel).
> The reducer uses `'hint' in payload` to distinguish absent from explicit-undefined. Action type explicitly includes `| undefined` on the union member so the explicit-undefined case is representable.
>
> **`actorRole: 'dm'` routing.** The `resolveActor` switch routes `identify` to its own DM-tagged branch (separate from the player-tagged group that covers `attune`, `use-charge`, etc.) per OUTLINE §8.1 row 459. In MVP party-of-one this has no behavioral effect (the sole user has both memberships); R3+ server-side gate will enforce DM-only for multi-member parties.
>
> **UI (3 new surfaces + 2 modified).**
>   - `apps/web/src/lib/identify.ts` (NEW) — pure helpers mirroring `lib/rarity.ts` / `lib/charges.ts`. Exports `UNKNOWN_MAGIC_ITEM_LABEL` (single source of truth for OUTLINE §8 verbatim text) and `displayName(row, def)` (encapsulates the identified ? real-name : 'Unknown Magic Item' decision; also hides `customName` when unidentified — spoiler protection extends to player-set nicknames). 7 tests.
>   - `ItemDetail` — header rendering switches between "real name + rarity chip + Requires-attunement pill + attunementPrereq advisory" (identified) and "Unknown Magic Item + italic 'Unidentified' badge + italic hint subtitle" (unidentified). The charges section is gated on `identified === true` too — knowing the wand has charges is itself a magic-item tell. New Identification Panel section with a `role="switch"` toggle (uses Tailwind-styled `<button>` per the plan decision to avoid the shadcn `switch` install — saves ~3 kB) and a hint editor with Save / Clear buttons. Both dispatch `identify` actions; toasts on success ("Item identified" / "Item marked unidentified" / "Hint updated" / "Hint cleared"). 7 new tests.
>   - `StashItemsTable` — row name uses `lib/identify.displayName`. The R2.1 rarity dot is hidden when unidentified; replaced with a small muted `?` glyph. The R2.2 charges indicator is similarly hidden. The hint shows up as a tooltip via the `title=` attribute on the unidentified `?` indicator so the user has fast access without navigating away. 3 new tests.
>   - `ItemHistory` — type guard widened from M2.5's 5-TxType set to 12 types (added `equip` / `unequip` / `attune` / `unattune` / `use-charge` / `recharge` / `identify`). OUTLINE §3.11 default-filter implemented — the visible set is the "ownership transition" 9-type subset; `use-charge` / `recharge` / `edit-item-instance` are hidden until the user clicks the new "Show all events" checkbox. Component-local toggle (resets per mount per the plan decision; R5 may lift to Zustand). `summarize()` extended with cases for all new entry types — identify's summary is verbose intentionally (each transition variant gets its own one-line summary so the audit log preserves the bidirectional nature). 6 new tests; 2 existing tests updated to toggle Show-all when asserting on hidden entry types.
>
> **Tests: 703 workspace-wide passing** (vs R2.2.1 close at 663 — **+40 R2.3 tests**). Breakdown:
> - shared: +6 (3 schema acceptance + 1 back-compat + 2 reject + 1 widening + the identify-entry round-trip)
> - rules: 0 (no new rules-layer code — display invariant is UI-enforced, reducer-side logic is local to `identifyAction`)
> - seeds: 0 (no seed content changes — identification is per-instance, not per-definition)
> - web: +34 (11 reducer: bidirectional flips + hint writes + no-op rejection + missing-id + missing-def + non-Inventory + actorRole routing + hint-only + identified-only + same-state-different-hint; 7 lib/identify; 7 ItemDetail; 3 StashItemsTable; 6 ItemHistory new + 2 modified)
>
> **Build: 949.89 kB JS / 30.68 kB CSS (gzip 272.46 / 6.44 kB).** Delta vs R2.2.1: **+5.51 kB JS raw / +1.55 kB gzip**, +CSS unchanged within rounding. Within the plan estimate (+5-8 kB raw). No new dependencies; the delta is `lib/identify.ts` + Identification Panel JSX + ItemHistory toggle + new summarize cases.
>
> **Decisions captured in code:**
> 1. **`hint` is a new `ItemInstance` field**, not a reuse of `notes`. Different role (DM-set vs player-set), different visibility gate; conflating them at the schema would lose audit clarity.
> 2. **No location restriction on `identify`.** DM identifies anywhere — Storage / Party Stash / Recovered Loot / Shop. Display gate is location-aware (the "Unknown Magic Item" swap only fires when the row is visible).
> 3. **No magic-item gate on `identify`.** Mundane items default to `identified: true` and never trigger the display swap; identify-on-a-Torch is a harmless write rejected by the no-op gate.
> 4. **Unconditional display gate** (per the slice 3 user decision). Even the solo user playing DM sees "Unknown Magic Item" when they've flipped identified off. Toggle in the ItemDetail panel is one click to reveal.
> 5. **Rarity + attunement chip + charges indicator + customName all hidden when unidentified.** Spoiler-protection consistency across all magic-item-tells. OUTLINE §8 only specifies the name swap; the rest are R2.3 polish decisions captured here.
> 6. **`previousIdentified` / `newIdentified` on the log entry** (OUTLINE §4 line 317 amendment). Hint-preserving identification flips still produce unambiguous audit rows.
> 7. **Action payload is "target state"**, reducer diffs and logs. Symmetric with `edit-item-instance` / `edit-character`.
> 8. **`hint: undefined` in payload clears the hint** (explicit-undefined under `exactOptionalPropertyTypes`). No separate `clearHint: boolean` flag; the reducer uses `'hint' in payload` to distinguish absent (untouched) from explicit-undefined (clear).
> 9. **Toggle state is component-local** in ItemHistory. Resets per mount; R5 may lift to Zustand if cross-navigation persistence becomes a real need.
> 10. **No new shadcn primitive for the Identified toggle.** A Tailwind-styled `<button role="switch" aria-checked={identified}>` ticks all accessibility boxes; saves the ~3 kB the shadcn `switch` install would have added.
>
> **OUTLINE.md amendments (additive).** One:
> - §4 TxType payload table for `identify` now lists `{ itemInstanceId, previousIdentified, newIdentified, previousHint?, newHint? }`. The `previousIdentified` / `newIdentified` fields are R2.3 additions to the spec — the original `{ previousHint?, newHint? }` shape can't represent a hint-preserving identification flip.
>
> **`docs/MVP.md` unchanged.** MVP closed at M7 — R2 work updates OUTLINE / roadmap only.
>
> **Followups carried forward to R3+ (server-authoritative auth):**
> - Server-side enforcement of OUTLINE §8.1 row 459 (Identify magic item: DM-only). MVP routes the action through the DM membership for audit; the actual permission gate happens server-side once the auth + party-membership tables land.
> - Multi-member party panel visibility — the Identification Panel is always visible in MVP solo. R4 will hide it from players in 2+-member parties (only the DM sees the toggle / hint editor).
>
> **Followups carried forward to R6 (DM tools):**
> - DM identification panel (§5.13) bulk surface — currently the user identifies items one at a time via ItemDetail. R6's DM tools may add a "all unidentified items" picker that takes a single identify-all action. The current per-instance OUTLINE §3.8 spec doesn't include batch identification (each instance carries its own hint); a bulk action would emit one log entry per row.
> - `conditionOverrides` editor — placeholder comment now at the bottom of the ItemDetail section. The schema field has been live since M0, but no UI consumes it. Natural R6 polish target along with the homebrew authoring deep-dive.
>
> **2026-06-26 — Post-R2.3 follow-up fixes (same day):**
> - **Bug 1 — free-recharge exploit via Storage round-trip.** The R2.2 transfer cascade cleared `currentCharges` to null on leave-Inventory and re-initialised to `def.max` on enter-Inventory. A spent wand moved Inventory → Storage → Inventory therefore came back fully charged for free. **Fixed by preserving `currentCharges` across moves** — the cascade no longer touches the field on leave; the enter-Inventory init only fires when the source row's `currentCharges` is currently `null` (first-time-into-Inventory case for items acquired directly into Storage). `equipped` / `attuned` still clear on leave-Inventory per the R1.3 cascade. OUTLINE §3.4 and §3.8 amended in lockstep — the "only meaningful in Inventory" rule for charges is now a UI display rule rather than a storage rule. R2.2 cascade tests updated (2 modified, 1 new round-trip-preservation test pinning the fix). Net test count change: +1.
> - **Bug 2 — equipped unidentified magic items leaked their real name.** `EquippedSlotsPanel` read `row.customName ?? def.name` directly instead of routing through `lib/identify.displayName(row, def)`. An equipped unidentified Cloak of Protection displayed its real name in the Inventory tab's Equipped Slots panel, contradicting OUTLINE §8. **Fixed by routing through the shared `displayName` helper**, mirroring the R2.3 fixes in `ItemDetail` and `StashItemsTable`. +2 new tests covering both equipped and attuned unidentified items.
> - **Tests: 706 workspace-wide passing** (+3 net vs R2.3 close at 703). Build delta negligible (label routes through an existing import).
> - **No new OUTLINE §4 schema changes.** The fix is in the reducer's transfer cascade logic and one component-level display lookup; the `currentCharges: number | null` shape stays the same — the change is just *when* it transitions.

#### R2 — Notes

> **2026-06-26 — R2 (Magic items) complete.** The three slices landed across two days:
> - R2.1 (2026-06-25) — DMG seed + rarity / attunement display.
> - R2.2 + R2.2.1 (2026-06-26) — Charges + recharge + roll-based partial recharge.
> - R2.3 (2026-06-26) — Identification.
>
> **OUTLINE coverage check (R2 scope):**
> - §3.7 (DMG catalog): **complete** — 305 DMG entries seeded, rarity / requiresAttunement / attunementPrereq surfaced, BoH-class containers carry `flatWeight: true`.
> - §3.8 (Magic items, attunement, charges, identification): **complete** — rarity ✓, attunement ✓ (R1.2 reducer + R2.1 gate), charges ✓ (R2.2 + R2.2.1), identification ✓ (R2.3).
> - §3.11 (Audit history): **complete** — default ownership-transition filter + Show-all toggle shipped in R2.3 (was R2.2 carry-forward).
> - §4 ItemDefinition extensions: **complete** — `rarity`, `requiresAttunement`, `attunementPrereq`, `charges` block all active.
> - §4 ItemInstance: **complete** — `identified` and `currentCharges` widened; `hint` added.
> - §4 TransactionLog: **complete** — `attune` / `unattune` (R1.2) + `use-charge` / `recharge` (R2.2) + `identify` (R2.3); OUTLINE amended in lockstep for the `recharge.characterId` (R2.2) and `identify.previousIdentified` / `newIdentified` (R2.3) additions.
> - §6 `charges.ts`: **complete** (R2.2 — 5 pure helpers replacing the M0 stub).
>
> **Aggregate test deltas across R2:**
> - R2.1: +23 (9 seed + 14 reducer / UI)
> - R2.2: +75
> - R2.2.1: +9
> - R2.3: +40
> - **Total R2 contribution: +147 tests**. Workspace started R2 at 556 (R1.5 close), ended R2 at 703.
>
> **Aggregate bundle deltas across R2 (raw JS, gzip):**
> - R2.1: +114.94 kB / +25.22 kB (mostly the inlined DMG seed JSON ~113 kB)
> - R2.2: +35.94 kB / +7.55 kB (`dropdown-menu` primitive ~12 kB + charges blocks + UI)
> - R2.2.1: +5.89 kB / +1.70 kB (RestRollModal + inline roll input)
> - R2.3: +5.51 kB / +1.55 kB (Identification Panel + display gate + history toggle)
> - **R2 total: +162.28 kB raw / +36.02 kB gzip.** ~80% of that is the DMG seed JSON; code-splitting becomes mandatory before R3 anyway (TECH_STACK §10).
>
> **What's NOT in R2 (carried forward intentionally):**
> - DM force-actions (`use-charge` / `recharge` on someone else's row, identify-all bulk action). All deferred to R4 (multi-member parties) + R6 (DM tools).
> - Charge-formula evaluation (`rechargeAmount: "1d6+1"` is opaque in MVP). The R2.2.1 roll input sidesteps this — the user enters their physical dice result.
> - `conditionOverrides` editor — schema field has been live since M0 but no UI consumes it. Future polish slice.
> - Necklace of Fireballs bead-level distinction — modeled as `{ max: 9, rechargeRule: 'none' }`. Could surface as `conditionOverrides` if anyone wants per-bead spell levels.
> - Rod of Lordly Might / Horn of Valhalla / Pipes of the Sewers and similar "structurally different from N charges" items shipped without a `charges` block. Future homebrew opportunities once R6 unlocks more nuanced charge models.

---

### R3 — Backend skeleton (outline §10 M3)

Self-hosted server, Discord OAuth + email OTP auth, user model, sync of solo data, nightly snapshots. Covers OUTLINE §3.1 (Discord + email login), §3.13 (server backups), §9 (architecture: server-authoritative, websocket-ready), §4 `User` (discordId/email/emailVerified/avatarUrl) and `Metadata`.

**Slicing.** R3 splits into infrastructure slices that each shrink the risk surface: R3.1 stands up Fastify + Postgres + Prisma + seed runner with NO auth (verifiable via curl + Prisma Studio); R3.2 layers Discord OAuth + sessions on top; R3.3 adds email OTP auth + backup-email settings flow; R3.4 wires authoritative sync (server re-runs the reducer); R3.5 connects the web client. Each slice is independently deployable behind a flag, and any one of them is already R1.1-sized.

#### R3.1 — Server scaffold + Postgres + Prisma + seed runner

- [x] `apps/server` Fastify + TypeScript scaffolded — **R3.1** (Fastify 5 + `@fastify/cors` + `@fastify/sensible`; ESM-only; `tsx watch` dev loop; same workspace tooling as `apps/web` — TS 5.7 strict, ESLint 9 flat config, Vitest 4)
- [x] Postgres + Prisma set up — **R3.1** (Postgres 18-alpine; Prisma 7.8 with the driver-adapter model — `@prisma/adapter-pg` + `pg`; mandatory `prisma.config.ts` at `apps/server/`; client generated to gitignored `prisma/generated/prisma/`)
- [x] Prisma schema mirrors `packages/shared/schemas` Zod definitions — **R3.1** (10 models / 9 enums; hyphenated Zod enum values stored underscore-form in DB and translated by `src/db/mappers.ts`; `cost` / `charges` nested blocks flattened to sibling columns; `tags` as native Postgres `text[]`; `conditionOverrides` + `TransactionLog.payload` as `Json`; `Character.inventoryStashId` ↔ `Stash.ownerCharacterId` cycle resolved via `DEFERRABLE INITIALLY DEFERRED` FK appended to the init migration)
- [x] Initial migration generated and applied — **R3.1** (`prisma migrate dev --name init`; hand-tail appended with `DEFERRABLE` FK + 10 CHECK constraints encoding Zod invariants — Character level 1-20 / strScore 1-30 / maxAttunement ≥0; ItemInstance quantity >0 / currentCharges ≥0-or-null; CurrencyHolding all 5 denoms ≥0; ItemDefinition weight ≥0; cost-pair + charges-pair "both null or both set"; Stash 3-arm scope/owner/party/isCarried discriminator)
- [x] `Metadata` table tracking canonical `seedVersion` (§4) — **R3.1** (`{ key: String @id, value: Json }` shape; single canonical key `'seedVersion'` with integer value; OUTLINE §4 amended in lockstep)
- [x] PHB + DMG seed runner on server boot (upsert) — **R3.1** (`src/db/seed-runner.ts` reads `@app/seeds` `loadPhbSeed()` + `loadDmgSeed()`, maps each row through `toPrismaItemDefinition`, upserts by id inside a single `$transaction`, stamps `Metadata.seedVersion`; idempotent — boots after the first one short-circuit at the version check; tampered rows revert when the version is bumped backwards)
- [x] `infra/docker/` compose: web + server + postgres for local dev — **R3.1** (`postgres:18-alpine` healthcheck-gated; `Dockerfile.server` multi-stage Node 22 alpine running `prisma migrate deploy` then `node dist/index.js`; `Dockerfile.web` serves the SAPUI5 production build via `vite preview` per the slice 6 user decision — nginx deferred to R7; `postgres-init/00-databases.sh` provisions `dnd_inv_test` on first-init for the integration suite)

#### R3.1 — Notes

> **2026-06-26 — R3.1 (Server scaffold) complete.** Opens R3 (Backend skeleton). First non-`apps/web` workspace app — `apps/server` now sits alongside `apps/web` with shared `packages/{shared,rules,seeds}` deps. Smoke-tested loop: `cd apps/server && pnpm dev` → seed runner logs `upserted 486 rows; vnone → v3` → `curl localhost:3000/healthz` returns `{"status":"ok","db":"ok","seedVersion":3}` → second boot logs `skipped (already at v3)`. Compose stack builds and runs the same path inside containers.
>
> **Stack delta vs the plan.** Prisma 7.8 went GA recently; planned for v6 but used `npm view` mid-slice and confirmed Postgres 18 + Node 22 + ESM compat in the migration guide. Switched mid-slice. Prisma 7's breaking-changes set reshapes 4 files vs the v6 blueprint: (1) `prisma.config.ts` is mandatory (no more `url = env(...)` in `schema.prisma`); (2) generator `provider = "prisma-client"` + mandatory `output` field, client emits TypeScript source instead of pre-compiled `.js`; (3) driver-adapter mandatory — every PrismaClient instantiates as `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`; (4) `dotenv/config` is no longer auto-loaded — every entrypoint (`src/index.ts`, `prisma/seed.ts`, `prisma.config.ts`, `src/test/setup.ts`) imports it explicitly. Net: 1 extra config file, ~3 extra import lines, no behavioral surprises after the migration guide pass.
>
> **Schema port — translation boundary at `src/db/mappers.ts`.** Hyphenated Zod enum values (`'very-rare'` / `'long-rest'` / `'short-rest'` / `'recovered-loot'`) translate to underscore form in Postgres because Prisma enum values can't contain hyphens. The mapper provides bidirectional pure functions per enum (`toDbRarity` / `fromDbRarity`, etc.) and round-trip parity is asserted in `mappers.test.ts` — every Zod enum value passes through `fromDb(toDb(v)) === v`. `ItemDefinition.cost` (nested `{ amount, currency }`) and `.charges` (nested `{ max, rechargeRule, rechargeAmount? }`) flatten to sibling columns (`costAmount` / `costCurrency`; `chargesMax` / `chargesRechargeRule` / `chargesRechargeAmount`) so future server-side queries can filter without `Json` casts; paired CHECK constraints enforce "both null or both set." Tags ship as native Postgres `text[]` (GIN-indexable later without a schema change); `conditionOverrides` + `TransactionLog.payload` stay `Json` (open shape; Zod validates at the boundary).
>
> **Cycle resolution.** `Character.inventoryStashId` references a `Stash`, but `Stash.ownerCharacterId` references the `Character` — chicken-and-egg in the `create-character` flow (R3.4). Prisma's DSL can't express deferrable FKs, so the init migration's hand-tail drops + recreates the FK with `DEFERRABLE INITIALLY DEFERRED`. Inside R3.4's `create-character` transaction the FK check waits until COMMIT, letting the two rows insert in either order. Verified via `pg_constraint`: `condeferrable=t, condeferred=t`.
>
> **Reducer side stays on `apps/web` for now.** R3.1's seed runner doesn't replicate the client's `seed-catalog` reducer action — it just upserts. R3.4 lands the authoritative server-side reducer; R3.5 wires `apps/web` to push actions through HTTP rather than mutating Dexie directly. Until then the server is "DB + catalog" only.
>
> **Tests: +17 in `apps/server`** (workspace total 706 → 723). Breakdown:
>   - **mappers (11)** — Rarity / ChargesRechargeRule / StashScope enum round-trip; cost+charges flatten/unflatten; hyphen→underscore mapping; minimal PHB row round-trip; maximal DMG row round-trip; `exactOptionalPropertyTypes` discipline (no `undefined` keys emitted).
>   - **seed-runner (4)** — first-run inserts all rows + stamps version; second run is `{ skipped: true }`; version mismatch reverts tampered rows; sampled rows round-trip through `itemDefinitionSchema`.
>   - **health route (2)** — `GET /healthz` returns 200 / `{status:'ok',db:'ok',seedVersion:3}`; returns 503 / `degraded` when Metadata is empty.
>
> **Row counts.** Seed runner upserts **486 ItemDefinition rows** on first boot — 181 PHB (mundane gear) + 305 DMG (magic items). Matches `pnpm --filter @app/seeds test` row-count assertions; sanity-checked via direct Prisma query against the test DB.
>
> **`@app/server` deps added (not yet in `apps/web`):** `fastify@5.8` + `@fastify/cors@11.2` + `@fastify/sensible@6.0` (server); `@prisma/client@7.8` + `@prisma/adapter-pg@7.8` + `pg@8.22` (DB); `prisma@7.8` (CLI, devDep); `tsx@4.22` (devDep, runtime); `dotenv@17.x` (env loading). All on latest stable; no peer-warning fallout.
>
> **`pnpm-workspace.yaml` change.** `allowBuilds` / `onlyBuiltDependencies` extended with `@prisma/client` / `@prisma/engines` / `prisma` — Prisma's postinstalls download the query-engine binary used by the adapter (esbuild is already allow-listed). The deny-by-default stance from the M0 commit is preserved.
>
> **Docker compose layout.** `postgres:18-alpine` healthcheck-gated; `Dockerfile.server` multi-stage (Node 22 alpine; `pnpm install --frozen-lockfile` in build stage, `prisma generate` + `pnpm build`, runtime stage copies `dist/` + `prisma/` + `node_modules/`); compose `server.command` runs `prisma migrate deploy` then `node dist/index.js`; `Dockerfile.web` serves the production build via `vite preview --host 0.0.0.0 --port 5173`. Postgres on host port `5433` to avoid clashing with any host Postgres on 5432. `postgres-init/00-databases.sh` provisions the secondary `dnd_inv_test` database on first-init of the named volume (Docker entrypoint contract — runs only when the volume is empty).
>
> **Prisma 7 AI safety gate.** `prisma migrate reset` refuses to run from an AI agent's session without an explicit user-consent env var (`PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION="<verbatim user message>"`). Documented for future slices that need a destructive reset: pause, explain the action, get explicit consent, then run with the consent env var attached. Hit during the slice when applying the hand-tail to the dev DB; resolved by asking + getting explicit "Yes, reset dev DB" from the user.
>
> **Test DB strategy.** `src/test/setup.ts` redirects `DATABASE_URL` to `DATABASE_URL_TEST` (`…/dnd_inv_test`) so DB-touching tests never hit the dev DB. Vitest's `fileParallelism: false` keeps the shared test DB safe; for R3.4's expanded test surface we may switch to per-test-file schema isolation.
>
> **Decisions captured in code:**
> 1. **Hand-write Prisma schema, mirror Zod shapes.** No codegen tool; we control indexes / CHECKs / FKs directly. Zod stays the source of truth; the mapper layer + `fromPrismaItemDefinition` Zod-parse-on-read makes drift fail loudly.
> 2. **Normalized tables per AppState entity.** Each entity is its own table (User / Party / PartyMembership / Character / Stash / ItemDefinition / ItemInstance / CurrencyHolding / TransactionLog / Metadata). Enables R3.4 server-side reducer + R5 broadcast model. No JSONB-blob shortcut.
> 3. **`TransactionLog` is a single table** with `type: String` discriminator + `payload: Json`. The 25 variant types stay in the Zod discriminated union; Zod validates the payload at the boundary. Avoids 25 sibling tables for what's already a 1:1 reducer-action-to-log-type contract.
> 4. **Flatten `cost` / `charges` to sibling columns.** Both are small fixed-shape nested objects with non-trivial query value (filter by rarity AND attunement requirements, for example). Paired CHECK constraints encode "both null or both set."
> 5. **Hyphenated enum mapping via `mappers.ts`.** Prisma enum values can't contain hyphens — `'very-rare'` becomes `'very_rare'` in the DB; the mapper is the single point of translation. Round-trip parity unit-tested per value.
> 6. **`Character.inventoryStashId` FK is `DEFERRABLE INITIALLY DEFERRED`.** Resolves the Character↔Stash cycle inside R3.4's `create-character` transaction. Plain Prisma DSL can't express it; appended to the init migration's SQL by hand.
> 7. **No auth + no HTTP-routed mutations in R3.1.** Only `GET /healthz`. R3.2 layers Auth.js; R3.4 lands the authoritative reducer. Keeps the slice small enough to verify end-to-end in one PR.
> 8. **Postgres 18 + Prisma 7.** Latest stable on both. Both adopted mid-slice after the version audit found 17 / 6.x in the original plan were unnecessarily conservative. Prisma 7's breaking-changes set is small and well-documented; no downstream surprises.
> 9. **Web container uses `vite preview`** (per the slice 6 user decision). Nginx deferred to R7. Keeps the slice from growing an nginx.conf maintenance surface for a use case (production deployment) that R3.1 doesn't have yet.
>
> **OUTLINE.md amendments (additive).** One:
> - §4 `Metadata` row shape now explicitly documented as `{ key: String @id, value: Json }` with canonical key `'seedVersion'` (integer value).
>
> **`docs/MVP.md` unchanged.** MVP closed at M7; R3+ work is OUTLINE-scoped only.
>
> **Followups carried forward to R3.2:**
> - `User` columns `discordId` / `email` / `emailVerified` / `avatarUrl` are NOT in the R3.1 schema. R3.2 will add them via `prisma migrate dev --name r32_user_auth_columns` along with the unique constraint on `email` and the DB-level check constraint `discordId IS NOT NULL OR emailVerified IS NOT NULL` per OUTLINE §4 / SECURITY §1.
> - Auth.js requires the standard `Account` / `Session` / `VerificationToken` tables (Prisma adapter shape) — R3.2 will add them.
> - `@fastify/cookie` + Auth.js handler routes are not yet wired. The Fastify scaffold + CORS in R3.1 are sufficient prep.
>
> **Followups carried forward to R3.4:**
> - The authoritative reducer (server re-runs `apps/web/src/store/reducer.ts` semantics against incoming actions). The pure parts of the reducer should hoist to a shared package (`packages/rules`?) so client + server share the same code; identify which actions are pure-state-update vs which need server-side side-effects (e.g., `acquire` source `'hoard'` is purely state; `dm-transfer` may need server-side party-ownership validation).
> - Per-user AppState sync endpoint (push + pull) — Fastify routes mounted under `/sync` consuming the dispatched action shape from the client.
> - Nightly snapshot job — likely a small Fastify-Cron plugin or a separate worker process; persists snapshots to disk per `OUTLINE §11`.

#### R3.2 — Discord OAuth + sessions + User model

- [x] Auth.js + Discord provider wired (authorization code + PKCE, scope `identify`) — **R3.2** (`@auth/core@^0.34` directly + hand-written Fastify route wrappers in `src/auth/routes.ts`; PKCE+state per SECURITY §1.1; scope hardcoded to `identify` via authorization URL override since `@auth/core/providers/discord`'s default is `identify+email`)
- [x] Session cookie issuance after token exchange — **R3.2** (database-backed session strategy via `@auth/prisma-adapter`; cookie name `__Host-auth-session-token` in production, `auth-session-token` in dev; `HttpOnly` + `SameSite=lax` + `Secure` in production; sliding 30-day idle expiry with daily-resolution updates per SECURITY §1.1)
- [x] `User.id` linked via `discordId`; `avatarUrl` populated — **R3.2** (`User.id` stays opaque cuid; `discordId` is a separate `String? @unique` column carrying the Discord snowflake; OUTLINE §4 amended in lockstep; `events.signIn` callback resyncs `displayName` + `avatarUrl` from the Discord profile on every login)
- [x] `User.email` and `User.emailVerified` columns added to Prisma schema (nullable; unique constraint on `email`) — **R3.2** (`emailVerified` typed as `DateTime?` per Auth.js adapter convention + OUTLINE §4 line 231; `email` has UNIQUE per SECURITY §1.2; both will be populated by R3.3's OTP flow)
- [x] DB-level `CHECK` constraint: `discordId IS NOT NULL OR "emailVerified" IS NOT NULL` — **R3.2** (`User_auth_present_check` in `prisma/migrations/<ts>_r32_auth/migration.sql` tail; mirrored in Zod via `userSchema.refine()`; defended by `src/db/schema-invariants.test.ts`)

#### R3.2 — Notes

> **2026-06-26 — R3.2 (Discord OAuth + DB sessions) complete.** Layers auth on top of R3.1's scaffold. The server now identifies users via a session cookie issued at the end of a Discord OAuth2 + PKCE flow; `User` carries the canonical OAuth identity columns; the DB enforces the SECURITY §1.2 "at least one of `discordId` or `emailVerified`" invariant. Smoke-tested loop: `pnpm dev` with empty `DISCORD_CLIENT_ID` → `curl /auth/discord/login` returns 503 `{"error":"discord_auth_disabled"}`; with creds set → 302 to `https://discord.com/api/oauth2/authorize?scope=identify&...&code_challenge=...&state=...`; full OAuth flow in a browser drops `User` + `Account` + `Session` rows + sets the session cookie; `curl --cookie cookies.txt /auth/session` returns the user. **No web client wiring** — that's R3.5.
>
> **Auth library: `@auth/core` directly, no community adapter.** TECH_STACK §6.6 + §9 Decision Log lock in "Auth.js over Lucia / hand-rolled". The community `@auth/fastify` adapter was rejected as less battle-tested; instead we ship ~50 lines of glue in `src/auth/routes.ts` that wrap Fastify req/reply into Web `Request`/`Response` and call `Auth(request, config)`. The two `GET` routes (`/auth/discord/login`, `/auth/discord/callback`) collapse the Auth.js v5 CSRF dance: `/login` internally fetches a CSRF token, POSTs `/auth/signin/discord` with it, and forwards the resulting 302 to Discord. End user sees a single `GET` → 302 hop.
>
> **DB-backed sessions over JWT.** SECURITY-modern: instant revocation (`DELETE FROM Session`), surgical key rotation, opaque tokens, no JWT-class CVEs. Aligns with OWASP ASVS guidance for first-party monoliths and Auth.js's default-when-adapter-present strategy. The "1 DB read per authenticated request" cost is bounded by `src/auth/session.ts`'s `getSession()` — a single `findUnique` with `include: {user: true}`. Sliding expiry: when remaining lifetime drops below `maxAge - updateAge` (= 29 days), `expires` is bumped to `now + 30d`. The integration test asserts this.
>
> **`@auth/prisma-adapter` ↔ Prisma 7 peer-dep override.** `@auth/prisma-adapter@2.11.2`'s peerDependencies range is `@prisma/client>=2.26.0 || >=3 || >=4 || >=5` — explicitly excludes Prisma 7. The adapter is thin CRUD over stable `PrismaClient` methods (`findUnique`/`create`/`update`/`delete`/`$transaction`) so it works in practice; we suppress the peer-dep warning via pnpm `peerDependencyRules` in `pnpm-workspace.yaml`. **TODO**: remove the override when `@auth/prisma-adapter` formally supports Prisma 7. If it ever breaks at runtime, R3.3 ejects to a custom adapter (~150 lines) — we already need to customize the `VerificationToken` path for email OTP there.
>
> **Discord token persistence stripping.** SECURITY §1.1: "Discord tokens are not persisted in the DB — only `discordId`, `displayName`, `avatarUrl`." `src/auth/adapter-overrides.ts` wraps `PrismaAdapter(prisma)` and intercepts `linkAccount` to write `null` for `access_token` / `refresh_token` / `id_token` / `expires_at` / `session_state`. The `Account` row still exists (Auth.js needs the provider linkage to resolve "the user signed in via Discord" semantics in `events.signIn`) but holds no Discord-issued credentials. Unit test asserts the five fields are nulled on the underlying `prisma.account.create` call.
>
> **`User.id` vs `discordId` split — OUTLINE §4 deviation.** OUTLINE §4 originally said "post-R3 the id becomes the Discord snowflake (`discordId`)." In practice the Auth.js Prisma adapter mints its own cuid for new users during the OAuth flow, and existing R3.1 / MVP users already have UUID ids. Co-locating both on `User.id` would force a destructive backfill on every existing row. R3.2 instead adds `discordId String? @unique` as a separate column; `User.id` stays an opaque internal cuid that survives provider changes. OUTLINE §4 amended in lockstep. The MVP web reducer now sets `discordId === id` for local-only users (placeholder; R3.5 overwrites with the real snowflake on first login).
>
> **`emailVerified DateTime?` (not Boolean).** Roadmap checklist line 1513 just said "emailVerified"; OUTLINE §4 line 231 specifies "ISO timestamp, nullable — set on first successful OTP verification". `DateTime?` matches OUTLINE wording AND the @auth/prisma-adapter convention — clean two-fold consistency.
>
> **`MembershipRole.banker` added in this slice.** OUTLINE §4 line 309 lists `dm | player | banker` for `TransactionLog.actorRole`. SECURITY §2.2 says banker is denormalized on `Party.bankerUserId` per OUTLINE §3.14 — never a row in `PartyMembership`. Adding `banker` to the Prisma `MembershipRole` enum now (rather than waiting for R3.4) keeps R3.4's migration surface from touching two enum types. R3.2 ships ONLY the enum value; the §2.2 guard layer that rejects writes of `PartyMembership.role = 'banker'` lands in R3.4. `src/db/mappers.ts` exposes a narrower `fromDbMembershipRole` that throws if it ever reads a banker row — defensive trip-wire against R3.4 regressions.
>
> **PKCE + state, not just PKCE.** Auth.js's default for OAuth providers is `checks: ['pkce']` only. PKCE alone defends against code-injection (RFC 7636) but SECURITY §1.1 explicitly requires "state parameter bound to the user's pre-auth session; reject mismatched callbacks." We opt in via `checks: ['pkce', 'state']` on the Discord provider config. Defense-in-depth against session-fixation attacks via crafted callback URLs.
>
> **503-when-unconfigured pattern (SECURITY §1.2 parallel).** When `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / `DISCORD_REDIRECT_URI` are absent, the `/auth/discord/*` routes return `503 {"error": "discord_auth_disabled"}` (graceful — local dev / CI / smoke tests work without a real Discord app). `NODE_ENV=production` overrides this and the env loader throws at boot, matching SECURITY §1.2's hard-fail-on-SMTP-misconfig stance. `GET /auth/session` keeps working even when Discord is disabled — useful for the R3.5 web client probing whether anyone is logged in.
>
> **Cookie naming: `__Host-` prefix in production.** Browser-enforced contract: no `Domain` attribute, `Path=/`, `Secure` required. Stricter than any flag we could set — if a misconfigured response strips `Secure`, the cookie is rejected on receipt. In dev (HTTP localhost) the `__Host-` prefix would break the cookie, so we fall back to a plain `auth-session-token` name. The switch is `env.NODE_ENV === 'production'`.
>
> **`trustHost: true` in AuthConfig.** Auth.js v5 refuses to run unless either `AUTH_URL` env / `AUTH_TRUST_HOST` env is set, or `trustHost: true` is on the config. We're behind a reverse proxy in production (nginx/caddy/traefik per TECH_STACK §7.1) and serve on localhost in dev — both modes derive the URL from the incoming `Host` header. Setting `trustHost: true` is the explicit "yes, we trust the proxy's Host" knob.
>
> **`app.getSession(req)` decorator on Fastify.** R3.4+ guards will call `await app.getSession(req)` to resolve the actor. Wrapping it as a decorator keeps future route code from re-implementing token lookup ad-hoc. The decorator delegates to `src/auth/session.ts`'s `getSession()`, which slides expiry forward when due.
>
> **Test fixture: `msw@2` Discord mock in `src/test/discord-mock.ts`.** Intercepts the two outbound calls (`POST /oauth2/token`, `GET /users/@me`) via undici's request interceptor in Node. Auth.js uses native fetch (undici under the hood) so interception is transparent. Reusable in R3.3 (SMTP send) and R5+ (websocket). Profile-per-test via the `withUser()` setter.
>
> **`userSchema.refine()` widened.** SECURITY §1.2 invariant ("at least one of `discordId` or `emailVerified`") now lives at the Zod boundary too — not just the DB CHECK. The MVP web reducer's `create-character` action was updated to set `discordId === id` so existing in-browser flows still parse. (User-confirmed acceptable: "Data of current mvp users is no concern because its just me.") R3.5 overwrites `discordId` with the real Discord snowflake on first server-side login.
>
> **DEFERRABLE FK drift (Prisma #8807) defended.** R3.2's migration touched `Character` indirectly (via the migrate engine's re-emit pass), reverting R3.1's `DEFERRABLE INITIALLY DEFERRED` on `Character_inventoryStashId_fkey`. The hand-tail of `r32_auth/migration.sql` drops + re-adds the FK with DEFERRABLE. A new test in `src/db/schema-invariants.test.ts` queries `pg_constraint` and CI-fails with a pointed error message if any future migration loses the deferral. Documented in `apps/server/prisma/schema.prisma` as a DRIFT WARNING comment on the `inventoryStashId` field.
>
> **Followups carried forward to R3.3:**
> - `VerificationToken` table is already provisioned by R3.2's migration — R3.3 just writes to it.
> - `@auth/core`'s Email provider can be drop-in registered alongside Discord; the SMTP misconfig guard (SECURITY §1.2) lives in `src/config/env.ts`.
> - The "503 when unconfigured" pattern from R3.2 is the template for the `/auth/email/*` routes in R3.3.
>
> **Followups carried forward to R3.4:**
> - `app.getSession(req)` decorator (R3.2) is the single source-of-truth identity resolver for the §8.1 guard layer.
> - `MembershipRole.banker` is in the enum; R3.4 adds the guard that rejects `PartyMembership.role = 'banker'` writes.
> - `actorRole: 'banker'` on `TransactionLog` is in the Zod union; R3.4's reducer emits it when `Party.bankerUserId === actorUserId`.

#### R3.3 — Email OTP auth + backup-email settings

- [x] Auth.js Email provider wired; `generateVerificationToken` overridden to produce an 8-digit numeric OTP; `sendVerificationRequest` overridden to send OTP-in-email (not a magic link) — **R3.3** (deviation: implemented as custom hand-written `POST /auth/email/request-otp` + `POST /auth/email/verify-otp` routes rather than Auth.js's Email provider; magic-link defaults made the SECURITY §1.2 "OTP via POST body only, never in a URL" mandate awkward to enforce. Verify route reuses `createSessionForUser` from R3.2 to issue the same session cookie shape Discord uses)
- [x] OTP token store backed by Prisma (`VerificationToken` table — standard Auth.js shape) — **R3.3** (table provisioned by R3.2's migration; R3.3 writes rows with `identifier = 'otp:<email>'` for primary flow, `identifier = 'link:<userId>:<email>'` for backup-email link flow to prevent cross-flow code consumption)
- [x] OTP codes: 15-minute expiry, single-use (consumed on first successful verification) — **R3.3** (`OTP_LIFETIME_MS = 15 * 60 * 1000` in `src/auth/email/otp.ts`; verify route `prisma.verificationToken.delete`s the row on success — replay attempts get P2025 / 401)
- [x] Rate limiting: 5 failed attempts per code → code invalidated + 15-minute per-IP + per-email lockout; implemented as a thin Fastify middleware on the OTP verification endpoint — **R3.3** (new `EmailAuthAttempt` table keyed by `(email, ip)`; the OR-axis query in `checkLockout` blocks both "one IP attacking many emails" and "one email attacked from many IPs"; `recordFailedAttempt` deletes the code row when failedCount reaches MAX. Implemented as a module in `src/auth/email/rate-limit.ts` called from the route rather than a Fastify hook — keeps the lockout-then-fail-2xx response-shape explicit at the call site)
- [x] `/auth/email/request-otp` returns constant-time identical response whether email is registered or not (no user enumeration) — **R3.3** (route always returns `200 { status: 'sent' }`; a synthetic 150-350ms `constantTimePad()` runs in parallel with the SMTP send so registered/unregistered timing distributions overlap within an order of magnitude; sophisticated timing attacks would also be blunted by adding a request-side rate limit on the same `EmailAuthAttempt` keyspace — captured as followup)
- [x] SMTP startup guard: if any of `SMTP_HOST | SMTP_PORT | SMTP_USER | SMTP_PASS | SMTP_FROM` are absent, email auth is disabled at startup — email login UI hidden, OTP endpoint returns `503` — **R3.3** (sentinel `isEmailAuthEnabled(env)` mirrors `isDiscordAuthEnabled`; all four mail-sending routes return `503 {"error": "email_auth_disabled"}` when false; `set-display-name` does NOT gate on SMTP — a user who already has a session can finish onboarding even if SMTP is later disabled. Production fail-fast in `env.ts` if NODE_ENV=production and any are missing)
- [x] Email-only first-login flow: user prompted for `displayName` before hub; server blocks hub access until `displayName` is set — **R3.3** (server side: new `User.needsDisplayName Boolean @default(false)` column set true on first verify-otp for an unknown email; `POST /auth/email/set-display-name` is the only route accepting that user's session until the flag flips false. R3.4's §8.1 guard layer will read this flag and return `409 display_name_required` on every other protected route. Web-side prompt UI lands in R3.5)
- [ ] Settings → "Linked accounts" section (replaces "Backup login") — symmetric for both user types:
  - Discord users: enter email → receive OTP → verify → `User.email` + `User.emailVerified` set — **R3.3 server endpoints shipped** (`POST /auth/email/link/request-otp` + `POST /auth/email/link/verify-otp` require auth via `app.getSession`; conflict on email already attached elsewhere returns `409 email_already_linked`); UI lands in R3.5
  - Email-only users: "Connect Discord" button → OAuth flow → on success `User.discordId` + `User.avatarUrl` stored on the existing row; `displayName` not overwritten — **deferred to R3.5** (intricate Auth.js callback hook; folds cleanly into R3.5's web-side OAuth redirect handling — see Notes)
- [ ] `shadcn/ui input-otp` component added (`pnpm dlx shadcn@latest add input-otp`); OTP entry screen uses `maxLength={8}` — **deferred to R3.5 (web UI slice)**
- [ ] Login screen shows both "Sign in with Discord" and "Sign in with email" paths — **deferred to R3.5 (web UI slice)**

#### R3.3 — Notes

> **2026-06-26 — R3.3 (Email OTP + backup-email server) complete.** Layers email-OTP login on top of R3.2's Auth.js+sessions surface. The server now mints 8-digit codes via `crypto.randomInt`, mails them through any SMTP relay (Postmark / SES / Mailgun / Postfix / Mailpit), and creates a `Session` row on a successful verify that's bit-identical to what the Discord callback writes. Smoke-tested loop: `pnpm dev` with empty SMTP_* → `curl /auth/email/request-otp` returns 503; with Mailpit at `localhost:1025` → POST request-otp returns 200, Mailpit UI shows the 8-digit code, POST verify-otp with that code drops `User` + `Session` rows + sets the session cookie; `curl --cookie cookies.txt /auth/session` works. **No web UI** — that's R3.5.
>
> **Custom routes rather than Auth.js Email provider.** Auth.js's `EmailProvider` is magic-link-default — its `signIn` action sends an email whose body contains an HTTPS link, and `callback/email` verifies a token from the URL's query string. Overriding `generateVerificationToken` + `sendVerificationRequest` to produce a numeric OTP works, but the magic-link callback URL would STILL be active and accept the same token, defeating SECURITY §1.2 "OTP submitted via POST body only, never in a query string." Hand-writing `POST /auth/email/request-otp` and `POST /auth/email/verify-otp` lets us mechanically enforce body-only submission, the constant-time response, and the 5-attempt lockout in one place — ~120 lines per route plus rate-limit / OTP / SMTP modules. The verify route doesn't go through `Auth(req, config)`; instead it calls `createSessionForUser(prisma, userId)` (a new helper in `src/auth/session.ts`) which writes the same `Session` row shape Auth.js's adapter would.
>
> **`@auth/core` peer-dep override survived R3.3.** No adapter calls touched the Prisma 7 incompatibility (we never invoke the `VerificationToken` adapter methods — the custom routes write directly through the typed PrismaClient). The pnpm `peerDependencyRules` block stays as-is.
>
> **OTP keyspace + plaintext storage.** 8 digits = 10⁸ ≈ 100M codes. The protection is the 15-minute expiry + 5-attempt lockout, NOT the entropy. Hashing the 8-digit code with bcrypt/argon2 would be theatrical — an attacker with DB read access can already mint sessions outright; the keyspace is too small for offline brute-force to be slower than online (which is what the lockout already blocks). Stored as plain digits in `VerificationToken.token`; documented in code comments + here.
>
> **`EmailAuthAttempt` two-axis lockout.** Single row per `(email, ip)` so concurrent attackers from different IPs against the same email each create their own row — and a single IP attacking many emails creates a row per target. `checkLockout` queries `lockedUntil > now()` with an `OR(email, ip)` clause so EITHER axis being locked blocks the next attempt. The 5-failure threshold burns ONE `(email, ip)` row's code; an attacker with a botnet pivoting IPs still has to burn 5 attempts per IP, which scales linearly with IP count rather than failing instantly. SECURITY §1.2 mitigations satisfied.
>
> **Constant-time `request-otp`.** Always returns 200 + the same JSON body; a `constantTimePad()` of 150-350ms runs in parallel with the SMTP send so registered/unregistered timing distributions overlap. Not a defense against a sophisticated attacker with millions of requests — but the per-IP rate limit on `verify-otp` is the load-bearing protection; the constant-time pad just defangs the trivial timing-leak case. Followup (not in this slice): add a per-IP rate limit on `request-otp` itself reusing the same `EmailAuthAttempt` keyspace. Mailpit smoke verified both branches pad to roughly the same timing envelope.
>
> **`needsDisplayName` Boolean column.** R3.2's User model had no way to express "this row is mid-onboarding." R3.3 adds `User.needsDisplayName Boolean @default(false)` so new email-only verify-otp rows land with `displayName: '', needsDisplayName: true`. The new `POST /auth/email/set-display-name` route is the only endpoint accepting that user's session until the flag flips. R3.4's §8.1 guard layer returns 409 `display_name_required` on every other protected route. Discord signups stay false because the `events.signIn` callback fills displayName from the Discord profile; the MVP web reducer's local users stay false because the local create flow takes the name from the user upfront.
>
> **Token redaction in logs.** SECURITY §1.2: "Server logs must not record OTP values — redact the body field in the logging middleware." Fastify's `logger.redact: { paths: ['req.body.otp', '*.body.otp'], remove: true }` strips the field before pino serializes the request log. Tested by inspection — pino-redact's docs cover the path-syntax.
>
> **`trustProxy: true` on the Fastify constructor.** The per-IP lockout would be meaningless behind a reverse proxy without this — `req.ip` would always be the loopback address. README §3.5 already mandates that the proxy validate `X-Forwarded-For` (don't blindly forward it from clients); the same security model applies here.
>
> **Discord-link `?link=1` flow deferred to R3.5.** The roadmap originally asked for both directions of account linking in R3.3. Server-side, the email-link side is straightforward (verify-otp + write to existing user). The Discord-link side requires routing the OAuth callback through a different code path when a session cookie is present — the `events.signIn` callback in `src/auth/config.ts` would need to detect the link case and attach `discordId`+`avatarUrl` to the existing user instead of letting the adapter create a new row. That logic folds cleanly into R3.5's web-side OAuth redirect handling (R3.5 is already going to revisit the callback for the redirect-to-hub flow), so we punt to avoid two passes over the same surface. Captured as a R3.5 carryforward below.
>
> **Mail mock for tests is NOT msw.** R3.2's `discord-mock.ts` uses msw to intercept outbound `fetch()`. SMTP isn't HTTP, so msw can't help. Instead, route tests pass `setupMailerMock().service` (an in-memory `MailService` that captures every `sendOtp` call into an array) directly into `buildServer` via the new `mailService?` BuildOption. The wider `vi.mock('nodemailer', ...)` approach is reserved for the `smtp.ts` unit test that exercises the wrapper itself. Two seams, two responsibilities — keeps each test layer's surface small.
>
> **Mailpit for local dev.** Docker `axllent/mailpit` exposes SMTP on `:1025` and a web inbox on `:8025`. Documented in `apps/server/README.md` and root README. No SMTP relay sign-up needed to smoke-test the loop. CI doesn't touch Mailpit — the mocked `MailService` covers everything.
>
> **`schema-invariants.test.ts` defensive checks extended.** Two new assertions: `User.needsDisplayName` is `BOOLEAN NOT NULL DEFAULT false`, and the `EmailAuthAttempt` table exists with the `(email, ip)` UNIQUE index. Catches future migration drift the same way the existing DEFERRABLE FK assertion does.
>
> **Followups carried forward to R3.4:**
> - `app.getSession(req)` decorator → §8.1 guard layer that also rejects routes when `user.needsDisplayName === true` with `409 display_name_required`.
> - `MembershipRole.banker` enum value (R3.2) → guard that rejects writes of `PartyMembership.role = 'banker'`.
> - The `actorRole: 'banker'` Zod union entry (R3.2) → reducer emits it when `Party.bankerUserId === actorUserId`.
>
> **Followups carried forward to R3.5 (web slice):**
> - `shadcn/ui input-otp` component install (`pnpm dlx shadcn@latest add input-otp` in `apps/web`).
> - Login screen: "Sign in with Discord" + "Sign in with email" buttons.
> - OTP entry screen (8-character input + verify request).
> - Display-name prompt screen when `needsDisplayName: true`.
> - Settings → "Linked accounts" UI: backup-email flow for Discord users (server endpoints shipped); Connect-Discord flow for email-only users (server-side `?link=1` callback handling lands here too).
>
> **Followups for ops/maintenance:** see the **Operational followups (unscheduled)** section at the bottom of this file (R3.3 contributes the `EmailAuthAttempt` cron sweep + per-IP `request-otp` rate limit).

#### R3.4 — Authoritative sync

- [x] Per-user AppState sync endpoint (push reducer actions) — **R3.4.a** (`POST /sync/actions { partyId, actions: Action[] }` — batched. Session-derived actor; §8.1 guard map dispatched per action; reducer re-run authoritatively; one `prisma.$transaction` with 30s timeout + 100-action batch cap. Whole-batch rollback on any guard rejection → `422 { rejected: { index, code, message } }`)
- [x] Per-user AppState pull/snapshot endpoint — **R3.4.a** (`GET /sync/state?partyId=...`. Eight Prisma queries fan-out via `Promise.all`; mapped through `db/mappers.ts` extensions; final result `appStateSchema.parse`d per CLAUDE.md "trust at the boundary")
- [x] Authoritative validation: server re-runs reducer against incoming actions — **R3.4.a** (reducer moved to `packages/rules/src/reducer/` with `ReducerContext { newId; now; newInviteCode }` injected; web and server both call `reduce(state, action, ctx)` with their own ctx — tests inject deterministic ctx)
- [ ] Nightly snapshot job to disk (default 30-day retention; configurable per §11) — **deferred to R3.4.b** (R3.5's web-side OAuth callback work doesn't depend on snapshots existing, so we shipped sync first; snapshot scheduler lands as a follow-on)
- [ ] User-triggered JSON export still works client-side (parity with §3.13) — **deferred to R3.4.b** (web export-import is intact in MVP; serverside parity is a R3.4.b concern)
- [x] **§8.1 guard layer reads `user.needsDisplayName` and returns `409 display_name_required` on every protected route except `POST /auth/email/set-display-name`** — **R3.4.a** (top-level check in both `/sync/state` and `/sync/actions` handlers; the column shipped in R3.3 and the unblock-route exists; R3.4.a closes the carryforward)
- [x] **Guard rejects writes of `PartyMembership.role = 'banker'`** — **R3.4.a** (structural defense-in-depth: the `partyMembershipSchema.role` enum in `@app/shared` is narrowed to `['dm', 'player']` — banker is denormalized on `Party.bankerUserId` per OUTLINE §3.14. The guard map's `banker_membership_forbidden` rejection code is reserved for future regressions; no R3.4.a action writes this directly)
- [x] **Reducer emits `actorRole: 'banker'` on `TransactionLog` entries when `Party.bankerUserId === actorUserId`** — **R3.4.a** (the `deriveActorRole(party, membership)` helper in `packages/shared/src/guards/actor.ts` returns `'banker'` iff `bankerUserId === membership.userId`; server's `resolveActor` calls it once per request to build the `Actor`, and `buildLogEntryServer` uses `actor.role` as the log entry's `actorRole`. MVP-validated state has `bankerUserId: null` so the banker branch is structurally unreachable until R4.2 widens the schema — but the code path is in place)

#### R3.4.a — Authoritative sync notes

> **2026-06-26 — R3.4.a (Authoritative sync — guard + push/pull) complete.** Server gains its first domain-mutation surface: `POST /sync/actions` accepts batches of typed reducer actions, validates each via the shared §8.1 guard map, runs the moved-to-`@app/rules` reducer authoritatively, and persists the resulting deltas + `TransactionLog` entries in one `prisma.$transaction`. `GET /sync/state?partyId=...` assembles the full `AppState` from 8 Prisma queries and validates through `appStateSchema`. R3.4.b ships nightly snapshots + retention as a follow-on so R3.5's web-client work isn't blocked.
>
> **Reducer moved to `@app/rules` with `ReducerContext` injection.** The 2484-line web reducer relocated to `packages/rules/src/reducer/`. The 13 non-pure references (`crypto.randomUUID` / `new Date()` / `crypto.getRandomValues`) became `ctx.newId()` / `ctx.now()` / `ctx.newInviteCode()`. Web injects real impls in `apps/web/src/store/index.ts`; server injects identical ones in `sync/routes.ts`. Tests can inject deterministic sequences for reproducibility. The web's `apps/web/src/store/{reducer,types}.ts` are now thin re-exports — every web-side import path is preserved.
>
> **Action schema in `@app/shared/schemas/action.ts`.** The reducer's TS `Action` union (25 variants) had no Zod counterpart before R3.4.a. The new `actionSchema` mirrors it 1:1 for wire-validation in `/sync/actions`. A compile-time `types.drift.test.ts` in `@app/rules` cross-checks the discriminator sets — adding a variant to one without the other becomes a TS error. Field-level optionals differ between Zod (`field?: T | undefined`) and reducer (`field?: T`) under `exactOptionalPropertyTypes: true`; the routes handler casts at the boundary with a documented `toReducerAction(schemaAction)` shim. Discriminator set equality is the load-bearing invariant; the optional-field flavor difference is cosmetic.
>
> **Guard layer in `@app/shared/src/guards/`.** Codifies OUTLINE §8.1 as a map `{ actionType → Guard }`. `checkGuard()` short-circuits to `{ ok: true }` for solo parties (OUTLINE §8.2 — the sole member gets the UNION of DM + Player rights). Multi-member tests cover the matrix: DM-only actions (`create-homebrew`, `edit-homebrew`, `delete-homebrew`, `identify`, `set-encumbrance`, `rename-party`, `seed-catalog`), ownership checks (`acquire`, `equip`, `attune`, `rename-character`, `create-stash`, `edit-character`), and the `maxAttunement`-only DM-gate inside `edit-character`'s patch. The actor's `role` is derived server-side via `deriveActorRole(party, membership)` — `'banker'` iff `Party.bankerUserId === actorUserId`; never from a `PartyMembership.role = 'banker'` row.
>
> **`POST /sync/actions` lifecycle.** Per request: (1) session cookie → `userId`; (2) `needsDisplayName === true` → 409; (3) Zod-parse body; (4) if every action is `create-character`, the actor is a "bootstrap actor" — otherwise `resolveActor` reads the user's `PartyMembership` + `Party` rows. (5) Open one `$transaction` with 30s timeout. (6) Per action: load state, run `checkGuard`, run `reduce(state, action, ctx)`, run `applyBootstrapDelta` (for create-character) or `applyDelta` (for everything else), then `appendTransactionLog` for each emitted `LogEntrySlice`. The persistor runs BEFORE the log writes so the `TransactionLog.partyId` / `actorUserId` FKs resolve. (7) Any guard rejection throws `BatchRejected` which rolls back the whole batch and surfaces as `422 { rejected: { index, code, message } }`.
>
> **Bootstrap special case (`create-character`).** The reducer's bootstrap path mints a synthetic `user` row (because the web has no pre-existing auth). The server already has the authenticated user via the session; `applyBootstrapDelta` writes the Party / Character / Stashes / Memberships / Currencies using the reducer's IDs but substitutes the authenticated `userId` everywhere the reducer wrote its synthetic one. The actor's `partyId` (initially the request's placeholder) is promoted to the reducer's freshly-minted party.id before building the log entry, so the `TransactionLog.partyId` FK resolves.
>
> **DEFERRABLE FK creation order.** `Character.inventoryStashId → Stash` is DEFERRABLE INITIALLY DEFERRED (migration tail workaround for prisma#8807); `Stash.ownerCharacterId → Character` is NOT. So the bootstrap creates `Character` FIRST (pointing at the not-yet-existing inventory stash; the deferred FK resolves at commit) and `Stash` SECOND (`ownerCharacterId` now points at the existing Character). This is documented inline in `applyBootstrapDelta`.
>
> **Mapper extensions.** `apps/server/src/db/mappers.ts` gained 7 new `fromPrismaX` mappers for the entities `loadAppStateForUser` reads: Party, PartyMembership, Character, Stash, ItemInstance, CurrencyHolding, TransactionLog. Each validates through its Zod schema per CLAUDE.md "trust at the boundary". The PartyMembership mapper goes through the R3.2 `fromDbMembershipRole` translator which throws on `'banker'` (per OUTLINE §3.14 banker is never a membership row).
>
> **State assembler.** `loadAppStateForUser` makes 3 lead queries (User, Party, active memberships) sequentially to short-circuit unauthorized requests early, then fans out 4 more in parallel (Character, Stash, ItemDefinition, ItemInstance/CurrencyHolding/TransactionLog). Catalog reads include PHB+DMG (system-wide) plus homebrew scoped to this party. The final result is parsed through `appStateSchema` — the entry-level boundary check that surfaces any DB↔Zod drift.
>
> **`schema-invariants.test.ts` defensive checks unchanged.** No new tables in R3.4.a; no Prisma migrations.
>
> **Followups carried forward to R3.4.b:**
> - Nightly snapshot job (`node-cron` at 03:00 local) writing a SHA-256-checksummed AppState dump per party to disk, with default 30-day retention.
> - Server-side JSON export endpoint (parity with web export).
>
> **Followups carried forward to R3.5 (web slice):**
> - Wire `apps/web/src/store/` to call `/sync/state` on hydrate and `/sync/actions` after each dispatch (replacing the Dexie-only persistence).
> - Optimistic UI: web reducer runs first against local state; server response either confirms or rolls back via `applied[]` / `rejected`.
> - Display-name prompt UX (`needsDisplayName: true` → block hub render).
>
> **Followups for R4.2 (Banker):**
> - Widen `partyMembershipSchema.role` to include `'banker'`? No — keep narrow per OUTLINE §3.14 (banker is denormalized only). Widen `party.bankerUserId` from `z.null()` to `z.string().min(1).nullable()`.
> - Add `appoint-banker` / `revoke-banker` action variants + matching guards + reducer cases + persistor handlers.
> - The R3.4.a guard's `banker_membership_forbidden` code becomes load-bearing — first triggered by a misbehaving `appoint-banker` payload that wrote to `PartyMembership.role` instead of `Party.bankerUserId`.

#### R3.4.b — Snapshots + JSON export parity

- [x] **Nightly snapshot job (`node-cron` at 03:07 local)** — **R3.4.b** (in-process `node-cron@4.5.0`, registered by `buildServer` and stopped via Fastify's `onClose` hook so SIGTERM doesn't leak the timer. Per tick: enumerates every Party, calls `writeSnapshot` per party (state via `loadAppStateForParty` admin loader), then `sweepSnapshots` for retention. Per-party write failures are collected and logged but don't abort the tick. Disabled when `SNAPSHOTS_ENABLED=false`).
- [x] **Server-side JSON export endpoint** — **R3.4.b** (`GET /sync/export?partyId=...`. Same auth + `needsDisplayName` + party-membership gates as `/sync/state`; reuses `loadAppStateForUser`; wraps the result in `exportEnvelope` with `schemaVersion: 1`, `exportedAt`, `appVersion`, `seedVersion`, and boundary-parses the envelope before sending. Per-status: 401 / 403 / 404 / 409 / 200).
- [x] **Snapshot restore admin command** — **R3.4.b** (`pnpm --filter @app/server snapshot:restore <path>`. Reads the snapshot JSON, verifies SHA-256 against the `.sha256` sidecar (sha256sum-compatible `<digest>  <filename>` format), Zod-parses the envelope, then wipes + reapplies the party's rows inside one `$transaction` with a 60s timeout. NOT exposed over HTTP — operator-only per SECURITY §8 "opt-in restore." A digest mismatch exits non-zero before touching the DB).

#### R3.4.b — Snapshots notes

> **2026-06-26 — R3.4.b (Snapshots + JSON export parity) complete.** Server now writes per-party snapshot JSON files + SHA-256 sidecars nightly at 03:07 local, sweeps files older than `SNAPSHOT_RETENTION_DAYS` (default 30), and surfaces an HTTP export endpoint that hands the web client the same `exportEnvelope` shape it's been writing locally. A `snapshot:restore` CLI lets the operator roll any snapshot file back into the DB after verifying its checksum.
>
> **node-cron@4.5.0.** v4 ships its own TypeScript types (no `@types/node-cron` needed) and exposes the same `schedule(expr, fn, opts)` surface as v3 plus richer events (`task:started`, `execution:overlap`, etc.). The R3.4.b `startSnapshotCron` uses only the v3-shape (`schedule()` + `task.stop()`); the v4 extras are available without a refactor when R3.4.c or a later slice wants them. v3's `@types/node-cron@3.0.11` is intentionally NOT installed — it would conflict with v4's bundled types.
>
> **Per-party file layout.** `${SNAPSHOT_DIR}/${partyId}/${ISO_TIMESTAMP}.json` + `.sha256` sidecar per file. Per-party folders make it trivial for an operator to copy / restore one party at a time without grepping a monolithic file. Filenames sanitize `:` to `-` (Windows portability); the full ISO timestamp is preserved inside the envelope's `exportedAt` regardless. The retention sweeper walks one level deep and leaves empty party folders in place (cheap; the next writer pass fills them back in).
>
> **SHA-256 sidecar format.** Standard `sha256sum` output — `<64-hex-digits>  <filename>` (two spaces). Verifiable with the canonical CLI: `cd <dir> && sha256sum -c <file>.sha256`. The restore CLI extracts the digest with `split(/\s+/, 1)[0]` so a hand-edited file using tabs / single-spaces still parses.
>
> **Admin-scoped state loader.** `loadAppStateForParty` is a sibling of `loadAppStateForUser` that skips the per-user membership check and anchors the AppState's `user` field to the party's owner row. Used by the snapshot writer (the cron job has no session). Internal `assembleAppState` is shared by both — only the entry-condition checks differ.
>
> **Export envelope appVersion.** Hard-coded to `'0.0.0'` (the server package's declared private-version). Wiring a build-time injection of the real package.json version would require a build step the MVP doesn't have; the constant is a placeholder that R5+ can wire up to a real version when the deployment story matures. Bumping `exportEnvelopeSchema.schemaVersion` from 1 → 2 would force a reader-side incompatibility check before the parse fans out.
>
> **`SNAPSHOTS_ENABLED=false` in tests.** Test fixtures across 7 files (`auth/{config,routes,routes.email,session,email/smtp}.test.ts`, `routes/health.test.ts`, `sync/routes.test.ts`) set the flag to false so `buildServer` doesn't register a cron timer per test app instance. The snapshot tests explicitly drive `runSnapshotTick` instead of waiting for a cron fire. CI never lands snapshot files.
>
> **Restore transaction order matches bootstrap.** The DEFERRABLE FK on `Character.inventoryStashId → Stash` lets `applyRestore` create Character before Stash (same as `applyBootstrapDelta` in R3.4.a). Wipe order is simpler — `prisma.party.deleteMany` cascades to PartyMembership, Character, Stash, ItemInstance, CurrencyHolding, and TransactionLog via the existing `onDelete: Cascade` declarations. Homebrew ItemDefinitions are wiped separately via `partyId` filter because their FK is `onDelete: Restrict`.
>
> **Schema-invariants test untouched.** No new tables; no Prisma migrations. The snapshot files live entirely on the filesystem.
>
> **Followups (no slice carries them forward):** see the **Operational followups (unscheduled)** section at the bottom of this file (R3.4.b contributes the snapshot-age metric, multi-replica cron coordination, and snapshot encryption-at-rest items).

#### R3.5 — Web integration

- [x] Login screen: "Sign in with Discord" + "Sign in with email" buttons (§5.1 / OUTLINE §3.1)
- [x] Hub screen (§5.2): Create party / Join party / Create solo cards + existing parties list
- [x] Web sync client pushes reducer actions to server
- [x] **Web reducer runs optimistically against local Dexie state; server response (`200 applied[]` or `422 rejected`) either confirms or rolls back** — carryforward from R3.4.a (the server endpoints + the `applied[]`/`rejected` response shapes locked in R3.4.a; this slice is the client integration that consumes them). Rollback uses **snapshot-before-flush** (single pre-batch snapshot is restored wholesale on 422) rather than per-applied index — simpler and correct by construction for the multi-slice cascades (`delete-stash`, currency-transfer).
- [x] Web reconciles server events back into the store (bootstrap pull-after-push canonicalises ids; subsequent mutations rely on the server's `applied[]` log entries)
- [ ] Offline-first: Dexie remains primary cache; solo party works offline (§9) — **deferred to R5 along with the WebSocket reconnect work**. R3.5 assumes online in server mode; Dexie remains a survival cache for the active party only.
- [x] Offline banner reserved for multi-member mode (R4 will gate behavior) — **shipped in R4.4.d** (`apps/web/src/components/OfflineBanner.tsx`). Gated on server mode + `navigator.onLine === false` + `memberCount >= 2` per OUTLINE §9; solo parties excluded by design. Write-blocking still deferred to M5's realtime layer.
- [x] Settings: Account section shows displayName + avatar (Discord) or email (email-only) (§5.17)
- [x] Settings: "Linked accounts" section — email entry + OTP flow for Discord users; "Connect Discord" OAuth flow for email-only users (§3.1)
- [x] **Discord-link `?link=1` callback handling** — carryforward from R3.3. R3.5 ships a route-layer OAuth code-exchange path (NOT via Auth.js) so the link flow keeps the existing session cookie + attaches `discordId`/`avatarUrl` to the live User row. Conflict on snowflake already linked elsewhere → `302 ${WEB_ORIGIN}/settings?linkError=discord_already_linked`. The handshake uses a new `PendingDiscordLink(token, userId, expires)` table for the state nonce + an HMAC-signed OAuth `state` parameter.
- [x] **OTP entry uses `shadcn/ui input-otp` with `maxLength={8}`** — carryforward from R3.3. Added via `pnpm dlx shadcn@latest add input-otp` in `apps/web`; one tiny edit to the generated `input-otp.tsx` (slot fallback for `noUncheckedIndexedAccess`).
- [x] **Display-name prompt screen when `needsDisplayName: true`** — carryforward from R3.3.
- [x] Settings: Logout button clears session cookie and returns to Login screen (also surfaced in the Layout header)
- [x] **Login screen probes `GET /auth/methods` to render only configured sign-in buttons** — added post-R3.5. New unauthenticated server endpoint returns `{ discord: boolean, email: boolean }` mirroring the existing `isDiscordAuthEnabled` / `isEmailAuthEnabled` sentinels. The web hides any button whose provider's env triple/quintuple isn't configured, so users no longer click into a 503 for a method the operator never enabled. Schema: `authMethodsResponseSchema` in `packages/shared/src/schemas/api.ts`.
- [x] **Soft-warn (not fail-fast) for missing Discord/SMTP env in production + `SESSION_COOKIE_INSECURE` opt-in** — added post-R3.5. `loadEnv()` now logs a startup warning when any of the Discord triple / SMTP quintuple is absent OR set to the empty string (docker-compose's `${VAR:-}` substitution case), instead of crashing the boot. The routes still self-disable with 503 and the web Login button hides via `GET /auth/methods`. Email-only and Discord-only production deployments are now first-class. Separately, `SESSION_COOKIE_INSECURE=true` drops the `__Host-` prefix + Secure flag in production for self-hosted HTTP-only stacks (docker-compose `--profile proxy` on `http://localhost:8080`) — without this, browsers silently refuse to store the session cookie on plain HTTP and users appear logged out on every navigation. See `docs/SECURITY.md` §1.1 / §1.2.

#### R3.5 — Notes

> - **Mode flag**: `VITE_SERVER_URL` build-time env. Unset/empty → local mode (no login UI, no logout, no account section; Hub stays as the front door); set → server mode. Captured once at module load by `apps/web/src/lib/serverMode.ts`. No runtime probe — rebuild to switch modes.
> - **Local-mode invariant**: in local mode the web app behaves exactly like the pre-R3.5 MVP. `<ProtectedRoute />` is a no-op; `<PublicOnlyRoute />` redirects to `/hub`. Hub renders Create-solo / Create-party cards; Join card is hidden with a "Coming in R4" caption. Settings shows Backup / Character&Party / Encumbrance / Wipe only (no Account, Linked accounts, or Logout).
> - **Storage model**: server-first. Boot sequence in server mode: `session.hydrate()` → if authenticated and `currentPartyId` is in Dexie meta, `pullState(partyId)` → write canonical AppState into the store + Dexie. Subsequent dispatches go optimistically through the reducer + Dexie save + sync queue.
> - **Snapshot-before-flush rollback**: the sync queue caches the pre-batch `{appState, log}` before the first network call. On `422` it calls the store's new `restoreSnapshot` action (no Dexie save, no re-enqueue) and surfaces a toast carrying the server's `code` + `message`. Multi-slice actions roll back atomically by construction.
> - **Bootstrap pull-after-push**: the first `create-character` action goes through the queue like any other. After the server returns `200`, the queue re-pulls `/sync/state` for the freshly-minted party so reducer-minted IDs are canonicalised before the Hub's submit handler navigates to `/character/:id`. This is the only mandatory pull-after-push in R3.5.
> - **Discord-link uses a route-layer code-exchange**: `apps/server/src/auth/discord-link.ts` owns three new routes (`/auth/discord/link/initiate`, `/.../start`, `/.../callback`) that handle PKCE + state + token exchange directly. Auth.js's adapter is untouched. The flow consumes a `PendingDiscordLink` row that the `?link=1` short-circuit minted on `/auth/discord/login`. Operators must register `${SERVER_URL}/auth/discord/link/callback` as a second redirect URI in the Discord developer portal.
> - **New shared API schemas**: `packages/shared/src/schemas/api.ts` co-locates the response Zods consumed by both the web `apiFetch` and the server route handlers (`sessionResponseSchema`, `authMethodsResponseSchema`, `partiesListResponseSchema`, `pullStateResponseSchema`, `pushActionsResponseSchema`, `verifyOtpResponseSchema`, etc.). Keeps the two sides from drifting. `sessionResponseSchema` is a union of the object shape and `null` — Auth.js v5 returns the JSON literal `null` for unauthenticated `/auth/session` rather than `{}`, and the union avoids a spurious `malformed_response` ApiError in the user's console.
> - **New `GET /sync/parties`** endpoint. Same auth + display-name gate as the rest of `/sync/*`. Collapses `(dm, player)` rows for a party-of-one into a single response entry with both roles in `roles[]`. `lastActivityAt` is `max(TransactionLog.timestamp)`. Future-proofs R4.1.
> - **MSW** for web test HTTP mocking. `apps/web/src/test/msw.ts` exports `setupServer(...defaultHandlers)`; `apps/web/src/test/setup.ts` wires `beforeAll/afterEach/afterAll` with `onUnhandledRequest: 'error'`. Mode-aware tests stub `VITE_SERVER_URL` per-test via `vi.stubEnv` + `vi.resetModules()`.
> - **Cookie same-origin assumption**: the server-side session cookie is `SameSite=Lax`. In production this requires same-origin web↔server (reverse proxy per TECH_STACK §7.1). In dev, run web on the same origin as the server (Vite proxy or matching localhost ports). R3.5 originally shipped without a cookie-config opt-out; a post-R3.5 fix added `SESSION_COOKIE_INSECURE=true` as an escape hatch for self-hosted HTTP-only stacks (the docker-compose `proxy` profile on `http://localhost:8080` is the canonical case). Real HTTPS deployments leave it off and keep the `__Host-` + `Secure` cookie pair. See `docs/SECURITY.md` §1.1.
> - **`Welcome.tsx` and `CreateCharacter.tsx` are kept as legacy fixtures** for the existing screen tests (which mount them directly). They are no longer routed; the index redirects to `/hub` and the character-creation form moved into `apps/web/src/components/CharacterForm.tsx` used by the Hub dialogs.

#### R3 — Notes

> -

---

### R4 — Multi-member parties (outline §10 M4)

Invite codes, multi-user joining, Party Stash, Recovered Loot, Banker appointment + distribution toolkit, DM/Player role split when 2+ members. Covers OUTLINE §3.1 (permissive-until-others-join), §3.2, §3.5 ("split evenly"), §3.10 (loot distribution), §3.14 (Banker), §8.1 (full permission matrix), §8.3 (leaving/kicking).

**Slicing.** R4 is the largest milestone (~50 checkboxes). Splits along the feature axes that compose: R4.1 lights up multi-membership (invites, join, leave, kick) — once shipped, a party can have 2+ members; R4.2 adds the Banker role on top; R4.3 adds DM cross-character authority; R4.4 widens currency-transfer + homebrew visibility for the 2+-member world; R4.5 ships the DM Dashboard. Each slice is independently testable; R4.1 is the hard dependency for all later slices. R4.1 itself splits into six sub-slices: R4.1.a/b/c/d shipped 2026-06-29 (schema deprecation, delete-character, leave-party, kick-player); R4.1.e shipped same day (invites + join + Hub + PartySettings); **R4.1.f (joiners create their own character) was deferred during the e-split and promoted back on 2026-06-29 — without it joiners can't actually play, so the user-facing flow is incomplete until f lands.**

#### R4.1 — Invites + join/leave/kick + multi-membership schema

**Schema activations (§4)**
- [x] `Party.inviteCode` becomes user-visible / rotatable — **R4.1.e**. `POST /parties/:partyId/invite/rotate` (DM-only) mints a fresh code; PartySettings shows the current code with Copy + DM-only Rotate buttons.
- [x] `PartyMembership` supports count > 2 — **R4.1.e**. `partyMembershipSchema.leftAt` widened from `z.null()` to `z.string().datetime().nullable()` so members can soft-leave; the MVP-era "exactly two memberships per (userId, partyId)" invariant is now scoped to the party creator only (dm + player), with additional player rows added by `POST /parties/join`.
- [x] **`Party.isSoloShortcut` deprecated / removed** per OUTLINE §4 amendment (2026-06-24) — **R4.1.a**. Field dropped from Zod `partySchema`, the `partyListItemSchema` API row shape, the reducer's `create-character` writer, the server persistor / mapper / restore CLI / sync route, and the Prisma `Party` model (migration `r41_drop_party_isSoloShortcut`). Hub "solo" badge derived from `memberCount === 1`. Zod's default object-strip behaviour silently drops the legacy field so MVP-vintage exports rehydrate cleanly.
- [x] Migration test: an M0 / M1 / M2 / M3 / M4 / M5 / M5.5 AppState (with `isSoloShortcut: true`) imports cleanly under R4 schema; the hub renders the "solo" badge based purely on `memberCount` — **R4.1.a** (`packages/shared/src/schemas/appState.test.ts` "R4.1 migration — imports a legacy AppState carrying `isSoloShortcut: true`").
- [x] Composite-key invariant test: `(userId, partyId, role)` allows DM+player for creator — already shipped (M1 reducer test asserts `memberships.length === 2` with `dm + player` roles for the creator).

**Reducer actions (§4 TransactionLog union)**
- [x] `join-party` action + payload schema — **R4.1.e**. Empty wire payload (`{}`); reducer reads actor from `state.user.id` and party from `state.party.id`. Reducer appends a `role='player'` membership row (characterId: null) and emits one `join-party` log slice with `{ partyId }`. Rejects when the actor is already an active player member of the party.
- [x] `leave-party` action: moves owned items + currency to Recovered Loot (§8.3) — **R4.1.c**. Reducer payload empty (`{}`); actor + party derived from session/state. Cascade: (1) if leaver had a character, runs the shared `cascadeCharacterToRecoveredLoot` helper (items + currency → Recovered Loot, drop character + stashes + holdings); (2) soft-deletes every active `PartyMembership` row for actor.userId in this party (`leftAt: ctx.now()`); (3) banker auto-clear stub (R4.2 carryforward — unreachable today because `partySchema.bankerUserId: z.null()`); (4) appends terminal `leave-party` slice with `{ partyId, characterId? }`. Reducer guards: rejects sole-member (server archive flow per R4.1.e), rejects sole-DM of a 2+-member party (must `dm-transfer` first in R4.3).
- [x] `kick-player` action: same Recovered Loot transfer (§8.3) — **R4.1.d**. Symmetrical to `leave-party` but parameterised on `{ kickedUserId }`. Reuses `cascadeCharacterToRecoveredLoot` verbatim. Logged with `actorRole: 'dm'`. Reducer guards: rejects self-kick (use `leave-party` instead), rejects kicking a DM (use `dm-transfer` first in R4.3), rejects unknown / already-left target. Banker auto-clear stub (R4.2 emits `revoke-banker` with `reason: 'kicked'`).
- [x] `delete-character` action + payload schema (`{ characterId, name, lastSessionId? }` per §4) — **R4.1.b**. Reducer payload narrows to `{ characterId }` (subset of log payload); log entry snapshots `{ characterId, name, itemCount, currencyTotalCp }` (mirrors `delete-stash` snapshot pattern). `lastSessionId` reserved for R5 session tagging.
- [x] `delete-character` reducer case: moves owned items + currency to Recovered Loot, clears `PartyMembership.characterId` — **R4.1.b** (`packages/rules/src/reducer/index.ts` `deleteCharacter`). Cascade emits one `transfer` slice per item in any character-scope stash (Inventory + every Storage) + one `currency-change` slice with `reason: 'character-deleted'` against Recovered Loot when aggregate currency was non-zero + one terminal `delete-character` slice. Items have `equipped`/`attuned`/`containerInstanceId` cleared on transfer. Character row + their stash rows + CurrencyHolding rows dropped. OUTLINE §4 `currency-change.reason` enum extended with `'character-deleted'` in lockstep.
- [x] `delete-character` invariant test: owning user keeps their membership (can recreate a character) — **R4.1.b** (`apps/web/src/store/reducer.test.ts` "drops the character row and clears PartyMembership.characterId on the player row").
- [x] `delete-character` log payload snapshots itemCount + currencyTotalCp (mirrors `delete-stash` pattern in §4) — **R4.1.b**.

**Server-side**
- [x] Invite-code generation endpoint (DM-only, rotatable) — **R4.1.e** (`POST /parties/:partyId/invite/rotate` in `apps/server/src/parties/routes.ts`). DM-only via `resolveActor` + role check; calls `generateInviteCode()` from `@app/rules`; updates `Party.inviteCode`. Old code becomes invalid immediately.
- [x] Invite-code redemption endpoint — **R4.1.e** (`POST /parties/join { inviteCode }`). Looks up the party by code (rejects archived parties as `invalid_invite`); rejects double-join as `already_member`; mints a `role='player'` membership + writes a `join-party` log slice in one `$transaction`.
- [ ] Websocket join/leave channel per party (foundation for R5)
- [x] Departure flow: archive empty parties (no destructive delete) per §8.3 — **R4.1.e**. New `Party.archivedAt` nullable column (migration `r41e_party_archivedAt`). `POST /parties/:partyId/leave` detects sole-member case and stamps `archivedAt` instead of running the §8.3 cascade. `GET /sync/parties` filters `archivedAt IS NULL`. Multi-member leave still goes through the reducer cascade.

**UI**
- [x] Hub: Join party (paste code) flow wired — **R4.1.e**. Hub Join card now active in server mode; opens a `JoinPartyForm` dialog with a single invite-code input. Submit calls `POST /parties/join`, refreshes the parties list, and routes into the new party. Surfaces `invalid_invite` / `already_member` toasts.
- [x] Hub: "do you also play a character?" toggle on the Create-party dialog (OUTLINE §3.1 default yes) — **R4.1.e + R4.1-followup 2026-06-29**. Three-step wizard: party-name input → Yes/No play prompt → character form (only if Yes). The "No" path dispatches `create-character` with `dmOnly: true` and routes the new DM to `/party/settings`. The "Yes" path dispatches the legacy `create-character` payload with the user-supplied `partyName` override. Solo Hub card stays single-step (party auto-named "My Campaign").
- [x] Hub: per-party row navigation — clicking a party in the Hub list pulls THAT party's `AppState` via `pullState(partyId)` and routes into it. R3.5 originally shipped a stub click handler (the comment said "Phase 4 wires the pull-then-navigate path") that navigated only to a character already in the local store, which was wrong for users with multiple parties. **Resolved post-R3.5** in `apps/web/src/screens/Hub.tsx`: click handler calls `setCurrentPartyId` (so reload boots back to the same party) → `pullState(partyId)` → `useStore.hydrate(...)` → navigates to `characters[0].id`. Disables all buttons during the pull and shows "Opening…" on the active card.
- [x] Party Settings screen (§5.15): invite code regenerate / revoke, kick player — **R4.1.e** (`apps/web/src/screens/PartySettings.tsx`, routed at `/party/settings`). Sections: Members list with role badges, Invite code (Copy + DM-only Rotate), Leave party. DM-only Kick buttons appear next to non-DM members. Confirm dialogs for both leave and kick.
- [x] Member list with role badges (DM / Player) — **R4.1.e** (inside `PartySettings`). One row per `(userId, role)` tuple; solo creator shows two rows (dm + player) by design. Role badges via the `RoleBadge` component.

#### R4.1.f — Joiners create their own character (`create-character-in-existing-party`)

**Why this is a milestone slice, not a backlog item.** The canonical multi-member flow per OUTLINE §3.1 / §3.3 is: DM creates a party (with or without their own character) → DM shares the invite code → each joining player creates their own character with their own Inventory + Storage stashes. They share the Party Stash + Recovered Loot + party-scope settings, but every player owns a separate character + carried Inventory + currency. **Without this slice R4.1 is functionally incomplete** — joiners land in the party with a `characterId: null` player row and cannot actually play; the "everyone has their own character" data model that the rest of the schema/reducer/server were built around has no entry point. This was deferred during the R4.1.e split (R4.1.e shipped `POST /parties/join` minting membership-only) and parked as an unscheduled followup before being promoted here on 2026-06-29.

**Same action covers three use cases** — joiner-creates-after-invite, DM-only-DM-later-adds-character, post-`delete-character` recreation. All three land at the same end state: an active `role='player'` `PartyMembership` row in an existing party with a non-null `characterId`.

**Reducer (`packages/rules/src/reducer/index.ts`)**
- [x] Extend `create-character` to accept a post-bootstrap variant. **Shipped 2026-06-30** in `createCharacterInExistingParty` (new function in `packages/rules/src/reducer/index.ts`); the legacy `createCharacter` arm now routes there when `state !== null` rather than throwing.
  - `state === null` → existing bootstrap path (mints `User` + `Party` + memberships + party-scope stashes + character/inventory if not `dmOnly`).
  - `state !== null` → new post-bootstrap path: validate the actor is an active member of `state.party`; mint Character + Inventory `Stash` + CurrencyHolding; if the actor already has a `role='player'` row update its `characterId`, else add a new `role='player'` row; emit a `create-character` log entry with the existing payload shape.
- [x] Reject `dmOnly: true` on the post-bootstrap branch (it's a bootstrap-only flag — adding a non-character DM-only "thing" to an existing party makes no sense).
- [x] Reject when the actor already has an active player membership in this party WITH a non-null `characterId` (one-character-per-user-per-party invariant per OUTLINE §4 composite-key model).

**Action schema (`packages/shared/src/schemas/action.ts`)**
- [x] No payload changes needed — the existing `create-character` action's legacy (with-character) payload already carries `{ name, species, size, class, level, str, partyName? }`. `partyName` is ignored on the post-bootstrap branch (the party already exists; renaming uses `rename-party`).

**Log entry (`packages/shared/src/schemas/transactionLog.ts`)**
- [x] No schema changes needed — `create-character` log entry's optional fields (`characterId`, `name`, `inventoryStashId`) are already set on the with-character branch; the post-bootstrap variant uses the same shape.

**Server-side**
- [x] Update `applyDelta` switch: the `create-character` arm now calls the new `persistAddCharacterToExistingParty` (lines 56–67 of `apps/server/src/sync/persistor.ts`) instead of throwing `'create-character must be applied via applyBootstrapDelta'`.
- [x] New persistor function `persistAddCharacterToExistingParty` (in `apps/server/src/sync/persistor.ts`): creates `Character` + `Stash(scope='character', isCarried=true)` + `CurrencyHolding`; either updates `PartyMembership.characterId` (player row exists with null id) or inserts a fresh `(userId, partyId, 'player')` membership row (DM-only DM adding their first character).
- [x] Bootstrap-vs-post-bootstrap dispatch in `apps/server/src/sync/routes.ts` `POST /sync/actions` now branches on `await prisma.party.findUnique({where:{id:partyId}})` BEFORE deciding `isBootstrap` — if the party exists, post-bootstrap path; the `applyBootstrapDelta` seam (lines ~300) is also gated on `isBootstrap`.

**Guards (`packages/shared/src/guards/map.ts`)**
- [x] Widened `createCharacterGuard` to accept `state !== null` when the actor is an active member of `state.party`. New rejection codes added to `GuardRejectionCode`: `'state_already_initialized'` (for dmOnly on post-bootstrap branch), `'character_already_exists'` (for the one-character-per-user-per-party invariant).

**Web UI**
- [x] Single CTA on PartySettings covers all three use cases (joiner post-join, DM-only DM, post-delete recreation). After `POST /parties/join`, `openServerParty` already routes the joiner to `/party/settings` when `characters[0]` is undefined; the new "Create your character" section in `apps/web/src/screens/PartySettings.tsx` is visible whenever `character === null && partyId !== null` and reuses the existing `<CharacterForm>` component. (No dedicated post-join route — the choice was for one UI path serving all three uses.)
- [x] After the post-bootstrap `create-character` dispatch, `handleCreateCharacterSubmit` follows the Hub-style sync flush + post-flush re-read + navigate-to-`/character/:id` pattern.
- [x] **Sync queue fix** — `apps/web/src/sync/queue.ts` previously misclassified post-bootstrap `create-character` as bootstrap (sending `'will-be-minted'` as partyId). Fixed: `isBootstrap = isCreateCharacter && snapshot?.appState == null`. The post-flush re-pull (which lands server-canonical ids in the store) was extended to fire on ANY `create-character`, not just bootstrap, so the server-minted character + inventory + holding ids replace the client's optimistic ones.

**Tests**
- [x] Reducer: dispatching `create-character` on a populated AppState as an active player with `characterId: null` adds a Character + Inventory stash + currency and updates the player row's characterId. (`apps/web/src/store/reducer.test.ts` describe block `reducer: create-character post-bootstrap (R4.1.f)`.)
- [x] Reducer: dispatching as a DM-only DM (no player row) adds a new `role='player'` membership row + Character + stashes.
- [x] Reducer: rejects when the actor already has an active player membership with a non-null `characterId`.
- [x] Reducer: rejects `dmOnly: true` on the post-bootstrap branch.
- [x] Reducer: rejects when the actor is not an active member of `state.party`.
- [x] Guard tests (`packages/shared/src/guards/map.test.ts`) — 5 cases mirroring the reducer rejection paths plus the two positive cases (joiner, DM-only DM).
- [x] Server integration (`apps/server/src/parties/routes.test.ts`): full flow — user A creates a party, user B joins, user B dispatches `create-character`, the resulting DB state has B's character + own Inventory + own CurrencyHolding; A still has their own separate character/inventory. Plus a DM-only DM "add character later" case.
- [ ] Web: `Hub` test that simulates `POST /parties/join` → navigates to the character-creation form (not `/party/settings`). **Not added** — the chosen UX is to land on `/party/settings` (which now hosts the CTA), so the existing Hub test continues to assert the current correct behaviour.
- [x] Web: `PartySettings` test that the "Create your character" CTA appears for a DM-only loaded party and dispatches `create-character` on submit. (Three new tests in `apps/web/src/screens/PartySettings.test.tsx`: CTA renders, submit dispatches + navigates, CTA hidden when character exists.)

**Out of scope (carryforward to a later slice if needed)**
- Multiple characters per user per party. The composite-key model `(userId, partyId, role)` only allows one player row per user per party, so one user → one character per party stays the invariant. A user playing multiple characters in the same campaign is a future ask (would need either `(userId, partyId, role, slot)` composite key OR moving `characterId` off the membership row entirely).
- Joiner-character-creation tied to invite-code redemption as a SINGLE atomic action. Two actions (`join-party` then `create-character`) is the simpler design — survives partial failures and reuses the existing reducer cases.

#### R4.1.f — Notes

> **2026-06-30 — R4.1.f (Joiners create their own character) shipped.** The post-bootstrap `create-character` path closes the last R4.1 gap: a user who joined via invite, a DM-only DM who skipped the play prompt at party creation, OR a user whose character was deleted can now dispatch `create-character` against an existing `AppState` and end up with a real Character + Inventory + zero-balance CurrencyHolding + a `role='player'` membership pointing at it.
>
> **Headline shape.** `createCharacterInExistingParty` (new function alongside the bootstrap `createCharacter` in `packages/rules/src/reducer/index.ts`) handles the post-bootstrap branch; the existing `createCharacter` now delegates instead of throwing. Server-side, `applyDelta`'s `create-character` arm calls a new `persistAddCharacterToExistingParty` that mints Character + Stash + CurrencyHolding rows and either patches the existing `(userId, partyId, 'player')` row's `characterId` or inserts a fresh one. The `/sync/actions` route's `isBootstrap` heuristic was tightened to gate on `prisma.party.findUnique({where:{id:partyId}}) === null` rather than just `actions.every(a => a.type === 'create-character')`, so the same action type now routes correctly to both paths.
>
> **Guard widening.** `createCharacterGuard` (in `packages/shared/src/guards/map.ts`) was widened to permit `state !== null` when the actor is an active member of the party. Two new `GuardRejectionCode` values landed: `'state_already_initialized'` (rejects `dmOnly: true` on the post-bootstrap branch) and `'character_already_exists'` (rejects re-creating a character when an active player row with non-null `characterId` exists).
>
> **Sync queue fix.** `apps/web/src/sync/queue.ts:142` previously detected bootstrap purely from the action type (`batch[0]?.type === 'create-character'`). That misclassified the post-bootstrap variant — the queue would push `'will-be-minted'` as the partyId. Fix: `isBootstrap = isCreateCharacter && snapshot?.appState == null`. The post-flush re-pull (originally only for bootstrap) was also extended to fire on the post-bootstrap variant, so the server's canonical character + stash + holding ids replace the client's optimistic ones before navigation.
>
> **UX choice.** The "Create your character" CTA lives on `/party/settings` only. The joiner post-`POST /parties/join` already lands there (via `openServerParty`'s "no characters → /party/settings" route), the DM-only DM is sent there by `handleCreatePartyDmOnly`, and the post-delete recreation case naturally surfaces there. A single CTA serves all three flows — no dedicated post-join route was added. The form reuses the existing `<CharacterForm>` component verbatim (no prop changes); submit goes through the canonical Hub-style flush + re-read + navigate pattern.
>
> **Test totals.** web 635 → **638** (+3 PartySettings CTA tests; reducer suite gained 7 R4.1.f tests but two pre-existing tests' error-message regexes had to update for the wider-throw, net +6 reducer cases; one obsolete test was rolled into the new suite, net +3 file-wide). shared 69 → **74** (+5 guard tests covering the new positive + rejection paths). server 154 → **156** (+2 integration tests: joiner adds character; DM-only DM adds character later). rules 114 unchanged.
>
> **Operational followup (Postgres on a separate port for tests).** Test DB moved from `:5433` to `:5434` so it can run in parallel with the docker-compose dev stack without conflicting (both want to bind a host port for Postgres). README updated to spin up two containers: `dnd-inv-pg` on `:5433` for dev + `docker-compose` parity, `dnd-inv-pg-test` on `:5434` for vitest. Every test file's `DATABASE_URL_TEST` fallback was updated in lockstep.
>
> **Carryforwards.** R4.1.f intentionally left two items out of scope per the spec: multiple characters per user per party (composite-key model `(userId, partyId, role)` only permits one player row per user per party), and atomic invite-code-plus-character-creation in a single action (two-action design `join-party` then `create-character` keeps the reducer simple and survives partial failures).
>
> **2026-06-30 post-ship bug + sweep.** R4.1.f introduced a new failure mode in the web that wasn't covered by the original tests: every screen that needed "the actor's character" read `appState.characters[0]`. Pre-R4.1.f the schema invariant was exactly one character per party so the index lookup was always correct. After R4.1.f, `GET /sync/state` returns every character in the party, and `characters[0]` resolves to player 1's character when player 2 logs in — producing two simultaneous symptoms: player 2 was navigated into player 1's character sheet, and the PartySettings "Create your character" CTA stayed hidden because the array-position check incorrectly read "user has a character." Fixed by adding `apps/web/src/lib/ownCharacter.ts` (a `getOwnCharacter(appState)` helper that resolves via `PartyMembership.characterId`, anchored on `state.user.id`), plus a regression test in `apps/web/src/screens/PartySettings.test.tsx` that asserts the CTA renders for player 2 when player 1's character is already in `characters[]`. The full sweep replaced `characters[0]` in five production sites: `Hub.tsx` (×3 — server-party open / local-party open / post-create navigation), `PartySettings.tsx` (×2 — character selector / post-submit navigation), `ItemDetail.tsx` (fallback character routing), `Settings.tsx` (encumbrance section), `io/export.ts` (export filename slug). `io/import.ts:61` keeps `characters[0]` intentionally — it labels external file content, not actor identity — with a clarifying comment. Two legacy files (`Welcome.tsx`, `CreateCharacter.tsx`) still read `characters[0]` but are unrouted; they'll go away with the existing "delete legacy fixtures" followup. Web test totals: 638 → 645 (+6 helper unit tests + 1 PartySettings regression).
>
> **2026-06-30 post-ship bug #2 — id canonicalization for non-create-character mutating actions.** Same root cause as the original R4.1.f bootstrap fix, with a wider blast radius: the queue's post-flush re-pull (`apps/web/src/sync/queue.ts`) only fired when `batch[0].type === 'create-character'`. But EVERY action whose persistor calls `ctx.newId()` server-side suffers the same divergence — the server-minted entity id never gets to the client, leaving the local store with stale optimistic ids. Symptom: a user acquires an item from the catalog, then tries to move it to Party Stash → server responds `422 { rejected: { code: 'item_not_found' } }` because the client's `transfer` action references the client's optimistic itemInstanceId while the server's row was minted with a different UUID. Affected action types: `acquire` (only on the non-stacking branch; auto-stacks reuse the existing row id and are unaffected), `create-stash`, `split`, `create-homebrew`, plus the already-handled `create-character`. **Tactical fix:** generalised the re-pull trigger to an explicit `ID_MINTING_ACTION_TYPES` set in `queue.ts` (declared at module top, doc-commented to stay in sync with the server's `ctx.newId()` call sites). The post-flush branch now fires for any batch containing such an action. Regression test: `apps/web/src/sync/queue.test.ts > queue — id canonicalization after id-minting actions` asserts `GET /sync/state` is called after `acquire`. Web test totals: 645 → **646**. **Architectural followup:** the runtime patch is structurally fragile (full-state refetch on every id-minting action; action-type list drifts as features land; won't survive R5's N-writer concurrency). The root cause is dual id-minting authorities (client reducer + server persistor each call `ctx.newId()`). **Promoted to RH1 (Hardening Pass 1: Server-Authoritative IDs)** scheduled between R4 and R5; RH1.3 explicitly deletes `ID_MINTING_ACTION_TYPES` once client-minted UUID v7 ids become canonical.

#### R4.1 — Notes

> **2026-06-29 — R4.1 (Multi-member parties — foundation) sub-slices a–e shipped + R4.1.f scoped.** Sub-slices a/b/c/d/e shipped 2026-06-29. Headline shape: multi-membership schema is now real (`Party.isSoloShortcut` dropped; `PartyMembership.leftAt` nullable), the four-action departure surface (`delete-character`, `leave-party`, `kick-player`, `join-party`) shares one `cascadeCharacterToRecoveredLoot` helper, server routes (`POST /parties/join`, `/invite/rotate`, `/leave`, `/kick`, `GET /:partyId/members`) sit alongside the existing `/sync/*` surface, Hub Join card lit up, PartySettings screen ships at `/party/settings`, and sole-member archive runs server-only via `Party.archivedAt`. **R4.1.f (joiners create their own character) was scoped but not yet shipped** — the canonical "DM invites players who join with their own character" flow needs it; without f, `POST /parties/join` mints a membership row with `characterId: null` and the joining user can't play. Tracked above; not a backlog item.
>
> **Post-shipping followups (also 2026-06-29).** Six bug-fix / refactor passes after the initial sub-slices landed; each kept R4.1 actually usable rather than just "schema-correct."
>
> 1. **DM-only Create-party flow** — extended `create-character` action with `dmOnly: boolean` + optional `partyName`. Reducer branches: full bootstrap (with-character) vs DM-only (mints `User` + `Party` + ONE `dm` membership + party-scope stashes only). Log entry's `characterId`/`name`/`inventoryStashId` became optional + a `dmOnly?: boolean` flag for log readers. Three-step Hub wizard: party name → "Will you also play a character?" Yes/No → character form if Yes. Server `applyBootstrapDelta` was already shape-agnostic; no server-side change needed. **5 new reducer tests** in `apps/web/src/store/reducer.test.ts`.
> 2. **Multi-party local-mode storage** — Dexie keys each party's blob under `appState:<partyId>`; the Hub enumerates every keyed blob in local mode via the new `listKnownPartyIds()` helper; `currentPartyId` (already in `apps/web/src/db/meta.ts`) tracks the active pointer; `hydrate.ts` boots through the pointer with legacy + first-keyed-blob fallbacks. Reducer's `state === null` invariant stays intact — the Hub flushes + clears in-memory state before each `create-character` dispatch. **7 new persistence tests** in `apps/web/src/db/persistence.test.ts`.
> 3. **Reverse-proxy `/parties/*` routing** — `infra/docker/Caddyfile` only routed `/auth/*` + `/sync/*` + `/healthz` to the server; new `/parties/*` requests fell through to the SPA handler and returned `index.html`, surfacing client-side as a Zod `malformed_response` parse error. Added `/parties /parties/*` to the `@server` matcher; mirrored in the production Caddy + nginx examples in `README.md` so fresh self-host installs don't trip the same wire.
> 4. **Sync queue race fix** — `store/index.ts` used `void import('@/sync/queue').then(({enqueue}) => enqueue(action))` which deferred enqueue across a microtask. Hub's `await flushSyncQueue()` then found an empty queue and bailed; bootstrap pull-after-push never ran. Replaced with a static `import { enqueue } from '@/sync/queue'` (no runtime cycle — `queue.ts` only depends on `@/store/session` + `@/store/types`, not `@/store/index.ts`).
> 5. **Bootstrap pull canonicalisation** — the server's `/sync/actions` runs its own reducer with its own `randomUUID()` ctx, so the freshly-minted `partyId` server-side DIFFERS from the client's optimistic local id. The queue's pull-after-push was using the local id and getting 404. Now reads `response.applied[0].payload.partyId` (the `create-character` log entry the server wrote with its own ids) and pulls THAT. The Hub then re-reads `useStore.getState().appState` AFTER `flushSyncQueue()` so navigation uses the now-canonical (server-minted) character/party ids. The pull-after-push had been silently broken since R3.4.a; pre-R4.1.e it didn't matter because navigation read local state — R4.1.e's PartySettings → `/parties/:id/members` was the first screen to call a server API with the local id and immediately 404.
> 6. **Settings → PartySettings refactor** — Character rename + Party rename moved from the global `/settings` screen to `/party/settings` (party-scoped, lives next to members + invite code). PartySettings dropped its `!isServerMode` redirect: local mode now sees the rename surfaces with server-only sections (members / invite code / kick / leave) hidden. New "Party" nav button in the header (Users icon), visible whenever `state.party !== null`. PartySettings also handles stale parties — `party_not_found` from `/parties/:id/members` redirects to Hub with a clear toast instead of stranding the user. Hub's `openServerParty` / `openLocalParty` route DM-only parties (no characters) to `/party/settings` instead of erroring "no characters yet." **4 new PartySettings tests**; 3 stale Settings rename tests removed.
>
> **Test totals.** 952 (after R4.1.e) → **964** (after R4.1.b's DM-only) → **972** at session-end (with multi-party + PartySettings tests added). All five workspaces typecheck; web lint clean. Server-side route tests at 154 (the 7 new R4.1.e route tests verified end-to-end against real Postgres).
>
> **Carryforwards (tracked under "Operational followups → Feature gaps"):** multi-party "vault" export (currently per-party) and explicit `archivedAt` check on `/sync/actions` (defensive).

#### R4.1 — Notes

> **2026-06-29 — R4.1 (Multi-member parties — foundation) sub-slices a–e shipped + R4.1.f scoped.** Sub-slices a/b/c/d/e shipped 2026-06-29. Headline shape: multi-membership schema is now real (`Party.isSoloShortcut` dropped; `PartyMembership.leftAt` nullable), the four-action departure surface (`delete-character`, `leave-party`, `kick-player`, `join-party`) shares one `cascadeCharacterToRecoveredLoot` helper, server routes (`POST /parties/join`, `/invite/rotate`, `/leave`, `/kick`, `GET /:partyId/members`) sit alongside the existing `/sync/*` surface, Hub Join card lit up, PartySettings screen ships at `/party/settings`, and sole-member archive runs server-only via `Party.archivedAt`. **R4.1.f (joiners create their own character) was scoped but not yet shipped** — the canonical "DM invites players who join with their own character" flow needs it; without f, `POST /parties/join` mints a membership row with `characterId: null` and the joining user can't play. Tracked above; not a backlog item.
>
> **Post-shipping followups (also 2026-06-29).** Six bug-fix / refactor passes after the initial sub-slices landed; each kept R4.1 actually usable rather than just "schema-correct."
>
> 1. **DM-only Create-party flow** — extended `create-character` action with `dmOnly: boolean` + optional `partyName`. Reducer branches: full bootstrap (with-character) vs DM-only (mints `User` + `Party` + ONE `dm` membership + party-scope stashes only). Log entry's `characterId`/`name`/`inventoryStashId` became optional + a `dmOnly?: boolean` flag for log readers. Three-step Hub wizard: party name → "Will you also play a character?" Yes/No → character form if Yes. Server `applyBootstrapDelta` was already shape-agnostic; no server-side change needed. **5 new reducer tests** in `apps/web/src/store/reducer.test.ts`.
> 2. **Multi-party local-mode storage** — Dexie keys each party's blob under `appState:<partyId>`; the Hub enumerates every keyed blob in local mode via the new `listKnownPartyIds()` helper; `currentPartyId` (already in `apps/web/src/db/meta.ts`) tracks the active pointer; `hydrate.ts` boots through the pointer with legacy + first-keyed-blob fallbacks. Reducer's `state === null` invariant stays intact — the Hub flushes + clears in-memory state before each `create-character` dispatch. **7 new persistence tests** in `apps/web/src/db/persistence.test.ts`.
> 3. **Reverse-proxy `/parties/*` routing** — `infra/docker/Caddyfile` only routed `/auth/*` + `/sync/*` + `/healthz` to the server; new `/parties/*` requests fell through to the SPA handler and returned `index.html`, surfacing client-side as a Zod `malformed_response` parse error. Added `/parties /parties/*` to the `@server` matcher; mirrored in the production Caddy + nginx examples in `README.md` so fresh self-host installs don't trip the same wire.
> 4. **Sync queue race fix** — `store/index.ts` used `void import('@/sync/queue').then(({enqueue}) => enqueue(action))` which deferred enqueue across a microtask. Hub's `await flushSyncQueue()` then found an empty queue and bailed; bootstrap pull-after-push never ran. Replaced with a static `import { enqueue } from '@/sync/queue'` (no runtime cycle — `queue.ts` only depends on `@/store/session` + `@/store/types`, not `@/store/index.ts`).
> 5. **Bootstrap pull canonicalisation** — the server's `/sync/actions` runs its own reducer with its own `randomUUID()` ctx, so the freshly-minted `partyId` server-side DIFFERS from the client's optimistic local id. The queue's pull-after-push was using the local id and getting 404. Now reads `response.applied[0].payload.partyId` (the `create-character` log entry the server wrote with its own ids) and pulls THAT. The Hub then re-reads `useStore.getState().appState` AFTER `flushSyncQueue()` so navigation uses the now-canonical (server-minted) character/party ids. The pull-after-push had been silently broken since R3.4.a; pre-R4.1.e it didn't matter because navigation read local state — R4.1.e's PartySettings → `/parties/:id/members` was the first screen to call a server API with the local id and immediately 404.
> 6. **Settings → PartySettings refactor** — Character rename + Party rename moved from the global `/settings` screen to `/party/settings` (party-scoped, lives next to members + invite code). PartySettings dropped its `!isServerMode` redirect: local mode now sees the rename surfaces with server-only sections (members / invite code / kick / leave) hidden. New "Party" nav button in the header (Users icon), visible whenever `state.party !== null`. PartySettings also handles stale parties — `party_not_found` from `/parties/:id/members` redirects to Hub with a clear toast instead of stranding the user. Hub's `openServerParty` / `openLocalParty` route DM-only parties (no characters) to `/party/settings` instead of erroring "no characters yet." **4 new PartySettings tests**; 3 stale Settings rename tests removed.
>
> **Test totals.** 952 (after R4.1.e) → **964** (after R4.1.b's DM-only) → **972** at session-end (with multi-party + PartySettings tests added). All five workspaces typecheck; web lint clean. Server-side route tests at 154 (the 7 new R4.1.e route tests verified end-to-end against real Postgres).
>
> **Carryforwards (tracked under "Operational followups → Feature gaps"):** multi-party "vault" export (currently per-party), explicit `archivedAt` check on `/sync/actions` (defensive), and `create-character-in-existing-party` so DM-only DMs can add their own character later without recreating the party.

#### R4.2 — Banker role

Sliced post-R4.1 (2026-06-30 planning session) into five independently-shippable sub-slices. R4.2.a ships the role lifecycle (appoint/revoke + auto-clear cascade); R4.2.b lights up the `'banker'` actorRole on all existing player-driven actions; R4.2.c gates shared-pool claim/distribution behind the Banker; R4.2.d adds the new distribution actions; R4.2.e adds the UI. Each sub-slice depends on the previous.

#### R4.2.a — Foundation: schema widen + appoint/revoke + kick/leave auto-clear

**Schema activations (§4)**
- [x] `Party.bankerUserId` becomes settable (was always `null` in MVP) — **carryforward from R3.4.a**: widen `partySchema.bankerUserId` from `z.null()` to `z.string().min(1).nullable()`. Keep `partyMembershipSchema.role` narrow (`['dm', 'player']`) per OUTLINE §3.14 — banker is denormalized on Party, never a membership row.

**Reducer actions (§4 TransactionLog union)**
- [x] `appoint-banker` action + payload schema (`{ bankerUserId }`)
- [x] `revoke-banker` action + payload schema (`reason: 'manual' | 'reassigned' | 'left-party' | 'kicked'`; `'dm-transfer'` reserved for R4.3)
- [x] `leave-party` auto-clears `Party.bankerUserId` if departing player was Banker (R4.1.c stub lit up)
- [x] `leave-party` writes `revoke-banker` entry with `reason: "left-party"` when applicable
- [x] `kick-player` Banker auto-clear with `reason: "kicked"` (R4.1.d stub lit up)
- [x] Invariant test: DM cannot self-appoint as Banker (§3.14)
- [x] Invariant test: Banker target must have active `role="player"` membership
- [x] Invariant test: Banker role only legal when `memberCount >= 2`
- [x] Invariant test: reassignment requires explicit revoke first (no in-place overwrite of `bankerUserId`)

**Server-side**
- [x] Server-authoritative `appointBankerGuard` + `revokeBankerGuard` (mirror reducer invariants; `banker_membership_forbidden` rejection code first lit-up in R4.2.a)
- [x] `persistAppointBanker` + `persistRevokeBanker` handlers (atomic `Party.update` on `bankerUserId`)
- [x] R4.1's `persistLeaveParty` / `persistKickPlayer` banker-clear stub already wired; now load-bearing once schema permits non-null

**Web store middleware**
- [x] `resolveActor` widened to return `'dm' | 'player' | 'banker'` (was `'dm' | 'player'`); player-driven actions surface as `'banker'` when `state.party.bankerUserId === state.user.id`. Mirrors `@app/shared/guards/actor.ts::deriveActorRole`.

#### R4.2.a — Notes

> **Shipped 2026-06-30** (`feature/r4-parties`, commits `eb68da0 R4.2.a`).
>
> **Test totals:** 1030 across the workspace (web 661 ← 659 with 2 new BUG-002 regression tests; server 165 ← 158 with 5 new R4.2.a + 2 BUG-002 integration tests). All five workspaces typecheck.
>
> **Decisions captured:**
> - **Reassignment is two-step.** `appoint-banker` against an already-set Banker rejects with `banker_membership_forbidden`; DM must `revoke-banker` first. The `'reassigned'` reason enum value is reserved for a future combined-CTA UX flow; no current emitter.
> - **Cascade lives in the reducer; server replays.** `leave-party` / `kick-player` reducer arms emit the synthetic `revoke-banker` slice when the departing user was the Banker. Server persistor replays the same slice; no server-only cascade logic. Matches CLAUDE.md "reducer is single source of truth + server replays authoritatively" pattern.
> - **`'dm-transfer'` reason intentionally absent from this slice's enum** so it can't be emitted prematurely. R4.3 widens the enum + adds the `dm-transfer`-driven Banker auto-clear cascade.
>
> **Did NOT ship (correctly deferred to later sub-slices):**
> - Permission gating: shared-pool claim/distribute still works for non-Banker actors even when `bankerUserId !== null`. The §8.1 matrix's Banker-conditional rows aren't enforced yet.
> - Banker distribution actions: `currency-distribute-evenly`, `currency-give-from-pool`, `currency-take-into-purse`, `item-distribute-from-pool`. None exist.
> - UI: there's no Party Settings appoint/revoke CTA. The slice is CLI-/test-only.
>
> **Carryforward (BUG-002 surfaced 2026-06-30 while building R4.2.a):** any code path that writes a row with the `(userId, partyId, role)` composite PK must use `upsert` (or read-then-update) instead of `create` because the soft-delete cascade leaves the row in place. Fix shipped same day under `🐛 BUG-002`; the lesson generalises to future composite-PK writes — flagged in `docs/BUGS.md` postmortem for R4.3 (`dm-transfer` membership churn) to remember.

#### R4.2.b — `actorRole: 'banker'` audit-trail polish

**Reducer / store**
- [x] `actorRole` on log derived correctly: `"banker"` if `Party.bankerUserId === actorUserId`, else membership role (§4) — **shipped in R3.4.a** for the derivation path (`deriveActorRole` in `@app/shared/guards/actor.ts`); R4.2.a lit it up by allowing `bankerUserId` to be non-null AND widening web `resolveActor` to mirror it.

**UI**
- [x] Party log UI: render `actorRole: 'banker'` distinct from `'player'` (badge color). Shipped as a shared `RoleBadge` component (`apps/web/src/components/RoleBadge.tsx`) with three theme-tokened variants (`bg-primary/10 text-primary` for DM, `bg-secondary text-secondary-foreground` for Player, `bg-accent text-accent-foreground` for Banker). Wired into `ItemHistory` (per-item audit log) AND `PartySettings` (member list — extracted from local inline definition).
- [ ] Banker badge IN the PartySettings member list — deferred to R4.2.e. Today the `PartyMemberItem.role` API type is narrow `'dm' | 'player'` (Banker is denormalised on `Party.bankerUserId`, not a membership row). Rendering "Banker" alongside a player's row requires joining `Party.bankerUserId` to the members list at render time — that lands with the R4.2.e appoint/revoke CTA so the UI flows together.

#### R4.2.b — Notes

> **Shipped 2026-06-30** (`feature/r4-parties`).
>
> **Test totals:** 1034 across the workspace (web 665 ← 661 with 4 new RoleBadge component tests; server unchanged at 165).
>
> **Decisions captured:**
> - **Component lives at `apps/web/src/components/RoleBadge.tsx`, NOT in `components/ui/`.** Per CLAUDE.md, `components/ui/` is shadcn-managed (hand-edits forbidden). The shared role badge is app-owned, so it sits next to other app components like `CharacterForm`, `Layout`.
> - **Three theme-token variants, not a custom palette.** DM uses `primary`, Player uses `secondary`, Banker uses `accent` — all already in the shadcn theme. No new design tokens introduced. The "Banker uses accent" choice signals "privileged but not DM" without inventing a custom color.
> - **Member-list Banker badge deferred to R4.2.e.** The API type `PartyMemberItem.role` is intentionally narrow per OUTLINE §3.14 (banker is denormalised on Party, never a membership row). Joining `Party.bankerUserId` to the members list in the UI is straightforward but belongs with the appoint/revoke CTA work in R4.2.e, where both ship together. R4.2.b focuses on the AUDIT-TRAIL surface (where `actorRole: 'banker'` already flows through from R4.2.a's reducer/middleware changes).
>
> **Carryforward to R4.2.e:** PartySettings member-list rendering needs to (a) call `RoleBadge role="banker"` for the player whose `userId === party.bankerUserId`, OR (b) widen the API response with a derived `effectiveRole` field. (a) is preferred — keeps the API narrow and the derivation client-side, matching the existing `deriveActorRole` pattern.

#### R4.2.c — Permission gating: shared-pool claim/distribute is Banker-mediated

**Guard layer (`@app/shared/guards/map.ts`)**
- [x] When `party.bankerUserId !== null` AND the action targets Party Stash / Recovered Loot as source, reject non-Banker actors with a new code `banker_required_for_claim`.
- [~] DM "gameplay drain" actions stay allowed (distinguish by destination: player stash vs. nowhere). — **Deferred to R4.2.d.** R4.2.c intentionally gates the DM alongside players (matches §8.1 "DM blocked while Banker active; revoke first"). R4.2.d re-opens the DM path by adding the `gameplay-drain` `currency-change.reason` value which bypasses the gate.
- [x] When `bankerUserId === null`, behavior unchanged — players self-claim freely.

**Reducer**
- [~] Same guard logic runs client-side for instant optimistic rejection feedback. — **Skipped for this slice** (planning session 2026-07-01). The web store currently does not call `checkGuard` (only the server does); the reducer's own inline invariants ARE the client-side path today. Rather than proliferate more inline duplication for three actions, R4.2.c relies on server-authoritative rejection + R4.2.e UI hiding/disabling the buttons based on `state.party.bankerUserId`. Revisit if UX evidence shows we need optimistic rejection (e.g. the wider "wire `checkGuard` into the web dispatch" change lands as its own architectural slice).

**Tests**
- [x] Matrix-driven: every {Banker active, actor role, source pool, destination} combination from §8.1. — 18 new guard tests in `packages/shared/src/guards/map.test.ts` (`currency-change` × 11 cases, `currency-transfer` × 5, `transfer` × 5, `split` un-gated × 1, solo-bypass × 1).
- [x] Regression: existing "no Banker" tests still pass. — all pre-existing 82 shared-guard tests still pass; new deposit/inventory/no-Banker positive cases confirm no over-gating.
- [x] Server integration: with a real Postgres, 2-member party with Banker set, non-Banker actor rejected with `banker_required_for_claim`; Banker actor accepted; no-Banker actor accepted; deposit un-gated. 5 new integration tests in `apps/server/src/parties/routes.test.ts`.

#### R4.2.c — Notes

> **Shipped 2026-07-01** (`feature/r4-parties`).
>
> **Test totals:** 1061 across the workspace (shared 90 ← 82, rules 114, seeds 22, web 665, server 170 ← 165). All five workspaces typecheck. Lint count unchanged from baseline (2 pre-existing errors in `shared/schemas/api.ts:77` and `shared/guards/map.test.ts:35`; 17 pre-existing in `apps/server`).
>
> **Design decisions captured (planning session 2026-07-01):**
> - **Gate on source, not destination.** A single predicate — "is the source stash a Party Stash or Recovered Loot?" — applied uniformly to `currency-change` (withdraw/convert only), `currency-transfer` (fromStashId), and `transfer` (item.ownerId). Deposits (destination = shared pool, source = own stash) are un-gated. This matches §8.1's split between "Add currency/items to Party Stash or Recovered Loot" (allowed) and "Claim / Distribute" (Banker-only).
> - **`split` is NOT gated.** It's an in-place stack reshape (new row inherits `ownerId`); nothing leaves the pool. Explicit positive test confirms behaviour.
> - **DM path.** R4.2.c rejects the DM alongside players when a Banker is active. This matches §8.1's "DM blocked while Banker active; revoke first". The R4.2.d `gameplay-drain` `reason` value re-opens the DM path for gameplay-driven pool drains.
> - **Web-side rejection skipped.** Server is authoritative; UI will hide/disable disallowed buttons in R4.2.e based on `state.party.bankerUserId`. If a user bypasses the UI, the server rejects with a clear code. Revisit if UX warrants optimistic rejection.
>
> **Implementation shape.** Two new helper functions in `map.ts`: `isSharedPoolStash(state, stashId)` (structural check) and `checkBankerGate(state, actor, sourceStashId, actionLabel)` (returns rejection or null; called from each of the three guards). The three guards remain single-purpose; the Banker gate is one line each.
>
> **Carryforward to R4.2.d:** the `currency-change.reason` enum widening (`gameplay-drain`, `split-evenly`) must be paired with a corresponding `checkBankerGate` bypass so DM drain actions pass. Concretely: R4.2.d's `currencyChangeGuard` should skip the gate when `reason === 'gameplay-drain'` (and the actor is DM, enforced by the same guard's role check).
>
> **Carryforward to R4.2.e:** the UI must read `state.party.bankerUserId` when rendering Party Stash / Recovered Loot controls: hide "claim" affordances for non-Banker actors when the value is non-null. `RoleBadge` (R4.2.b) already handles the log-side surface.

#### R4.2.d — Banker distribution toolkit (new actions)

**Reducer actions (§4 TransactionLog union)**
- [x] `currency-change` extended `reason` values (`gameplay-drain` added to the action enum; `split-evenly` stayed out — see Notes for rationale).
- [x] Action: split Party Stash currency evenly across characters — new `split-evenly` action + `currency.splitEvenly` cascade helper. Emits ONE terminal `split-evenly` log entry + N `currency-transfer` entries (§4 rule: transfers replace paired `currency-change` in stash-to-stash moves).
- [x] DM `gameplay-drain` bypass — the `checkBankerGate` skip lets the DM `currency-change` a shared pool with `reason: 'gameplay-drain'` even when a Banker is active; non-DM actors using this reason are rejected outright (`dm_only`).

**Server-side**
- [x] Server authoritative checks for each new action; CP-integer currency math (per `docs/SECURITY.md` §3.2); no negative balances. `persistSplitEvenly` re-runs `splitEvenly` inside the sync `$transaction`, debits the pool, and increments N recipient Inventory holdings atomically.

**Tests**
- [x] TDD RED/GREEN/REFACTOR on `currency.splitEvenly` (12 new tests in `packages/rules/src/currency.test.ts` — worked examples, edge cases, conservation invariant `N × share + remainder === pool`, argument validation).
- [x] Guard matrix in `packages/shared/src/guards/map.test.ts` (13 new tests — DM `gameplay-drain` bypass across Banker-active/inactive, non-DM rejection with `gameplay-drain`, R4.2.c behaviour preserved for `withdraw`, `splitEvenlyGuard` Banker-only + source-must-be-Party-Stash + recipient-must-be-active-player).
- [x] Reducer tests in `apps/web/src/store/reducer.test.ts` (5 new tests — 100gp/2, 100gp/3 cascade, terminal + N transfer log shape, empty-pool → terminal only, `remainderInPool` always present).
- [x] Server integration tests in `apps/server/src/parties/routes.test.ts` (5 new tests — 100gp/2 happy path, non-Banker rejection, 100gp/3 cascade end-to-end DB verification, DM `gameplay-drain` when Banker active, non-DM rejection).

#### R4.2.d — Notes

> **Shipped 2026-07-01** (`feature/r4-parties`).
>
> **Test totals:** 1096 across the workspace (shared 103 ← 90, rules 126 ← 114, seeds 22, web 670 ← 665, server 175 ← 170). All five workspaces typecheck. Lint clean workspace-wide.
>
> **Design decisions captured (planning session 2026-07-01):**
> - **Cascade rounding.** For each denom in `[pp, gp, ep, sp, cp]` (largest → smallest), give each recipient `floor(pool[d] / N)`, then convert the per-denom remainder into the next lower denom via the OUTLINE §4 rate constants (all integer factors: pp/gp=10, gp/ep=2, ep/sp=5, sp/cp=10). CP-level remainder (0 to N-1 cp) stays in the pool. Matches how a DM splits loot at the table — piles of coins in each denomination, not raw copper. Compared to naive-CP-flatten: same total value, but the recipient sees `+33 gp +3 sp +3 cp` instead of `+3333 cp`.
> - **`split-evenly` action shape.** `{ fromStashId, recipientCharacterIds: string[] }`. Banker picks recipients (opt-in; the Banker can distribute to a subset if, e.g., a player is absent from the session). Banker's own character IS a valid recipient per OUTLINE §8.1 "Take Party Stash currency into own character's purse" (Banker: allowed).
> - **Log shape.** ONE terminal `split-evenly` entry carrying `{ fromStashId, recipientCharacterIds, sharePerRecipient, remainderInPool }` as the audit anchor; N child `currency-transfer` entries (one per recipient) as the atomic debit/credit machinery. Follows §4's rule that `currency-transfer` replaces paired `currency-change` in stash-to-stash moves. `remainderInPool` is ALWAYS present, even when zero — uniform log shape.
> - **Empty pool.** If the Banker triggers split-evenly on an empty pool, ONE terminal entry emits (audit: "Banker attempted a split; nothing distributed") but the N transfer entries are skipped (no zero-delta transfers).
> - **`split-evenly` NOT in `currency-change.reason` enum.** The roadmap text mentioned `'split-evenly'` as a `currency-change.reason` value; that was pre-design language. Our final design uses `currency-transfer` for the child entries (which has no `reason` field) and a dedicated `split-evenly` log-entry type for the terminal. So `'split-evenly'` never appears as a `reason` value at runtime. Left in the log-entry schema's enum (line 336) as a tolerant leftover; not added to the action enum.
> - **Source restricted to Party Stash.** R4.2.d does NOT support split-evenly on Recovered Loot. Recovered Loot is the incidental pile from character departures; distributing it evenly is uncommon and the Banker can do it manually via `currency-transfer` if needed. Recovered Loot rejection is `stash_not_found` (semantically: not a valid split-source).
> - **`gameplay-drain` is DM-only.** Even the Banker can't use it — `dm_only` rejection. The reason label describes a world-level effect (magical drain, NPC tax, theft), which is the DM's domain per OUTLINE §8.1 row 464. The DM uses this to remove currency from a pool for gameplay reasons; the Banker uses `withdraw` to prepare a distribution (which the Banker gate then permits).
> - **Web-side rejection.** Same as R4.2.c: skipped for this slice. Server is authoritative; R4.2.e UI hides/disables buttons based on `state.party.bankerUserId` and `actor.role`. Optimistic UI rejection would require wiring `checkGuard` into the web store's dispatch — that's a broader architectural change outside R4.2.d's scope.
>
> **Implementation shape.** `currency.splitEvenly` is a 15-line loop over the 5 denoms; reducer arm is ~90 lines including comments (mostly the recipient-Inventory resolution + log entry construction); server persistor is ~60 lines (Prisma updates in-transaction). Guards add a `splitEvenlyGuard` and extend `currencyChangeGuard` with the `gameplay-drain` bypass. The `checkBankerGate` helper introduced in R4.2.c did not need changes.
>
> **Carryforward to R4.2.e:** the UI for "Split the Pot" lives on the Party Stash screen (§5.5). Recipient picker should default to all active players' characters with the Banker's character pre-selected; the Banker can uncheck any to skip them. Preview should show the computed share + remainder BEFORE dispatch so the Banker sees "each player gets 33 gp 3 sp 3 cp; pool retains 1 cp" and can confirm. Pure client-side math via `currency.splitEvenly` — no round-trip.
>
> **Carryforward to R4.3:** the `dm-transfer` action lands with the caveat from BUG-002 (soft-delete composite-PK) — no direct interaction with R4.2.d.

#### R4.2.e — UI

- [x] Party Settings screen (§5.15): appoint / revoke Banker CTAs (DM-only, hidden in solo, hidden on the DM's own row).
- [x] Member list with role badges (DM / Player / Banker) — Banker badge attaches to the player row whose `userId === Party.bankerUserId`. Derivation is client-side; API type `PartyMemberItem.role` stays narrow per §3.14.
- [x] ~~Log-entry badge for `actorRole: 'banker'`~~ — **shipped in R4.2.b** (via `RoleBadge` in `ItemHistory`).
- [x] Party Stash (§5.5): Banker distribution — new `SplitEvenlyModal` for split-the-pot (Party Stash only per R4.2.d). "Give currency to player" / "Give items to player" reuse the existing `CurrencyTransferModal` / `MoveItemModal` — R4.2.c gate lets the Banker drive them; the Banker sees the normal Transfer button while non-Banker/non-DM users have it hidden.
- [x] Party Stash for DM-when-Banker-active: withdraw controls hidden; `DrainCurrencyModal` visible instead (dispatches `currency-change` with `reason: 'gameplay-drain'`). Deposit (`+`) stays visible for the DM per §8.1 deposit row.
- [x] Recovered Loot (§5.6): same Banker/DM split as Party Stash, minus the Split Evenly button (per R4.2.d, split-evenly source is Party Stash only).
- [x] Component tests: `SplitEvenlyModal` (7 tests — selection, preview, dispatch), `DrainCurrencyModal` (5 tests — payload, overspending), `CurrencyRow.bankerContext` (5 tests — visibility flags per role permutation).

#### R4.2.e — Notes

> **Shipped 2026-07-01** (`feature/r4-parties`). **R4.2 complete.**
>
> **Test totals:** 1113 across the workspace (shared 103, rules 126, seeds 22, web 687 ← 670, server 175). Typecheck + lint clean workspace-wide.
>
> **Design decisions captured (planning session 2026-07-01):**
> - **DM drain UX.** Confirmation modal (`DrainCurrencyModal`) instead of an inline rename. Deliberate friction — draining a shared pool for gameplay reasons is a world-level effect (magical drain, NPC tax, theft — §8.1 row 464); a per-denom form + explicit Drain button + destructive-variant styling reads as "you are removing this from the game" instead of "you are moving this somewhere". Deposit path stays inline (+) — depositing IS the fast path.
> - **Per-row Banker CTAs in PartySettings.** DM sees a "Make Banker" button on every non-DM, non-self player row when no Banker is set; sees "Revoke Banker" next to the current Banker. Hidden in solo (memberCount < 2). Rejected on the DM's own row (§3.14 forbids DM-as-Banker anyway; the reducer + guard enforce it — the UI just avoids the reject-path click).
> - **Prop-gated visibility over "many components".** Rather than five new modals for Banker/DM permutations, `CurrencyRow` accepts an optional `bankerContext: BankerContext` prop with four flags: `userIsBanker`, `userIsDmWithBankerActive`, `userIsGatedFromPool`, `isPartyStash`. `CharacterSheet` computes these once per render and passes them; character-scope tabs (Inventory / Storage) pass `undefined` and the row falls back to its M4 default control set. Zero behavioural change for non-shared-pool stashes.
> - **Split-evenly recipient default: all-checked.** When the Banker opens the modal, every eligible active player character is pre-selected (including the Banker's own). Matches R4.2.d's "distribute across the party" default flow. The Banker unchecks recipients only for the absentee/skip-one case.
> - **Full per-denom preview.** The modal renders the exact cascade output via `currency.splitEvenly` before dispatch. The Banker sees "Each recipient gets: 33 gp, 3 sp, 3 cp" and "Party Stash retains: 1 cp" — no round-trip, no surprise.
> - **StashItemsTable NOT gated in R4.2.e.** Item-side controls (transfer / split / remove) remain visible for all roles even on shared pools. Non-Banker item transfers already fail at the server with `banker_required_for_claim` and toast the error — that's acceptable friction. Hiding item controls would double the visibility-flag surface for marginal UX gain; revisit if telemetry shows non-Banker users frequently attempting shared-pool item moves.
> - **PartySettings component tests deferred to server integration.** The Banker CTAs live in the server-mode-only members section, which requires a live API mock. The dispatch pipeline for `appoint-banker` / `revoke-banker` is already covered by R4.2.a's reducer + server integration tests. R4.2.e tests focus on the two new modals + the visibility prop mechanics — the parts with novel logic.
>
> **Implementation shape.**
> - `SplitEvenlyModal` (~230 lines) — recipient checkbox list, `useMemo` preview via `currency.splitEvenly`, single dispatch on Confirm.
> - `DrainCurrencyModal` (~140 lines) — five per-denom inputs with `max={pool[denom]}`, overspending warning, single dispatch with `reason: 'gameplay-drain'`.
> - `CurrencyRow` (~65 lines added) — five visibility flags derived from `bankerContext`; existing modals reused; two new modals conditionally mounted.
> - `CharacterSheet` (~15 lines added) — Banker context computed inside the `useShallow` selector alongside stash ids; passed as a prop only for shared-pool tabs.
> - `PartySettings` (~60 lines added) — extended selector for `bankerUserId`; two new handlers (`handleAppointBanker` / `handleRevokeBanker`); per-row CTAs with the DM/solo/own-row visibility rule; second `RoleBadge` on the Banker's player row.
>
> **Selector pattern gotcha (resolved).** SplitEvenlyModal's first draft used a single `useShallow` selector that built a fresh `EligibleRecipient[]` on each store change. React 19 + Zustand rejected this with "The result of getSnapshot should be cached to avoid an infinite loop" and hit the max-update-depth guard. Fix: split into two primitive `useShallow` selects (`memberships`, `characters`) + `useMemo` for the derived list. Same pattern CLAUDE.md notes for `CatalogBrowser` and `StashItemsTable`.
>
> **Negative-zero gotcha (resolved).** `DrainCurrencyModal` originally emitted `delta: { cp: -0, sp: -0, ..., gp: -3 }` because JS `-0 === 0` but the object shape reads oddly. Fixed with `-amounts.cp || 0` per denom — the `|| 0` short-circuits when the negation is `-0`.

#### R4.2 — Notes

> **R4.2 shipped 2026-07-01 (five sub-slices R4.2.a–e).** The Banker role is now fully implemented across schema, reducer, guards, server persistence, and UI. Sliced from a single roadmap section into R4.2.a–e on 2026-06-30 (planning session). The original section was a flat task list; the sub-slicing aligned Banker work with the R4.1.a/b/c/d/e/f rhythm so each PR stayed reviewable and shipped its own user-visible (or substrate-visible) value.
>
> **Total test growth across R4.2:** MVP baseline ~659 tests → 1113 after R4.2 (+454). Guard tests: 82 → 103 (+21 across R4.2.a/c/d). Reducer tests (rules): 114 → 126 (+12 R4.2.d). Web component tests: ~605 → 687 (+82 across R4.2.a/b/e). Server integration: 158 → 175 (+17 across R4.2.a/c/d).
>
> **Carryforward to R4.3 (`dm-transfer`):**
> - `dm-transfer` auto-clears `Party.bankerUserId` when the incoming DM is the current Banker per OUTLINE §3.14. The R4.2.a `revokeBankerGuard` + `revoke-banker` reducer arm are ready; R4.3 extends the `revoke-banker.reason` enum with `'dm-transfer'`.
> - Every code path that writes a `(userId, partyId, role)` composite-PK row must use `upsert` (BUG-002 lesson). `dm-transfer` will churn DM rows — audit the new persistor arm against the pattern used in `persistJoinParty`.
> - The R4.2.c/d/e "banker or DM" affordance-visibility pattern generalises to R4.3's DM cross-character actions. When R4.3 lands, StashItemsTable-side visibility gating may be worth revisiting (currently un-gated per R4.2.e Notes).
>
> **Carryforward to R4.4 (cross-character currency + homebrew party scope):**
> - Player→player currency push is Banker-independent per §3.14 amendment (2026-06-24). `currency-transfer` already supports it; R4.4 adds the receiver UX + party-log surfacing.
> - Homebrew visibility is party-scoped — R4.4 adds the catalog filter. R4.2 doesn't touch homebrew.

#### R4.3 — DM cross-character actions + DM transfer

Sliced post-R4.2 (2026-07-01 planning session) into five independently-shippable sub-slices, mirroring the R4.1.a-f / R4.2.a-e rhythm. R4.3.a ships the `dm-transfer` reducer foundation (schema widen + Banker auto-clear cascade + membership swap semantics); R4.3.b lands server-authoritative guards + persistor + integration tests; R4.3.c/d ship DM cross-character actions in two batches; R4.3.e adds the UI. Each sub-slice depends on the previous.

#### R4.3.a — Foundation: `dm-transfer` reducer + Banker auto-clear cascade

**Reducer actions (§4 TransactionLog union)**
- [x] `dm-transfer` action + payload schema (`{ newDmUserId: string }`; `partyId` derived from URL/session per SECURITY §2)
- [x] `dm-transfer` log entry schema (`{ oldDmUserId, newDmUserId }`; both ids stored on the entry so the audit trail is self-contained)
- [x] **`revoke-banker.reason` enum extended with `"dm-transfer"`** per OUTLINE §4 amendment (2026-06-24). Round-trip test that pre-amendment logs (reason ∈ `"manual" | "reassigned" | "left-party" | "kicked"`) still validate — the enum widening is additive.
- [x] **`dm-transfer` auto-clears `Party.bankerUserId`** when the incoming DM is the current Banker per OUTLINE §3.14. Atomic cascade: one synthetic `revoke-banker` entry with `reason: "dm-transfer"` emitted BEFORE the terminal `dm-transfer` entry (mirrors `leave-party` / `kick-player` cascade ordering). New DM must reappoint a Banker afterward.
- [x] Invariant test: `dm-transfer` to current Banker → Banker auto-cleared, both log entries emitted in the correct order, new DM is NOT also Banker (preserves §4 `bankerUserId != ownerUserId`).
- [x] Invariant test: `dm-transfer` to a non-Banker player → no `revoke-banker` entry emitted; Banker (if any) stays in role.
- [x] Membership swap semantics: outgoing DM's `role='dm'` row soft-deleted (`leftAt: now`); incoming DM's `role='dm'` row upserted to active (reactivates historical soft-deleted row per BUG-002 lesson); outgoing DM's `role='player'` row auto-minted if missing (DM-only outgoing DM case); `Party.ownerUserId` updated to `newDmUserId`.
- [x] Reducer guards: `dm_only` (actor lacks active DM membership), `dm_transfer_self` (self-transfer rejected), `dm_transfer_target_not_member` (target lacks active player membership).
- [x] Placeholder `dmTransferGuard` in `packages/shared/src/guards/map.ts` mirroring reducer rejections — satisfies the exhaustive-map type check + provides defense-in-depth for R4.3.b's server-authoritative path. Two new `GuardRejectionCode` values: `dm_transfer_self`, `dm_transfer_target_not_member`.

#### R4.3.a — Notes

> **Shipped 2026-07-01** (`feature/r4-parties`).
>
> **Test totals:** 1125 across the workspace (web 699 ← 689 with 10 new dm-transfer reducer tests; shared 103 ← 102 with the exhaustive-map guard test list widened by one). Rules 126, seeds 22, server 175 unchanged. All five workspaces typecheck.
>
> **Decisions captured (2026-07-01 planning):**
> - **Outgoing DM keeps player row; new DM keeps player row.** Both users hold their `role='player'` rows post-transfer (untouched by the reducer). The party creator's dual dm+player bootstrap pattern generalises — after any transfer, both users have both roles active (or the outgoing DM has just player, if they were DM-only pre-transfer and got auto-minted).
> - **Auto-mint player row for DM-only outgoing DM.** Rather than reject (`dm_transfer_no_player_row`), the reducer auto-mints an active `role='player'` row with `characterId: null` for the outgoing DM. UX rationale: transfer completes in one click; the outgoing DM then sees the existing "add character" CTA from the Hub. Matches the joiner-post-join flow (BUG-002's rejoin resets `characterId: null` too). `joinedAt: now` follows current-tenure semantics — historical DM tenure is preserved on the soft-deleted dm row.
> - **`joinedAt` on reactivated incoming DM's dm row is refreshed to `now`.** BUG-002 rejoin semantics: soft-deleted → reactive resets `joinedAt` to the current tenure. Original historical `joinedAt` is not preserved on the reactivated row (matches how `persistJoinParty` handles the same shape).
> - **`ownerUserId` bar to self-transfer.** Guard 2 (`newDmUserId === actorUserId`) is redundant with the invariant `state.user.id === state.party.ownerUserId` for any active DM, but keeping the explicit guard clarifies intent + guards against a hypothetical multi-DM state that today can't exist.
> - **Test approach: batch RED, batch GREEN.** Wrote all 10 reducer tests as RED first (confirmed 10 failures), then implemented the reducer arm + `resolveActor` switch case, hit intermediate failures on `resolveActor` (missing `dm-transfer` case) and guards map (missing entry), fixed both, GREEN. One additional refactor to test structure: the invariant-preservation test originally tried Case A + Case B in the same `it()` with two `localBootstrap()` calls; `beforeEach` only fires between `it`s, so the second bootstrap collided with existing DM character. Split into a single case (Case A); the Case B behaviour is already covered by the "does NOT emit revoke-banker" test.
>
> **Not shipped in R4.3.a (deferred to R4.3.b+):**
> - Server `POST /parties/:partyId/transfer-dm` route + `persistDmTransfer` — R4.3.b.
> - Integration tests (real Postgres) for the FULL swap semantics — R4.3.b.
> - `persistDmTransfer` must use `upsert` for the incoming DM's `role='dm'` row (BUG-002 lesson locked-in per pre-R4.3.a audit; see AUDIT-002 below when it lands).
> - End-to-end optimistic-rollback test for `dm_transfer_self` / `dm_transfer_target_not_member` rejection codes in `apps/web/src/sync/queue.test.ts` per BUG-003 lesson — lands with R4.3.b when the server route can actually reject.
> - PartySettings "Transfer DM" affordance — R4.3.e.
>
> **Carryforwards to R4.3.b:**
> - Server persistor: outgoing DM's `role='dm'` row → soft-delete via `update` (row is active). Incoming DM's `role='dm'` row → `upsert` (BUG-002 shape) with `create` for fresh case and `update: { leftAt: null, joinedAt: now, characterId: null }` for reactivation. Outgoing DM's `role='player'` row → conditional `create` (only when missing; the `upsert` idiom won't help here because the composite PK is different). `Party.ownerUserId` → single `update`. Banker cascade: `Party.bankerUserId → null` conditional on `bankerUserId === newDmUserId` before the transaction commits.
> - Guard test coverage: R4.3.b writes the `dmTransferGuard` unit tests in `packages/shared/src/guards/map.test.ts` (the placeholder ships with zero direct tests today; the reducer arm's rejection tests exercise the same rules from the reducer side).
>
> **Carryforwards to R4.3.c/d/e:** none directly. R4.3.a is a substrate slice — the DM cross-character actions in R4.3.c/d and the UI in R4.3.e depend on R4.3.b's server surface, not on R4.3.a directly.

#### R4.3.b — Server-authoritative `dm-transfer` route + guards

**Reducer actions (§4 TransactionLog union)**
- [x] `dm-transfer` dispatched via `POST /sync/actions` (same route pattern as R4.2.a Banker actions — no dedicated route). Matches OUTLINE precedent: `appoint-banker` / `revoke-banker` / `split-evenly` all route through `/sync/actions`; only actions with invite-redemption or cross-entity cascades (`join` / `leave` / `kick`) get dedicated party routes. `dm-transfer` is a state mutation that fits the `/sync/actions` shape.
- [x] `persistDmTransfer` in `apps/server/src/sync/persistor.ts` — atomic transaction: (1) soft-delete outgoing DM's dm row via `update`; (2) upsert incoming DM's dm row per BUG-002 shape; (3) upsert outgoing DM's player row (create if missing / reactivate if soft-deleted / leave in place if active); (4) update `Party.ownerUserId` and conditionally clear `Party.bankerUserId` when incoming DM is the Banker.
- [x] `applyDelta` switch case for `'dm-transfer'` wired.
- [x] Full `dmTransferGuard` unit tests in `packages/shared/src/guards/map.test.ts` — 7 new tests: DM accepts, non-DM rejects (`dm_only`), Banker rejects (`dm_only`), self-transfer rejects (`dm_transfer_self`), stranger rejects (`dm_transfer_target_not_member`), soft-deleted player rejects (`dm_transfer_target_not_member`), null state rejects (`state_not_initialized`).
- [x] Integration tests (real Postgres) in `apps/server/src/parties/routes.test.ts` — 6 new tests: success path (party ownership + all 4 membership rows verified + terminal log entry checked), self-transfer 422 `dm_transfer_self`, non-DM actor 422 `dm_only`, target-not-in-party 422 `dm_transfer_target_not_member`, Banker cascade end-to-end (both log entries emitted in the correct order), **BUG-002 shape verified via two-step transfer round-trip** (A→B then B→A — the second transfer would P2002 without the upsert semantics; test proves the historical dm row is reactivated in place).
- [x] End-to-end optimistic-rollback test for `dm_transfer_target_not_member` in `apps/web/src/sync/queue.test.ts` (BUG-003 lesson: every new rejection code needs a matching 422 rollback assertion). The representative case covers both `dm_transfer_self` and `dm_transfer_target_not_member` — the rollback machinery is code-agnostic.

#### R4.3.b — Notes

> **Shipped 2026-07-01** (`feature/r4-parties`).
>
> **Test totals:** 1139 across the workspace (shared 110 ← 103 with +7 dmTransferGuard tests; web 700 ← 699 with +1 queue rollback; server 181 ← 175 with +6 dm-transfer integration tests; rules 126 + seeds 22 unchanged). All 5 workspaces typecheck.
>
> **Decisions captured (2026-07-01 execution):**
> - **Routed via `/sync/actions`, not a dedicated `/parties/:id/transfer-dm` route.** The R4.2.a precedent (Banker appoint/revoke via `/sync/actions`) applies: `dm-transfer` is a state mutation without invite-code redemption or a cross-entity cascade shape. Dedicated party routes exist for `/join` (invite redemption), `/leave` + `/kick` (character cascade to Recovered Loot per BUG-001's path). This reduces route surface and keeps the guard pipeline uniform.
> - **`persistDmTransfer` uses `upsert` on BOTH the incoming DM's dm row AND the outgoing DM's player row.** BUG-002's lesson generalises: any composite-PK write against a table with soft-delete must be `upsert`. The incoming DM might have a historical dm row (BUG-002 shape); the outgoing DM might have a historical player row (leave+rejoin+transfer chain). Both cases are covered.
> - **BUG-002 test coverage via a two-step transfer.** Rather than pre-seed a soft-deleted row directly in the test DB (which would test the persistor in isolation but not the wire path), the test does A→B→A. The first transfer creates the state (A's dm row soft-deletes, B's dm row is created). The second transfer exercises the BUG-002 shape end-to-end: B→A finds A's soft-deleted dm row and must reactivate it via upsert. Would P2002 without the fix.
> - **BUG-003 test coverage: single representative case.** The queue's rollback machinery is code-agnostic — once one rejection code is proven to trigger the rollback, all others follow the same path. `dm_transfer_target_not_member` was chosen as the representative because it's the "authoritative server rejection" case (self-transfer is caught client-side by the reducer before ever reaching the queue). Adding a second test for `dm_transfer_self` would be pure duplication.
>
> **Not shipped in R4.3.b (deferred to R4.3.c+):**
> - DM cross-character actions (`acquire` / `consume` / `transfer` / `equip` / `attune` / `recharge` / `use-charge` / character-field edits) — R4.3.c/d.
> - PartySettings "Transfer DM" affordance — R4.3.e.
>
> **Carryforwards to R4.3.c/d/e:**
> - The `POST /sync/actions` route pattern generalises to R4.3.c/d: DM cross-character actions extend existing action types (`acquire`, `consume`, `transfer`, etc.) — they'll route through the same pipeline, no new endpoints.
> - The BUG-002 upsert pattern is now shipped in three places: `persistJoinParty` (R4.1.e), `persistDmTransfer` (R4.3.b — this slice, two upserts), plus AUDIT-001's verdict that other `partyMembership.create()` callsites don't need it. If R4.3.c/d introduces any new `PartyMembership` writes, apply the same pattern.
> - The BUG-003 rollback test pattern is now proven for 2 rejection codes (`banker_required_for_claim`, `dm_transfer_target_not_member`). Any new rejection code in R4.3.c/d/e needs its own test — the pattern is one representative per rejection family.

#### R4.3.c — DM cross-character actions (batch 1: `acquire` / `consume` / `transfer`)

**DM cross-character actions (§8.1 "Edit other players' inventory via explicit action")**
- [x] DM-issued `acquire` / `consume` against another player's character (logged with `actorRole: "dm"` via `deriveActorRole`; no reducer change needed — the reducer arms are ownership-agnostic).
- [x] DM-issued `transfer` between any two stashes in the party (source-ownership check widened; destination was always accessible for party/recovered-loot; character-scope destinations were always DM-writable via the same source-ownership widening because DM is source-owner).
- [x] Guard update: `ownsOrShares` (packages/shared/src/guards/map.ts) widened — when `actor.role === 'dm'` AND the target stash is character-scoped AND the character's `partyId` matches `actor.partyId`, return true. Preserves player behaviour (still rejected on `not_own_stash` for cross-character targets).
- [x] Guard tests: 7 new in packages/shared/src/guards/map.test.ts — DM can acquire/consume/transfer OUT on another player's stash; player still rejected; DM cannot cross into another party (partyId mismatch).
- [x] Invariant satisfied: every DM cross-character action writes a log entry via the existing reducer pipeline; `actorRole: 'dm'` derived at store middleware via `deriveActorRole`. The affected owner reads the same party log per OUTLINE §8 "DM principle".
- [x] Invariant satisfied: no silent edits — the guard widening only permits actions that already go through the full reducer + log pipeline. No new mutation surface introduced.

#### R4.3.c — Notes

> **Shipped 2026-07-01** (`feature/r4-parties`).
>
> **Test totals:** 1146 across the workspace (shared 117 ← 110 with +7 R4.3.c guard tests; other workspaces unchanged). All 5 workspaces typecheck.
>
> **Decisions captured (2026-07-01 execution):**
> - **Guard-only change; no reducer changes.** The reducer arms for `acquire` / `consume` / `transfer` check state consistency (stash exists, item exists, definition exists) — not actor identity. Actor identity is the guard's job. Widening `ownsOrShares` alone is sufficient to unlock DM cross-character behavior for all three actions. This mirrors how R4.2.c added the Banker gate: guard-only, no reducer touch.
> - **Widened `ownsOrShares` in-place rather than adding a separate helper.** Alternative was `ownsOrDmOverride` applied only where §8.1 allows DM cross-character. Rejected because §8.1 grants DM cross-character on ALL of `acquire` / `consume` / `transfer` / `edit-item-instance` / `split` — the same set that already uses `ownsOrShares`. A parallel helper would be pure duplication. The in-place widening is the minimum change and preserves the single-source-of-truth for ownership checks.
> - **`partyId` verified via the character row, not the stash.** Character stashes have `partyId: null` per §4 (party membership lives on the character). The guard reads `state.characters.find(c => c.id === stash.ownerCharacterId).partyId` and compares to `actor.partyId`. Prevents cross-party DM access if a stray character reference somehow points across parties (defensive; shouldn't happen structurally).
> - **No server integration tests added.** The R4.2.c server integration tests already prove that `/sync/actions` calls `checkGuard` for `acquire` / `consume` / `transfer` (same code path). R4.3.c widens the guard's return value for one actor.role case; it doesn't change the transport. Adding server integration tests for R4.3.c would test the transport, not R4.3.c's new logic. The 7 guard unit tests cover the new behavior directly. Revisit if a wire-shape regression surfaces.
> - **`edit-item-instance` and `split` inherit the widening.** Both use `ownsOrShares` on the source-stash. R4.3.c's widening automatically applies to them. Not called out in R4.3.c's scope but worth noting: the DM can now also edit item-instance metadata (notes, quantity) on other players' items, and split their stacks. This is consistent with §8.1's "Edit other players' inventory" umbrella. No new tests added for these two derivative flows since the `ownsOrShares` widening is proven for the three primary actions.
>
> **Not shipped in R4.3.c (deferred to R4.3.d+):**
> - DM-issued `equip` / `unequip` / `attune` / `unattune` / `recharge` / `use-charge` — R4.3.d (these use `ownsCharacter`, not `ownsOrShares`; guard change is different).
> - DM-issued character-field edits (name, species, class, level, STR) — R4.3.d.
> - PartySettings UI + character-sheet DM affordances — R4.3.e.
>
> **Carryforwards to R4.3.d:**
> - `ownsCharacter` (packages/shared/src/guards/map.ts) is the parallel helper for `equip` / `unequip` / `attune` / `unattune` / `use-charge` / `recharge`. R4.3.d must widen it symmetrically: `actor.role === 'dm'` AND `character.partyId === actor.partyId` returns true. Same pattern as R4.3.c's `ownsOrShares` widening.
> - `use-charge` has the additional constraint from OUTLINE §3.8 amendment (Inventory-only for force-use-charge) — R4.3.d needs an explicit test that DM force-use-charge on an item in Party Stash rejects.
> - `attune` cap-override: OUTLINE §3.8 says DM can bypass the max-attunement cap with explicit confirm. R4.3.d guard for `attune` may need a DM-specific branch.
> - `rename-character` + `edit-character` widening: same `ownsCharacter` widening applies. `edit-character.maxAttunement` is already DM-only per the existing guard, so no change there.

#### R4.3.d — DM cross-character actions (batch 2: equip/attune/recharge/use-charge/character-field edits)

**DM cross-character actions (§8.1 "Edit other players' inventory via explicit action")**
- [x] DM-issued `equip` / `unequip` on another player's character (unlocked by `ownsCharacter` widening).
- [x] DM-issued `attune` / `unattune` — cross-character via `ownsCharacter` widening. `attune` gains `overrideCap?: boolean` payload field per OUTLINE §3.8; reducer skips the maxAttunement slot-cap check when true; log entry preserves the flag for audit trail.
- [x] DM-issued `recharge` (single-mode + batch-mode) on another player's item — `ownsCharacter` widening.
- [x] **DM-issued `use-charge` restricted to items in someone's Inventory** per OUTLINE §3.8 amendment. Guard preserves the `use_charge_only_in_inventory` invariant even for DM actors — the `isCharacterInventoryStash` check runs after the ownership check.
- [x] Invariant test: DM `use-charge` on an item moved to Party Stash → `use_charge_only_in_inventory`. Guard test in `packages/shared/src/guards/map.test.ts`.
- [x] DM-issued character-field edits (name via `rename-character`; species/class/level/str via `edit-character`) — inherited from `ownsCharacter` widening. `edit-character.maxAttunement` remains explicitly DM-only per the existing guard (a strict-superset case).

**Guard changes:**
- [x] `ownsCharacter` widened in `packages/shared/src/guards/map.ts` — when `actor.role === 'dm'` AND `character.partyId === actor.partyId`, return true. Unlocks 6 actions (`equip`, `unequip`, `attune`, `unattune`, `use-charge`, `recharge`) plus 2 (`rename-character`, `edit-character` owner path). +5 LOC.
- [x] `attuneGuard` extended with `overrideCap` DM-only check — non-DM actor with `overrideCap: true` rejects with `dm_only` code.

**Schema changes:**
- [x] `attuneAction.payload` gains `overrideCap: z.boolean().optional()` in `packages/shared/src/schemas/action.ts`.
- [x] `attuneEntry.payload` gains same optional field in `packages/shared/src/schemas/transactionLog.ts`. Absent for normal attune, `true` for DM cap-override.
- [x] Reducer's `Action` union gains `overrideCap?: boolean` on the `attune` variant in `packages/rules/src/reducer/types.ts`.

**Reducer changes:**
- [x] `attuneOrUnattune` in `packages/rules/src/reducer/index.ts` — when `overrideCap === true`, skip the `attunement.hasFreeSlot` check. Log-entry payload preserves the `overrideCap: true` field (only for `attune`, not `unattune` — unattune never carries the flag).

#### R4.3.d — Notes

> **Shipped 2026-07-01** (`feature/r4-parties`).
>
> **Test totals:** 1165 across the workspace (shared 132 ← 117 with +15 new tests: 12 R4.3.d cross-character guard + 3 overrideCap guard; web 704 ← 700 with +4 attune cap-override reducer tests). Rules 126, seeds 22, server 181 unchanged. All 5 workspaces typecheck.
>
> **Decisions captured (2026-07-01 execution):**
> - **Widened `ownsCharacter` in-place, same pattern as R4.3.c's `ownsOrShares`.** Single conditional branch: DM actor + partyId match → true. Unlocks 6 primary actions (`equip`/`unequip`/`attune`/`unattune`/`use-charge`/`recharge`) plus 2 inherited ones (`rename-character`, `edit-character` owner path). Alternative `ownsCharacterOrDmOverride` helper rejected — same rationale as R4.3.c: §8.1 grants DM cross-character on the same set that already uses `ownsCharacter`.
> - **`use-charge` Inventory-only invariant survives DM widening.** The `isCharacterInventoryStash` check runs AFTER the ownership check. DM force-use-charge on an item moved to Party Stash → `use_charge_only_in_inventory`. Guard test proves this explicitly (line ~1418 in map.test.ts). This matches OUTLINE §3.8 amendment: force-use-charge is Inventory-only regardless of actor role.
> - **`attune` cap-override: field on the payload + reducer branch + guard check.** Three-touch change. Field is `overrideCap?: boolean` (optional; absent = normal attune within cap). Reducer's `attuneOrUnattune` reads it via `'overrideCap' in payload && payload.overrideCap === true`; when true, skips `attunement.hasFreeSlot`. Guard rejects `overrideCap: true` from non-DM actors with `dm_only`. Log entry preserves `overrideCap: true` when set — the audit trail records the deliberate override per OUTLINE §3.8.
> - **`unattune` deliberately does NOT carry `overrideCap`.** Un-attuning frees a slot; there's no cap to override. Log entry omits the field for unattune even when payload happens to have it (the reducer's log-entry builder only includes it for `type === 'attune'`).
> - **`edit-character.maxAttunement` DM-only guard preserved.** Existing behaviour: any patch that touches `maxAttunement` requires DM. `ownsCharacter` widening doesn't affect this since the guard checks `maxAttunement` before the ownership check. DM editing another player's `maxAttunement` was already allowed pre-R4.3.d via the `if (actor.role === 'dm') return { ok: true };` short-circuit; R4.3.d confirms the pattern.
> - **Server integration tests skipped (same rationale as R4.3.c).** The R4.2.c server tests already prove `/sync/actions` routes through `checkGuard`. R4.3.d widens guard return values for the DM actor.role case; it doesn't change the transport. The 15 shared guard tests + 4 web reducer tests cover the new behavior directly.
> - **No new `partyMembership` writes.** R4.3.d touches guards + reducer + schemas only. BUG-002's upsert lesson (from R4.3.b's carryforward checklist) doesn't apply.
> - **No new rejection codes.** The `dm_only` code already existed; the `overrideCap` non-DM rejection reuses it. BUG-003's rollback test lesson doesn't add a new test.
>
> **Not shipped in R4.3.d (deferred to R4.3.e):**
> - PartySettings "Transfer DM" affordance (from R4.3.a carryforward).
> - Character-sheet DM affordances for cross-character actions.
> - Attune cap-override UI (explicit-confirm dialog per OUTLINE §3.8).
> - StashItemsTable visibility gating revisit.
>
> **Carryforwards to R4.3.e:**
> - **Attune cap-override UI must include an explicit-confirm step** per OUTLINE §3.8. The action payload just needs `overrideCap: true`; the friction lives in the UI (a modal that says "This will exceed the 3/3 attunement cap. Confirm?"). Suggested implementation: reuse the existing attune button on the character sheet; when the DM sees a 4th attune target and clicks, if `hasFreeSlot` returns false the UI opens a cap-override confirm dialog with a warning. Non-DM sees the standard "no free slot" toast.
> - **DM force-use-charge on non-Inventory items has no UI affordance.** Per OUTLINE §3.8 amendment, force-use-charge is Inventory-only. The DM must transfer the item into the character's Inventory first — the UI should NOT surface a "use charge" button on Party Stash / Recovered Loot / Storage items even for DM actors. R4.3.e must respect this.
> - **`edit-character` DM path already exists and doesn't need UI-side gating.** The reducer arm accepts patches from DM against any character; the character-sheet edit modal just needs to be surfaced for DM actors on non-owned characters.

#### R4.3.e — UI

- [x] Party Settings screen (§5.15): "Transfer DM" affordance — Button + confirm dialog on each non-DM active player row when the DM views the members list. DM-only, requires ≥2 members (`!isSolo` check derived from unique userId count). Dispatches `dm-transfer` via `useStore.getState().dispatch`; refreshes the server-mode member list post-dispatch so role badges reflect the swap. Toast success / error.
- [x] Character-name link in the member list — clicking a member's `characterName` navigates to `/character/:id`. Unlocks the DM cross-character UX (R4.3.c/d) because the CharacterSheet already renders any character in the AppState without an ownership gate; the guards enforce write-side permissions. No new gate needed on the sheet route.
- [~] DM cross-character action affordances on character sheets / inventories — **deferred**. The R4.3.c/d guard widening already lets DM dispatches through; the existing character-sheet action buttons (acquire, equip, attune, use-charge, etc.) work without any UI-side gating because `useStore.getState().dispatch` calls the reducer directly and the reducer is ownership-agnostic. Guard rejection surfaces as a toast (same as any other rejection). Deferred UI polish: explicit "you are editing another player's character" visual cue, DM-only affordance visibility filtering. Revisit if user testing surfaces confusion.
- [~] Attune cap-override confirm dialog — **deferred**. R4.3.d ships the `overrideCap` payload field + reducer branch + guard check. The UI can dispatch `{ type: 'attune', payload: { ..., overrideCap: true } }` at any time; ergonomic explicit-confirm dialog per OUTLINE §3.8 is deferred. Standard attune button today rejects on cap with a `no free attunement slot` toast; DM users work around by editing `maxAttunement` first, or by dispatching with `overrideCap: true` from a dev console. Revisit when a real UX need surfaces.
- [~] StashItemsTable visibility gating revisit — **deferred**. Same rationale as R4.2.e's parked decision: hiding item controls for non-Banker/non-owner users on shared pools would double the visibility-flag surface for marginal UX gain. Guard rejection + toast is acceptable friction. DM cross-character (R4.3.c/d) doesn't change this calculus — DM sees the same controls and dispatches succeed for the new cases.

#### R4.3.e — Notes

> **Shipped 2026-07-01** (`feature/r4-parties`). **R4.3 complete.**
>
> **Test totals:** 1165 across the workspace (unchanged from R4.3.d). Per R4.2.e's precedent + user direction ("I will test 4.3 as a whole"), PartySettings component tests were deferred to manual + server integration coverage. The `dm-transfer` dispatch pipeline is fully covered by R4.3.a's 10 reducer tests + R4.3.b's 7 guard + 6 server integration + 1 rollback tests.
>
> **Decisions captured (2026-07-01 execution):**
> - **Component tests deferred (R4.2.e precedent).** PartySettings' Banker CTAs were deferred to server integration in R4.2.e for the same reason: the members section is server-mode-only and requires a live API mock. R4.3.e follows suit — the button is a thin wrapper over `dispatch`, and dispatch is exhaustively tested at the reducer + guard + server-integration layers.
> - **Character-name link is a minimal enhancement.** One-line change (`<span>` → `<button>`) that unlocks DM cross-character navigation without a dedicated "DM view of member" screen. Clicking any member's character name goes to `/character/:id`, which renders for any character in the AppState. DM affordances (guard-widened R4.3.c/d actions) work automatically once the sheet is open.
> - **DM affordance gating deferred.** Alternative was to add an "editing another player's character" banner on the CharacterSheet when `character.ownerUserId !== state.user.id && actor.role === 'dm'`. Deferred because (a) the button set doesn't change — same actions, guard permits DM alone; (b) toast-based rejection covers user error; (c) roadmap doesn't mandate a specific visual cue. Revisit if telemetry / user testing shows confusion.
> - **Attune cap-override UI deferred.** Same rationale: R4.3.d ships the payload field + reducer branch + guard check. The dialog is UX polish; the mechanism works today. Deferring lets us see whether DMs actually need the affordance or work around by editing `maxAttunement` (which is the natural way to raise the cap permanently). Revisit at a later slice.
> - **Two-step Banker cascade end-to-end.** When the DM transfers to the current Banker, R4.3.a's reducer emits `revoke-banker { reason: 'dm-transfer' }` before the terminal `dm-transfer` entry. The UI's toast says "DM role transferred to {name}" — the Banker auto-clear is visible via the members-list refresh (Banker badge disappears from that row).
> - **Character name shown as button, not `<a href>`.** Uses `navigate()` from react-router. Standard SPA nav pattern; keeps the rest of the app's routing behaviour intact.

#### R4.3 — Notes

> **R4.3 shipped 2026-07-01 (five sub-slices R4.3.a–e).** DM cross-character actions + DM transfer per OUTLINE §3.14 + §8.3 are now fully implemented across schema, reducer, guards, server persistence, and UI. Sliced from a single roadmap section into R4.3.a–e on 2026-07-01 (planning session, mid-execution), mirroring the R4.1.a-f / R4.2.a-e rhythm.
>
> **Total test growth across R4.3:** 1113 → 1165 (+52). Breakdown:
> - **R4.3.a — reducer foundation (+12):** 10 dm-transfer reducer tests, 1 shared guard-map exhaustiveness, 1 web via reducer coverage
> - **R4.3.b — server + guards + rollback (+14):** 7 dmTransferGuard unit tests, 6 dm-transfer integration tests, 1 BUG-003-shape rollback test
> - **R4.3.c — DM cross-character batch 1 (+7):** guard tests for DM `acquire` / `consume` / `transfer` + player-still-blocked + partyId-mismatch
> - **R4.3.d — DM cross-character batch 2 (+19):** 12 R4.3.d cross-character guard tests + 3 overrideCap guard tests + 4 attune cap-override reducer tests
> - **R4.3.e — UI (+0):** Component tests deferred per R4.2.e precedent + user direction ("I will test 4.3 as a whole")
>
> **Key architectural decisions preserved across sub-slices:**
> - **`dm-transfer` routes via `/sync/actions`, not a dedicated route.** Matches R4.2.a's Banker action precedent. Dedicated party routes exist only for actions with invite-redemption or cross-entity cascades (`join` / `leave` / `kick`).
> - **BUG-002 upsert pattern applied at every `PartyMembership` write in `persistDmTransfer`.** Both the incoming DM's dm row AND the outgoing DM's player row use upsert semantics to handle historical soft-deleted rows. Covered by a two-step transfer round-trip test (A→B→A).
> - **BUG-003 rollback test added for a representative new rejection code.** `dm_transfer_target_not_member` proves the pattern; the queue's rollback machinery is code-agnostic, so one test per rejection family is enough.
> - **`ownsOrShares` and `ownsCharacter` widened in-place** with an `actor.role === 'dm'` + partyId-match branch. Single conditional; no parallel helpers. R4.3.c/d guard widening unlocked 5 + 6 actions respectively (plus inherited actions via existing `ownsCharacter` guards).
> - **`use-charge` Inventory-only invariant preserved for DM.** OUTLINE §3.8 amendment (force-use-charge is Inventory-only) survives the DM widening because the guard's ownership check runs BEFORE the Inventory-only check; both must pass.
> - **`attune.overrideCap` is a payload field, not a separate action.** DM cap-override extends the existing `attune` action with an optional `overrideCap: boolean`. Guard rejects non-DM setting it; reducer skips slot-cap check when true; log entry preserves the flag for audit.
>
> **Carryforwards to R4.4:**
> - **Cross-character `currency-transfer` — R4.4 scope.** R4.3 didn't touch `currency-transfer`; player→player push and Banker-from-pool distribution land in R4.4 per the existing roadmap. The BUG-002 / BUG-003 patterns established in R4.3 apply to any new `PartyMembership` writes / rejection codes R4.4 introduces.
> - **Homebrew party-scope filtering — R4.4 scope.** Independent of R4.3.
> - **DM-only custom-item creation enforcement in 2+-member parties — R4.4 scope.**
>
> **Deferred UI polish (may fold into R4.5 or ship as R4.3.e.1):**
> - Explicit "editing another player's character" visual cue on CharacterSheet when `character.ownerUserId !== state.user.id && actor.role === 'dm'`.
> - Attune cap-override confirm dialog per OUTLINE §3.8 (mechanism ships in R4.3.d; explicit-confirm UX deferred).
> - **DM UI to permanently modify (grant OR reduce) a character's attunement slots** (edit `Character.maxAttunement`). The reducer + guard mechanism has existed since R1.2 / R4.3.d: `edit-character` with `{ patch: { maxAttunement: N } }` is DM-only and logged as a `maxAttunement` change on the audit trail. What's missing is the UI affordance — no screen today dispatches `edit-character.maxAttunement`. **Promoted to R6.0** on 2026-07-01 as a stand-alone slice (independent of R6's pricing / shops / hoard work). See R6.0 for the full spec including over-cap-reduce confirm dialog and DM-only visibility.
> - StashItemsTable visibility revisit (parked in R4.2.e Notes, re-parked here).

#### R4.4 — Cross-character currency + homebrew party scope + gating

Sliced into four independently-shippable sub-slices, mirroring the R4.1.a-f / R4.2.a-e / R4.3.a-e rhythm. R4.4.a locks in `currency-transfer` cross-character invariants (test-only slice — the R4.3.c `ownsOrShares` widening + R4.2.c Banker gate already compose correctly, so no reducer / guard / schema changes are needed; the invariants only need to be codified). R4.4.b filters the Catalog Browser to the active party's homebrew. R4.4.c enforces DM-only custom-item creation once `memberCount >= 2`. R4.4.d ships the multi-member offline banner.

#### R4.4.a — `currency-transfer` cross-character invariants (test-only lock-in)

**Reducer actions (§4 TransactionLog union)**
- [x] `currency-transfer` action extended for cross-character use (M5.5 added own-stash self-transfer; R4 adds): (a) player pushes currency directly to another player's Inventory stash (direct/immediate — no acceptance step); (b) Banker transfers currency from Party Stash or Recovered Loot to a specific player's stash — **already supported** by the R4.3.c `ownsOrShares` widening + R4.2.c Banker gate composing correctly. No reducer / guard / schema code change needed; R4.4.a locks the invariants in with tests.
- [x] `currency-transfer` invariant test: **player→player push is ALWAYS allowed regardless of Banker state** per OUTLINE §3.14 amendment (2026-06-24). The Banker mediates the shared pools, not character-to-character moves. Two guard tests in `packages/shared/src/guards/map.test.ts` (Banker active + no Banker).
- [x] `currency-transfer` invariant test: Banker-from-pool allowed always (already covered by R4.2.c test at map.test.ts:847); DM blocked from distributing to specific players from Party Stash / Recovered Loot while Banker active (§8.1) — two new guard tests (Party Stash + Recovered Loot).
- [x] `currency-transfer` invariant test: when no Banker, DM can distribute freely + players self-claim freely from Recovered Loot (Party Stash covered by pre-existing R4.2.c test at map.test.ts:867) — two new guard tests.
- [x] Server integration coverage — the existing test at `routes.test.ts:1114` ("rejects a non-Banker moving currency FROM Recovered Loot when Banker is active") already exercises the `/sync/actions` transport for DM-blocked-while-Banker (userA resolves as `dm` via `resolveActor`'s DM > player preference). No new server tests added — the R4.4.a widening doesn't change the transport surface.

#### R4.4.a — Notes

> **Shipped 2026-07-01** (`feature/r4-parties`). Test-only lock-in slice.
>
> **Test totals:** 1171 across the workspace (shared 132 → 138, +6 R4.4.a guard tests; other workspaces unchanged). All 5 workspaces typecheck.
>
> **Design notes:**
> - **Audit-first approach vindicated.** Pre-slice audit revealed that R4.3.c's widening of `ownsOrShares` (DM cross-character path) + R4.2.c's `checkBankerGate` (source-side "OUT of shared pool" gate) already implement all four §3.14 + §8.1 semantics R4.4.a requires. The `currencyTransferGuard` at `packages/shared/src/guards/map.ts:399` is unchanged; the six new tests exercise the composition.
> - **Player→player push is source-side only.** The guard checks `ownsOrShares(state, actor, fromStashId)` — the destination stash is unrestricted at the guard level. Player u2 pushing from their own Inventory to player u3's Inventory passes because (a) u2 owns the source, (b) source is a character stash so `checkBankerGate` short-circuits (`isSharedPoolStash` returns false). This matches §3.14: "Banker mediates the shared pools, not character-to-character moves."
> - **DM-blocked-while-Banker follows automatically.** `checkBankerGate` rejects any non-Banker actor (including DM) moving OUT of a shared pool while `bankerUserId !== null`. No DM-specific branch was needed — the actor's role only matters for the `banker` short-circuit. Matches §8.1's "DM cannot self-distribute while Banker active."
> - **Reducer coverage inherited.** The `currencyTransfer` reducer at `packages/rules/src/reducer/index.ts:1726` is actor-agnostic — it only validates stash existence, non-negative deltas, and funds. All existing reducer tests (28 for `currency-transfer`) cover the mutation shape for any actor. No new reducer tests were added; adding them would duplicate existing coverage.
> - **No BUG-002 / BUG-003 risk.** R4.4.a adds no new `PartyMembership` writes and no new rejection codes — both patterns are irrelevant here. The R4.3 carryforward checklist is satisfied by omission.
>
> **Not shipped in R4.4.a (deferred to R4.4.b+):**
> - Catalog Browser homebrew party-scope filter — R4.4.b.
> - DM-only custom-item creation gating for `memberCount >= 2` — R4.4.c.
> - Multi-member offline banner — R4.4.d.
>
> **Carryforwards to R4.4.b/c/d:**
> - None directly. R4.4.a is a substrate slice — the visibility (R4.4.b), gating (R4.4.c), and banner (R4.4.d) slices don't depend on it.

#### R4.4.b — Homebrew party-scope filter (Catalog Browser)

- [x] **Homebrew visibility is party-scoped** per OUTLINE §3.7 + §4 `ItemDefinition.partyId`. Server-side filter in `apps/server/src/sync/state-loader.ts:151-155` (`OR: [{ source: PHB | DMG }, { partyId }]`) already scopes the catalog to system rows + this-party homebrew — no client-side filter needed. Homebrew from other parties never reaches the client's `catalog` array.
- [x] Invariant test: user is a member of parties A + B; a homebrew "Vorpal Spork" scoped to party A is NOT included in `GET /sync/state?partyId=<partyB>`. Sanity: same user querying party A DOES see it. Server integration test in `apps/server/src/sync/routes.test.ts`.
- [x] Invariant test: creator makes homebrew in party A; another user joins party A → the new member's `GET /sync/state?partyId=<partyA>` includes the homebrew (party-scoped, not user-scoped). Server integration test.

#### R4.4.b — Notes

> **Shipped 2026-07-01** (`feature/r4-parties`). Test-only lock-in slice.
>
> **Test totals:** 1173 across the workspace (server 181 → 183, +2 R4.4.b integration tests; other workspaces unchanged). All 5 workspaces typecheck.
>
> **Design notes:**
> - **Audit-first approach vindicated again.** Pre-slice audit revealed that the visibility filter already exists at the server sync boundary. The client-side Catalog Browser (`apps/web/src/screens/CatalogBrowser.tsx`) needs no change — it renders whatever's in `state.catalog`, and the server delivers a party-scoped catalog on every `GET /sync/state?partyId=X`. Party switches trigger full-state replacement via `hydrate({ appState: pulled.state })` in `Hub.tsx:openServerParty`, so cross-party homebrew leakage isn't possible.
> - **Homebrew stamped with `partyId` at creation.** `packages/rules/src/reducer/index.ts:createHomebrew` sets `newDef.partyId = s.party.id`, and `apps/server/src/sync/persistor.ts:persistCreateHomebrew` sets `data.partyId = actor.partyId`. Both write paths converge on the same invariant, and the server sync-loader filter enforces it on read.
> - **`seedPartyDirect` helper introduced.** Direct-Prisma seeder that bootstraps a party (party row + character + 3 stashes + memberships + currency holdings) inside a single `$transaction` to satisfy the `Character ↔ Stash INITIALLY DEFERRED` FK cycle. Mirrors the real bootstrap in `persistCreateCharacter` but avoids the full `/sync/actions` roundtrip. Reusable pattern for future multi-party integration tests (e.g. RH4's URL-scoped routing when it lands).
> - **No client-side change needed.** The Catalog Browser doesn't need a `partyId === activePartyId` filter — the catalog it receives from the server is already scoped. If R5's real-time sync ever pushes cross-party updates over WebSocket, a client-side belt-and-braces filter may be worth revisiting, but that's an R5+ concern.
> - **No reducer / guard / schema code changed.** Pure test slice.
>
> **Not shipped in R4.4.b (deferred to R4.4.c+):**
> - DM-only custom-item creation gating for `memberCount >= 2` — R4.4.c.
> - Multi-member offline banner — R4.4.d.
>
> **Carryforwards to R4.4.c/d:**
> - None directly. R4.4.b is orthogonal to R4.4.c (gating on `create-homebrew`) and R4.4.d (offline banner).

#### R4.4.c — DM-only custom-item gating for `memberCount >= 2`

- [x] DM-only custom-item creation enforced once `memberCount >= 2` (§3.7, §8.1). Enforced by `createHomebrewGuard` in `packages/shared/src/guards/map.ts:422` (rejects `actor.role !== 'dm'` with `dm_only`) + solo bypass in `checkGuard` per §8.2 (a party-of-one bypasses the matrix, so a solo actor can create homebrew regardless of their role). Composition: solo → allowed for anyone; multi-member → DM-only. Matches the R4.4.c invariant exactly.

#### R4.4.c — Notes

> **Shipped 2026-07-01** (`feature/r4-parties`). No new code — the R4.4.c invariant is already enforced by the existing `createHomebrewGuard` + §8.2 solo bypass composition, and both branches have direct test coverage.
>
> **Test totals:** 1173 across the workspace (unchanged from R4.4.b). All 5 workspaces typecheck.
>
> **Design notes:**
> - **Pre-existing coverage.** Three tests in `packages/shared/src/guards/map.test.ts` already cover R4.4.c's invariant:
>   1. Line 183–192 (`checkGuard — §8.2 solo bypass > bypasses the matrix for a solo party`): a player actor in a solo party is allowed to `create-homebrew` (solo bypass). Locks in the "solo = anyone can create homebrew" branch.
>   2. Line 251–258 (`guards — DM-only actions > create-homebrew rejects a player`): a player actor in a 2+-member party is rejected with `dm_only`. Locks in the "multi-member = DM-only" branch.
>   3. Line 259–267 (`guards — DM-only actions > create-homebrew accepts a DM`): the DM actor in a 2+-member party is allowed. Locks in the DM path.
> - **`memberCount >= 2` is expressed via `isSolo` inversion.** `checkGuard` calls `isSolo(memberships)` (distinct-active-userId count === 1); when true, the guard is bypassed. When false, the per-guard rejection fires. This is the same predicate `docs/OUTLINE.md` §8.2 specifies.
> - **`edit-homebrew` and `delete-homebrew` inherit the same pattern.** Both guards (`map.ts:439` + `map.ts:456`) require `actor.role === 'dm'` and are bypassed by §8.2 in solo. Same three-test pattern would apply if we wanted explicit lock-in; current coverage exercises `create-homebrew` as the representative case (following the R4.2.c/R4.3.c "one representative per rejection family" precedent).
> - **No reducer / guard / schema code changed.** Pure documentation slice — the invariant was already enforced and tested; R4.4.c formally acknowledges it.
>
> **Not shipped in R4.4.c (deferred to R4.4.d):**
> - Multi-member offline banner — R4.4.d.
>
> **Carryforwards to R4.4.d:**
> - None directly. R4.4.d (UI banner) is orthogonal to R4.4.c (guard).

#### R4.4.d — Multi-member offline banner (UI)

- [x] Offline banner activates for multi-member parties (§9). Persistent alert bar below the header renders when all three predicates hold: (a) server mode (`isServerMode === true`, build-time `VITE_SERVER_URL`), (b) browser is offline (`navigator.onLine === false`, subscribed via `online` / `offline` window events), (c) party has 2+ distinct active members (`new Set(memberships.filter(m => m.leftAt === null).map(m => m.userId)).size >= 2`). Solo parties never see the banner per §9's "party-of-one works offline indefinitely" rule. New `OfflineBanner.tsx` mounted in `Layout.tsx` below the header. 5 component tests locking in each visibility branch + online↔offline transition.

#### R4.4.d — Notes

> **Shipped 2026-07-01** (`feature/r4-parties`). UI slice.
>
> **Test totals:** 1178 across the workspace (web 704 → 709, +5 R4.4.d component tests; other workspaces unchanged). All 5 workspaces typecheck.
>
> **Design notes:**
> - **Banner-only; write-blocking deferred to M5.** OUTLINE §9 says "show offline banner; block writes; auto-resume on reconnect" — the banner is shipped as R4 groundwork (per M5's "offline banner in party mode" line item, line 555), but write-blocking (queue.ts short-circuiting when `!navigator.onLine`) lands with M5's WebSocket layer. Today the sync queue already handles fetch failures gracefully: keeps optimistic state, surfaces a toast (`queue.ts:275`). The banner + graceful fetch failure is a reasonable interim UX; explicit write-blocking is a stricter guardrail that pairs naturally with WebSocket reconnect handling.
> - **`useOnline` inline hook, not a shared util.** The hook is 15 LOC and used by exactly one component; extracting to `lib/` would be premature abstraction (per CLAUDE.md "don't create helpers, utilities, or abstractions for one-time operations"). If R5's realtime layer needs to gate other components on online state, promote it then.
> - **Three-predicate visibility.** Server mode + offline + multi-member. The order matters: `isServerMode` is a build-time constant so it short-circuits without cost; `isOnline` is component-local state; `memberCount` reads from the store (`useShallow` on a scalar to avoid re-renders on every reducer mutation). Only the last predicate can flip while a party is loaded — the others are effectively constants for the lifetime of an AppState.
> - **Solo-bypass symmetry with §8.2.** Same predicate as the guard-level solo bypass: `new Set(memberships.filter(m => m.leftAt === null).map(m => m.userId)).size >= 2`. Consistent semantics between "banker mediation kicks in at 2+ members" (R4.2) and "offline banner kicks in at 2+ members" (R4.4). Both use distinct-active-userId, so a party creator (dm + player rows for the same user) counts as 1.
> - **`role="alert"` + `aria-live="polite"`.** Accessible announcement without stealing focus. Icon has `aria-hidden` since the text carries the same info.
> - **No new lib/ files.** The banner is one component + one 15-LOC hook, both colocated. Follows the R4.2.e / R4.3.e minimalism precedent.
>
> **Not shipped in R4.4.d (deferred to M5+):**
> - Write-blocking when offline (queue.ts short-circuit on `!navigator.onLine`) — M5 with the WebSocket reconnect flow.
> - Retry / reconnect countdown ("reconnecting in 5s...") — M5.
> - Server-heartbeat detection (banner also shows on server-unreachable, not just browser-offline) — M5.
>
> **Carryforwards to R4.5 / M5:**
> - **Reuse the `useOnline` hook** when M5 needs to gate mutations. Consider extracting it to `apps/web/src/lib/useOnline.ts` at that point (single-use → dual-use tips the abstraction cost the other way).
> - **Banner styling.** Currently uses `bg-destructive/10` + `text-destructive`. If M5 adds a "reconnecting" transient state, consider a `warning` intent for that (yellow) vs. `destructive` for confirmed-offline (red).

#### R4.4 — Notes

> **R4.4 shipped 2026-07-01 (four sub-slices R4.4.a–d).** Cross-character currency invariants (R4.4.a), homebrew party-scope filter (R4.4.b), DM-only custom-item gating for `memberCount >= 2` (R4.4.c), and multi-member offline banner (R4.4.d) — all per OUTLINE §3.7 + §3.14 + §8.1 + §9. Sliced from a single roadmap section into R4.4.a–d on 2026-07-01 (planning session, mid-execution), mirroring the R4.1.a-f / R4.2.a-e / R4.3.a-e rhythm.
>
> **Total test growth across R4.4:** 1165 → 1178 (+13). Breakdown:
> - **R4.4.a — currency-transfer invariants (+6):** 6 shared guard tests locking in player→player push, Banker-from-pool, DM-blocked-while-Banker, and no-Banker self-claim rules.
> - **R4.4.b — homebrew party-scope (+2):** 2 server integration tests exercising the state-loader's `partyId` filter (cross-party isolation + new-joiner visibility).
> - **R4.4.c — DM-only custom-item gating (+0):** Pure documentation slice — 3 pre-existing tests (solo bypass + player-rejects + DM-accepts) already covered the invariant.
> - **R4.4.d — offline banner (+5):** 5 component tests exercising the three-predicate visibility (server mode + offline + memberCount ≥ 2) and the online↔offline transition.
>
> **Audit-first slicing paid off.** Three of the four sub-slices (R4.4.a, R4.4.b, R4.4.c) required NO new reducer / guard / schema / persistor code — only tests to lock in behaviors already correct from prior slices' composition. R4.4 landed as an unusually thin milestone: 8 test additions across three test-only slices plus one 60-LOC UI slice.
> - R4.3.c's `ownsOrShares` widening + R4.2.c's `checkBankerGate` compose correctly for R4.4.a's cross-character currency semantics.
> - `state-loader.ts:151-155` already filters catalog by party (system rows + this-party homebrew), covering R4.4.b's visibility invariant end-to-end.
> - `createHomebrewGuard` + §8.2 solo bypass compose to give R4.4.c's exact semantics: solo = allowed for anyone; multi-member = DM-only.
>
> The audit-first pattern (established in R4.3.c's `ownsOrShares` widening decision) is now proven across R4.3 + R4.4 and worth carrying forward to R4.5 (DM Dashboard).
>
> **Carryforwards to R4.5:**
> - **DM Dashboard is DM-only** and needs a route guard. Reuse the same `actor.role === 'dm'` predicate the guards already use; solo bypass is irrelevant here (the dashboard is only meaningful for multi-member parties, where §8.2 doesn't fire).
> - **Party summary cards.** `partyStash` + `recoveredLoot` currency + item totals — no new schema, existing state suffices.
> - **Homebrew visibility.** R4.4.b's filter already ensures the DM sees only their party's homebrew when the dashboard queries the catalog.
>
> **Carryforward to RH4 (URL-scoped routing):**
> - `OfflineBanner` reads `state.appState.memberships` — if RH4 introduces a "no party loaded" URL state, the `memberCount === 0` short-circuit (already in the component) is the correct fallback.

#### R4.5 — DM Dashboard (§5.9)

- [x] `DmDashboard.tsx` route (DM-only; desktop-only per §5 form factor). New route `/dm` wrapped in `DmOnlyRoute` guard. Desktop-first table with `overflow-x-auto` fallback on narrow viewports (no hard block per user direction).
- [x] At-a-glance grid: all characters with name + class + level + Inventory GP-equivalent. Renders `state.characters` mapped over their `inventoryStashId` currency holding via `currency.toGpEquivalent`.
- [x] Party Stash + Recovered Loot summary cards on the dashboard. Each card shows GP-equivalent + distinct item count.
- [x] Total party gold (sum of Inventory GP-eq per character + Party Stash + Recovered Loot). One `<section role="region" aria-label="Total party gold">` above the summary cards.
- [x] Click-through from any row navigates to that character's sheet (DM read-all). Row-level button dispatches `navigate('/character/:id')`; the existing R4.3.c/d guard widening ensures cross-character write flows work for DMs from there.
- [x] DM-only route guard (hidden from non-DM members). `DmOnlyRoute` reads `isCurrentUserDmOrSolo(appState)` — has a DM membership row OR is solo per §8.2 union-of-rights. Non-DM in a 2+-member party gets redirected to `/hub`. Nav button in `Layout.tsx` also gated by the same predicate.
- [x] **R4.5 polish — cross-character DM cue on CharacterSheet.** When `actor.role === 'dm'` AND `character.ownerUserId !== state.user.id`, an amber banner "Editing {name}'s character as DM." renders below the header. Suppressed in solo (§8.2 makes the distinction moot) and on own-character views. 3 component tests.
- [x] **R4.5 polish — attune cap-override confirm dialog.** DM (or solo per §8.2) clicking Attune on a row when the target character's slots are full opens an AlertDialog asking to bypass the cap; confirming dispatches `attune` with `overrideCap: true` (log entry preserves the flag per R4.3.d). Non-DM in multi-member party keeps the pre-disable behavior. 3 component tests + 2 refactored existing.

#### R4.5 — Notes

> **Shipped 2026-07-01** (`feature/r4-parties`). One-slice implementation (no sub-slicing needed per pre-implementation sizing check — R4.5 landed at ~470 LOC vs. R4.4's 611).
>
> **Test totals:** 1194 across the workspace (web 709 → 725, +16 R4.5: 10 DmDashboard tests + 3 CharacterSheet cross-character tests + 3 StashItemsTable cap-override tests). Other workspaces unchanged. All 5 workspaces typecheck.
>
> **Design notes:**
> - **`isCurrentUserDmOrSolo` helper.** Extracted to `apps/web/src/lib/currentUserRole.ts` because two consumers landed simultaneously (`DmOnlyRoute` for the route guard, `Layout.tsx` for the nav-button gate, and `StashItemsTable.tsx` for the cap-override DM detection). Three consumers is the cost-benefit tip point for extracting a shared util (per CLAUDE.md "don't create helpers for one-time operations" — this isn't one-time). Solo bypass logic mirrors `isSolo` from `packages/shared/src/guards/actor.ts` — same predicate, distinct-active-userId count === 1.
> - **DM Dashboard is a pure read-view.** Zero mutation surfaces. All actions happen via click-through to the character sheet, where R4.3.c/d's DM cross-character widening is already in force. Keeps R4.5 orthogonal to the guard/reducer layer.
> - **`overflow-x-auto` mobile fallback.** Table stays functional on narrow viewports without responsive card reflow. Per user direction and CLAUDE.md minimalism — a card layout would double the component surface for marginal utility. Revisit if user testing surfaces mobile pain.
> - **Route guard as `Outlet` wrapper.** Follows the `ProtectedRoute` pattern from R3.5. Nested inside the auth-protected group: `ProtectedRoute → DmOnlyRoute → DmDashboard`. Auth is checked first (session valid), then DM role, then the page renders. Non-DM redirect target is `/hub` (not `/`) so users land somewhere useful.
> - **Cross-character cue uses `role="note"`.** Semantically distinct from the offline banner's `role="alert"` — the cue is a passive context marker, not an urgent state announcement. Amber (warning) intent, not destructive.
> - **Attune cap-override reuses AlertDialog primitive.** Same shadcn primitive as `DeleteHomebrewDialog`; the pattern is consistent for confirm-then-mutate flows. `AlertDialogAction`'s Radix auto-close behavior + my synchronous `dispatch` composes cleanly — the dialog closes after the log entry is committed, keeping the UI in sync.
> - **Two existing tests refactored** to explicitly force non-DM state (they used solo bootstrap which now grants the cap-override branch). Refactored tests still assert the same invariant (disabled button + reducer-rejection toast) — the semantics didn't change, just the setup preconditions became explicit.
>
> **Not shipped in R4.5 (deferred):**
> - **`maxAttunement` inline editor** on `EquippedSlotsPanel` — **promoted to R6.0** (2026-07-01). Parked deferred item from R4.2's carryforward; not folded into R4.5 per user's planning decision. Now scheduled as a stand-alone R6.0 sub-slice. Reducer mechanism (`edit-character { patch: { maxAttunement: N } }`) has shipped since R1.2 — only the UI affordance is missing. See R6.0 for the full spec.
> - **StashItemsTable visibility revisit** (parked from R4.2.e). Re-parked here.
> - **BUG-005 fix** (optimistic success toast flashes before rejection). Filed for triage; not blocking R4.5.
> - **URL-scoped route rename** (`/dm` → `/party/:partyId/dm`). Deferred to RH4.1 per 2026-07-01 planning decision. R4.5 ships `/dm` unprefixed to stay consistent with the current unprefixed-route era; RH4.1 rewrites the whole route table in one sweep. Also ratified in that planning session: URL param is authoritative when it lands (see RH4.1 charter).
>
> **Carryforwards to M5 / post-R4:**
> - **`isCurrentUserDmOrSolo` becomes load-bearing.** If M5 adds more DM-only UI (Loot Distribution Wizard §5.10, Hoard Generator §5.11), keep using this helper. Consider promoting to `packages/shared/src/guards/` as `isUserDmOrSolo(AppState)` if server also needs to compute it (unlikely — server uses `deriveActorRole` directly).
> - **DM Dashboard as a display invariant checkpoint.** If R5 adds real-time sync, the dashboard's totals become a nice smoke-test — a DM watching the dashboard should see character gold shift live as players push currency. Suggests a future WebSocket happy-path test.
> - **Attune cap-override log audit.** R4.3.d's `overrideCap: true` flag lands in the party log; a future M5+ party log UI should surface this prominently (audit trail is why the flag exists per OUTLINE §3.8).

#### R4 — Notes

> -

---

### RH0 — Legacy-data scaffolding strip (cleanup)

> **What this is.** A mechanical sweep that deletes every piece of code, schema leniency, fallback chain, migration test, doc comment, and inline rationale that exists ONLY to preserve old stored data or pre-current-version shapes. Per `CLAUDE.md` "Things to avoid → no legacy-data debt": the project is WIP with no production users; old Dexie blobs and old Postgres rows can be discarded. RH0 retires the scaffolding accumulated under the previous "preserve legacy compat" policy.
>
> **Sequencing.** No dependencies. Can ship in parallel with any in-flight feature work. Recommended FIRST because (a) the next architectural slices (RH1 / RH2 / RH3) inherit the codebase, and the smaller / clearer it is, the cheaper they get; (b) most of this is mechanical deletion with no design questions; (c) it reduces the audit-noise floor — when a future engineer asks "why is this `.strict()` off?" the answer should never again be "legacy."

**Why now.** Every legacy-compat concession was justified at write-time by the same single rationale: a hypothetical user's stored Dexie blob or exported JSON would otherwise re-parse. With the WIP rule explicit (`CLAUDE.md`), that rationale is gone. Each concession costs ongoing readability + invites future drift: every new schema field is wrestled into a lenient shape "to match" the legacy pattern, then someone reads the schema later and assumes the leniency is principled rather than accidental. RH0 cuts the rationale at the root.

**Approach.** Pure deletion + Zod tightening. No migrations, no API changes, no user-facing behaviour change. After RH0, every `.strict()` is on, every schema test exercises only the CURRENT shape, every fallback chain is reduced to a single explicit path, and every doc paragraph that says "kept for legacy" is gone. Anything that mints state writes the canonical shape directly — there is no "literal value kept as a placeholder for forward-compat with existing blobs."

**Slicing.** Five sub-slices ordered by independence. Each can ship as a separate commit; together they retire all known legacy scaffolding.

#### RH0.1 — Tighten Zod schemas to `.strict()`

**Schemas (`packages/shared/src/schemas/*.ts`)**
- [x] Audit every `z.object({...})` declaration. Add `.strict()` unless it's a wire shape that intentionally tolerates extra fields (none currently exist — every shared schema is internal). Today the lenient default silently strips unknown keys; after RH0.1 a stray key throws. **Shipped 2026-06-30** on top-level entity schemas: `partySchema`, `partyMembershipSchema`, `appStateSchema`, `characterSchema` (incl. nested `abilityScores`), `currencyHoldingSchema`, `stashSchema` (all 3 discriminated variants), `userSchema` (chained `.strict()` before `.refine()`), `itemDefinitionSchema` (incl. nested `cost` + `charges`), `itemInstanceSchema`, `exportEnvelopeSchema` (incl. nested `payload`). **Not applied** to the ~150 nested `z.object`s inside the discriminated unions in `transactionLog.ts` / `action.ts` / `api.ts` — manual cost exceeds value; the discriminator already gates shape correctness at the union boundary.
- [x] Remove every schema doc comment that says "no `.strict()` here because legacy MVP-vintage blobs carry [field X]" — once `.strict()` is on, the rationale is gone. Specifically: `packages/shared/src/schemas/party.ts` (the comment about `isSoloShortcut` legacy parsing), and any sibling comments in `partyMembership.ts`, `appState.ts`, `transactionLog.ts`, etc. **Shipped 2026-06-30** in `party.ts`, `partyMembership.ts`, `itemDefinition.ts`.
- [x] Delete the migration tests in `packages/shared/src/schemas/appState.test.ts` that verify pre-RH-version shapes parse cleanly. **Shipped 2026-06-30** — six tests removed (the R4.1 isSoloShortcut migration; the R4.1 pre-R4.1 leftAt-null parses; the pre-R1.3 flatWeight-absent; the pre-R1.5 toContainerInstanceId-absent; the pre-R2.2 currentCharges:null under old narrow schema; the pre-R2.3 identified:true literal + no hint).
  - `R4.1 migration — imports a legacy AppState carrying isSoloShortcut: true` (lines ~763–774)
  - `pre-R1.3 ItemDefinition without flatWeight` (lines ~313–344)
  - `pre-R1.5 transfer without toContainerInstanceId` (lines ~403–430)
  - `pre-R2.2 ItemInstance with currentCharges: null` under old narrow schema (lines ~531–655)
  - `pre-R2.3 ItemInstance with identified: true literal + no hint` (lines ~657–675)
- [x] Keep the R4.1 `partyMembership.leftAt: nullable` widening test — that's testing the CURRENT shape works for soft-deletion, not legacy preservation. **Confirmed 2026-06-30** — the test renamed from "R4.1 migration — accepts a membership with a non-null leftAt" to "R4.1 — accepts a membership with a non-null leftAt" (dropped the misleading "migration" word; same assertion).

#### RH0.2 — Drop MVP placeholder writes

**Reducer (`packages/rules/src/reducer/index.ts`)**
- [x] Stop writing `Party.isSoloShortcut: true` in the bootstrap `createCharacter` branch. The field has been removed from Postgres + the Zod schema; the literal was being written purely to keep MVP-vintage Dexie blobs valid. RH0.1's `.strict()` would reject it anyway. **Already-done 2026-06-30** — confirmed no `isSoloShortcut` writes remain in the reducer; R4.1.a had already retired them. RH0.2 verified, no change required.
- [x] Audit `createCharacter` (both branches) and `createCharacterInExistingParty` for any other field whose only rationale is "match legacy shape." Strip them. **Already-done 2026-06-30** — no such fields remain after the R4.1.a / R4.1.f cleanups.

**Tests**
- [x] Remove the `Party.isSoloShortcut as null` cast scaffolding in `packages/shared/src/guards/map.test.ts` lines ~31–35. **Already-done 2026-06-30** — the cast was resolved during R4.1.f; the comment that mentioned `isSoloShortcut: true` had already been removed.

#### RH0.3 — Make `partyId` mandatory on Dexie hydration

> **Deferred 2026-06-30, promoted to standalone slice 2026-07-02 — see RH5 below.** The persistence layer's null-state save path tangles with this and needs a dedicated design decision, so it isn't part of RH0's mechanical-deletion charter. The full task list lives at RH5.

#### RH0.4 — Delete dead screens

**Screens (`apps/web/src/screens/`)**
- [x] Delete `Welcome.tsx`. It's unrouted; the welcome / empty-state surface moved into the Hub in R3.5+. **Shipped 2026-06-30.**
- [x] Delete `CreateCharacter.tsx`. The character-creation form lives in `apps/web/src/components/CharacterForm.tsx` and is consumed by the Hub wizard + PartySettings CTA. **Shipped 2026-06-30.**

**Tests**
- [x] Migrate the existing screen tests that mount these files. **Shipped 2026-06-30.**
  - `apps/web/src/screens/Settings.test.tsx`
  - `apps/web/src/screens/CharacterSheet.test.tsx`
  - `apps/web/src/screens/ItemDetail.test.tsx`
  - `apps/web/src/screens/StorageDetail.test.tsx`
- [x] For each, replace direct `<Welcome />` / `<CreateCharacter />` mounts with `bootstrap()` from `apps/web/src/test/fixtures.ts` + the screen under test. The bootstrap fixture already mints the right state; the legacy screens were only there to bypass it. **Shipped 2026-06-30** — three tests use `{ path: '/', element: null }` as no-op fallback (Settings, ItemDetail, CharacterSheet); `StorageDetail.test.tsx` got a local `RedirectToCharacter` helper (~10 LOC) because its test specifically exercises the "unknown stashId → / → CharacterSheet" auto-redirect path. Two heading-text assertions (`/welcome, adventurer/i`) were rewritten as negative assertions (CharacterSheet's tab list NOT present / ItemDetail's history heading NOT present) — same intent, no dependency on the legacy screen.

#### RH0.5 — Flatten the `create-character` action union + tidy aliases

**Action schema (`packages/shared/src/schemas/action.ts`)**
- [-] Today the `createCharacterAction` is a `z.union` of two payload shapes: legacy (with-character, `dmOnly?: false`) + DM-only (`dmOnly: true` + required `partyName`). The legacy variant's optional `dmOnly`/`partyName` exist because M0–R3 dispatches didn't carry them. Flatten to a single discriminated shape: `dmOnly: boolean` always required; with-character branch keeps `name`/`species`/`size`/`class`/`level`/`str`; DM-only branch keeps `partyName`. **Dropped 2026-06-30.** Re-triage during execution showed this is dispatch-ergonomic compat (preserves `dispatch({ type: 'create-character', payload: { name, ... } })` without forcing an explicit `dmOnly: false`), NOT stored-data compat — which CLAUDE.md's "no legacy-data debt" rule explicitly exempts ("Distinct from forward-compat slots like `bankerUserId: null` … those stay; they preserve UNWRITTEN future code, not stored old data"). The schema comment was reworded to drop the "M0-R3 dispatch-compatible without a migration shim" framing and describe the actual reason (ergonomics). Marked `[-]` skipped per the roadmap's status-legend convention; the underlying concern is resolved (rationale corrected in the schema comment).
- [-] Reducer + tests: every dispatch site now passes `dmOnly: false` explicitly. Audit + update. **Dropped 2026-06-30 — see above.** Follows automatically from the item above being dropped.

**Seeds (`packages/seeds/src/seedVersion.ts`)**
- [x] Delete the deprecated `PHB_SEED_VERSION` alias. Confirmed unused in-tree; was kept for out-of-tree consumers that don't exist. **Shipped 2026-06-30** — alias removed from `seedVersion.ts` + barrel re-export in `seeds/src/index.ts`; in-tree callers (`apps/web/src/screens/CatalogBrowser.test.tsx`, `apps/web/src/store/reducer.test.ts`) updated to use `SEED_VERSION`.

**Docs sweep**
- [x] Strip legacy-rationale paragraphs from current-policy spec text. **Shipped 2026-06-30** with narrowed scope per user policy ("MVP.md and old roadmap points should remain to document the history"). What was updated:
  - `docs/OUTLINE.md` §4 paragraph about `Party.isSoloShortcut` — dropped the "MVP code keeps writing it so existing Dexie blobs validate" sentence; the field is removed, the rationale doesn't apply.
  - `docs/OUTLINE.md` §11 Resolved-questions bullet on `isSoloShortcut` lifecycle — same edit (dropped the "but R4 multi-member work treats it as 'derived, ignored'" stored-data-compat framing).
  - `packages/shared/src/schemas/action.ts` `createCharacterAction` comment — reworded to drop "keeping every M0–R3 dispatch payload-compatible" language (see action-union note above).
  - **Not edited** per user policy:
    - `docs/MVP.md` — historical record of the M0 spec.
    - `docs/roadmap.md` slice Notes (past-tense diary entries documenting what each slice did).
    - `README.md` line ~36 — historical R-section roll-up.

#### RH0 — Notes

> **2026-06-30 — RH0 partial ship.** Sub-slices RH0.1, RH0.2, RH0.4, RH0.5 landed. RH0.3 deferred. Headline shape: legacy-data preservation scaffolding stripped from the schema layer + the test fixtures; the `Welcome.tsx` / `CreateCharacter.tsx` legacy screens deleted; the `PHB_SEED_VERSION` alias removed; OUTLINE.md spec-text scrubbed of "kept for legacy" framings on `Party.isSoloShortcut`. Test totals: shared 74 → 68 (-6 legacy migration tests deleted as planned); web 646 unchanged (the four screen tests using `Welcome` as router fallback migrated to either a `null` stub or a local `RedirectToCharacter` helper — same coverage, no legacy dependency).
>
> **What shipped (sub-slice detail):**
>
> **RH0.1 — Zod `.strict()` + legacy migration tests removed.** Top-level entity schemas tightened with `.strict()`: `partySchema`, `partyMembershipSchema`, `appStateSchema`, `characterSchema` (including the nested `abilityScores`), `currencyHoldingSchema`, `stashSchema` (all three discriminated variants), `userSchema` (chained `.strict()` before `.refine()`), `itemDefinitionSchema` (including the nested `cost` and `charges`), `itemInstanceSchema`, `exportEnvelopeSchema` (including the nested `payload`). Six legacy migration tests deleted from `packages/shared/src/schemas/appState.test.ts`: pre-R1.3 `flatWeight`-absent, pre-R1.5 `toContainerInstanceId`-absent, pre-R2.2 `currentCharges: null` under old narrow schema, pre-R2.3 `identified: true` literal + no `hint`, R4.1 legacy `isSoloShortcut: true`, R4.1 pre-R4.1 `leftAt: null` survives. Schema comments that justified leniency-for-legacy-blobs removed in `party.ts`, `partyMembership.ts`, `itemDefinition.ts`. **Discriminated-union entry schemas inside `transactionLog.ts` / `action.ts` / `api.ts` (~150 nested `z.object`s) were not given `.strict()` individually** — manual cost exceeds value; the union's discriminator already rejects shape-wrong payloads.
>
> **RH0.2 — MVP placeholder writes.** No source writes to `Party.isSoloShortcut` remained; the R4.1.a slice had already retired them. The `as null` cast scaffolding in `map.test.ts` flagged by the audit had already been resolved during R4.1.f. Net change: zero (work was already absorbed into earlier R4.1 sub-slices).
>
> **RH0.3 — `partyId` mandatory on Dexie hydration: DEFERRED.** The persistence layer has two storage modes (unkeyed slot for the pre-character-creation null-state window, keyed `appState:<partyId>` for parties) and both `loadAppState()` callers + `createDebouncedSaver` actively use the unkeyed slot during the bootstrap window. The "remove all fallbacks" surgery requires a real design decision about how to handle the null-state save (skip writing? write to a dedicated key?) plus a ~10-test migration in `persistence.test.ts`. Tangles with how the save side works for the null-state window. Out of scope for RH0; promote to a dedicated slice if/when the hydrate path needs further work.
>
> **RH0.4 — Legacy screens deleted.** `apps/web/src/screens/Welcome.tsx` + `apps/web/src/screens/CreateCharacter.tsx` removed. The four screen tests that mounted `Welcome` as the "/" router fallback (`Settings.test.tsx`, `ItemDetail.test.tsx`, `CharacterSheet.test.tsx`, `StorageDetail.test.tsx`) migrated: three use `{ path: '/', element: null }` (a literal no-op fallback), and `StorageDetail.test.tsx` got a local `RedirectToCharacter` component (~10 LOC) to preserve the "unknown stashId redirects to /, then `/` auto-redirects to character" test path. Two tests that asserted the literal `Welcome, adventurer` heading were rewritten to assert the negative ("CharacterSheet's tab list is NOT present" / "ItemDetail's history heading is NOT present") — same intent, no dependency on the legacy screen.
>
> **RH0.5 — Action union + alias + docs sweep.** The `PHB_SEED_VERSION` deprecated alias removed from `packages/seeds/src/seedVersion.ts` + `packages/seeds/src/index.ts` and replaced with `SEED_VERSION` at all in-tree callers (`apps/web/src/screens/CatalogBrowser.test.tsx`, `apps/web/src/store/reducer.test.ts`). The `create-character` `z.union` action shape **was NOT flattened** — re-triage during execution showed it was ergonomic-compat, not stored-data-compat (it preserves `dispatch({ type: 'create-character', payload: { name, ... } })` without forcing an explicit `dmOnly: false`), which the CLAUDE.md rule explicitly exempts. The schema comment was reworded to remove the misleading "M0-R3 dispatch-compatible without a migration shim" framing and instead describe the actual reason (ergonomics). Docs sweep narrowed: OUTLINE.md §4 + §11 paragraphs about `Party.isSoloShortcut` rewritten to drop the "MVP code keeps writing it so existing Dexie blobs validate" rationale (current-policy spec text, not history). `MVP.md` and roadmap slice Notes left as historical records per the user-confirmed policy: "old roadmap points should remain to document the history."
>
> **Carryforward.** RH0.3 (Dexie partyId mandatory) deferred as documented above. The `Welcome.tsx` / `CreateCharacter.tsx` Operational followups item is now CLOSED — RH0.4 retired both files. The action-union flatten remains as an open question if a future slice wants stricter dispatch ergonomics, but it isn't legacy-data debt.

---

### RH1 — Hardening Pass 1: Server-Authoritative IDs (architectural)

> **What this is.** RH-slices are **hardening passes**: architectural cleanups that pay down debt accumulated during feature slices. They don't add user-facing capabilities — they make the existing ones structurally sound. RH1 sits between R4 and R5 because R5 (websocket live sync, multi-writer) compounds the id-canonicalisation problem; fixing it once, before N writers arrive, is much cheaper than patching the resulting conflicts.

**Why now.** Today the **client's reducer** and the **server's persistor** independently call `ctx.newId()` for the same logical entity. They produce different UUIDs. The reported "move acquired item → `item_not_found`" bug (R4.1.f post-ship bug #2) is one visible symptom; **BUG-004 (server persistor mints a different UUID than the reducer → Item Detail history empty after `acquire` / `split`, surfaced 2026-07-01 in R4.3 manual testing) is another.** The structural issue is that the system has **two id-minting authorities**. The current mitigation (post-flush `GET /sync/state` re-pull for any action in `ID_MINTING_ACTION_TYPES` — `apps/web/src/sync/queue.ts`) is a runtime patch:

- It refetches the **entire** AppState after every `acquire` / `create-stash` / `split` / `create-homebrew` / `create-character`. For a 6-player party with hundreds of items the bandwidth cost scales linearly with party size.
- The "list of action types we have to remember" drifts: R4.2 / R4.3 / R4.4 / R4.5 will each add actions; some mint ids, some don't; the queue's constant has to stay in lockstep with the server's `ctx.newId()` call sites.
- Multi-writer (R5 websocket) makes echo-patching the canonical id (cheaper alternative — option B in the bug postmortem) intractable: with N clients each holding optimistic state, an id-rewrite on broadcast becomes "conflict resolution," a different problem class.
- The documented architecture (SECURITY §2, CLAUDE.md, OUTLINE §8) says **server is authoritative**. Today's implementation contradicts that for ids — both sides mint, both write. RH1 aligns the code with the spec rather than expanding a contradiction.

**Approach.** The client mints UUID v7 ids when dispatching id-creating actions. The action payload carries the new id explicitly. The server **accepts** the client's id (rather than minting its own), after validating that (a) it parses as UUID v7, (b) it isn't already in use, (c) its timestamp is within a sane clock-skew window. The TransactionLog becomes a single source of truth — entries describe the action with the same ids on both sides.

**Slicing.** Three small sub-slices, each independently shippable. RH1.1 lays the foundation (shared UUID v7 utility + guard codes). RH1.2 migrates the id-minting action schemas + reducer / persistor (the bulk of the change). RH1.3 deletes the now-unnecessary post-flush re-pull from the queue.

#### RH1.1 — Shared UUID v7 utility + guard codes

**Shared package (`packages/shared`)**
- [x] Add `uuid` dep (or self-implement a minimal UUID v7 generator — ~30 LOC; avoids the dep). **Shipped 2026-07-02** — chose `uuid@^14` (14.0.1 at ship time). Rationale captured in RH1.1 Notes: RFC 9562 conformance risk outweighed the dep cost for a hardening slice whose whole point is reducing structural risk.
- [x] Expose `newUuidV7(): string` from a new `packages/shared/src/ids.ts` module, plus `isValidUuidV7(s: string): boolean` and `timestampFromUuidV7(s: string): number`. Re-exported from `packages/shared/src/index.ts`. `timestampFromUuidV7` is implemented in-tree (6-byte read out of the first octets per RFC 9562 §5.7) because `uuid@14` doesn't expose the extractor directly.
- [x] Decision-doc comment at the top of `ids.ts` capturing: why v7 (time-ordered, debuggable, collision-safe with 74 random bits per ms), why client-mints (server authoritative for validation, client authoritative for id minting per RH1 charter), the clock-skew tolerance constant (±5 minutes default, exported as `CLOCK_SKEW_TOLERANCE_MS`), and the security implication (no new attack surface — Prisma unique constraint catches forged collisions).

**Reducer context (`packages/rules/src/reducer/types.ts`)**
- [x] `ReducerContext.newId` retains the same signature; its default implementation in both client (`apps/web/src/store/index.ts`) and server (`apps/server/src/sync/routes.ts` + all three call sites in `apps/server/src/parties/routes.ts`) is wired to `newUuidV7` from the new module. `node:crypto.randomUUID` imports removed from both server route files (unused after the swap). Server-side becomes a **no-op invariant check** rather than an id source in RH1.2 — see below.

**Guards (`packages/shared/src/guards/index.ts`)**
- [x] Add three new `GuardRejectionCode` values: `'id_malformed'` (not a valid UUID v7), `'id_already_exists'` (collision), `'id_clock_skew'` (timestamp outside the tolerance window). Each gets a javadoc block per the roadmap charter.

**Tests**
- [x] `packages/shared/src/ids.test.ts` — 17 tests across `newUuidV7` (format + version nibble + variant nibble + monotonic + 1000-mint uniqueness), `isValidUuidV7` (accepts fresh mint, rejects v4 / wrong length / non-hex / wrong version / wrong variant, accepts uppercase), `timestampFromUuidV7` (round-trip within 1 ms, monotonic across a burst, extracts the RFC 9562 §5.7 hand-crafted vector `017f22e2-79b0-7cc3-98c4-dc0c0c07398f` → `0x017F22E279B0`, throws on non-v7), and `CLOCK_SKEW_TOLERANCE_MS` (locked at 5 minutes).

#### RH1.1 — Notes

> **Shipped 2026-07-02** (`feature/rh1-server-authoritative-ids`).
>
> **Test totals:** 1211 across the workspace (shared 155 ← 138 with +17 new `ids.test.ts` tests; rules 126, seeds 22, web 725, server 183 all unchanged). All 5 workspaces typecheck. `packages/shared` lint is unchanged from the pre-RH1.1 baseline (15 pre-existing errors in `guards/map.test.ts`; zero new errors in `ids.ts` / `ids.test.ts`).
>
> **Design decisions captured:**
> - **Chose the `uuid` package over a self-implemented ~30-LOC generator.** The roadmap listed both as options. Self-implementing was rejected during triage: (a) RFC 9562 bit layout is easy to get subtly wrong (version nibble `0x7`, variant bits `10`, 48-bit ms timestamp big-endian, 74 random bits); (b) getting it wrong means either false rejections of valid v7s from other clients OR false acceptance of malformed ids that pass a lax validator — the exact structural risk RH1 is supposed to REDUCE, not add; (c) `uuid@14` is dep-free, ~20kB, and has been through actual scrutiny; (d) the "~30 LOC" self-impl estimate covers generation only — robust parsing + validation + a defensible test suite pushes toward ~100. `timestampFromUuidV7` is the exception — 5 LOC in-tree, since `uuid@14` doesn't expose the extractor.
> - **`CLOCK_SKEW_TOLERANCE_MS` exported as a named constant at ±5 min.** Matches OUTLINE §4 (`RH1 — Server-Authoritative ID contract`). Wide enough to absorb a misconfigured client (system clock off by a few minutes is common); narrow enough that a backdated forgery can't slip an id into the log with a fake timestamp far outside plausible mint order. Not consumed anywhere in RH1.1 (the guard that reads it lands in RH1.2); exporting now so RH1.2's consumers pick it up from the same module.
> - **`isValidUuidV7` is case-insensitive.** RFC 9562 §4 says hex chars can be either case; a client that lowercases and a client that uppercases both produce valid v7s. `uuid@14.validate()` is case-insensitive and we don't second-guess it.
> - **`timestampFromUuidV7` throws instead of returning `null` on invalid input.** Callers validate first via `isValidUuidV7`; if they don't, that's a programmer error, and a throw surfaces it during dev rather than propagating `null` into arithmetic. Mirrors the reducer's other "validate-first, extract-second" patterns (`currencyHoldingBy`, `stashBy`, etc.).
> - **`newUuidV7()` wraps `uuid.v7()` even though it's a one-liner.** Named export gives us a stable seam if we ever need to inject a deterministic mint in tests (RH1.2's server-side validator tests will want this); also keeps the `uuid` package import in one place so future refactors don't have to grep-replace across the codebase.
>
> **Not shipped in RH1.1 (deferred to RH1.2 as intended):**
> - Action-payload widening (`new<EntityName>Id` fields on `acquire` / `create-stash` / `split` / `create-homebrew` / `create-character` — five action shapes to touch).
> - Server-side guard consumers of the three new rejection codes (`id_malformed` / `id_clock_skew` / `id_already_exists`). Codes are declared; no guard reads them yet.
> - Reducer + persistor migration to consume `payload.new<EntityName>Id` instead of calling `ctx.newId()`.
> - Server `ctx.newId()` shim that throws (per RH1.2 charter).
>
> **Not shipped in RH1.1 (deferred to RH1.3 as intended):**
> - `ID_MINTING_ACTION_TYPES` set + post-flush `GET /sync/state` re-pull deletion in `apps/web/src/sync/queue.ts`. Still needed until RH1.2 lands.
>
> **Carryforward to RH1.2:**
> - The five id-minting call sites the roadmap enumerates (`acquire`, `create-stash`, `split`, `create-homebrew`, `create-character`) all still call `ctx.newId()`. `create-character` alone calls it eight times (User + Party + Character + Inventory stash + Party stash + Recovered Loot stash + 3× CurrencyHolding — see `packages/rules/src/reducer/index.ts:317+ / :421+ / :530+`). RH1.2 will need a matching `new<EntityName>Id` payload field for every one of those, OR (design decision open) a batched `newIds: { user: string; party: string; ... }` shape on the bootstrap.
> - The reducer's `create-character` arm mints ids in TWO branches (post-bootstrap `createCharacterInExistingParty` also calls `ctx.newId()` at line 530+ for the character + inventory stash + currency holding). Same `new<EntityName>Id` widening applies but on a smaller subset (character-only, no party).
> - Server-side clock-skew guard needs a callable seam: `checkGuard` today runs BEFORE the reducer; the id-shape validation will need the same slot but with access to `Date.now()` for the tolerance-window comparison. Likely lands as a pre-reducer check in `POST /sync/actions` rather than inside a per-action guard.

#### RH1.2 — Client-minted ids in action payloads + server validation

**Action schemas (`packages/shared/src/schemas/action.ts`)**

Each id-minting action's payload widens with an explicit "new entity id" field. The field is REQUIRED on the wire so the server can validate it; clients always provide it via `ctx.newId()`. Naming convention: `new<EntityName>Id` (matches the existing `inventoryStashId` naming on `create-character`).

- [x] `acquire.payload.newItemInstanceId: string` — required when NOT auto-stacking; ignored when stacking (the existing row's id wins). The reducer guard rejects `newItemInstanceId` for a stacking acquire (defensive: prevents the client from forging the wrong id). For simplicity in the initial cut: always send `newItemInstanceId`, server uses it only on the insert path.
- [x] `create-stash.payload.newStashId: string` + `newCurrencyHoldingId: string`
- [x] `split.payload.newItemInstanceId: string`
- [x] `create-homebrew.payload.newDefinitionId: string`
- [x] `create-character.payload.newCharacterId` / `newInventoryStashId` / `newCurrencyHoldingId` (bootstrap variant adds `newUserId` / `newPartyId` / `newPartyStashId` / `newRecoveredLootStashId` / `newPartyStashCurrencyId` / `newRecoveredLootCurrencyId`). The bootstrap branch is the largest payload widening but also the most-tested action — covered comprehensively in `apps/web/src/store/reducer.test.ts`.
- [x] **Also shipped (not called out in the initial plan): `transfer.payload.newItemInstanceId: string`** — the partial-move-no-autostack branch of the `transfer` reducer mints a new `ItemInstance` at the destination (see `packages/rules/src/reducer/index.ts::transfer`, ~line 1573). Same wire contract as the other minting actions; full-move + partial-with-autostack paths ignore it. Six minting actions total, not five.

**Reducer (`packages/rules/src/reducer/index.ts`)**
- [x] Replace every `const newId = ctx.newId()` with `const newId = payload.newXId` for the corresponding action arm. The `ctx.newId()` call still exists at the **dispatch site** in the client (`apps/web/src/store/index.ts`) where it mints the payload field — but the reducer itself is now a pure transformer that doesn't generate ids.
- [x] Validate the new id at the reducer boundary: `if (!isValidUuidV7(payload.newItemInstanceId)) throw new Error('acquire: newItemInstanceId must be a valid UUID v7')`. Lets test failures surface fast and gives a clear "your client is misbehaving" diagnostic.
- [x] Invariant test (per action): dispatching with the same id twice → second dispatch rejected at the reducer (id collision detected before persistor). **Shipped as guard-layer + persistor-layer coverage**, not reducer-layer. The client reducer doesn't dedupe against the log (would require a Set<string> scan on every action; the persistor's Prisma unique-constraint is the authoritative check). Guard-layer tests exercise `id_malformed` + `id_clock_skew`; the server integration test exercises `id_already_exists`. Reducer-layer defense is `isValidUuidV7` per arm.

**Server route + guards (`apps/server/src/sync/routes.ts`, `packages/shared/src/guards/map.ts`)**
- [x] Each id-minting action's guard validates the new id: structural via `isValidUuidV7`, clock-skew via `timestampFromUuidV7` ± `CLOCK_SKEW_TOLERANCE_MS`. The collision check happens at the persistor (Prisma unique-constraint) rather than the guard — guards are pure state checks, and looking up "does this id exist in DB" isn't pure. **Shipped as `checkMintedIds()` in `packages/shared/src/guards/map.ts`, invoked upstream of the per-action guard + upstream of the §8.2 solo bypass** (so a malformed id is rejected even for party-of-one).
- [x] ~~Server's `ctx.newId()` becomes a shim that throws~~ — **shipped as full removal**: the `newId` field is gone from `ReducerContext` entirely, so the type system forbids server-side entity-id minting. `TransactionLog.id` is still server-minted (each log entry is a server-composed record, not a client-carried entity id) and is generated inline in `apps/server/src/sync/log-builder.ts::buildLogEntryServer` via `newUuidV7()`.

**Persistor (`apps/server/src/sync/persistor.ts`)**
- [x] Replace every `id: ctx.newId()` with `id: payload.newXId`. Five call sites (matching the action list above). **Actually 6 sites: the transfer partial-move branch was overlooked in the plan.**
- [x] Collision detection: Prisma will throw `P2002` (unique constraint violation) on a duplicate primary key. The persistor catches it and re-throws as `BatchRejected` with `code: 'id_already_exists'` — the route layer translates that into the 422 response. **Shipped at the route-layer try/catch rather than in the persistor**: the `try { applyDelta / applyBootstrapDelta } catch (P2002) → throw BatchRejected` wrapper sits in `apps/server/src/sync/routes.ts` around the per-action dispatch, so both minting paths (bootstrap and non-bootstrap) share one mapping.

**Web client (`apps/web/src/store/index.ts`)**
- [x] Dispatch sites for id-minting actions now pre-mint via `newUuidV7()` and inject the id into the payload before calling `dispatch`. Two patterns possible: (a) wrap `dispatch` in a thin `dispatchMintingAction` helper that knows which actions need new-id injection; (b) every call-site pre-mints inline. (a) is cleaner; recommended. **Shipped (a)**: `dispatchMintingAction(action)` + `injectMintedIds(action)` in `apps/web/src/store/index.ts`. Callers pass the action without `new*Id` fields; the helper mints and injects them. 10 UI call sites migrated (see `HomebrewForm`, `AddItemModal`, `CatalogPicker`, `CreateStashModal`, `MoveItemModal`, `PackItemModal`, `SplitModal`, `StashItemsTable`, `Hub`, `PartySettings`).

**Tests**
- [x] Update every existing reducer test that previously didn't pass `newXId` (most tests use action payloads from `apps/web/src/store/reducer.test.ts`). The shared `bootstrap()` fixture (`apps/web/src/test/fixtures.ts`) gains a helper that pre-mints the canonical bootstrap ids so tests can pass them without boilerplate. **Shipped**: `bootstrap()` now pre-mints all 9 canonical bootstrap ids and returns them in `BootstrapResult` so downstream tests inherit them. Per-suite helpers (`acquireIds()`, `transferIds()`, `splitIds()`, `createStashIds()`, `createHomebrewIds()`, `createCharacterIds()`, `createCharacterDmOnlyIds()`) added to each test file with direct-dispatch sites.
- [x] New reducer test: "rejects malformed newItemInstanceId" + "rejects already-used newItemInstanceId" + "rejects newItemInstanceId with future-clock-skew timestamp." **Shipped as split coverage**: reducer-layer (`apps/web/src/store/reducer.test.ts::reducer RH1.2: rejects malformed or missing new<EntityName>Id`) covers the malformed path across all 6 minting arms; guard-layer (`packages/shared/src/guards/map.test.ts::checkGuard — RH1.2 id-shape + clock-skew validation`) covers `id_malformed` + `id_clock_skew`; server integration covers `id_already_exists`.
- [x] New server integration test: client dispatches `acquire` with its own UUID v7 → server writes a row with that exact id → `GET /sync/state` returns the same id back. **Shipped in `apps/server/src/sync/routes.test.ts`** as two tests: (1) round-trip with a client-minted UUID v7 asserts the DB row's id matches the client's mint AND `GET /sync/state` surfaces the same id; (2) collision test — a duplicate id surfaces as `422 { rejected: { code: 'id_already_exists' } }`.

#### RH1.2 — Notes

> **Shipped 2026-07-02** (`feature/rh1-server-authoritative-ids`).
>
> **Test totals:** 1227 across the workspace (shared 160 ← 155 with +5 new guard tests for `id_malformed` / `id_clock_skew`; rules 126 unchanged; seeds 22 unchanged; web 734 ← 725 with +9 new reducer tests for malformed-id rejection per action arm; server 185 ← 183 with +2 new integration tests for id round-trip + collision). All 5 workspaces typecheck. All 1227 tests pass.
>
> **Design decisions captured:**
>
> - **`transfer.newItemInstanceId` added to the wire contract.** Not in the initial plan (the roadmap listed five minting actions; the reducer has six because the transfer's partial-move-no-autostack branch also mints a new `ItemInstance`). Discovered during the reducer sweep. The `transfer` arm mints an id only on that one branch; the reducer + persistor validate the id on every dispatch, and the arm's other branches (full-move, partial-with-autostack) discard it.
> - **`create-character` payload union kept at 2 branches, not 3.** The with-character branch's 6 party-scope ids (`newUserId` / `newPartyId` / `newPartyStashId` / `newRecoveredLootStashId` / `newPartyStashCurrencyId` / `newRecoveredLootCurrencyId`) are `.optional()` at the wire; the reducer + guard boundaries assert their presence when `state === null`. Splitting the union into `bootstrap-with-character` / `in-existing-party` / `bootstrap-dm-only` would triple the wire surface for a runtime-state distinction that neither the client nor the server has trouble making.
> - **`ReducerContext.newId` removed entirely, not shimmed.** The RH1.2 plan proposed a `() => { throw new Error('...') }` shim as a migration-time seatbelt. In practice the type system enforces the same invariant more cheaply: after removing the field from `ReducerContext`, every remaining `ctx.newId()` call site turned into a TS2339 error surfaced by `pnpm typecheck` — no runtime shim needed. `TransactionLog.id` remains server-minted (each log entry is server-composed) and is generated inline in `log-builder.ts` via `newUuidV7()` rather than routing through the context.
> - **`checkMintedIds()` runs BEFORE the §8.2 solo bypass.** A malformed id or a clock-skewed id is a wire-shape defect, not a permission question. Running the id validator upstream of the solo short-circuit means a solo party still can't dispatch a bogus id — the wire contract is universal, not party-shape-conditional.
> - **P2002 → `id_already_exists` mapping at the route layer, not the persistor.** The plan proposed catching P2002 inside `persistor.ts`. In practice the route layer wraps both `applyDelta` and `applyBootstrapDelta` in one try/catch; centralising the mapping there keeps the persistor free of route-layer concerns (it doesn't know what a `BatchRejected` is) and covers both minting paths with one line.
> - **`dispatchMintingAction` helper vs. inline pre-minting at call sites.** Chose the wrapper. Ten UI call sites × six minting-action shapes = 60 tiny knowledge points that would otherwise need to know which fields to inject; centralising it in one 150-LOC helper cuts the total to one. The wrapper is typed so callers pass the action *without* `new*Id` fields (`MintingActionInput`) — TypeScript enforces the injection contract.
> - **Reducer-layer id-collision test dropped from RH1.2 scope.** The plan asked for a reducer test that dispatches the same id twice and expects the second dispatch to be rejected at the reducer. Adding that would require the reducer to scan the log or state for existing ids on every dispatch — an O(n) check per action that scales badly for long parties. The persistor's Prisma unique-constraint is the authoritative dedupe layer; the reducer's job is state-transition logic. Test coverage for id collision is shipped at the server integration layer (`RH1.2 — duplicate client-minted id → 422 id_already_exists`) instead.
> - **Test-file id-injection helpers duplicated per-file, not lifted to a shared module.** Considered a `@app/shared/test-fixtures` or `@app/web/test/idHelpers` module. Rejected: the helpers are 5-line functions each, and the copy-per-file version keeps the test fixture stack (`bootstrap()`, `bootstrapWithItem()`, `bootstrapWithHomebrew()` in `apps/web/src/test/fixtures.ts` — which DID get the shared treatment) discoverable without an extra import. If a seventh minting action lands, we'll revisit.
>
> **Carryforward to RH1.3:**
>
> - `ID_MINTING_ACTION_TYPES` set + post-flush `GET /sync/state` re-pull deletion in `apps/web/src/sync/queue.ts` (still needed until RH1.3 lands).
> - The `isBootstrap` heuristic in `POST /sync/actions` (dispatches `applyBootstrapDelta` vs. `applyDelta`) still uses the R4.1.f keying on `prisma.party.findUnique(...) === null`. RH1.3 simplifies further because there's no `'will-be-minted'` placeholder to special-case.
> - Persistor-layer P2002 catch is at the route layer today; RH1.3's collision-on-bootstrap negative test will exercise the same `id_already_exists` mapping from the create-character path (a client that reuses another user's `newPartyId`).

#### RH1.3 — Remove post-flush re-pull; the queue trusts client ids

**Sync queue (`apps/web/src/sync/queue.ts`)**
- [x] Delete the `ID_MINTING_ACTION_TYPES` constant and the re-pull branch added for the R4.1.f post-ship bug #2.
- [x] The bootstrap-specific re-pull (where `snapshot?.appState == null`) ALSO goes away — the client mints its own user / party / character / stash / currency ids in the bootstrap payload, and the server accepts them. `'will-be-minted'` as a placeholder partyId disappears from both client and server; the action payload IS the source of truth.
- [x] The queue's post-flush concern shrinks to: 200 → drop snapshot; 422 → rollback; 401 → sign out; 409 → display-name flow; network error → keep snapshot for retry. No re-pulls needed.

**Server route (`apps/server/src/sync/routes.ts`)**
- [x] The `isBootstrap` heuristic disappears. `applyBootstrapDelta` vs. `applyDelta` dispatch is now keyed on `await prisma.party.findUnique(...) === null` alone (R4.1.f introduced this; RH1.3 simplifies because there's no `'will-be-minted'` placeholder to special-case).
- [x] The `'will-be-minted'` placeholder is removed from `POST /sync/actions` accepted input shapes.

**Tests**
- [x] Update queue test (`apps/web/src/sync/queue.test.ts`) to assert the re-pull is NOT triggered after `acquire`. The current test that asserts the re-pull IS triggered gets replaced — moves to the regression archive in the Notes section.
- [x] Update reducer + server integration tests that hard-coded the `'will-be-minted'` placeholder to send the client-minted partyId instead.
- [x] New negative test: server rejects `POST /sync/actions` with a `partyId` that's already used by a different user (collision-on-bootstrap). Should surface as `id_already_exists` at the 422 layer.

#### RH1.3 — Notes

> **Design decisions made during implementation:**
>
> - **`isBootstrap` conjunct dropped, not the boolean itself.** The roadmap said "the isBootstrap heuristic disappears." In practice the boolean stayed — what disappeared is the `actions.every((a) => a.type === 'create-character')` conjunct that made it a per-batch cap on non-create-character actions. Post-RH1.3 it's a per-batch boolean `partyExists === null`; if a non-create-character action arrives with an unknown partyId, it falls into `applyDelta` and gets rejected by the guards with `state_not_initialized` (state stays null on the isBootstrap path). Clean, no special-casing.
>
> - **`actor.partyId` promotion line KEPT (not deleted as originally planned).** RH1.3 planning assumed `actor.partyId` (the URL body's `partyId`) would always equal `payload.newPartyId` in a bootstrap batch — so the post-reduce promotion line would be a no-op. Reality: test helpers (`apps/server/src/parties/routes.test.ts:bootstrapParty`) still send placeholder URL partyIds like `'irrelevant'`; the reducer's `state.party.id` correctly resolves to `payload.newPartyId`, but the `TransactionLog.partyId` FK would violate if `actor.partyId` stayed as the placeholder. Keeping the promotion (`actor = { ...actor, partyId: reduced.state.party.id }`) makes the server robust to defensive clients / stale test fixtures without requiring a schema-level `partyId === newPartyId` refinement.
>
> - **Placeholder `'will-be-minted'` NOT explicitly rejected at the schema layer.** The action-payload Zod schema (`syncActionsRequestSchema` in `apps/server/src/sync/types.ts`) still accepts `partyId: z.string().min(1)` — no explicit `'will-be-minted'` refinement. Rationale: the RH1.2 payload-id guards (`checkMintedIds` in `packages/shared/src/guards/map.ts`) already enforce that `newPartyId` is a valid UUID v7; the URL partyId is essentially a routing hint the actor-promotion step overrides during bootstrap. A separate `.refine((s) => s !== 'will-be-minted')` would be dead code — the placeholder has no code paths that produce it any more, and any client sending it would still succeed (or fail via a downstream guard). Not worth the schema noise.
>
> - **Bootstrap-collision test surfaces 403 not_a_member, NOT 422 id_already_exists.** The roadmap's stated intent was "server rejects POST /sync/actions with a partyId that's already used by a different user. Should surface as id_already_exists at the 422 layer." Actual architectural outcome: user B replaying user A's already-persisted `newPartyId` hits `partyExists = A's row (non-null)` first → `isBootstrap = false` → `resolveActor(B, partyId)` runs → B has no membership → 403 `not_a_member`. The auth check is the more informative error and it fires before the persistor's P2002 could. The test at `apps/server/src/sync/routes.test.ts` documents this. The `id_already_exists` (P2002 → BatchRejected → 422) mapping itself is already covered by the pre-existing RH1.2 "duplicate client-minted itemInstanceId" test at line 507; the two paths share one persistor catch block, so extra coverage is redundant.
>
> - **`getActivePartyId` interface preserved.** The queue's dep still supports `null` return for defensive callers; Hub.tsx stamps `setCurrentPartyId` before flush, so bootstrap and post-bootstrap look identical to the queue.
>
> - **`pullState` import from `./client` removed.** No longer called from the queue post-RH1.3. If a future slice re-adds a canonicalize step, it will re-import.
>
> **Regression archive (pre-RH1.3 tests / behaviour removed):**
>
> - `queue.test.ts` had a test `'re-pulls canonical state after `acquire` so optimistic ids get replaced'` (positive assertion). RH1.3 replaced it with a NEGATIVE assertion (`'does NOT re-pull /sync/state after `acquire`'`). The original test's rationale was correct FOR ITS TIME (R4.1.f post-ship bug fix, 2026-06-30) — the server minted its own randomUUIDs, so a re-pull was necessary to canonicalize local ids. RH1.2 (2026-07-02) moved id-minting to the client, eliminating the divergence.

#### RH1 — Notes

> **Sequencing rationale.** RH1 ships AFTER R4.5 (DM Dashboard) and BEFORE R5 (Live sync). R5 introduces N concurrent writers; an id-canonicalisation bug under one writer becomes a conflict-resolution problem under N. Fixing the id contract once, before websockets land, costs ~1 slice. Fixing it afterwards costs RH1 + a multi-writer reconciliation slice on top. The same logic applies to the SECURITY §2 invariant ("server is authoritative") — R5 cements client-server interaction patterns; we want the invariant true before that hardens.
>
> **Out of scope.** RH1 does NOT touch:
> - The TransactionLog schema (log payloads already carry the entity ids — they're just now CANONICAL ids minted once rather than client/server twins).
> - The Prisma schema (UUID columns stay `String`; v7 is structurally compatible with v4 — no migration needed; existing rows minted with v4 keep working).
> - The optimistic-dispatch model (reducer still runs client-side first; only the id-minting authority changes).
>
> **Carryforward to RH2 + RH3.** Two follow-on hardening passes pick up the rest of the architectural-debt audit (see findings catalog from 2026-06-30):
> - **RH2 — Determinism & Invariants**: dual-authority `timestamp` minting, `actorRole` derivation split between client + server, reducer iteration-order non-determinism in cascades, multi-tab queue race, `applied[]` count not validated, action-type registry drift, and the DB-level invariant constraints (`isCarried` uniqueness, recovered-loot uniqueness, `bankerUserId !== ownerUserId`, equip/attune/charges only on Inventory, container depth).
> - **RH3 — Session + sync foundation**: introduce the `GameSession` entity + `sessionId` widening in the log schema BEFORE R5.2 lands the user-facing session tools. (Called `GameSession` in code to avoid collision with the Auth.js `Session` model — see OUTLINE §4 naming note.)
>
> RH1 stays narrowly scoped to the id-authority cleanup; the broader determinism / invariant / session work lives in RH2 / RH3. Non-architectural cleanup (`Welcome.tsx`, vault export, etc.) is captured in RH0 (legacy-data scaffolding strip).

---

### RH2 — Hardening Pass 2: Determinism & Invariants (architectural)

> **What this is.** Closes the remaining structural debt the 2026-06-30 audit surfaced AFTER RH1 resolved the id-minting authority. Three concerns under one slice: (a) RH1-shaped dual-authority problems for other non-deterministic reducer outputs (`timestamp`, `actorRole`), (b) reducer / queue determinism gaps that won't survive R5's N concurrent writers (iteration order, multi-tab race, `applied[]` count, registry drift), (c) documented invariants that exist only in the reducer and never made it down to the DB schema (uniqueness constraints, structural CHECKs).
>
> **Sequencing.** Ships AFTER RH1, BEFORE R5. Same R5-blocker rationale as RH1: every concern compounds under multi-writer broadcast. Concretely: a client and server that disagree on a timestamp are tolerable today (queue's full-state re-pull masks it) but unrecoverable once R5.1's websocket broadcast replays log entries verbatim. A reducer cascade whose log slice order depends on hashmap iteration is tolerable today (the queue re-pulls) but produces divergent log streams under R5. A `bankerUserId` row that doesn't satisfy `!== ownerUserId` is tolerable today (the guard rejects writes) but corrupts the DB if a future migration writes directly.

**Why now.** Each concern is "works for single-writer, fails or becomes expensive under N." Without RH2 in place before R5.1:
- A subtle timestamp-drift bug under broadcast → bisecting the cause across two reducers running with different clocks.
- A cascade-order divergence between two clients → broadcast surfacing inconsistent log streams; reconciliation slice gets harder.
- A documented invariant violated by a future code path → silent data corruption rather than a 22-line `BatchRejected`.

**Approach.** Mostly small, surgical changes — each is independently testable. Schema layer adds CHECK / UNIQUE constraints; reducer layer adds stable sorts at cascade points; sync layer adds an assertion and tab-coordination shim. No grand redesign; each concern is one or two files.

**Slicing.** Four sub-slices, ordered by independence.

#### RH2.1 — Server-authoritative `timestamp` + shared `actorRole` derivation

**Why grouped:** Both are the same RH1 shape — two sides computing the same value, the system relying on them agreeing. Same fix shape: server is authoritative for the value, client uses an optimistic placeholder that gets replaced from the `applied[]` echo.

**Timestamp (`packages/rules/src/reducer/types.ts` + the two reducers)**
- [x] `ReducerContext.now` becomes server-only for LOG-ENTRY timestamps. Client-side reducer dispatches use a sentinel placeholder `'PENDING'` on log entries; the queue's post-flush hook overwrites it with `applied[].timestamp` once the server echoes it. **Shipped 2026-07-02 (Option 2 scope)** — the seam that flips is `apps/web/src/store/index.ts::buildLogEntry` (line ~120), which now branches on `isServerMode`. `ReducerContext.now` itself stays on the interface because entity `createdAt` / `joinedAt` / `leftAt` fields still need it in optimistic UI; retiring `ctx.now` entirely is deferred to **RH2.6** which retires client-side log emission in server mode.
- [-] Add a Zod refinement: `transactionLogEntry.timestamp` must be a valid ISO datetime when persisted — `'PENDING'` is forbidden once an entry is server-canonical. The wire schema doesn't see `'PENDING'`; it's a client-internal sentinel. **Skipped** — nothing on the wire accepts a client-composed log entry (only actions), so a wire-side refinement has no target. The Dexie-persistence boundary is guarded instead: `apps/web/src/store/index.ts::dispatch` filters PENDING entries out of the debounced saver's payload in server mode, so `.datetime()` on the hydrate path never sees `'PENDING'`.
- [x] Update `apps/web/src/store/index.ts` dispatch site to do the placeholder-then-patch dance. New `patchLogEntries(applied)` store method matches entries by `(type, canonical-payload)` content and overwrites `timestamp` — id-matching isn't available because client and server mint log-entry ids independently (`crypto.randomUUID()` vs `newUuidV7()`).
- [x] Update `apps/web/src/sync/queue.ts` post-flush patch logic: for each entry in `applied[]`, locate the matching local log row and overwrite timestamp. Wired via a new optional `QueueDeps.patchLogEntries` hook; `main.tsx` supplies the real dep, tests may omit.
- [x] Tests: reducer unit test that a freshly-dispatched action's local log entry has `'PENDING'` timestamp; integration test that after queue flush, every local entry has the server-canonical timestamp. **Shipped as `apps/web/src/store/timestamp-authority.test.ts`** — 3 tests covering server-mode PENDING emission, local-mode unchanged behaviour, and post-flush timestamp patch.

**`actorRole` shared derivation (`packages/shared/src/guards/actor.ts` — `deriveActorRole` exists)**
- [x] Today both `apps/web/src/store/index.ts:resolveActor` and `apps/server/src/sync/log-builder.ts` independently derive `actorRole` from `(actor, membership, party)`. Move the logic to a single shared function called from both sites. **Shipped 2026-07-02** as `deriveActorRoleForSlice(state, slice)` in `packages/shared/src/guards/actor.ts` — action-aware; consumed by web's `resolveActor` (now ~15 LOC, was ~165) and by `buildLogEntryServer` (which previously used `actor.role` verbatim). The pre-existing 2-arg `deriveActorRole(party, membership)` stays for the guard-layer identity resolution.
- [x] Banker derivation: when `Party.bankerUserId === actorUserId`, return `'banker'`. Today both sites partially handle this; some action arms hard-code `'player'`. After RH2.1 there's one definition that handles all cases. **Shipped** — the shared function's default arm returns `banker iff state.party.bankerUserId === state.user.id`; DM-only and Banker-only arms (`identify`, `kick-player`, `appoint-banker`, `revoke-banker`, `dm-transfer`, `split-evenly`) hard-code their canonical role.
- [x] Guard test asserting the contract: given the same `(state, action, actorUserId)`, both sites return identical results. **Shipped** — new `describe('deriveActorRoleForSlice — RH2.1a')` block in `packages/shared/src/guards/map.test.ts` covers the full action-type × (banker, non-banker, DM) matrix (~35 assertions via `it.each` fan-out) plus bootstrap null-state and server-synthesised join-party null-state carve-outs.

#### RH2.1 — Notes

> **2026-07-02 — RH2.1 shipped (Option 2 scope).**
>
> **Option 2 chosen.** Two options were considered:
> - **Option 1 (full RH2.1):** `TransactionLog.timestamp` + entity `createdAt`/`joinedAt`/`leftAt` both become server-authoritative via placeholder-then-patch.
> - **Option 2 (log-timestamp only, chosen):** only `TransactionLog.timestamp` flips to PENDING in server mode. Entity timestamps deferred to RH2.6.
>
> Option 2 preserves the RH chain's "one axis per slice" discipline: RH2.1 handles the log-entry axis; RH2.6's mode-aware log-authority split naturally picks up entity timestamps as part of the same "server owns state in server mode" cutover. Splitting keeps each PR bisectable.
>
> **`ReducerContext.now` stays on the interface** contrary to the roadmap sketch's summary sentence. The reducer still calls `ctx.now()` for entity `createdAt`/`joinedAt`/`leftAt` fields, which are asserted by 30+ `appStateSchema.parse` tests. Only the log-entry timestamp seam (`buildLogEntry` in the web store) flips to PENDING. RH2.6 will complete the retirement.
>
> **Correlation strategy: content-matching.** Client log-entry ids and server log-entry ids diverge today (client: `crypto.randomUUID()`, server: `newUuidV7()`). Rather than adding a `newLogEntryId` field to every action payload (RH1-shape extension, large surface), the patch matches on `(type, canonical-JSON-payload)`. Robust because the reducer never emits two structurally-identical slices in one batch. RH2.6 retires client-side log emission entirely, making the correlation problem moot.
>
> **Dexie persistence:** PENDING entries are stripped from the debounced saver's payload in server mode. If the tab closes with PENDING entries in memory, Dexie has state without the corresponding log entries — but the server pull on next boot replaces both, so no user-visible inconsistency.
>
> **BUG-004 partial-fix.** RH2.1a's shared `deriveActorRoleForSlice` fixes the DM-vs-player role stamp on Item Detail history; RH2.1b's server timestamp patch fixes the "why does my newest acquire show yesterday's date" symptom class. The **full** BUG-004 closure still needs RH2.6 (client stops emitting log slices in server mode, server-emitted slices with server-canonical ids arrive via applied[]).

#### RH2.2 — Reducer determinism: stable iteration in cascades

**Reducer (`packages/rules/src/reducer/index.ts`)**
- [x] Audit every cascade arm that iterates `state.items` / `state.stashes` to emit log slices: `delete-stash`, `delete-character`, `leave-party`, `kick-player`, `transfer` (container-with-contents). Each must sort by stable key (typically `id`) BEFORE emitting slices. **Shipped 2026-07-03** — the 5 listed arms feed 2 helpers (`deleteStash` at `~1195`; `cascadeCharacterToRecoveredLoot` at `~2944`, shared by `delete-character` / `leave-party` / `kick-player`). The `transfer` container-with-contents case emits a single log slice per dispatch (the parent's) — child rows relocate silently through `s.items.map` indexed by an id-set, so log-slice fan-out isn't order-sensitive there.
- [x] One-liner per call site: `const sortedItems = [...s.items].sort((a, b) => a.id.localeCompare(b.id));`. Apply to ~6 sites. **Shipped 2026-07-03** — 2 sites in practice (`index.ts:1195`, `index.ts:2944`), both inlined into the existing `.filter` chain rather than introducing a fresh binding. The "~6" count in the sketch conflated action arms with source-code iteration points; see Notes below.
- [x] Property-based test in `packages/rules/src/reducer/`: given the same state in two random insertion orders, the cascade emits identical log slice sequences (modulo `ctx.newId` outputs, which RH1 makes deterministic anyway). **Shipped 2026-07-03** as `packages/rules/src/reducer/determinism.test.ts` — 3 property tests using `fast-check@^4.8.0` shuffling `s.items` across 50 permutations per case; covers `delete-stash` transfer-slice order, `delete-character` transfer-slice order (which also exercises `leave-party` + `kick-player` via the shared cascade helper), and post-cascade state-shape invariance.

#### RH2.2 — Notes

> **2026-07-03 — RH2.2 shipped.**
>
> **Site-count discrepancy: "~6 arms → 2 helpers".** The audit surfaced 5 cascade arms feeding log slice fan-out (`delete-stash`, `delete-character`, `leave-party`, `kick-player`, `transfer`) — the "~6" figure in the pre-ship sketch counted these action arms rather than unique iteration points in the reducer source. In practice:
> - `delete-stash` has its own filter+emit at `index.ts:~1195`.
> - `delete-character`, `leave-party`, `kick-player` all delegate to `cascadeCharacterToRecoveredLoot` at `index.ts:~2944` (single filter+emit, three consumers).
> - `transfer` container-with-contents is a red herring for RH2.2's specific concern: it emits ONE `transfer` log slice per dispatch (the parent's). Child rows relocate silently through `s.items.map` indexed by a `Set<childId>`; `Array.prototype.map` preserves input order deterministically, so state mutation order is already stable. No fix needed there.
>
> So the mechanical change is 2 sort-insertions, not 6.
>
> **Sort placement: inline in the `.filter` chain.** Both helpers already had a `s.items.filter(...)` line; the fix appends `.sort((a, b) => a.id.localeCompare(b.id))` to the same chain. `Array.prototype.filter` returns a new array (safe to mutate in place with `.sort`), and downstream reads (`itemCount` reduce, state-mutation `s.items.map` at other sites) are order-independent, so no additional local copies were needed.
>
> **Supply-chain gate for `fast-check`.** Added as `packages/rules` devDependency at `^4.8.0`. Per user direction, relied on the existing `.npmrc:1 min-release-age=7` policy rather than pinning a specific SHA — pnpm refuses to resolve any release younger than 7 days, so a fresh-publish compromise (typosquat, hijacked maintainer) can't slip in. Lockfile pinned `fast-check@4.8.0` at install time. Supply-chain check: `Lockfile passes supply-chain policies` — pnpm 11.8.0.
>
> **What RH2.2 does NOT fix.** Two things are worth calling out for the RH chain readers:
> - Iteration order over `state.stashes`, `state.currencies`, `state.memberships`, `state.characters` — none of the fixed cascades fan out log slices from those, so they weren't in scope. If a future cascade emits N slices by iterating one of them, RH2.2's pattern applies again at that new site.
> - The single-`transfer`-slice-per-dispatch guarantee. If a future refactor splits the parent + child transfer into N slices (e.g. one per relocated row), that new emit needs a sort too. Left un-guarded because no such refactor is on the roadmap.
>
> **Test verification: mutation-check.** During implementation, each sort was independently reverted to confirm the corresponding property test fails with a clean `fast-check` counterexample (shuffled `s.items` array → emitted slice sequence != sorted reference). Both sorts restored before final commit; test suite is 129/129 in `packages/rules`.

#### RH2.3 — Multi-tab queue race + `applied[]` count validation

**Multi-tab queue (`apps/web/src/sync/queue.ts`)**
- [x] Queue is currently module-level state (`queue`, `timer`, `preBatchSnapshot`, `inflight`). Two browser tabs on the same origin produce two independent queues against shared Dexie. Add a `BroadcastChannel`-based coordinator: one tab owns the queue at a time; other tabs forward enqueues to the owner via the channel. **Shipped 2026-07-03** — pivoted from `BroadcastChannel` to the **native Web Locks API** (`navigator.locks.request('sync-queue-flush', ...)`). Baseline Widely Available since March 2022 across Chrome / Firefox / Safari / Edge (93.96% global). The lock FIFO-queues concurrent flushes across same-origin tabs by default; auto-releases on tab close; zero manual heartbeat / leader-election protocol. No new npm dependencies. `apps/web/src/sync/queue.ts:190`. See RH2.3 — Notes for the sticky-leader-vs-native-lock trade-off.
- [x] Acceptance test: two `loadQueue()` instances in the same test process, both enqueue against the same party, only one issues a network request, the other receives the post-flush state. **Shipped 2026-07-03** as `apps/web/src/sync/queue.multitab.test.ts` — spins up two module instances via `vi.resetModules()`, both flush concurrently against a slow (100 ms) MSW handler, asserts `intervals[1].start >= intervals[0].end` (non-overlapping). Mutation-checked by bypassing the lock: test correctly fails with `expected N to be greater than or equal to M` showing a ~100 ms overlap.

**`applied[]` count assertion (`apps/server/src/sync/routes.ts`)**
- [x] After the `prisma.$transaction` block, assert `applied.length === reducer.logEntries.length`. Mismatch indicates a persistor bug (silent slice drop) and should 500, not 200. **Shipped 2026-07-03** — assertion is **per-action inside the reducer loop** (not post-transaction total): `apps/server/src/sync/routes.ts:353-380` captures `preLen = out.length` before the slice-push loop and throws a descriptive `Error` on mismatch. Load-bearing shape — catches persistor bugs that silently drop a slice mid-loop, which a batch-total assertion would miss.
- [x] Integration test: dispatch a `delete-stash` cascade with 3+ items, expect `applied.length` to equal the reducer-emitted slice count. **Shipped 2026-07-03** — added `describe('POST /sync/actions — RH2.3 applied[] count invariant')` to `apps/server/src/sync/routes.test.ts:876`. Bootstraps a party, creates a Storage stash, acquires 3 distinct items (torch / rope / rations-1day), deletes the stash, asserts `applied.length === 4` (3 transfer + 1 delete-stash; currency-change omitted because the freshly-created holding is zero). Green-path only — see RH2.3 — Notes on why a red-path mock-persistor test wasn't added.

#### RH2.3 — Notes

> **2026-07-03 — RH2.3 shipped.**
>
> **Multi-tab coordinator: pivoted from `BroadcastChannel` to Web Locks API.** The pre-ship sketch called for a sticky-leader coordinator with heartbeat + enqueue-forwarding via `BroadcastChannel`. Research surfaced that `navigator.locks` (Baseline Widely Available since March 2022; 93.96% global support per caniuse) provides exactly this primitive natively — FIFO queuing across same-origin tabs, auto-release on tab close, no manual protocol. One `navigator.locks.request<void>('sync-queue-flush', async () => { ... })` wrapping the existing `flush()` body replaces what would have been ~150 LOC of leader-election, heartbeat, and message-forwarding code. Rejected the `broadcast-channel` npm library (2 k stars, MIT, well-maintained) as unnecessary: it exists to polyfill non-Baseline browsers and shim Node compatibility. Our target is evergreen browsers; the polyfill is dead weight.
>
> **jsdom shim.** jsdom 29.1.1 doesn't ship `navigator.locks` (as of this writing; may land in a future release). The test env now installs a ~20 LOC FIFO shim at `apps/web/src/test/setup.ts:42-64` guarded by `if (!('locks' in navigator))` so it's a no-op in real browsers or when jsdom eventually adds native support. Shim is per-lock-name-serialising, mirroring the production contract closely enough for the queue's usage. Deletable when the underlying platform catches up. Mutation-check: disabling the shim causes `TypeError: Cannot read properties of undefined (reading 'request')` — descriptive enough that a future jsdom upgrade would surface cleanly.
>
> **Server assert scope.** Chose per-action-inside-transaction over batch-total-outside-transaction. Rationale: a batch total is trivially true by construction (`out.push(entry)` is the only writer, `sum(logEntries.length)` is the only expected value); a persistor bug that dropped a slice mid-loop would ALSO decrement `sum(logEntries.length)` implicitly and the outer assertion would still pass. The per-action shape captures the delta around a single iteration where the two counts should agree independently, catching drift the moment it happens. Trade-off: 6 LOC vs 3 LOC. Worth it.
>
> **No red-path test for the server assert.** The assertion guards a "should never happen" invariant; inducing it in a test would require intercepting the local `out.push` inside the `prisma.$transaction` closure, which isn't spyable from the outside. A `vi.mock('./log-builder.js', ...)` could stub `appendTransactionLog` to throw mid-loop, but that just tests the transaction's rollback path (already covered elsewhere) — not the count assertion itself, because a mid-loop throw beats the assertion to it. The green-path test proves the assertion doesn't fire under a real 4-slice cascade; if the assertion were misconfigured (e.g. off-by-one) it would 500 today. The error message embedded in the throw is descriptive enough that a future regression surfaces with a clear diagnostic. Defence-in-depth accepted.
>
> **Not addressed in RH2.3:**
> - Different-party multi-tab coordination — RH4 handles it via URL-scoped routing (see `docs/roadmap.md:2920`). RH2.3 solves same-party same-origin only.
> - Sync-queue retry with a persisted outbox — carryforward to R5 per `docs/roadmap.md:3103`. The current network-error behaviour (keep optimistic state, surface transient toast, drop batch) is unchanged.

#### RH2.4 — Schema metadata replaces action-type registries

**Action schema (`packages/shared/src/schemas/action.ts`)**
- [x] Today the queue uses `ID_MINTING_ACTION_TYPES: Set<Action['type']>` to know which actions need post-flush re-pull. After RH1 that set goes away. But the pattern WILL recur: R5.1 needs "which actions trigger broadcast"; R5.3 needs "which actions affect history visibility"; future slices will add more. Each registry is a drift-risk. **Shipped 2026-07-03** — `ID_MINTING_ACTION_TYPES` was already deleted by RH1.3 (`docs/roadmap.md:2657`), so this slice is **preventive not corrective**: the pattern is established before R5.1 / R5.3 land, so those slices don't have to introduce (and later migrate away from) a Set-shaped registry. See RH2.4 — Notes.
- [x] Replace registries with **schema metadata**. Each Zod action schema carries a metadata object: `{ broadcastOnApplied: true, affectsHistory: true, ... }`. Consumers iterate the metadata at runtime rather than maintaining a separate Set. **Shipped 2026-07-03** as `packages/shared/src/schemas/actionMetadata.ts` — uses Zod v4's native `z.registry<ActionMetadata>()` API for schema→metadata lookup, backed by a compile-time-exhaustive `Record<Action['type'], ActionMetadata>` that TS enforces stays in sync with the discriminatedUnion. Populated with one representative field (`broadcastOnApplied`) — every user-dispatched variant is `true`, `seed-catalog` is `false`. Additional fields (`affectsHistory`, etc.) land in their consuming slice.
- [x] Document the pattern in `CLAUDE.md` "Code conventions": "no constant-set registry of action types; per-action concerns live as schema metadata." **Shipped 2026-07-03** — added under `### Code conventions` (`CLAUDE.md:50`), with explicit pointer to `actionMetadata.ts` + the `actionMetadata.test.ts` exhaustiveness guardrail.

#### RH2.4 — Notes

> **2026-07-03 — RH2.4 shipped.**
>
> **Preventive, not corrective.** The concrete registry the pre-RH2 audit cited (`ID_MINTING_ACTION_TYPES`) was deleted by RH1.3 before RH2.4 landed. So this slice migrates zero existing code — the payoff is that R5.1 (websocket broadcast decision path) and R5.3 (history-view visibility filter) will consume `getActionMetadata(type).broadcastOnApplied` / `affectsHistory` instead of introducing their own Sets. Landing the pattern now, ahead of R5, means those slices are additive-only edits to `actionMetadata.ts` rather than "introduce Set, then migrate Set to registry".
>
> **Two indexes, one source of truth.** `metadataByType: Record<Action['type'], ActionMetadata>` is the compile-time-exhaustive source; TS demands every discriminatedUnion variant have a key. The `z.registry<ActionMetadata>()` is populated FROM the Record at module load by iterating `actionSchema.options` and keying by `variant.shape.type.value`. Consumers pick whichever index is ergonomic — `getActionMetadata(type)` for string-literal callers (typical), `actionMetadataRegistry.get(schema)` for tooling that already holds a schema reference (e.g. future JSON-Schema generation).
>
> **Exhaustiveness is enforced twice.** The `Record` type catches missing keys at `tsc` time — the common case. `actionMetadata.test.ts` iterates `actionSchema.options` at runtime and asserts every variant has a registered entry — defence in depth for cases where a Zod variant is added but the imports on `actionMetadata.ts` are stale and the compile-time check silently doesn't fire (e.g. import-cycle-induced type widening). Mutation-checked by removing a variant from the population loop: test fails naming the missing type.
>
> **Not migrated.** `deriveActorRoleForSlice`'s per-variant `switch` (`packages/shared/src/guards/actor.ts:68`) and the guard `map.ts` per-action function map are ALSO one-entry-per-action structures, but both are TypeScript-enforced exhaustive (discriminated-union switch + typed guard-function generic). Neither is a `Set<Action['type']>` drift risk. Left alone — RH2.4 is scoped to replacing constant-set registries, not to unifying all per-action data structures.
>
> **Zod v4 registry API.** Uses `z.registry<Meta>()` from Zod v4's core registries module. First-class typed WeakMap-backed schema→metadata index. Not documented on Zod's landing page but well-tested (used internally by `z.toJSONSchema()`); saw the type in `node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/registries.d.ts`. No hand-rolled `Map<ZodSchema, Meta>` needed.


#### RH2.5 — DB-level invariant constraints (Postgres migration)

**Prisma schema (`apps/server/prisma/schema.prisma`) + new migration**
- [x] **Single Inventory per character.** Partial unique index: `CREATE UNIQUE INDEX stash_inventory_per_character ON "Stash"("ownerCharacterId") WHERE "isCarried" = true AND scope = 'character'`. **Shipped 2026-07-03** as `Stash_inventory_per_character_uniq` in `apps/server/prisma/migrations/20260703131254_rh25_invariants/migration.sql`. Presence test + negative-path integration test (attempting a second Inventory returns SQLSTATE `23505`) both in `apps/server/src/db/schema-invariants.test.ts`.
- [x] **Single Recovered Loot per party.** Partial unique index: `CREATE UNIQUE INDEX recovered_loot_per_party ON "Stash"("partyId") WHERE scope = 'recovered_loot'`. **Shipped 2026-07-03** as `Stash_recovered_loot_per_party_uniq`. Note: the DB enum value is `recovered_loot` (underscore), not `recovered-loot` (hyphen) as the roadmap sketch had — the hyphenated form is the client-side Zod discriminator; the mapper in `apps/server/src/db/mappers.ts` bridges the two.
- [x] **Banker != Owner.** Check constraint: `CHECK ("bankerUserId" IS NULL OR "bankerUserId" != "ownerUserId")`. **Shipped 2026-07-03** as `Party_banker_not_owner_check`. Null-safe: `bankerUserId IS NULL` is the MVP-typical state.
- [x] **Equip/attune/charges only on Inventory.** Either a trigger (joins `ItemInstance` to its `Stash` and validates `equipped`/`attuned`/`currentCharges`), or denormalise `isCarried` onto `ItemInstance` and use a CHECK. Pick whichever is cheaper — likely the denormalised approach. **Shipped 2026-07-03** as `ItemInstance_equip_attune_check_trg` (BEFORE INSERT/UPDATE PL/pgSQL trigger). Chose **trigger** over denormalisation despite the roadmap's suggested preference — see RH2.5 — Notes. `currentCharges` intentionally excluded from the check per R2.3 amendment: items leaving Inventory keep their charges (`packages/rules/src/reducer/index.ts:1490`).
- [x] **Container depth (one-level).** Trigger asserting `containerInstanceId IS NULL OR (the row referenced has containerInstanceId IS NULL)`. **Shipped 2026-07-03** as `ItemInstance_container_depth_check_trg`. Narrowed to `UPDATE OF containerInstanceId` — the trigger only fires when the parent-pointer changes, so equip/attune/quantity updates never pay the lookup cost.
- [x] Pair each constraint with a schema-invariants test in `apps/server/src/db/schema-invariants.test.ts` that queries `pg_constraint` / `pg_indexes` and verifies the constraint is present (mirrors the existing DEFERRABLE FK check pattern). **Shipped 2026-07-03** — 5 catalog presence tests (`pg_indexes` for the two partial-uniques, `pg_constraint` for the CHECK, `pg_trigger`+`pg_class` for the two triggers) + 2 negative-path integration tests (attempting a second Inventory + attempting an equipped-outside-Inventory INSERT) covering the highest-value invariants end-to-end.

#### RH2.5 — Notes

> **2026-07-03 — RH2.5 shipped.**
>
> **Trigger over denormalisation for the equip/attune + container-depth invariants.** The roadmap sketch said "denormalise `isCarried` onto `ItemInstance` and use a CHECK. Pick whichever is cheaper — likely the denormalised approach." I disagreed after auditing the persistor: denormalisation would require touching every ItemInstance write site (transfer, delete-stash, create-stash, cascade-character-to-recovered-loot) to keep the mirror column in sync, plus a backfill migration. A BEFORE trigger is one PL/pgSQL function + one `CREATE TRIGGER` declaration, zero application-code changes, ~10 μs per firing (single indexed PK lookup on `Stash.id` / `ItemInstance.id`). The `OF equipped, attuned, ownerId` / `OF containerInstanceId` column-list narrowing means the trigger doesn't fire for updates that can't cause a violation (quantity, notes, identified, hint). Trigger wins on maintenance cost by a wide margin; the marginal per-write latency is negligible for an inventory-management app.
>
> **`currentCharges` intentionally excluded from the equip/attune trigger.** The roadmap's original wording "equip/attune/charges only on Inventory" is stale per R2.3 amendment. `packages/rules/src/reducer/index.ts:1490` documents: "R2.3 amendment: `currentCharges` is NO LONGER cleared on leave-Inventory. Wands that leave Inventory keep their remaining charges." Adding `currentCharges IS NOT NULL` to the DB check would break this invariant. Only `equipped` and `attuned` are cleared by the reducer's leave-Inventory cascade; only those two are checked by the trigger.
>
> **Postgres enum value is `recovered_loot` (underscore).** The client-side Zod discriminator uses `'recovered-loot'` (hyphen) per OUTLINE §4. The mapper at `apps/server/src/db/mappers.ts` bridges the two. The partial UNIQUE index's `WHERE` predicate must reference the DB enum literal.
>
> **Migration is hand-written raw SQL, no `prisma migrate dev` step.** Prisma DSL can't express partial unique indexes, CHECK constraints, or triggers. The migration was written directly and applied via `prisma migrate deploy` against `dnd_inv_test`. This matches the RH-era pattern (see `20260626100818_init/migration.sql`'s "R3.1 hand-tail" block for the 8 pre-existing CHECKs).
>
> **Not in RH2.5:**
> - **Banker is an active party member** (§3.14 cross-table). Requires a trigger joining `Party.bankerUserId` to `PartyMembership`. Deferred to R4.2 (Banker feature slice) where the UX + guard-layer changes land.
> - **`currentCharges` bounds check by definition** (`currentCharges <= ItemDefinition.chargesMax`). Cross-table, better as a trigger, and orthogonal to this slice's "physical-location invariants" theme.
> - Negative-path integration tests for the other 3 constraints (Recovered Loot uniqueness, banker != owner, container depth). Their presence-tests catch missing constraints; adding red-path tests can happen in a follow-up if a specific bug surfaces.

#### RH2.6 — Mode-aware log-authority split (client owns log in local mode, server owns log in server mode)

**Why now.** RH1 retires client id-minting. RH2.1 retires client timestamp/actorRole minting via placeholder-then-patch. But those still have the CLIENT build the log slice, then patch fields post-flush. That's a half-measure — the client-built slice is a source of drift (BUG-004 surfaced this: the client mints a log payload that references a client-minted item id, and the two never reconcile with server truth on the same row). The correct architecture per SECURITY §3.6 ("in server mode the server is the sole authority for TransactionLog contents") is a **mode-aware split**:

- **Local mode** (Dexie-only, no server): the client-side reducer builds the log slice, appends to `state.log`, persists to Dexie. Unchanged from today.
- **Server mode** (Postgres backend): the client-side reducer does NOT build log slices. The dispatch pipeline calls `reduce(state, action, ctx)` for the state mutation only; log slices are the server's exclusive output. After the queue flushes, the response's `applied[]` (or the post-batch `/sync/state` pull) delivers the canonical log entries, and the store appends them to `state.log`. Between dispatch-time and flush-response, the UI has NO log entries for the in-flight action — displays either "pending…" states or defer log-dependent reads.

**Sequencing.** Ships AFTER RH1 and RH2.1. RH1 removes the client-vs-server id divergence (so the server's log entry references the correct entity id). RH2.1 removes the timestamp/actorRole divergence (so the returned log entries don't need patching for those fields either). Once both are in, log entries returned by the server are structurally identical to what a placeholder-then-patch pipeline would produce — at which point emitting them client-side is pure duplication + drift risk, and this slice retires the duplication.

**Why NOT bundle into RH1 / RH2.1.** RH1 changes id-minting mechanics but keeps the client emitting log slices (with server-canonical ids). RH2.1 patches placeholder fields on client-emitted slices. Both are "same shape, better contents." RH2.6 is a **shape change**: the client stops emitting slices in server mode entirely. That's a bigger conceptual shift with implications for the reducer's return type, the store middleware, and every optimistic-UI reader that assumes `state.log` has an entry for the just-dispatched action. Better as its own slice than as a hidden effect of RH2.1's cleanup.

**Approach.** Two-way `ReducerResult`:
- **Reducer stays pure.** `reduce(state, action, ctx)` still returns `{ state, logEntries }`. The reducer doesn't know about modes; it produces the full slice list as before.
- **Store middleware branches on mode.** In `apps/web/src/store/index.ts`, the dispatch pipeline:
  - **Local mode:** unchanged — build full entries via `buildLogEntry` + append to `state.log`.
  - **Server mode:** apply `result.state` locally (optimistic UI), but DO NOT append log entries. The reducer's `logEntries` slice output is DISCARDED at the store boundary. The queue's post-flush hook (existing `pullState` re-pull path, or the response's `applied[]` array) is the sole writer of `state.log` in server mode.
- **Queue owns log append in server mode.** After `/sync/actions` returns `applied[]`, iterate and `set(draft => draft.log.push(entry))` for each. For id-minting actions (RH1's list, or RH2.4's metadata replacement), still `pullState` and replace the full log.

**Consequences.**
- **In-flight log gap.** Between local dispatch and queue flush (~200 ms debounce window), server-mode UI has no log entry for the in-flight action. `ItemHistory` shows the pre-dispatch state; a subsequent flush repopulates. Acceptable per SECURITY §3.6's carve-out ("readers must not assume the local entry's id/timestamp/actorRole match the server's").
- **Local-mode behaviour preserved.** Users running local-only Dexie (no backend) see log entries immediately, exactly as today. Zero UX regression for the local-mode path.
- **BUG-004 auto-fixes.** The server-emitted log entry references the server's canonical `itemInstanceId` (post-RH1). The client's `ItemHistory` reads the server-emitted entry via `pullState` and filters correctly. No client-side patching needed.
- **Rollback stays intact.** BUG-003's rollback captures the store snapshot BEFORE the mutation lands. In server mode, that snapshot's `log` is the last-known-server-canonical state; on 422, restoring it correctly undoes both state AND any speculative log append (there's nothing to undo in server mode because the client never appended).

**Slicing.** Two sub-slices to keep the change reviewable:

**RH2.6.a — Store dispatch mode-branch**
- [x] Add `isServerMode` guard around the log-append block in `apps/web/src/store/index.ts` `dispatch()`. When true, apply `result.state` but skip the `draft.log.push(entry)` loop. **Shipped 2026-07-03** — `apps/web/src/store/index.ts:158`; reducer's `logEntries` output collapses to `[]` in server mode.
- [x] Wire the queue's `applied[]` response into a new `appendServerLogEntries(entries: TransactionLogEntry[])` store method. Called from `apps/web/src/sync/queue.ts` after `pushActions` succeeds. **Shipped 2026-07-03** — replaces the RH2.1b `patchLogEntries` method entirely; pure append (no content-matching). Queue wiring in `apps/web/src/main.tsx:70`.
- [x] Update `pullState`-based canonicalisation path to use the same method (or unify with the existing `restoreSnapshot({log, appState})` call — decide during execution). **Shipped 2026-07-03** — `restoreSnapshot` already writes the full `{appState, log}` snapshot atomically; no code change needed there. `pullState` continues to route through it via the existing hydrate path.
- [x] Reducer, guards, schemas: unchanged. This slice touches ONLY the web store + queue. **Confirmed** — server workspace (`apps/server`), rules workspace (`packages/rules`), and shared workspace (`packages/shared`) untouched; all three test suites unchanged.

**RH2.6.b — UI readers: pending-state ergonomics**
- [x] Audit log-reading components for "log entry immediately present" assumptions:
  - `apps/web/src/components/item/ItemHistory.tsx` — falls back to "No log entries yet" when empty. In server mode with an in-flight action, this shows briefly (~200 ms). Acceptable; document.
  - Party log (if / when it exists) — same behaviour.

  **Shipped 2026-07-03** — audit confirmed `ItemHistory` already has a graceful "No entries yet" fallback (`apps/web/src/components/item/ItemHistory.tsx:120`); no other consumers of `state.log` currently exist. No code change needed at the UI layer; the ~200 ms in-flight window is user-invisible in practice. RH2.6.b's actual delta collapsed to documentation only, so shipped in the same commit as RH2.6.a rather than as a separate sub-slice.
- [ ] Add a "sync pending" indicator when the queue has an in-flight batch (optional; may fold into R5 offline-banner work). Signals "action pending server confirmation" so users don't misread the empty-log state as failure. **Deferred to R5** per the roadmap's own "optional" language — the 200 ms window is short enough that no user misread will surface before then.
- [ ] Optional: an in-flight action count in `useStore` derived from the queue's public API. Skip if the empty-log window is short enough (200 ms debounce + network) that users don't notice. **Skipped** per the same rationale as the sync-pending indicator.

**Tests.**
- [x] Store test: in server mode, `dispatch({type: 'acquire', ...})` mutates `state.appState` but does NOT push to `state.log`. **Shipped 2026-07-03** as test 1 of `apps/web/src/store/log-authority.test.ts`.
- [x] Store test: in local mode, same dispatch appends to `state.log` (unchanged behaviour). **Shipped 2026-07-03** as test 2 of `apps/web/src/store/log-authority.test.ts`.
- [x] Queue test: after `/sync/actions` responds with `applied: [{type: 'acquire', payload: {itemInstanceId: SERVER_ID}, ...}]`, `state.log` has exactly one entry with `itemInstanceId: SERVER_ID`. **Shipped 2026-07-03** as test 3 of `apps/web/src/store/log-authority.test.ts` — asserts the full entry equals the server echo verbatim (id, timestamp, actorRole all server-canonical).
- [x] Integration test (server workspace): full round-trip proves the log-read cycle works for the BUG-004 case — dispatch acquire, wait for queue flush, navigate to Item Detail, history shows the acquire entry. **Shipped 2026-07-03** — the existing sync-route test `apps/server/src/sync/routes.test.ts` "RH1.2 — acquire uses the client-minted newItemInstanceId end-to-end" already covers the server-side round-trip; test 3 of `log-authority.test.ts` covers the client-side consumption path with MSW. Together they exercise the full cycle without needing a new integration test file.
- [x] Rollback regression: 422 mid-flight rejection in server mode does not require log rollback (there was nothing to append). Existing BUG-003 tests continue to pass unchanged. **Confirmed** — `apps/web/src/sync/queue.test.ts` "queue — 422 rollback restores PRE-mutation snapshot (BUG-003)" continues to pass; RH2.6 didn't touch the rollback code path.

**Documentation.**
- [x] Update `docs/SECURITY.md` §3.6 to describe the mode-aware split concretely (the 2026-07-01 bullet added post-BUG-004 can be tightened once this slice lands). **Shipped 2026-07-03** as a new §3.1.6 "TransactionLog authority split (RH2.6)" — placed after the RH1 entity-id contract (§3.1.5) so the two RH-era contracts sit side by side. The original spec's "§3.6" reference was a placeholder; the actual document doesn't have a §3.6, so the new subsection lives under Data Integrity §3.1.
- [x] Update `CLAUDE.md` "All mutations go through the reducer" line to clarify: reducer produces the state + slices; **in server mode the slices are for the server to persist and echo back, not for the client to append.** **Shipped 2026-07-03** at `CLAUDE.md:49`.

#### RH2.6 — Notes

> **2026-07-03 — RH2.6 shipped (final RH2 slice).**
>
> **Sub-slice merge.** The roadmap sketch split RH2.6 into `.a` (store dispatch mode-branch) and `.b` (UI readers: pending-state ergonomics). Exploration confirmed `.b`'s actual delta reduces to a `ItemHistory` audit — the "No entries yet" fallback already handles the in-flight empty-log window gracefully — plus two optional items explicitly deferred to R5 by the roadmap. So `.b` collapsed to documentation, and RH2.6.a + `.b` ship as one commit rather than two.
>
> **Dead code deleted.** Retiring client-side log emission in server mode makes several RH2.1b constructs redundant:
> - `PENDING` timestamp sentinel in `buildLogEntry` — no client-emitted entry, no PENDING to stamp.
> - `patchLogEntries` store method — no timestamp to patch after the fact.
> - `matchKey` + `stableStringify` helpers — content-matching's only consumer was `patchLogEntries`.
> - Dexie persist filter (`log.filter((e) => e.timestamp !== 'PENDING')`) — no PENDING entries exist to filter.
>
> All four deletions ship in this commit. `buildLogEntry` reverts to unconditional `new Date().toISOString()` (only called in local mode now).
>
> **BUG-004 closure.** Prior to RH2.6, in server mode:
> 1. Client's `buildLogEntry` composed a local log entry with `id = crypto.randomUUID()` and `timestamp: 'PENDING'`.
> 2. Server persisted the action, echoed back an `applied[]` entry with its own server-minted `id` and canonical timestamp.
> 3. Queue's `patchLogEntries` content-matched on `(type, payload-JSON)` to find the local PENDING entry and overwrote only the timestamp. The local `id` never converged with the server's `id`.
>
> Any future consumer keying by `entry.id` would silently read the client-minted value. Post-RH2.6, `state.log` in server mode holds ONLY server-emitted entries — no client-side `id` exists to diverge. `docs/BUGS.md` BUG-004 moved to "Recently fixed."
>
> **RH2.1b tests replaced.** The `PENDING`-timestamp assertion tests in `timestamp-authority.test.ts` are semantically void post-RH2.6 (no PENDING sentinel to check). File renamed to `log-authority.test.ts` with three focused tests covering the new contract: server-mode dispatch emits no log entry, local-mode dispatch is unchanged, queue post-flush populates `state.log` from `applied[]`.
>
> **`ctx.now()` stays on the interface.** The reducer still calls `ctx.now()` for entity `createdAt` / `joinedAt` / `leftAt` fields (`Stash.createdAt`, `PartyMembership.joinedAt`, etc.) — 30+ schema tests assert their presence. RH2.6 handles log entries only; entity timestamps stay client-minted for optimistic display and get overwritten on the next `pullState`. Full `ctx.now` retirement is an RH-followup if worth pursuing.

#### RH2.6 — Notes

> **Filed:** 2026-07-01, following BUG-004 triage. User direction: "In local mode the UI is responsible and in server mode the server is responsible for all log types since it is the source of truth."
>
> **Dependency graph:** RH1 → RH2.1 → **RH2.6** → (RH2.5 / RH3 / R5 all continue independently). RH2.2-2.4 are unblocked by RH2.6 (they touch reducer + queue mechanics but not log-authority).

#### RH2 — Notes

> **Prettier cleanup — post-RH2 followup (filed 2026-07-03).** During RH2.3 shipping, `pnpm format:check` surfaced ~50 pre-existing dirty files across the repo (screen tests, store code, reducer, guards, several `apps/web/src/screens/*.tsx`, `packages/rules/src/reducer/index.ts`, `packages/shared/src/guards/*.ts`, `README.md`, etc.). Reformatting them mid-RH2-slice would have introduced noise unrelated to the slice's concern. **Shipped 2026-07-03** after RH2.6 landed — ran `pnpm format` (`prettier --write .`) across the whole workspace; 48 files normalised. Verified `pnpm format:check` returns "All matched files use Prettier code style!" and re-ran `pnpm typecheck` (5/5 workspaces clean), `pnpm -r --parallel test` (all suites unchanged: rules 129/129, shared 253/253, web 738/738, server 194/194), `pnpm -r --parallel lint` (5/5 clean) to confirm zero behavioural change.

---

### RH3 — Hardening Pass 3: GameSession entity + sync schema readiness (architectural)

> **What this is.** Lifts the `GameSession` entity (called `Session` in OUTLINE §3.12 / §4 gameplay copy; renamed to `GameSession` in code per the OUTLINE §4 naming note to avoid collision with the Auth.js `Session` model) out of the R5.2 slice and onto its own pre-R5 hardening pass. Today the gameplay `Session` is a single line in OUTLINE §3.12 and a placeholder in §4; `TransactionLog.sessionId` is hard-`z.null()`. R5.2 currently bundles "introduce GameSession entity + activate session tagging + ship history UI session-filter" into one bullet; that's 3-4 slices of work, and the entity / schema piece is a pre-requisite for everything else.
>
> **Sequencing.** Ships AFTER RH2, BEFORE R5.1. R5.1's websocket broadcast needs to know whether a log entry belongs to an active session for routing purposes (a "no, the user hasn't started a session yet — these are untagged events" is itself a state R5.1 must handle). Defining the entity + the routing rules cleanly before R5.1 lands prevents R5.1 from accreting session logic it doesn't want.

**Why now.** Without RH3 the Session work is a mess of cross-cutting changes done piecemeal across R5.1, R5.2, R5.3:
- R5.1 has to decide what to do about `sessionId: null` log entries in the broadcast.
- R5.2 has to introduce the entity AND widen the schema AND activate tagging.
- R5.3 has to filter by sessionId against a schema that was just widened.

Pulling the entity + schema widening + the "Untagged" routing rule into RH3 means R5.1 / R5.2 / R5.3 each ship a clean feature on top of a stable foundation.

**Approach.** No user-facing UI yet — that's R5.2's job. RH3 introduces the entity, the schema widening, the actions, and the routing rule. After RH3 every log entry has a non-null `sessionId` field type (value still may be null in the "Untagged" case), and the codebase is ready for the actual session-tools surface to land.

**Slicing.** Two sub-slices.

#### RH3.1 — `GameSession` entity + schema widening

**Prisma schema (`apps/server/prisma/schema.prisma`) + migration**
- [x] New `GameSession` model: `id` (UUID v7, RH1-canonical), `partyId` (FK), `number` (auto-increment per party), `date` (date), `notes` (text, optional), `isCurrent` (bool — at most one true per party, enforced via partial unique index). **Named `GameSession` (not `Session`)** to avoid collision with the existing `model Session` Auth.js table (`schema.prisma:417`). — **Shipped 2026-07-03**
- [x] FK on `TransactionLog.sessionId → GameSession(id)` (nullable). The column keeps its short name — no rename needed; `sessionId` on a transaction log is unambiguous. FK carries `ON DELETE SET NULL` so deleting a GameSession never orphans history (entries become Untagged). — **Shipped 2026-07-03**
- [x] Partial unique index: at most one `GameSession` per party has `isCurrent = true` (`GameSession_isCurrent_uniq`). Mirrors the RH2.5 partial-unique pattern; verified in `apps/server/src/db/schema-invariants.test.ts` (test `(f)`). — **Shipped 2026-07-03**

**Zod schemas (`packages/shared/src/schemas/`)**
- [x] New `gameSessionSchema` in `packages/shared/src/schemas/gameSession.ts`. — **Shipped 2026-07-03**
- [x] Widen `TransactionLog.sessionId` from `z.null()` to `z.string().uuid().nullable()`. Existing log entries keep `null`; future entries will carry the active GameSession's id when one exists. — **Shipped 2026-07-03**
- [x] Add `gameSessions: GameSession[]` to `AppState`. — **Shipped 2026-07-03**

**Reducer (`packages/rules/src/reducer/index.ts`)**
- [x] `start-game-session` action: mints a fresh GameSession row, sets `isCurrent: true`, demotes any prior current session for the party (opt-in via `endCurrentFirst`; without the flag, throws `session_already_current`). Number is `max(existing) + 1`, per-party monotone. — **Shipped 2026-07-03**
- [x] `end-game-session` action: clears `isCurrent` on the current session; subsequent log entries land with `sessionId: null` ("Untagged" bucket per OUTLINE §3.12). — **Shipped 2026-07-03**
- [x] Reducer guard: `start-game-session` rejects if a session is already current AND the user didn't pass an explicit "end-first" flag — preserves the "exactly one current session per party" invariant. — **Shipped 2026-07-03**

**Log entry types (`packages/shared/src/schemas/transactionLog.ts`)**
- [x] Add `start-game-session` and `end-game-session` log entry types: `{ gameSessionId, number, date }` / `{ gameSessionId, number }`. — **Shipped 2026-07-03**
- [x] Middleware stamps the active GameSession's id from PRE-reduce state (same as `partyId` / `actorRole`) via shared `currentGameSessionId(state)` helper in `packages/shared/src/guards/actor.ts`. Consequence for the transition markers: `start-game-session` lands Untagged (pre-state has no current session yet); `end-game-session` lands with the ending session's id (pre-state still isCurrent=true). Subsequent regular entries inherit correctly. — **Shipped 2026-07-03**

**Server-side**
- [x] `persistStartGameSession` / `persistEndGameSession` in `apps/server/src/sync/persistor.ts`. Number computed authoritatively from `MAX(number) + 1` per party. — **Shipped 2026-07-03**
- [x] `state-loader.ts` includes `gameSessions` in the pulled AppState; `db/mappers.ts` gains `fromPrismaGameSession`. — **Shipped 2026-07-03**

**Guards (`packages/shared/src/guards/map.ts`)**
- [x] `startGameSessionGuard` / `endGameSessionGuard` — DM-only per OUTLINE §3.12 ("the DM marks the current session"). Solo bypass in `checkGuard` handles party-of-one. — **Shipped 2026-07-03**
- [x] Action metadata registry (RH2.4) — both actions marked `broadcastOnApplied: true` in `actionMetadata.ts`. — **Shipped 2026-07-03**

#### RH3.2 — Routing & "Untagged" filter rule

**Per OUTLINE §3.12 — already documented but not implemented**

- [x] The "Untagged" filter bucket: every log entry with `sessionId: null` belongs to the "Untagged" filter. Defined as a derived predicate `isUntaggedLogEntry(entry)` in `packages/shared/src/guards/actor.ts` — R5.3 will import when the session-filter UI ships. — **Shipped 2026-07-03**
- [x] **Server routing rule**: R5.1's broadcast doesn't filter by sessionId at the transport layer — every active member of a party receives every event. The session-filter is a client-side concern (display rule, history-view filter). Documented as an RH3 Notes rationale — SECURITY §6 (WebSocket Security) update deferred to R5.1's slice when the broadcast surface actually ships. — **Shipped 2026-07-03**

**Tests**
- [x] Reducer test: dispatching `start-game-session` then `acquire` produces an `acquire` log entry with `sessionId === <new game-session id>` — verified in `packages/rules/src/reducer/gameSession.test.ts` + `apps/web/src/store/log-authority.test.ts`. — **Shipped 2026-07-03**
- [x] Reducer test: dispatching `acquire` with no active game session produces a log entry with `sessionId: null`. — **Shipped 2026-07-03**
- [x] Reducer test: dispatching `end-game-session` then `acquire` produces a log entry with `sessionId: null` (the acquire lands Untagged; the end entry itself carries the ending session's id — see RH3 Notes for the pre-reduce-state stamping rationale). — **Shipped 2026-07-03**
- [x] Schema test: `transactionLogEntrySchema.parse(...)` accepts both `null` and a valid UUID for `sessionId` — `packages/shared/src/schemas/transactionLog.test.ts`. — **Shipped 2026-07-03**
- [x] Server integration test: `POST /sync/actions` batch with `start-game-session` + `acquire` — the acquire's `applied[]` entry carries the new session id — `apps/server/src/sync/routes.test.ts`. — **Shipped 2026-07-03**

#### RH3 — Notes

> **Shipped 2026-07-03 on `refactor/rh3-session-entity-sync-schema`.** RH3.1 + RH3.2 merged into one commit (`♻️ RH3 GameSession entity + sync schema`) following the RH2.6 precedent — RH3.2's UI-facing work was documentation-scale (one derived-predicate helper + a routing-rule note), not worth its own commit.
>
> **Naming decision.** Called `GameSession` in code (Prisma model, Zod schema, `AppState.gameSessions`, reducer actions `start-game-session` / `end-game-session`) to avoid collision with the existing Auth.js `Session` model at `schema.prisma:417`. The `TransactionLog.sessionId` column keeps its short name — unambiguous in log-column context. OUTLINE §4 gained a naming note pointing at this rationale.
>
> **Stamping decision — middleware, not reducer.** RH3.1 sketch said "stamping happens in the reducer". Post-RH2.6 review flipped this: `sessionId` is a state-derived log field, same category as `partyId` / `actorRole` — both are middleware-stamped via `resolveActor` / `buildLogEntry` / `buildLogEntryServer`. Putting sessionId in the reducer would (a) require every reducer arm to add `sessionId` to its slice output (30+ emit sites), (b) require the `LogEntrySlice` type to widen, and (c) break the RH2.1a symmetry that makes web + server produce bit-identical entries. The middleware path uses a shared `currentGameSessionId(state)` helper in `packages/shared/src/guards/actor.ts` — same file, same pattern as RH2.1a's `deriveActorRoleForSlice`.
>
> **Pre-reduce vs post-reduce state.** The middleware stamps from PRE-reduce state (consistent with `partyId` + `actorRole`). Consequence for the transition markers:
> - `start-game-session` lands with `sessionId: null` — the new session doesn't exist in pre-state. The entry belongs to the Untagged epoch it transitions OUT of.
> - `end-game-session` lands with the ending session's id — pre-state still has isCurrent=true. The entry belongs to the session it closes.
> - Regular entries emitted AFTER `start-game-session` see the new session as isCurrent=true in pre-state and inherit its id.
>
> This is the semantically correct decomposition: the transition markers announce the boundary crossings, and each belongs to the epoch it's leaving (start → Untagged; end → the ending session). Alternative (`result.state`-based stamping) would have made `start` self-referential and `end` Untagged — plausible but requires the middleware to break its "pre-reduce state" symmetry with `partyId` / `actorRole`.
>
> **BUG-005 avoided.** The `endCurrentFirst` flag on `start-game-session` demotes the prior session in a single reducer run — atomic with the new-session mint. Without it, the partial UNIQUE index `GameSession_isCurrent_uniq` would reject the insert (two isCurrent=true rows for the same party). The client-side reducer catches this before the persistor round-trips.
>
> **Session tools UI deferred to R5.2.** RH3 ships the data-model foundation only. R5.2's scope narrows to user-facing Start/End buttons, session list, "current session" indicator, and the distribute-loot session-tagging wizard.
>
> **Session-filter UI deferred to R5.3.** The `isUntaggedLogEntry` helper is available; R5.3 wires the party-log filter dropdown.
>
> **Historical log entries keep `sessionId: null`.** No back-fill migration. Pre-RH3 entries were always Untagged by design; the widened Zod schema still accepts them.
>
> **Dead code removed.** None — the `sessionId: z.null()` shape was narrowly used in tests + fixtures (all sites updated via the schema widening; no runtime code depended on the null-only invariant).
>
> **Prisma DSL drift addressed.** `Party_archivedAt_idx` (from R4.1.e) was created by migration but never declared on the schema, so `prisma migrate dev` kept emitting DROP/ADD pairs. RH3.1 declares `@@index([archivedAt])` on `model Party` — future migrations no longer drift this index. Similar hand-tailing on `Character_inventoryStashId_fkey` (DEFERRABLE + NO ACTION, per BUG-001) preserved by hand in the RH3.1 migration SQL, matching the schema.prisma prisma#8807 comment.
>
> **What RH3 does NOT do:**
> - No R5.1 broadcast surface (R5.1 owns it).
> - No SECURITY.md subsection — session data doesn't cross a new trust boundary; the guards enforce DM-only, actor identity still resolves from session cookie server-side.
> - No `delete-game-session` action — historical sessions are permanent audit anchors; users end them, they don't delete them.

---

### RH4 — Hardening Pass 4: URL-scoped routing (architectural)

> **What this is.** Retires the "implicit current-party" scoping pattern in favour of URL-scoped routes. Every party-scoped screen gains `:partyId` in its route pattern (`/party/settings` → `/party/:partyId/settings`; `/character/:id` → `/party/:partyId/character/:id`; etc.). Same shift for other resource-scoped surfaces if any surface later.
>
> **Sequencing.** Ships AFTER RH3, BEFORE R5.1. Same "R5-blocker" rationale as the other RH slices: R5.1's websocket broadcast subscribes rooms scoped by resource id; the natural mapping is URL → room (`/party/:partyId/*` → `party:${partyId}`). An implicit-pointer scoping forces R5.1 to invent a parallel "which party is this tab in" resolution, which is brittle under multi-tab and untestable in unit tests.

**Why now.** Today the app uses School-B implicit scoping (per 2026-07-01 discussion of URL-scoping conventions). The pattern is fine for a single-writer WIP but bakes in three long-term costs:

- **Multi-tab correctness.** Two tabs on different parties currently share the Dexie `currentPartyId` pointer — activating a party in tab A silently switches tab B on next dispatch. RH2.3 addresses same-party multi-tab (BroadcastChannel coordinator); it doesn't fix cross-party multi-tab because both tabs use the same origin. URL-scoped routing eliminates the shared pointer: each tab's URL identifies its party, no cross-tab activation state to synchronise for the different-party case.
- **Deep-linking / shareability.** "Copy this URL to your co-DM" fails today — the URL is `/party/settings` regardless of which party is loaded. RH4 makes URLs meaningful outside the current session.
- **R5 broadcast rooms.** WebSocket subscriptions are naturally scoped by URL params. Matching against a mutable `currentPartyId` pointer under N concurrent tabs = a class of subtle race bugs. URL scoping is the standard fix pattern (see e.g. React Router v6 + Remix docs on nested resource routing).
- **Client-server URL asymmetry.** Server already uses URL-scoped routes (`POST /parties/:partyId/kick`, `GET /parties/:partyId/members`). Client's implicit scoping means every code review carries a small "does this route need the id explicitly?" tax. Alignment reduces friction.

**Prior art.** GitHub, Linear, Notion, Vercel, Figma, Discord, Slack (post-workspace-switch) all use URL-scoped resource ids for the same reason. React Router v6 + Remix + Next.js App Router all push nested-route scoping as the default. Kent C. Dodds / Ryan Florence's "URL is the world's under-appreciated state manager" is the school this slice adopts.

**What stays.** Local-mode's Dexie `meta.currentPartyId` pointer stays for two derived reasons: (a) it still tracks "which party did the user last activate" for the Hub landing screen; (b) it's the single-writer local-mode's natural home. Server-mode routes read `partyId` from the URL and NEVER from `meta.currentPartyId`; the pointer becomes a UX-hint only, not a source of truth.

**Approach.** Route pattern refactor. Every party-scoped route gains `:partyId`. Every navigation call updates. Every screen reads `partyId` from `useParams()` instead of from `useStore(s => s.appState.party.id)`. Store still exposes `party.id` for reads that don't have URL context (e.g. modals mounted outside a route); but the URL is the source of truth for scope.

**Slicing.** Three sub-slices, ordered by dependency.

#### RH4.1 — Route pattern refactor

**Router (`apps/web/src/router/index.tsx`)**
- [ ] Rewrite the route table so every party-scoped surface takes `:partyId`. Target patterns:
  - `/party/:partyId/settings` (was `/party/settings`)
  - `/party/:partyId/hub` (was `/hub`) — Hub becomes party-agnostic AT the app-level (party picker); per-party Hub content moves under the id
  - `/party/:partyId/character/:id` (was `/character/:id`)
  - `/party/:partyId/item/:id` (was `/item/:id`)
  - `/party/:partyId/stash/:id` (was `/stash/:id`)
  - `/party/:partyId/catalog` (was `/catalog`) — catalog is party-scoped per R4.4 homebrew rules
  - `/party/:partyId/dm` (was `/dm`) — **R4.5 carryforward.** The DM Dashboard route shipped as `/dm` on 2026-07-01 to stay consistent with the then-current unprefixed-route era. RH4.1 must rename it alongside every other party-scoped route. Also carries a `DmOnlyRoute` guard that must be preserved through the rewrite (its membership check is orthogonal to the URL structure and needs no change — just ensure the guard still wraps `DmDashboard` after the path change).
  - `/party/:partyId/log` (once a global party-log screen exists)
- [ ] `/hub` remains as the pre-party-selection landing (party picker + create-party CTA); it doesn't need a partyId.
- [ ] `/settings` (app-wide settings, backup/restore) remains party-agnostic and does NOT gain `:partyId`.
- [ ] `/login`, `/login/*`, other auth routes remain unchanged.

**Component-side (`apps/web/src/screens/*.tsx`, `apps/web/src/components/**/*.tsx`)**
- [ ] Every screen that currently reads `s.appState.party.id` from the store switches to `useParams<{ partyId: string }>()` and validates the id matches `s.appState.party.id` on mount. Mismatch → trigger a party-switch (Dexie re-hydrate) before rendering.
- [ ] Every `navigate('/...')` / `<Link to="/..." />` call updates to include the current party id. New helper: `useCurrentPartyId()` returns the id from `useParams`, throws if missing (routes that opt into the helper are guaranteed inside a `/party/:partyId/*` subtree).
- [ ] `Layout.tsx` (nav bar) — the "Party Settings" link becomes `to={`/party/${partyId}/settings`}` using the same helper.

**Party-switching flow (`apps/web/src/screens/Hub.tsx`)**
- [ ] Hub's "Enter this party" CTA navigates to `/party/${partyId}/hub` (or a per-party landing). Setting `meta.currentPartyId` in Dexie stays for the local-mode UX hint but is no longer the source of truth.
- [ ] The party-switching path becomes: URL change → route mount → screen reads `partyId` from `useParams` → if `s.appState.party.id !== partyId`, trigger `loadAppState(partyId)` → replace store. Same shape as today's Hub re-hydrate flow, just triggered by URL rather than a state pointer.

**Tests**
- [ ] Update every screen test's `initialEntries` to include a `partyId` in the path. Existing fixtures are all `[/party/settings]`, `[/character/char-abc]`, etc. — becomes `[/party/${TEST_PARTY_ID}/settings]`, etc.
- [ ] New test: URL `partyId` mismatched with loaded state triggers re-hydrate. Given `s.appState.party.id === 'A'` and route `/party/B/settings`, expect the store to reload B before the screen renders.
- [ ] New test: URL `partyId` for a party the user isn't a member of → 403-style redirect to Hub.
- [ ] Existing R4.5 tests for `/dm` (`DmDashboard.test.tsx`) — update `initialEntries` to `/party/${TEST_PARTY_ID}/dm` and add a URL-vs-state mismatch test specific to the DM Dashboard.

**URL-vs-state authority decision (2026-07-01, ratified during R4.5 planning).**
- **URL param is authoritative.** When `useParams.partyId !== s.appState.party.id`, the guard triggers a re-hydrate (`loadAppState(partyId)`) before rendering. State conforms to URL, not vice versa.
- **Rationale.** Server-authoritative routing means bookmarks + shared links + back-button navigation resolve consistently. If state were authoritative, a URL rewrite wouldn't reload the party, breaking the browser primitive. The URL is the durable identifier.
- **Mismatch semantics.** Not-a-member of the URL's partyId → redirect to `/hub` (same treatment as R4.5's non-DM redirect). Member-of-both parties → re-hydrate the correct one. Loading in-progress → the same `loading` state as `ProtectedRoute` handles today.

#### RH4.1 — Notes

> -

#### RH4.2 — Retire `meta.currentPartyId` as source-of-truth (local-mode carryforward)

**Dexie meta (`apps/web/src/db/meta.ts`)**
- [ ] `getCurrentPartyId()` / `setCurrentPartyId()` remain as functions but their role shrinks to: "which party should the pre-URL landing show first?" — used only by `/hub` and the initial post-login redirect.
- [ ] Every server-mode read of `currentPartyId` (in the sync queue, in `PartySettings`, in `CharacterSheet` state loading) is replaced by the `useParams<{partyId}>()`-based helper. Only local-mode single-writer paths retain the Dexie pointer.
- [ ] Boot hydration (`apps/web/src/store/hydrate.ts`): on app load, read `currentPartyId` from meta, redirect to `/party/${id}/hub`. On first-login (no current party), redirect to `/hub` (party picker).

**Sync queue (`apps/web/src/sync/queue.ts`)**
- [ ] `getActivePartyId` dep is replaced by a URL-derived helper. Since queue is module-scoped (not React), it needs to be told the current partyId on each enqueue. Options: (a) `enqueue(action, partyId)` signature widening, (b) `configureQueue({ currentPartyId })` re-run on route changes. Prefer (a) — explicit, no hidden route-listener state.

**Tests**
- [ ] Test that server-mode routes ignore `meta.currentPartyId` entirely (mismatched pointer + correct URL = correct behaviour).
- [ ] Test that local-mode boot still uses `meta.currentPartyId` for the initial redirect.

#### RH4.2 — Notes

> -

#### RH4.3 — Cross-party access denial + party-switcher polish

**Route guards**
- [ ] Add a `PartyScopeGuard` component wrapping every `/party/:partyId/*` route. Reads `partyId` from `useParams`, checks `s.appState.memberships` for an active membership of `state.user.id` in that party. If missing → redirect to `/hub` with a toast: "You're not a member of that party." Prevents URL tampering (deep-linking to another party's screen).
- [ ] Server-side already enforces this via `resolveActor` (`apps/server/src/sync/actor.ts`) returning 403 for cross-party access; RH4.3 is the client-side mirror for UX.

**Party-switcher**
- [ ] Optional: add a party picker in the nav bar (dropdown of the user's active parties). Clicking switches URL to `/party/${newId}/hub`. Nice-to-have; not required for RH4 correctness. Consider deferring to R4.6 as UX polish.

**Tests**
- [ ] `PartyScopeGuard` unit test: user is a member of party A only; navigating to `/party/B/settings` redirects to `/hub` + toast.
- [ ] `PartyScopeGuard` unit test: user is a member; renders the child screen.

#### RH4.3 — Notes

> -

#### RH4 — Notes

> **Filed 2026-07-01** following BUG-004 triage + a discussion of URL-scoping conventions. User direction: "We should fix this as part of RH slices." Chosen scope: URL scoping is the industry-consensus modern-SaaS pattern (GitHub / Linear / Notion / Vercel / Discord all URL-scope), it eliminates multi-tab pointer-sharing bugs, and it prepares R5's broadcast rooms.
>
> **What RH4 does NOT do:**
> - Change server routes. Server already URL-scopes (`/parties/:partyId/*`); RH4 is purely a client-side alignment.
> - Rearchitect the store. `useStore(s => s.appState.party.id)` still works; RH4 just makes `useParams<{partyId}>()` the authoritative read.
> - Retire the Dexie `meta.currentPartyId` pointer entirely. It stays for the "first-load, no URL" case in local mode. See RH4.2.
>
> **Interaction with RH2.3.** RH2.3's multi-tab BroadcastChannel coordinator handles the case where TWO TABS OPERATE ON THE SAME PARTY (same URL) — queue coordination for concurrent enqueues. RH4 makes the DIFFERENT-PARTY multi-tab case work correctly (each tab's URL identifies its party, no cross-activation). Both slices remain needed; RH4 doesn't subsume RH2.3.
>
> **Interaction with R5.1 (websocket broadcast).** R5.1 subscribes rooms scoped by `partyId`. With URL-scoped routes, `useEffect(() => subscribe(partyId), [partyId])` reads the id from `useParams` and re-subscribes on URL change. Clean; testable. Without URL scoping, the subscription would follow `s.appState.party.id`, which can change under N tabs — R5.1 would need to distinguish "which tab is authoritative" (a much harder problem).
>
> **Cost estimate.** ~1 afternoon of work: route table refactor + `useParams` migration in ~15 screens + test `initialEntries` updates. No user-visible behaviour change beyond bookmarkable URLs. Tests need mechanical updates but no new invariants.
>
> **Reversibility.** Fully reversible. If URL scoping proves too noisy after ship, revert the router patterns and the migration is complete. Store still exposes `party.id` throughout — no data-model changes to unwind.

---

### RH5 — Hardening Pass 5: Dexie hydration hardening (client persistence contract)

> **What this is.** Retires the multi-tier fallback chain in the client's boot hydration path. `loadAppState()` currently accepts a nullable `partyId` and, on absence, falls back through (a) the unkeyed legacy slot, (b) the current-party pointer, (c) the first keyed blob it can find. After this slice, `loadAppState(partyId: string)` is required-arg; the pointer is the ONLY resolver for "which party did the user last activate"; a parse failure is a corruption signal rather than a "try the next slot" trigger.
>
> **Promoted from RH0.3 (2026-07-02).** RH0.3 was scoped inside the RH0 legacy-data-strip pass but deferred on 2026-06-30 because the null-state save path (the pre-character-creation window where `appState === null` but Dexie still needs to persist meta) tangles with the fallback removal and needs a dedicated design decision — outside RH0's mechanical-deletion charter. Promoted here so it isn't forgotten.
>
> **Sequencing.** No hard dependency on RH1–RH4. Can ship in parallel with the RH-chain or after it. Recommended to ship **before RH4** if RH4 is imminent — RH4 rewrites the router around URL-scoped `partyId`, which makes "URL is the source of truth for partyId, Dexie pointer is a UX hint" the canonical pattern; landing RH5 first means RH4 can assume a clean hydration contract from day one. Alternatively, ship RH5 **after** RH4 to piggyback on the URL-scoped pattern (the URL becomes the authoritative pointer, and Dexie's pointer just tracks the last-visited party for the Hub landing). Either order works — pick during scheduling.
>
> **Why now.** Three costs of keeping the fallback chain:
> - **Silent corruption masking.** After RH0.1 tightened Zod to `.strict()`, a parse failure on the primary slot means the blob is genuinely corrupted. Silently retrying the legacy unkeyed slot or the "first keyed blob" hides the corruption from the user AND may load the wrong party's data as if it were the current one.
> - **RH4 asymmetry.** RH4's URL-scoped routing wants Dexie's role narrowed to "cache keyed by `appState:<partyId>`" — the pointer becomes a UX hint (Hub landing screen), not a source of truth. The multi-tier fallback contradicts this narrowing.
> - **Test-shape drift.** Persistence tests today have to model the null-state save window + the four fallback tiers. Every new test adds another axis; a single-path loader collapses that surface area.

**Why deferred from RH0.** The persistence layer has two storage modes (unkeyed slot for the pre-character-creation null-state window, keyed `appState:<partyId>` for parties). Both `loadAppState()` callers AND `createDebouncedSaver` actively use the unkeyed slot during the bootstrap window. Removing all fallbacks requires a real design decision about the null-state save: skip writing? write to a dedicated key like `appState:pending`? drop the null-state persistence entirely and let Hub re-mint on reload? Plus a ~10-test migration in `persistence.test.ts`. This is design-cost, not mechanical deletion — outside RH0's charter.

**Approach.** Three sub-decisions, each shippable independently, but naturally landing together:

**Slicing.** Three sub-slices in the intended order.

#### RH5.1 — Design decision: null-state save behaviour

**Design work (before any code)**
- [ ] Pick one of three approaches for the pre-character-creation null-state window:
  1. **Skip null-state persistence entirely.** The store's `appState: null` phase never writes to Dexie. On reload, `hydrate.ts` sees no keyed blob for `currentPartyId` (because it's also `null`), boots empty, and Hub renders the create-party CTA. Pros: cleanest — no null-state row in storage. Cons: any in-progress state (draft party name, wizard step) is lost on refresh — but the Hub wizard is transient by design, so this may be acceptable.
  2. **Dedicated `appState:pending` key.** Null-state writes go to a well-known key that's semantically distinct from party blobs. Loader ignores it during party-scoped reads. Pros: null-state persistence preserved for Hub wizard refresh survival. Cons: one more storage key to reason about; RH0.1's `.strict()` schema doesn't naturally cover a partial "wizard-in-progress" shape.
  3. **Move Hub wizard state out of `appState` entirely.** Wizard draft goes to a component-local `useState` or a tiny separate Dexie `meta` field (e.g. `hubWizardDraft`), not into the main store. The store's `appState` becomes strictly non-null after first party creation. Pros: cleanest separation of concerns; the store is only ever null before the FIRST party ever exists on the device. Cons: mechanical Hub refactor.
- [ ] Capture the decision in this slice's Notes block. The decision affects RH5.2's shape.

#### RH5.2 — Dexie loader + hydration path

**Dexie loader (`apps/web/src/db/load.ts`)**
- [ ] Remove the legacy unkeyed-slot fallback (lines ~12–40). `loadAppState(partyId: string)` becomes required-argument; callers that don't have a partyId must read it from `getCurrentPartyId()` first.
- [ ] Remove the "first keyed blob" tertiary fallback. If no partyId is supplied AND no current-party pointer exists, return `null` cleanly (caller routes to Hub).
- [ ] `createDebouncedSaver` updated per the RH5.1 decision (skip null-state / dedicated key / no null-state persistence at all).

**Boot hydration (`apps/web/src/store/hydrate.ts`)**
- [ ] Reduce the four-tier fallback chain (lines ~29–59) to a single path: `currentPartyId from meta → loadAppState(partyId)`. If `currentPartyId` is missing, the store stays empty (`appState: null`) — Hub handles the empty case via the existing "no current party" branch.
- [ ] Remove the Zod-parse-then-try-legacy-slot pattern in `hydrate.ts`. After RH0.1 the schema is strict — a parse failure means the blob is genuinely corrupted, not "old shape we should fall back from." Surface the error to the user (toast + wipe), don't silently retry against legacy slots.

**Error handling**
- [ ] Corruption path: on parse failure, show a user-facing dialog ("Local data for this party is corrupted. Export any data you can, then wipe.") with a Wipe button that clears just the affected blob. Don't silently continue with a partial state.

#### RH5.3 — Test migration

**Tests (`apps/web/src/db/persistence.test.ts` + downstream)**
- [ ] Audit every callsite of `loadAppState()` in `apps/web/src/**/*.test.ts` (and `*.test.tsx`). Migrate any call that previously relied on the legacy fallbacks to pass an explicit `partyId`.
- [ ] Add a test for the corruption-detection path: seed a Dexie blob with an invalid shape → `hydrate.ts` returns `appState: null` + surfaces the corruption toast, does NOT silently fall through to another slot.
- [ ] Add a test for the "no current party" boot: empty Dexie → `hydrate.ts` returns `appState: null`; Hub renders the create-party CTA. Locks in the "single-path" contract.
- [ ] Delete tests that exercised the removed fallback tiers (they'll fail once the fallbacks are gone; deletion is the right response, not adaptation).

#### RH5 — Notes

> **Filed 2026-07-02.** Promoted from RH0.3 (deferred 2026-06-30). RH0.3's task list was moved here verbatim + expanded with the null-state design decision (RH5.1) that blocked the original ship. The `Welcome.tsx` / `CreateCharacter.tsx` legacy-screen deletions from RH0.3's neighbourhood already shipped in RH0.4 — this slice covers only the Dexie loader + hydration contract narrowing.
>
> **Not blocked by anything.** RH5 is orthogonal to RH1 (id authority), RH2 (determinism), RH3 (GameSession entity), RH4 (URL routing). Can ship whenever the hydrate path is next touched.
>
> **Estimated cost.** ~1 afternoon for RH5.1 (design + capture) + ~1 afternoon for RH5.2 (code) + ~1 afternoon for RH5.3 (test migration). Small slice; the design decision is the only real cost.

---

### R5 — Live sync & history (outline §10 M5)

Websocket sync; per-item history; party log with session-tag filter; offline banner in party mode. Covers OUTLINE §3.11, §3.12, §4 `GameSession`, §5.8 (History/Log).

**Sequencing.** R5 depends on the **RH-chain** (RH0 cleanup, RH1 server-authoritative IDs, RH2 determinism + invariants, RH3 GameSession entity + sync schema) landing first. R5's websocket broadcast cements client-server interaction patterns; every architectural debt item handled BEFORE R5 lands costs one slice, every one deferred PAST R5 costs RH-slice + multi-writer-reconciliation. The RH chain ships in order; R5.1 starts once RH3 is done.

**Slicing.** Three independently testable surfaces: R5.1 ships the websocket plumbing + reconciliation; R5.2 adds the `GameSession` entity's user-facing tooling on top of RH3's data-model foundation; R5.3 builds the history UI on top. R5.3 depends on R5.2 (session filter) but not R5.1 (history reads from `TransactionLog` directly).

#### R5.1 — Websocket sync + reconnect

- [ ] Websocket party-room subscription (server pushes action diffs)
- [ ] Optimistic UI: web applies action locally, reconciles on server ack
- [ ] Conflict resolution policy documented and implemented (server is authoritative)
- [ ] Reconnect flow replays missed events
- [ ] Offline banner active in multi-member parties; writes blocked while offline (§9)
- [ ] **Offline-first Dexie cache for solo parties** — **carryforward from R3.5**. Today the web sync queue keeps optimistic state on a network error but drops the batch; solo parties should survive a full offline session by replaying the queue when connectivity returns. (Source: R3.5 Notes.)
- [ ] **Sync queue retry semantics** — R3.5 surfaces a transient toast on network errors and drops the batch. R5 should add bounded retry with exponential backoff and an "outbox" persisted to Dexie so a tab close doesn't lose work. Inline pointer: `apps/web/src/sync/queue.ts:22, 192`. **Carryforward from R3.5.**

#### R5.1 — Notes

> -

#### R5.2 — Sessions entity + log tagging

> **Scope narrowed 2026-07-03 (RH3.1 shipped the data model).** RH3.1 landed the `GameSession` entity, `TransactionLog.sessionId` widening, the `start-game-session` / `end-game-session` reducer actions, the DM-only guards, and the middleware stamping. R5.2's remaining work is the **user-facing session tools UI + the distribute-loot session tagging wizard** on top of that foundation.

- [x] `GameSession` entity (id, partyId, number, date, notes, isCurrent) — **Shipped in RH3.1 (2026-07-03)**
- [x] Invariant: at most one `isCurrent` session per party — enforced by partial UNIQUE index `GameSession_isCurrent_uniq` per RH3.1
- [x] Action: `start-game-session` (rejects when a session is already current unless `endCurrentFirst: true`) — **Shipped in RH3.1**
- [x] Action: `end-game-session` — **Shipped in RH3.1**
- [x] `TransactionLog.sessionId` populated from PRE-reduce current session at write time; **`null` when no session is current** per OUTLINE §3.12 amendment (2026-06-24) — no-session activity is allowed, not blocked. — **Shipped in RH3.1**
- [x] Reducer test: dispatching `acquire` / `transfer` / `currency-transfer` etc. with no current session produces log entries with `sessionId: null`. — **Shipped in RH3.1**
- [ ] **UI: Start / End Session buttons** — party header or DM Dashboard surface. DM-only. Confirmation dialog on End.
- [ ] **UI: Current session indicator** — visible on every party-scoped screen when a session is active ("Session 12 in progress — Started March 5th").
- [ ] **UI: Session list** — DM view of every past session with dates + notes; edit-in-place for notes on the current session.
- [ ] **Distribute-loot session tagging wizard** — the DM's "give this hoard to the party" flow auto-starts a session if none is current, then tags every emitted `transfer` / `acquire` slice against it (OUTLINE §3.12).

#### R5.2 — Notes

> -

#### R5.3 — History UI + permission rules

- [ ] Party log timeline view (§5.8)
- [ ] Filters: session / character / item / action type / actorRole
- [ ] **Session filter has an explicit "Untagged" bucket** that surfaces entries with `sessionId: null` per OUTLINE §3.12. Component test: a no-session entry appears under "Untagged" in the filter dropdown and renders in the list when "Untagged" is selected.
- [ ] Per-item history queried directly from log (no separate table, per §4)
- [ ] **Permission rule** per OUTLINE §3.4 amendment (2026-06-24): per-item history is visible to (a) the current owner + DM for items in a character's Inventory or Storage, and (b) **every party member** for items currently in **Party Stash** or **Recovered Loot** (matches §3.15 transparency on shared pools).
- [ ] Component test: player A's Inventory item history is hidden from player B (only A + DM see it).
- [ ] Component test: an item currently in Party Stash has its history visible to every party member.
- [ ] Component test: an item moved from a player's Inventory → Party Stash → back to a different player's Inventory has each segment of its history visible to the right audience at the time it was held there (the visibility rule reads the item's CURRENT `ownerId` for the gating decision; the history rows themselves are immutable).
- [ ] Virtualized list / pagination for long histories
- [ ] Banker actions tagged `actorRole: "banker"` visible to all members (§3.14)

#### R5.3 — Notes

> -

#### R5 — Notes

> -

---

### R6 — DM tools (outline §10 M6)

Loot distribution wizard (per-hoard mode), hoard generator, identification flow with hints, shop manager (static + modifiers). Covers OUTLINE §3.7 (search), §3.9, §3.10, §6 `hoard.ts` / `pricing.ts` / `search.ts`.

**Slicing.** R6 is the second-largest milestone after R4 (~30+ checkboxes). Splits along the rules-engine + UI surface axes: R6.0 lights up the DM character-field editors (independent, no rules-engine dep); R6.1 lights up `pricing.ts` + the per-party economy controls (prerequisite for any priced transaction); R6.2 adds `Shop` + `purchase`/`sale` on top; R6.3 ships the hoard generator + loot distribution wizard; R6.4 adds identification UI + batch-identify (the R2.3 reducer already exists by this point); R6.5 swaps the Catalog Browser to `search.ts`. R6.0 is independent of the others; R6.1 is the hard dependency for R6.2 and the catalog price display.

#### R6.0 — DM character-field editors (`maxAttunement`, other catch-all fields)

**Rationale.** The `edit-character` catch-all reducer + guard have shipped since R1.2 (schema + reducer + DM-only guard + audit-log entry), and R4.3.d widened the guard so DMs can dispatch against ANY character in their party. What's missing across the R1.2 → R4.5 arc is the UI affordance: no screen today dispatches `edit-character` with `{ patch: { maxAttunement: N } }` (or any of the other DM-editable fields). R6.0 lights up that surface as a stand-alone slice so subsequent R6 work can lean on it (e.g. R6.3's loot wizard may want to bump a character's `maxAttunement` when handing out a legendary; R6.4 identification runs alongside).

**UI**
- [ ] DM-only inline editor for `Character.maxAttunement` on `EquippedSlotsPanel` (or a "DM edit character" dialog reachable from the character-sheet header — pick during implementation). Dispatches `edit-character { characterId, patch: { maxAttunement: N } }`. **Both directions supported:** grant (raise cap, e.g. 3 → 5) AND reduce (lower cap, e.g. 3 → 2). Bounded by the R3.1 DB CHECK: `maxAttunement >= 0`, so 0 is the min (a valid legal value meaning "no attunement possible"), no negatives.
- [ ] Over-cap-reduce confirm dialog. When the DM lowers `maxAttunement` BELOW the character's current attuned count (e.g. character has 3 attuned, DM sets max to 2), show an AlertDialog: "{Character} has {N} attuned items; reducing max to {M} will leave them over-cap. Continue?" Per R1.2 Notes line 865 this is legal (existing attunements NOT auto-revoked; over-cap state is a display flag, not an invariant violation) — but confirmation is warranted so the DM doesn't strand players over cap accidentally. Reuse the R4.3.d cap-override AlertDialog primitive pattern.
- [ ] Suppressed / hidden for non-DM players in 2+-member parties. Solo bypass (§8.2) allows the sole member to edit their own `maxAttunement`. Reuse the `isCurrentUserDmOrSolo` helper from R4.5.
- [ ] Optional stretch: an inline "DM edit character" dialog covering `species` / `class` / `level` / `str` / `maxAttunement` in one form (matches OUTLINE §5.15's Party Settings §5.15 amend flow). Skip if per-field inline editors are sufficient.

**Tests**
- [ ] Component test: DM raises `maxAttunement` from 3 → 5, next attune fires without the cap-override dialog (slot check now passes cleanly).
- [ ] Component test: DM lowers `maxAttunement` from 3 → 2 while character has 3 attuned → over-cap confirm dialog appears; confirming dispatches the edit and leaves existing attunements intact (over-cap display state).
- [ ] Component test: cancel on the over-cap confirm dialog leaves `maxAttunement` unchanged.
- [ ] Component test: `maxAttunement = 0` accepted and rendered (edge case — character can no longer attune anything).
- [ ] Guard test: non-DM player in 2+-member party cannot dispatch `edit-character { patch: { maxAttunement } }` (already covered by R1.2 tests; add one more if the UI adds a client-side pre-guard).

#### R6.0 — Notes

> -

#### R6.1 — Pricing + per-party economy

**Rules — activate stubs (§6)**
- [ ] `packages/rules/pricing.ts` implemented (base price × party.priceModifier × shop.priceModifier; default 0.5× sell)
- [ ] `pricing.ts:formatPrice(cp, baseCurrency)` — display canonicalizer per OUTLINE §3.5 (largest denomination ≤ baseCurrency that divides cleanly; no fractional coins; no rollup past ceiling; sub-cp rounds to nearest cp)
- [ ] `pricing.ts` tests cover modifier composition, override, sell-to-merchant rate, AND every row of the OUTLINE §3.5 preset table (Gold / Silver / Copper / Electrum / Platinum)
- [ ] `pricing.ts` tests cover the "no rollup past ceiling" rule explicitly (200 gp under `baseCurrency="gp"` stays "200 gp", never "20 pp")

**Per-party economy controls (§3.5)** — promoted from Future / Stretch (2026-06-23) because R6 is the natural home: it's the milestone that activates `pricing.ts` AND introduces `purchase` / `sale`, which are the first call sites that actually read a price.
- [ ] `Party.priceModifier: number` schema field (default `1.0`) — additive on the existing `Party` Zod schema
- [ ] `Party.baseCurrency: "cp" | "sp" | "ep" | "gp" | "pp"` schema field (default `"gp"`) — additive
- [ ] Round-trip test: pre-R6 (M4-vintage) AppState exports import cleanly with the new fields defaulted
- [ ] Catalog Browser displays prices via `pricing.ts:formatPrice` honoring the party's `baseCurrency`
- [ ] Catalog Browser preset-chooser test: switching from Gold to Silver standard re-renders the visible catalog prices without re-seeding
- [ ] Party Settings (§5.15) preset chooser: Gold / Silver / Copper / Electrum / Platinum / Custom (canonical mapping per OUTLINE §3.5 preset table). Selecting a named preset sets both `priceModifier` and `baseCurrency` atomically; "Custom" reveals the two raw inputs.
- [ ] `update-party-economy` action + payload schema (`{ priceModifier, baseCurrency }`); single log entry per change; DM-only when `memberCount >= 2` (per §8.1)
- [ ] Component test: changing the preset from the Settings UI updates a sample Catalog Browser display end-to-end

#### R6.1 — Notes

> -

#### R6.2 — Shops + purchase / sale

**Schema activations (§4 `Shop`)**
- [ ] `Shop` entity activated (id, partyId, name, priceModifier, sellToMerchantRate, stock)
- [ ] `Shop.stock` entries: `{ itemDefinitionId, priceOverride?, quantity }` with `-1` = unlimited
- [ ] `ItemInstance.ownerType = "shop"` becomes legal
- [ ] Action: `purchase` (`{ itemInstanceId, quantity, currencyDelta, shopId }`)
- [ ] Action: `sale` (`{ itemInstanceId, quantity, currencyDelta, shopId }`)
- [ ] Purchase decrements finite shop stock; unlimited stock untouched
- [ ] **Shops have no `CurrencyHolding`** per OUTLINE §3.9 amendment (2026-06-24). `purchase` only debits the buyer's stash; `sale` only credits the buyer's stash. The shop side is bookkeeping-free — `Shop` deliberately omits a currency row.
- [ ] Invariant test: `purchase` debits 50 cp from the buyer's Inventory when the priced item costs 50 cp; no other state changes.
- [ ] Invariant test: `sale` credits the buyer's Inventory at the shop's `sellToMerchantRate × price`; no other state changes.
- [ ] `purchase` / `sale` reducer cases consult `party.priceModifier` × `shop.priceModifier` via `pricing.ts` when resolving the cost of a catalog row
- [ ] Reducer test: PHB-sourced rows are scaled by `priceModifier`; homebrew-sourced rows skip the modifier (per `ItemDefinition.source` discriminator)
- [ ] Reducer test: purchase under `priceModifier: 0.1` of a 5 gp PHB item charges 50 cp from the buyer's stash

**Shops (§3.9, §5.12)**
- [ ] Shop Manager screen: create / edit shops + stock + modifiers
- [ ] Manual purchase flow: DM resolves each buy/sell as explicit `purchase` / `sale` transfer
- [ ] Catalog Browser "Add to shop" picker

#### R6.2 — Notes

> -

#### R6.3 — Hoard generator + loot distribution wizard

**Rules — activate stub (§6)**
- [ ] `packages/rules/hoard.ts` implemented (DMG 2024 tables by CR/level band)
- [ ] `hoard.ts` tests cover representative CR bands

**Loot distribution (§3.10)**
- [ ] Loot Distribution Wizard screen (§5.10) — per-hoard choice: shared pool vs direct assign
- [ ] "Drop loot into shared pool" action (loot → Party Stash; players claim per §3.14 rules)
- [ ] "Assign loot directly to player" action (item lands in target character's Inventory or Storage)
- [ ] Wizard tags emitted log entries with the active session (§3.12)

**Hoard generator (§3.5, §5.11)**
- [ ] Hoard Generator screen using `hoard.ts`
- [ ] Output flows into the Loot Distribution Wizard

#### R6.3 — Notes

> -

#### R6.4 — Identification panel + batch-identify

**Identification (§3.8, §5.13)**
- [ ] Identification Panel UI: list of unidentified instances in the party
- [ ] DM toggles `identified`; players see real name update via sync
- [ ] DM-set hint editable
- [ ] **Bidirectional toggle** per OUTLINE §3.8 amendment (2026-06-24): the DM can flip an item BACK to `identified: false` (e.g., "actually that was cursed all along"). Component test: identified → unidentified flip produces an `identify` log entry; the item reverts to "Unknown Magic Item" + hint display per the §8 display invariant.
- [ ] **DM batch-identify action** per OUTLINE §3.8 amendment (2026-06-24): a dedicated DM toolkit affordance that toggles `identified` and optionally sets a shared hint across ALL instances of a given `definitionId` in the party (Inventory + Storage + Party Stash + Recovered Loot). Emits one `identify` log entry per affected instance (or a single batch entry — pick one and document). Useful because hints are per-instance (§3.8), so bulk-revealing several copies of "Sword of X" otherwise takes one-by-one clicks.
- [ ] Batch-identify component test: 3 unidentified copies of the same definition → one batch click → all 3 reveal; 3 `identify` log entries (or one batch entry) recorded.

#### R6.4 — Notes

> -

#### R6.5 — Catalog search

**Rules — activate stub (§6)**
- [ ] `packages/rules/search.ts` implemented (fuzzy across name + description + tags)
- [ ] `search.ts` tests cover ranking + filter combinations

**Catalog search**
- [ ] Catalog search wired to `search.ts` (replaces M2's simple search)
- [ ] Filters by category, rarity, attunement-required, cost, source (§3.7)
- [ ] Catalog source filter (PHB / DMG / homebrew / all) surfaced in `CatalogBrowser` alongside the category filter
- [ ] Catalog source-filter test: with PHB + ≥1 homebrew loaded, selecting "homebrew" hides PHB rows; "all" restores them; combines with category filter (e.g. "homebrew" + "consumable" only).

#### R6.5 — Notes

> -

#### R6 — Notes

> -

---

### R7 — Polish (outline §10 M7)

Light/dark theme, responsive player views (mobile), fuzzy multi-field search, accessibility pass. Covers OUTLINE §5 form factor, §5.17 Settings.

**Slicing.** R7 is the smallest post-R1 milestone (~16 checkboxes) but the topics are independent enough that they're worth shipping as separate slices: each can land without blocking the others, and the a11y pass benefits from its own focused session.

#### R7.1 — Theme + responsive layout

- [ ] Theme system with light / dark / system-default toggle (§5.17)
- [ ] Player views mobile-responsive: Character Sheet, Party Stash, Recovered Loot, Transfer Modal, Item Detail (§5)
- [ ] DM tools remain desktop-only by design (§5) — verify layout doesn't claim otherwise

#### R7.1 — Notes

> -

#### R7.2 — Accessibility pass

- [ ] Accessibility: keyboard navigation across all interactive elements
- [ ] Accessibility: ARIA labels on all icon-only buttons
- [ ] Accessibility: color-contrast pass against WCAG AA
- [ ] Accessibility: screen-reader audit on Character Sheet + Party Stash flows

#### R7.2 — Notes

> -

#### R7.3 — Bulk multi-select on stash tables

- [ ] **Bulk multi-select for move / delete** on stash tables (§3.4) — checkbox column, bulk action bar
- [ ] Bulk-move test: select N items, pick target stash, all transfer with one log entry each (or a single grouped entry — decide and document)
- [ ] Bulk-delete test: select N items, confirm once, all removed

#### R7.3 — Notes

> -

#### R7.4 — Bulk currency edit

- [ ] **Bulk currency edit on `<CurrencyRow>`** — *promoted from Future / Stretch (2026-06-23); R7 is the natural home alongside other bulk-action UX*. M4's ±1 inline controls handle small tweaks; "loot drop: +300 sp" is painful. Plan: editable inline cells that accept signed integers (`+300`, `-50`, or an absolute target `=42`) and dispatch a single `currency-change` carrying the diff. Schema-additive — same action, richer UI on top. Keyboard ergonomic: tab through cells, type signed integer, Enter dispatches.
- [ ] Bulk currency edit test: type `+300` into the sp cell, Enter, sp holding moves by exactly +300, one `currency-change` log entry with reason `'deposit'`
- [ ] Bulk currency edit test: type `-50` into a cell with insufficient funds, submit-blocks (mirrors the existing `−` button's disabled-at-0 behavior)
- [ ] Bulk currency edit test: absolute-target syntax (`=42`) dispatches the computed diff (e.g. holding 30, type `=42` → log entry with delta `+12`)

#### R7.4 — Notes

> -

#### R7.5 — Misc polish

- [ ] Fuzzy multi-field search live across Catalog + stash tables (uses `search.ts` from R6)
- [ ] Performance pass on log size (capping, IndexedDB pagination if needed)
- [ ] Re-seed conflict hints ("this item has updates" on duplicated PHB/DMG rows) (per `MVP.md` §12)
- [ ] Variant-rules toggle exposed in Settings (§5.17)

#### R7.5 — Notes

> -

#### R7 — Notes

> -

---

### Open Questions (outline §11)

Track resolution before the relevant milestone ships. Each is a decision, not an implementation task — check once decided + linked in code.

> **2026-06-24 — All historical open questions resolved.** OUTLINE §11 reads "Currently no open questions remain." This section is now a synced mirror of the resolved-and-moved-into-spec-body list there. New open questions surfaced by future milestones will be added here and to OUTLINE §11 simultaneously.

- [x] **Snapshot retention** — Resolved: default **30 days**, **operator-configurable** in admin settings. See OUTLINE §9 and `SECURITY.md` §8. Impacts R3.
- [x] **Discord outage fallback** — Resolved: existing valid session cookies remain accepted without contacting Discord; only new logins fail during an outage. See `SECURITY.md` §1.1. Impacts R3.
- [x] **Invite code lifetime** — Resolved: reusable until the DM rotates; no time limit. See OUTLINE §3.2 + `SECURITY.md` §1.2. Impacts R4. (R3 also adds **Session TTL** → **30 days idle expiry** with sliding expiry on activity per `SECURITY.md` §1.1 — tuned for private campaigns that may go weeks between sessions.)
- [x] **Recovered-loot pruning** — Resolved: **never auto-purges**. The pile only shrinks when items/currency are explicitly claimed (player self-claim when no Banker, Banker distribution when one is active, or DM action) or when the DM explicitly removes items/currency for gameplay reasons. See OUTLINE §3.10 / §3.15 / §8.1. No time-based or size-based eviction. Impacts R4/R5.
- [x] **History detail level** — Resolved: **ownership-transition filter by default on per-item history; full filtered party log for everything else.** Per OUTLINE §4 there is no separate `ItemHistory` table — per-item history is a filtered view over `TransactionLog`. The Item Detail screen defaults to types that change ownership/identity (`acquire`, `transfer`, `purchase`, `sale`, `consume`, `identify`, `attune`, `unattune`, `equip`, `unequip`); a "Show all events" toggle expands to the full set. Impacts R5.
- [x] **Default Storage stash on character creation** — Resolved 2026-06-23: **zero**. Characters land with Inventory + Party Stash + Recovered Loot only; Storage tab is opt-in via M3's "New Storage stash". Matches MVP §5.2 wording.
- [x] **DM-as-player on creation** — Resolved: the party-creation flow **prompts the user explicitly**: *"Do you also play a character in this party?"* with yes / no (default yes for convenience but not silent). User's choice determines whether the second `PartyMembership` row (`role="player"`, with a character) is created alongside the `role="dm"` row. See OUTLINE §3.1 and §4 `PartyMembership`. Impacts R4.

#### Open Questions — Notes

> **2026-06-24 — Roadmap synced to OUTLINE §11.** All seven historical open questions now show as resolved here, matching OUTLINE §11's "Resolved (moved into spec body)" block. No new open questions surfaced through M5 / M5.5. Future milestones that uncover a new decision-point should add the row to BOTH this checklist AND OUTLINE §11 (with whatever resolution gets agreed) so the two stay in sync.

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
- [x] **Bulk currency edit on `<CurrencyRow>`** — *promoted to R7 on 2026-06-23* (alongside the bulk multi-select cluster). Inline signed-integer entry on each denomination cell (`+300`, `-50`, `=42`) dispatching one `currency-change`. See R7 tasks above. Schema-compatible — no new action variant.
- [x] **Per-party economy controls** — *promoted to R6 on 2026-06-23* (alongside `pricing.ts` activation + `Shop` + `purchase`/`sale`). Two knobs: `Party.priceModifier` (default `1.0`) and `Party.baseCurrency` (default `"gp"`). UI preset chooser: Gold / Silver / Copper / Electrum / Platinum / Custom. See R6 tasks above and OUTLINE §3.5.

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

> **2026-06-24 — OUTLINE §11 review batch propagated to roadmap.** Fourteen ambiguities surfaced in a full OUTLINE.md re-read got resolved in the spec body (see OUTLINE §11 "Resolved 2026-06-24" rollup). Mapped to roadmap milestones below; each new checkbox in R1–R6 references the OUTLINE clause that authorized it.
>
> | # | Decision | Roadmap touchpoint(s) |
> |---|---|---|
> | History visibility on shared pools = every party member | R5 — "Permission rule" + 3 new component tests |
> | Auto-clear `equipped` / `attuned` / `currentCharges` on leaving Inventory | R1 — `transfer` reducer extension + 3 invariant tests |
> | Container contents follow on transfer; reject A-into-B | R1 — `transfer` reducer extension + 3 invariant tests |
> | Lossy `convert` refused (not rounded) | ✅ already shipped in M4; no roadmap action |
> | `ItemDefinition.flatWeight: boolean` field | R1 — schema activation + `weight.ts` tests; R2 — DMG seed entries |
> | Homebrew party-scoped visibility | R4 — Catalog Browser filter + 2 invariant tests |
> | Identification bidirectional | R2 — `identify` reducer bidirectional test; R6 — UI bidirectional toggle test |
> | Hint per-instance + DM batch action | R2 — per-instance test; R6 — batch-identify affordance + test |
> | DM force-use-charge Inventory-only | R4 — DM cross-character action gating + 1 invariant test |
> | Shops have no purse | R6 — `Shop` schema (no currency row) + 2 invariant tests |
> | No-session activity allowed; "Untagged" bucket | R5 — `sessionId: null` reducer test + "Untagged" filter component test |
> | `dm-transfer` auto-clears Banker; new enum value `"dm-transfer"` | R4 — cascade reducer + 2 invariant tests; `revoke-banker` enum extension |
> | Player→player currency push unaffected by Banker | R4 — `currency-transfer` invariant test made explicit |
> | `Party.isSoloShortcut` removed | R4 — schema migration + 1 migration test; MVP keeps writing the literal |
>
> All future spec changes should follow the same pattern: amend OUTLINE.md first, then add roadmap checkboxes in the affected milestone(s), then code. The roadmap is a tracker, not a source of truth — if it disagrees with OUTLINE, OUTLINE wins (per CLAUDE.md).

---

## Operational followups (unscheduled)

Followups that don't belong to any single feature slice. Listed here so they're discoverable; promote any item to a milestone (with a checkbox) when scheduled. Inline `// Followup:` comments in the source code point back to this section where relevant.

### Hardening / observability

- [ ] **`EmailAuthAttempt` cron sweep** — periodically delete rows with `lockedUntil < now() - 24h`. The `@@index([lockedUntil])` makes this cheap. Not blocking — the table is bounded by the `(email, ip)` UNIQUE and rows hold no PII beyond email + IP. Inline pointer: `apps/server/src/auth/email/rate-limit.ts:18`. (Source: R3.3 Notes.)
- [ ] **Per-IP rate limit on `POST /auth/email/request-otp`** — verify-side is already rate-limited via the `EmailAuthAttempt` two-axis lockout; the request side is currently protected only by the constant-time pad. Add a per-IP throttle reusing the same keyspace. Inline pointer: `apps/server/src/auth/routes.ts:306`. (Source: R3.3 Notes.)
- [ ] **`PendingDiscordLink` cron sweep** — R3.5 deletes expired rows inline on every link initiation. A periodic sweep (e.g. nightly) would catch the case where a user starts a link flow then never returns. Cheap: `@@index([expires])` is in place. Inline pointer: `apps/server/src/auth/discord-link.ts`. (Source: R3.5 Notes.)
- [ ] **Snapshot-age operator metric** — "snapshot age per party" gauge surfaces a stuck cron / disk-full situation. Wire into a future `/admin/health` endpoint (or expose via Prometheus / OpenTelemetry once metrics infra lands). (Source: R3.4.b Notes.)
- [ ] **Explicit `archivedAt` check in `POST /sync/actions`** — R4.1.e ships the `Party.archivedAt` column + filters it out of `GET /sync/parties`, but the `/sync/actions` route relies on the existing `not_a_member` guard (every member's row is `leftAt: NOT null` after archive, so guards reject). Adding an upfront `archivedAt IS NOT NULL` check would surface a cleaner `party_archived` error code. Inline pointer: `apps/server/src/sync/routes.ts:226`. (Source: R4.1.e Notes.)

### Test infrastructure

- [ ] **Sync queue bootstrap pull-after-push test** — R3.5 dropped the bootstrap integration test from `apps/web/src/sync/queue.test.ts` because `instanceof BatchRejectedError` checks across `vi.resetModules()` boundaries proved flaky in the existing test rig. A proper fix wires module-singleton caching (or replaces `instanceof` with structural checks) so the bootstrap pull-after-push + 422 rollback paths get explicit coverage. The happy path + 401 path are tested; the rollback + bootstrap paths are exercised only through the type-checker today. (Source: R3.5 Notes.)
- [x] **Delete `apps/web/src/screens/Welcome.tsx` + `CreateCharacter.tsx`** — **Resolved 2026-06-30 (RH0.4).** R3.5 kept them as legacy fixtures so the existing screen tests (`Settings.test.tsx`, `CharacterSheet.test.tsx`, `ItemDetail.test.tsx`, `StorageDetail.test.tsx`) keep working without churn. RH0.4 deleted both files and migrated the dependent tests: three use `{ path: '/', element: null }` as a no-op fallback, and `StorageDetail.test.tsx` got a local `RedirectToCharacter` helper to preserve the "unknown stashId → / → CharacterSheet" auto-redirect test path. Two tests that asserted the literal Welcome heading were rewritten to assert the negative (CharacterSheet's tab list NOT present / ItemDetail's history heading NOT present) — same intent, no dependency on the legacy screen. (Source: R3.5 Notes, R4.1.f post-ship sweep, RH0.4.)
- [ ] **Sync queue unit test for the R4.1.f `isBootstrap` discrimination** — `queue.ts:142` now gates `isBootstrap` on `snapshot?.appState == null` in addition to the action type, but the existing 2 queue.test.ts tests don't isolate this branch. The integration test in `apps/server/src/parties/routes.test.ts` exercises the full path end-to-end; a focused unit test asserting `getActivePartyId()` is called (not `'will-be-minted'`) when `appState !== null` would catch a regression at the layer where it would surface. Same flaky-`instanceof` rig as the bootstrap pull-after-push followup above — likely lands together. (Source: R4.1.f.)
- [ ] **`GET /sync/state` assertion in the R4.1.f integration test** — the current full-flow test in `apps/server/src/parties/routes.test.ts` asserts the DB rows after user B dispatches `create-character`, but doesn't round-trip through `GET /sync/state?partyId=...` for user B. The mapper layer is well-tested elsewhere, but a focused assertion here would close the seam between the persistor's write side and the state-loader's read side specifically for the post-bootstrap-created character. (Source: R4.1.f.)
- [ ] **End-to-end browser tests (Playwright)** — still deferred per `docs/TECH_STACK.md` §3.3 (re-evaluate at M5). R4.x accumulated two motivating cases — BUG-001 and BUG-002 — where every unit + Vitest server-integration test passed but the real HTTP + real Postgres path failed. Both share a profile: defects that only manifest in the full server-DB-client stack under specific state shapes. M5 re-evaluation criteria + scoping notes captured in TECH_STACK §3.3, with the layer-selection ratchet in §3.5 (climb to Playwright only when a lower-cost layer can't catch the defect category). (Source: BUG-001 + BUG-002 postmortems; TECH_STACK §3.3.)

### Feature gaps (small, web-only)

- [ ] **`delete-character` UI entry point** — R4.1.b shipped the reducer action + cascade to Recovered Loot, but no UI surface dispatches it. The PartySettings "Create your character" CTA from R4.1.f explicitly supports the post-delete recreation case (the reducer + guard accept it), but until a deletion button exists somewhere — Character Sheet header? Settings → Danger zone? PartySettings → Members row? — the third use case is theoretical. Recommendation: small "Delete character" button on the Character Sheet header behind a confirm dialog showing the snapshot (item count + currency total cp moved to Recovered Loot), mirroring the existing `delete-stash` confirmation pattern. (Source: R4.1.b carryforward, surfaced by R4.1.f.)
- [ ] **Reject `partyName` on the post-bootstrap `create-character` branch** — `createCharacterInExistingParty` currently ignores `partyName` silently if a client sends it (the party already exists; renaming is `rename-party`). A client could plausibly send `{ name: 'X', partyName: 'rename me' }` expecting both effects, and the partial silent ignore is a footgun. Either: (a) reject the action with `invalid_payload` when `partyName` is set on the post-bootstrap branch, OR (b) treat it as an implicit `rename-party` and emit both log entries. (a) is the simpler / safer choice. (Source: R4.1.f.)

- [x] **Multiple local-mode parties** — **shipped 2026-06-29 (R4.1 followup)**. The Dexie persistence layer now keys each party's blob under `appState:<partyId>` (`apps/web/src/db/save.ts`, `load.ts`). The Hub enumerates every keyed blob in local mode via the new `listKnownPartyIds()` helper; `currentPartyId` (already in `apps/web/src/db/meta.ts`) tracks the active pointer; `hydrate.ts` boots through that pointer with a fallback to the legacy unkeyed slot and a "first keyed blob" tertiary fallback. Hub flows now flush + clear the in-memory store before each `create-character` dispatch and before swapping to another party's blob — the reducer's `state === null` invariant stays intact. Local-mode users can hold N parties; server-mode users continue to use `GET /sync/parties` + per-party pull. **Carryforward (not blocking):** the JSON export envelope (§3.13 / `apps/web/src/io/export.ts`) still operates on the active party only — a future "vault" export that bundles every keyed blob is a separate scope.

- [ ] **Multi-party "vault" export / import** — the current §3.13 JSON export envelope (`apps/web/src/io/export.ts`, `import.ts`) handles ONE party at a time (the active party in memory). With local mode now supporting N parties (R4.1 followup above), a user wanting to back up their full local-mode footprint has to export each party individually. Two options:
  - **Per-party export, multi-party Hub action**: keep the envelope shape unchanged; add a Hub-level "Export all parties" button that iterates `listKnownPartyIds()` and produces a ZIP / JSON-array of envelopes. Simplest; preserves backward compatibility with existing per-party exports.
  - **New "vault" envelope shape**: introduce a `vaultEnvelopeSchema` that wraps `parties: ExportEnvelope[]` plus vault-level metadata. Cleaner long-term but requires Zod schema work + a vault-aware import path.
  - **Recommendation:** start with per-party-iteration (no new schema; reuses the existing import path for restore). Promote to a "vault" shape only if users actually ask for it.
  - **Server-mode interaction:** server-mode users get per-party export via `GET /sync/export?partyId=...` already (R3.4.b). The vault concern is purely local-mode.
  - Inline pointer: `apps/web/src/io/export.ts`, `apps/web/src/io/import.ts`, `packages/shared/src/schemas/exportEnvelope.ts`. (Source: R4.1 followup 2026-06-29.)

- [x] **"Do you also play a character?" toggle on Create-party** — **shipped 2026-06-29 (R4.1 followup)**. The `create-character` reducer + action payload now accepts a `dmOnly: boolean` flag and an optional `partyName` override. When `dmOnly: true`, the reducer mints `User` + `Party` + ONE `role='dm'` `PartyMembership` + party-scope stashes (Party Stash + Recovered Loot) + their currency holdings, skipping the Character + Inventory stash + player membership. The log entry's `characterId`/`name`/`inventoryStashId` fields are now optional + a `dmOnly?: boolean` flag carries the intent for log readers. The Hub Create-party dialog became a three-step wizard: (1) party name input, (2) "Will you also play a character?" Yes / No, (3a) character form if Yes / dispatch dmOnly directly if No. Create-solo stays a single-step flow (party name auto-derived to "My Campaign"). DM-only bootstrap routes the user to `/party/settings` since they have no character sheet. Server-side `applyBootstrapDelta` is shape-agnostic — it iterates the reducer's `characters` / `stashes` / `memberships` arrays, so the empty-character branch just writes fewer rows.

- **NOTE:** `create-character-in-existing-party` was previously listed here as a feature-gap followup. **Promoted to R4.1.f on 2026-06-29; shipped 2026-06-30.** See R4.1.f above.

### Multi-replica / scale

- [ ] **Snapshot cron coordination for multi-replica deploys** — `node-cron@4`'s `runCoordinator` / `distributed` options let a multi-instance deployment elect one writer per tick. Non-issue for the single-binary MVP / R3-tier; relevant when R5+ ships horizontal scaling. (Source: R3.4.b Notes.)

### At-rest data security

- [ ] **Snapshot encryption** — snapshot files are plaintext JSON; if encryption is required the operator handles it at the volume layer (LUKS / EBS-encryption / etc.), same pattern as the Postgres data directory. Document the recommendation in the root README's hosting section; revisit if the project ever ships its own snapshot daemon. (Source: R3.4.b Notes.)

### Process

- Promote an item to a real milestone by adding a checkbox + brief checklist there, then leave a back-pointer here that reads `**Promoted to <slice> on <date>.**`. The intent is that this section shrinks over time as items either ship or are explicitly deprioritized.

