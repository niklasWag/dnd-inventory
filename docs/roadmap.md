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

**Slicing.** R1 splits along four independently-shippable feature axes. R1.1 (shipped) lit up encumbrance display — capacity rule (`off | phb | variant`), enforce flag, size multiplier, capacity bar. R1.2 ships equip / attune plumbing — reducer actions, slot rules, validation. R1.3 ships container modelling + the §3.4 transfer cascade — `containerInstanceId`, `flatWeight`, auto-clear of equip/attune/charges leaving Inventory. R1.4 closes the loop by activating Hard-mode enforcement (reducer rejection in `acquire` / `transfer` when over-threshold). Each slice is ~R1.1-sized.

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
- [ ] `ItemInstance.equipped` allowed to be `true`
- [ ] `ItemInstance.attuned` allowed to be `true`
- [ ] `Character.maxAttunement` becomes DM-editable (was display-only in MVP)

**Reducer actions (§4 TransactionLog union)**
- [ ] `equip` action + payload schema (`{ itemInstanceId, characterId, slot? }`)
- [ ] `unequip` action + payload schema
- [ ] Invariant test: equip only from `scope=character, isCarried=true` stash
- [ ] `attune` action + payload schema (`{ itemInstanceId, characterId }`)
- [ ] `unattune` action + payload schema
- [ ] Attunement slot-cap invariant test (uses `Character.maxAttunement`)
- [ ] `edit-character` catch-all action + payload schema (`changedFields: string[]` per the `edit-homebrew` precedent) — destination for `maxAttunement`, `str`, `level`, and other DM-editable character fields. The R1.1 dedicated `set-encumbrance` action stays as-is (single-field actions remain single-purpose); `edit-character` only wraps the fields that compose naturally as a catch-all. DM-only when 2+ members; per §8.1.

**Rules — activate stubs (§6)**
- [ ] `packages/rules/attunement.ts` implemented (slot tracking, prereq display string)
- [ ] `attunement.ts` tests
- [ ] `packages/rules/validation.ts` implemented (equip slot conflicts: 2H + shield, etc.)
- [ ] `validation.ts` tests

**UI (§5)**
- [ ] Equipped-slots panel on Inventory tab
- [ ] Attunement counter (X/max) on Inventory tab
- [ ] Equip toggle on Inventory rows
- [ ] Attune toggle on Inventory rows

#### R1.2 — Notes

> -

#### R1.3 — Containers + transfer cascade + flatWeight

**Schema activations (§4)**
- [ ] `ItemInstance.containerInstanceId` becomes settable (single-level only)
- [ ] `ItemDefinition.flatWeight: boolean` schema field (default `false`) — Bag-of-Holding-style discriminator per OUTLINE §3.6 + §4. PHB seed values stay `false`; DMG seed (R2.1) ships `flatWeight: true` on BoH-class entries.
- [ ] Migration test: MVP and R1.1-vintage exports import cleanly with all placeholders preserved (including `flatWeight: false` defaulted on pre-R1.3 definitions).

**Reducer actions (§4 TransactionLog union)**
- [ ] **Extend `transfer` reducer**: when source row is Inventory (`scope=character, isCarried=true`) and destination is anything else, atomically set `equipped: false`, `attuned: false`, `currentCharges: null` on the moved row per OUTLINE §3.4. Emit one `edit-item-instance` log entry alongside the `transfer` capturing `changedFields: ["equipped" | "attuned" | "currentCharges"]` (only the fields that actually changed). M5 transfer cases stay green — the auto-clear is a no-op when the source row was already at the MVP-placeholder values.
- [ ] Invariant test: equipped item transferred Inventory → Party Stash → `equipped: false` after; one `transfer` + one `edit-item-instance` entry; the entries share `actorUserId` / timestamp / partyId per the M3 cascade contract.
- [ ] Invariant test: attuned item transferred Inventory → Storage → `attuned: false` + attunement slot freed on the source character.
- [ ] Invariant test: charged item (currentCharges = 3) transferred Inventory → Storage → `currentCharges: null` after.
- [ ] **Extend `transfer` reducer**: container contents follow the container atomically per OUTLINE §3.4. When the moved row's `id` appears as a `containerInstanceId` on other instances in the source stash, those child rows' `ownerId` updates to the destination stash too. Children's `containerInstanceId` is preserved (still points at the same parent).
- [ ] Invariant test: backpack with 3 rations moved Inventory → Storage → all 4 rows now in Storage; children still point at the backpack's id.
- [ ] Invariant test: `transfer` rejects moving a container row INTO another container (would create two-level nesting; OUTLINE §3.6 one-level-deep rule).
- [ ] Invariant test: full move auto-stack collapse on a container destroys the parent id — children's `containerInstanceId` re-targets the surviving destination row's id (or, simpler: container auto-stack is rejected because two containers with the same `(definitionId, notes)` rarely make sense; pick one approach and document).

**Rules — widen R1.1 stub (§6)**
- [ ] `packages/rules/weight.ts` widened to descend into containers respecting `ItemDefinition.flatWeight` per OUTLINE §3.6: when `true`, stop descending into contents (Bag-of-Holding exception). Signature widens from flat-row aggregator to `(rows, definitionsById)`. R1.1's flat-row tests stay green as the no-container case.
- [ ] `weight.ts` tests cover normal containers (sum-of-contents) AND flat-weight containers (contents ignored once parent is `flatWeight: true`); homebrew opt-in via the same field works in tests.

**UI (§5)**
- [ ] One-level container view inside Inventory

#### R1.3 — Notes

> -

#### R1.4 — Hard-mode enforcement

**Reducer rejection (§4 TransactionLog union)**
- [ ] **Extend `acquire` reducer**: when destination stash is Inventory (`scope=character, isCarried=true`) and the owning character has `enforceEncumbrance: true` and `encumbranceRule !== 'off'`, reject if post-write weight would exceed `heavyThreshold(str, size, rule)`. R1.1's helper already exposes the ceiling — this slice just consumes it.
- [ ] **Extend `transfer` reducer** with the same guard on the destination side. Composes with R1.3's §3.4 cascade: cascade adjusts the moved row first, threshold check runs on the post-cascade weight (a leaving-Inventory transfer never trips the guard because it lowers source weight; an entering-Inventory transfer is the case that matters).
- [ ] Invariant test: enforced + variant + acquire that would exceed 10×STR rejects; log entry NOT appended; state unchanged.
- [ ] Invariant test: enforced + phb + transfer-into-Inventory that would exceed STR × 15 × sizeMultiplier rejects.
- [ ] Invariant test: enforced + rule = `off` allows (off short-circuits before the guard).
- [ ] Invariant test: unenforced + over-threshold allows (display-only path stays intact).
- [ ] Invariant test: enforced + Small character + size multiplier respected (rejection threshold scales).

**UI (§5)**
- [ ] Remove the "(R1.2)" hint from `EncumbranceRuleField` helper text now that enforcement is live (and re-target or remove the Settings test that asserts the hint).
- [ ] Toast / inline error when a reducer rejects an acquire/transfer due to hard-mode (consistent with existing reducer-rejection UX; no new pattern).

#### R1.4 — Notes

> -

#### R1 — Notes

> -

---

### R2 — Magic items (outline §10 M2)

DMG 2024 seed; attunement w/ warnings + DM cap override; charges with batch recharge. Covers OUTLINE §3.7 (DMG catalog), §3.8 (full magic-item & charge tracking), §4 `ItemDefinition` extensions, §6 `charges.ts`.

**Slicing.** R2 splits along the three independently-shippable feature axes: seed-and-display (R2.1) lights up the DMG catalog and attunement plumbing; charges (R2.2) activates `charges.ts` + the four charge-related reducer actions; identification (R2.3) ships the bidirectional `identify` action + DM panel. Each slice is ~R1.1-sized.

#### R2.1 — DMG seed + rarity / attunement display

**Seed (§7)**
- [ ] `seed/dmg-2024.json` placed (private; same private-use disclaimer as PHB)
- [ ] DMG seed Zod schema
- [ ] DMG seed loader + tests
- [ ] `seedVersion` bumped; re-seed test: PHB+DMG upsert, homebrew untouched
- [ ] DMG seed entries for Bag of Holding, Handy Haversack, Portable Hole, and any other "extradimensional storage" item ship with `flatWeight: true` per OUTLINE §3.6 (the rules-engine discriminator added in R1). Seed test: at least one BoH-class entry parses with `flatWeight: true`; non-container DMG entries default to `false`.

**Schema activations (§4)**
- [ ] `ItemDefinition.rarity` becomes settable (`common`…`artifact`)
- [ ] `ItemDefinition.requiresAttunement` becomes settable
- [ ] `ItemDefinition.attunementPrereq` becomes settable (display string)

**UI (§5)**
- [ ] Rarity color coding in catalog + item rows
- [ ] Attunement prerequisite displayed as advisory text on item detail

#### R2.1 — Notes

> -

#### R2.2 — Charges + recharge

**Schema activations (§4)**
- [ ] `ItemDefinition.charges` becomes settable (`{ max, rechargeRule }`)
- [ ] `ItemInstance.currentCharges` allowed to be a number

**Rules — activate stub (§6)**
- [ ] `packages/rules/charges.ts` implemented (dawn / dusk / long-rest / short-rest / custom)
- [ ] `charges.ts` tests cover each recharge trigger
- [ ] `charges.ts` never-negative + never-over-max invariants

**Reducer actions (§4 TransactionLog union)**
- [ ] `use-charge` action + payload schema
- [ ] `recharge` action + payload schema (per-trigger)
- [ ] `recharge` batch action (long-rest / dawn / dusk applies to all eligible items)

**UI (§5)**
- [ ] Charge counter + manual recharge button on Item Detail
- [ ] "Long rest" / "Dawn" / "Dusk" batch buttons on Character Sheet

#### R2.2 — Notes

> -

#### R2.3 — Identification

**Schema activations (§4)**
- [ ] `ItemInstance.identified` allowed to be `false`

**Reducer actions (§4 TransactionLog union)**
- [ ] `identify` action + payload schema (`{ itemInstanceId, previousHint?, newHint? }`)
- [ ] DM-only invariant test for `identify` in 2+-member parties (§8.1)
- [ ] **`identify` is bidirectional** per OUTLINE §3.8: the DM can flip `identified` from `true → false` (e.g., "actually that was cursed") as well as `false → true`. Reducer test for both directions; both produce their own `identify` log entry with `previousHint` / `newHint` capturing before/after.
- [ ] **`identify` hint is per-instance** per OUTLINE §3.8: two `ItemInstance`s with the same `definitionId` can each carry a different hint. Reducer test: two unidentified longswords get distinct hints "radiates evil" vs "smells like lavender"; toggling `identified` on one doesn't affect the other.

**UI (§5)**
- [ ] Unidentified items render as "Unknown Magic Item" + DM-set hint (display invariant per §8)
- [ ] DM identification panel (§5.13): toggle identified, edit hint text

#### R2.3 — Notes

> -

#### R2 — Notes

> -

---

### R3 — Backend skeleton (outline §10 M3)

Self-hosted server, Discord OAuth, user model, sync of solo data, nightly snapshots. Covers OUTLINE §3.1 (Discord login), §3.13 (server backups), §9 (architecture: server-authoritative, websocket-ready), §4 `User` (discordId/avatarUrl) and `Metadata`.

**Slicing.** R3 splits into infrastructure slices that each shrink the risk surface: R3.1 stands up Fastify + Postgres + Prisma + seed runner with NO auth (verifiable via curl + Prisma Studio); R3.2 layers Discord OAuth + sessions on top; R3.3 wires authoritative sync (server re-runs the reducer); R3.4 connects the web client. Each slice is independently deployable behind a flag, and any one of them is already R1.1-sized.

#### R3.1 — Server scaffold + Postgres + Prisma + seed runner

- [ ] `apps/server` Fastify + TypeScript scaffolded
- [ ] Postgres + Prisma set up
- [ ] Prisma schema mirrors `packages/shared/schemas` Zod definitions
- [ ] Initial migration generated and applied
- [ ] `Metadata` table tracking canonical `seedVersion` (§4)
- [ ] PHB + DMG seed runner on server boot (upsert)
- [ ] `infra/docker/` compose: web + server + postgres for local dev

#### R3.1 — Notes

> -

#### R3.2 — Discord OAuth + sessions + User model

- [ ] Auth.js + Discord provider wired (authorization code + PKCE, scope `identify`)
- [ ] Session cookie issuance after token exchange
- [ ] `User.id` linked via `discordId`; `avatarUrl` populated

#### R3.2 — Notes

> -

#### R3.3 — Authoritative sync

- [ ] Per-user AppState sync endpoint (push reducer actions)
- [ ] Per-user AppState pull/snapshot endpoint
- [ ] Authoritative validation: server re-runs reducer against incoming actions
- [ ] Nightly snapshot job to disk (default 30-day retention; configurable per §11)
- [ ] User-triggered JSON export still works client-side (parity with §3.13)

#### R3.3 — Notes

> -

#### R3.4 — Web integration

- [ ] Login screen: "Sign in with Discord" button (§5.1)
- [ ] Hub screen (§5.2): Create party / Join party / Create solo cards + existing parties list
- [ ] Web sync client pushes reducer actions to server
- [ ] Web reconciles server events back into the store
- [ ] Offline-first: Dexie remains primary cache; solo party works offline (§9)
- [ ] Offline banner reserved for multi-member mode (R4 will gate behavior)
- [ ] Settings: Account section shows Discord displayName + avatar (§5.17)
- [ ] Settings: Logout button clears session cookie and returns to Login screen

#### R3.4 — Notes

> -

#### R3 — Notes

> -

---

### R4 — Multi-member parties (outline §10 M4)

Invite codes, multi-user joining, Party Stash, Recovered Loot, Banker appointment + distribution toolkit, DM/Player role split when 2+ members. Covers OUTLINE §3.1 (permissive-until-others-join), §3.2, §3.5 ("split evenly"), §3.10 (loot distribution), §3.14 (Banker), §8.1 (full permission matrix), §8.3 (leaving/kicking).

**Slicing.** R4 is the largest milestone (~50 checkboxes). Splits along the feature axes that compose: R4.1 lights up multi-membership (invites, join, leave, kick) — once shipped, a party can have 2+ members; R4.2 adds the Banker role on top; R4.3 adds DM cross-character authority; R4.4 widens currency-transfer + homebrew visibility for the 2+-member world; R4.5 ships the DM Dashboard. Each slice is independently testable; R4.1 is the hard dependency for all later slices.

#### R4.1 — Invites + join/leave/kick + multi-membership schema

**Schema activations (§4)**
- [ ] `Party.inviteCode` becomes user-visible / rotatable
- [ ] `PartyMembership` supports count > 2
- [ ] **`Party.isSoloShortcut` deprecated / removed** per OUTLINE §4 amendment (2026-06-24). The "solo" hub badge is derived from `memberCount === 1`. R4 migration: stop writing the field on newly-created parties (drop it from `create-character` reducer); MVP-vintage parties keep the `true` value but readers ignore it. Schema either drops the field entirely or marks it `.optional()` to accept legacy blobs.
- [ ] Migration test: an M0 / M1 / M2 / M3 / M4 / M5 / M5.5 AppState (with `isSoloShortcut: true`) imports cleanly under R4 schema; the hub renders the "solo" badge based purely on `memberCount`.
- [ ] Composite-key invariant test: `(userId, partyId, role)` allows DM+player for creator

**Reducer actions (§4 TransactionLog union)**
- [ ] `join-party` action + payload schema
- [ ] `leave-party` action: moves owned items + currency to Recovered Loot (§8.3)
- [ ] `kick-player` action: same Recovered Loot transfer (§8.3)
- [ ] `delete-character` action + payload schema (`{ characterId, name, lastSessionId? }` per §4)
- [ ] `delete-character` reducer case: moves owned items + currency to Recovered Loot, clears `PartyMembership.characterId`
- [ ] `delete-character` invariant test: owning user keeps their membership (can recreate a character)
- [ ] `delete-character` log payload snapshots itemCount + currencyTotalCp (mirrors `delete-stash` pattern in §4)

**Server-side**
- [ ] Invite-code generation endpoint (DM-only, rotatable)
- [ ] Invite-code redemption endpoint
- [ ] Websocket join/leave channel per party (foundation for R5)
- [ ] Departure flow: archive empty parties (no destructive delete) per §8.3

**UI**
- [ ] Hub: Join party (paste code) flow wired
- [ ] Party Settings screen (§5.15): invite code regenerate / revoke, kick player
- [ ] Member list with role badges (DM / Player)

#### R4.1 — Notes

> -

#### R4.2 — Banker role

**Schema activations (§4)**
- [ ] `Party.bankerUserId` becomes settable (was always `null` in MVP)

**Reducer actions (§4 TransactionLog union)**
- [ ] `appoint-banker` action + payload schema
- [ ] `revoke-banker` action + payload schema
- [ ] `leave-party` auto-clears `Party.bankerUserId` if departing player was Banker
- [ ] `leave-party` writes `revoke-banker` entry with `reason: "left-party"` when applicable
- [ ] `kick-player` Banker auto-clear with `reason: "kicked"`
- [ ] Invariant test: DM cannot self-appoint as Banker (§3.14)
- [ ] Invariant test: Banker target must have active `role="player"` membership
- [ ] Invariant test: Banker role only legal when `memberCount >= 2`
- [ ] `currency-change` extended `reason` values (`split-evenly`, `gameplay-drain`)
- [ ] Action: split Party Stash currency evenly across characters
- [ ] Action: Banker gives currency / items to a specific player from Party Stash
- [ ] Action: Banker gives currency / items from Recovered Loot to a specific player
- [ ] Action: Banker takes from Party Stash / Recovered Loot into own purse
- [ ] `actorRole` on log derived correctly: `"banker"` if `Party.bankerUserId === actorUserId`, else membership role (§4)

**Server-side**
- [ ] Server authoritative checks for every Banker action above

**UI**
- [ ] Party Settings screen (§5.15): appoint / revoke Banker
- [ ] Member list with role badges (DM / Player / Banker)
- [ ] Party Stash (§5.5): Banker distribution controls (split-evenly, give-to-player, give-items-to-player)
- [ ] Party Stash for DM-when-Banker-active: distribute-to-player controls hidden; add/remove-for-gameplay visible
- [ ] Recovered Loot (§5.6): same Banker/DM split as Party Stash
- [ ] Component test: Banker toggle changes both Party Stash and Recovered Loot control sets

#### R4.2 — Notes

> -

#### R4.3 — DM cross-character actions + DM transfer

**Reducer actions (§4 TransactionLog union)**
- [ ] `dm-transfer` action + payload schema
- [ ] **`revoke-banker.reason` enum extended with `"dm-transfer"`** per OUTLINE §4 amendment (2026-06-24). Round-trip test that pre-amendment logs (reason ∈ `"manual" | "left-party" | "kicked" | "reassigned"`) still validate.
- [ ] **`dm-transfer` auto-clears `Party.bankerUserId`** when the incoming DM is the current Banker per OUTLINE §3.14. Atomic cascade: one `dm-transfer` entry + one `revoke-banker` entry with `reason: "dm-transfer"`. New DM must reappoint a Banker afterward.
- [ ] Invariant test: `dm-transfer` to current Banker → Banker auto-cleared, both log entries emitted, new DM is NOT also Banker (preserves §4 `bankerUserId != ownerUserId`).
- [ ] Invariant test: `dm-transfer` to a non-Banker player → no `revoke-banker` entry emitted; Banker (if any) stays in role.

**DM cross-character actions (§8.1 "Edit other players' inventory via explicit action")**
- [ ] DM-issued `acquire` / `consume` against another player's character (logged with `actorRole: "dm"`)
- [ ] DM-issued `transfer` between any two stashes in the party
- [ ] DM-issued `equip` / `unequip` on another player's character
- [ ] DM-issued `attune` / `unattune` (bypasses cap with explicit confirm; cap-override still logs)
- [ ] DM-issued `recharge` on another player's item (force-recharge — any item, any location, per §3.8)
- [ ] **DM-issued `use-charge` (force-use-charge) is restricted to items currently in someone's Inventory** per OUTLINE §3.8 amendment (2026-06-24). Items in Storage / Party Stash / Recovered Loot / Shop have `currentCharges: null` per §4 — there's nothing to decrement. If the DM needs to force a charge consumption on a stashed item, they `transfer` it into a character's Inventory first.
- [ ] Invariant test: DM force-use-charge on an item in Party Stash → rejected with a clear "not in Inventory" message. The same item moved to a character's Inventory + force-used → succeeds; one `use-charge` entry recorded.
- [ ] DM-issued character-field edits (name, species, class, level, STR) via explicit action — separate from owner self-edits
- [ ] Invariant test: every DM cross-character action writes a log entry that the affected owner can see in the party log
- [ ] Invariant test: no silent edits — UI never mutates another player's data without dispatching a logged action (§8 "DM principle")

**Server-side**
- [ ] Server authoritative checks for every DM cross-character action above

**UI**
- [ ] Party Settings screen (§5.15): transfer DM

#### R4.3 — Notes

> -

#### R4.4 — Cross-character currency + homebrew party scope + gating

**Reducer actions (§4 TransactionLog union)**
- [ ] `currency-transfer` action extended for cross-character use (M5.5 added own-stash self-transfer; R4 adds): (a) player pushes currency directly to another player's Inventory stash (direct/immediate — no acceptance step); (b) Banker transfers currency from Party Stash or Recovered Loot to a specific player's stash
- [ ] `currency-transfer` invariant test: **player→player push is ALWAYS allowed regardless of Banker state** per OUTLINE §3.14 amendment (2026-06-24). The Banker mediates the shared pools, not character-to-character moves. Test: with a Banker active, player A can push 5 gp to player B's Inventory and the entry surfaces in the party log (Banker has visibility but no veto).
- [ ] `currency-transfer` invariant test: Banker-from-pool allowed always; DM blocked from distributing to specific players from Party Stash / Recovered Loot while Banker active (§8.1)
- [ ] `currency-transfer` invariant test: when no Banker, players self-claim freely (including pushing to own character's Inventory)
- [ ] Invariant test: when Banker active, DM cannot distribute to specific players (§8.1)
- [ ] Invariant test: when Banker active, players cannot self-claim from Party Stash / Recovered Loot (§3.14)
- [ ] Invariant test: when no Banker, players self-claim freely from both pools (§3.14)
- [ ] DM-only custom-item creation enforced once `memberCount >= 2` (§3.7, §8.1)
- [ ] **Homebrew visibility is party-scoped** per OUTLINE §3.7 + §4 `ItemDefinition.partyId`. Catalog Browser filters definitions where `partyId === null` (PHB/DMG) OR `partyId === activePartyId` (this party's homebrew). Definitions belonging to other parties the same user is in are NOT visible from the active party's catalog.
- [ ] Invariant test: user is a member of parties A + B; creates homebrew "Vorpal Spork" in party A; switches to party B's view → Catalog Browser doesn't list it. Switches back to party A → it's there again.
- [ ] Invariant test: user creates homebrew in party A; another user joins party A later → the new member sees the homebrew (party-scoped, not user-scoped).

**UI**
- [ ] Offline banner activates for multi-member parties (§9)

#### R4.4 — Notes

> -

#### R4.5 — DM Dashboard (§5.9)

- [ ] `DmDashboard.tsx` route (DM-only; desktop-only per §5 form factor)
- [ ] At-a-glance grid: all characters with name + class + level + GP-equivalent
- [ ] Party Stash + Recovered Loot summary cards on the dashboard
- [ ] Total party gold (sum of all GP-equivalent across characters + pools)
- [ ] Click-through from any row navigates to that character's sheet (DM read-all)
- [ ] DM-only route guard (hidden from non-DM members)

#### R4.5 — Notes

> -

#### R4 — Notes

> -

---

### R5 — Live sync & history (outline §10 M5)

Websocket sync; per-item history; party log with session-tag filter; offline banner in party mode. Covers OUTLINE §3.11, §3.12, §4 `Session`, §5.8 (History/Log).

**Slicing.** Three independently testable surfaces: R5.1 ships the websocket plumbing + reconciliation; R5.2 adds the `Session` entity and `sessionId` log tagging; R5.3 builds the history UI on top. R5.3 depends on R5.2 (session filter) but not R5.1 (history reads from `TransactionLog` directly).

#### R5.1 — Websocket sync + reconnect

- [ ] Websocket party-room subscription (server pushes action diffs)
- [ ] Optimistic UI: web applies action locally, reconciles on server ack
- [ ] Conflict resolution policy documented and implemented (server is authoritative)
- [ ] Reconnect flow replays missed events
- [ ] Offline banner active in multi-member parties; writes blocked while offline (§9)

#### R5.1 — Notes

> -

#### R5.2 — Sessions entity + log tagging

- [ ] `Session` entity (id, partyId, number, date, notes, isCurrent)
- [ ] Invariant: at most one `isCurrent` session per party
- [ ] Action: `start-session` (clears previous `isCurrent`)
- [ ] Action: `end-session`
- [ ] `TransactionLog.sessionId` populated from current session at write time; **`null` when no session is current** per OUTLINE §3.12 amendment (2026-06-24) — no-session activity is allowed, not blocked.
- [ ] Reducer test: dispatching `acquire` / `transfer` / `currency-transfer` etc. with no current session produces log entries with `sessionId: null`.

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

**Slicing.** R6 is the second-largest milestone after R4 (~30+ checkboxes). Splits along the rules-engine + UI surface axes: R6.1 lights up `pricing.ts` + the per-party economy controls (prerequisite for any priced transaction); R6.2 adds `Shop` + `purchase`/`sale` on top; R6.3 ships the hoard generator + loot distribution wizard; R6.4 adds identification UI + batch-identify (the R2.3 reducer already exists by this point); R6.5 swaps the Catalog Browser to `search.ts`. R6.1 is the hard dependency for R6.2 and the catalog price display.

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
