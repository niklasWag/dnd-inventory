# Roadmap

Living checklist for shipping the D&D 5e (2024) Inventory Manager. Steps are intentionally fine-grained — one checkbox per file / function / test — so progress is visible and nothing slips. **Mark items only when fully done.**

Source of truth for *what* and *why*: `MVP.md`, `OUTLINE.md`, `TECH_STACK.md`. This doc tracks *progress*, not specs — if a step here disagrees with those docs, the docs win.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` skipped/dropped (note why).

---

## MVP

Mirrors `MVP.md` §11 (M0–M7). Each milestone has a trailing **Notes** block for free-form progress logging — dates, decisions, blockers, follow-ups.

### M0 — Skeleton

App boots; welcome empty state; settings page with wipe; logging plumbing in place.

**Repo & tooling**
- [ ] pnpm workspace root (`pnpm-workspace.yaml`, root `package.json`)
- [ ] `apps/web` Vite + React 18 + TypeScript app scaffolded
- [ ] `packages/shared` package created (empty placeholder index)
- [ ] `packages/rules` package created (empty placeholder index)
- [ ] `packages/seeds` package created (empty placeholder index)
- [ ] `infra/docker/` directory created with placeholder README
- [ ] Root `tsconfig.base.json` with `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`
- [ ] Per-package `tsconfig.json` extending base
- [ ] ESLint config (flat config) with TS + React rules
- [ ] Prettier config + `.editorconfig`
- [ ] Vitest config at workspace root + `apps/web`
- [ ] `pnpm typecheck` script wired across workspace
- [ ] `pnpm --filter @app/web dev` runs the empty app
- [ ] `pnpm --filter @app/web build` produces a production bundle
- [ ] `pnpm --filter @app/web lint` passes on empty scaffold
- [ ] `pnpm --filter @app/web test` runs (no tests yet, exits 0)
- [ ] CI-friendly `.gitignore` (node_modules, dist, .turbo, coverage)
- [ ] README with private-use disclaimer (per `../CLAUDE.md` — no PHB/DMG redistribution)

**App shell**
- [ ] Tailwind + PostCSS configured in `apps/web`
- [ ] shadcn-ui initialized; `components.json` committed
- [ ] `src/components/ui/` populated with first primitives (button, dialog, input)
- [ ] App entry (`src/main.tsx`) renders root component
- [ ] Top-level layout component (header / content slot)
- [ ] Empty-state **Welcome** screen ("Create your character" CTA, settings link)
- [ ] **Settings** screen route (stub: app version, wipe button)
- [ ] Simple in-app router/navigation between Welcome and Settings (no library beyond what's needed)

**Persistence plumbing**
- [ ] Dexie added to `apps/web`
- [ ] `src/db/schema.ts` — Dexie schema for `appState:v1` blob
- [ ] `src/db/load.ts` — load AppState (returns `null` if absent)
- [ ] `src/db/save.ts` — debounced save of AppState
- [ ] `src/db/wipe.ts` — clear all stored state
- [ ] Wipe button in Settings wired to `wipe.ts` with confirm dialog
- [ ] App boots empty AppState when nothing is stored

**State + logging plumbing**
- [ ] Zustand store created in `src/store/index.ts`
- [ ] Immer middleware wired
- [ ] `src/store/reducer.ts` — action dispatcher skeleton (no actions yet)
- [ ] Reducer appends a `TransactionLog` entry on every action (verified by a no-op test)
- [ ] Reducer triggers debounced persist after each action
- [ ] `src/store/types.ts` — re-exports the `AppState` type from `packages/shared`
- [ ] First placeholder reducer test (`reducer.test.ts`) proves logging + persist hooks fire

#### M0 — Notes

> _Free-form progress log. Add dated entries, decisions, blockers, links to PRs, etc._
>
> -

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

Sections mirror `MVP.md` §13 — each adds **purely additive** changes (no MVP schema field renamed/removed). Order roughly follows the outline's M1→M7.

### R1 — Equip + Attunement + Encumbrance (outline M1)

**Schema activations**
- [ ] `ItemInstance.equipped` allowed to be `true`
- [ ] `ItemInstance.attuned` allowed to be `true`
- [ ] `Character.encumbranceRule` accepts `"advisory" | "hard"` (in addition to `"off"`)
- [ ] Migration test: existing MVP exports import cleanly (all placeholders stay valid)

**Reducer actions**
- [ ] `equip` / `unequip` actions + payload schemas
- [ ] Equip-only-from-carried-Inventory invariant test
- [ ] `attune` / `unattune` actions + payload schemas
- [ ] Attunement slot limit invariant test (uses `Character.maxAttunement`)

**Rules — activate stubs**
- [ ] `packages/rules/capacity.ts` implemented
- [ ] `capacity.ts` tests (STR × multiplier, encumbered/heavily-encumbered thresholds)
- [ ] `packages/rules/attunement.ts` implemented
- [ ] `attunement.ts` tests
- [ ] `packages/rules/weight.ts` implemented
- [ ] `weight.ts` tests
- [ ] `packages/rules/validation.ts` implemented (cross-action invariants)
- [ ] `validation.ts` tests

**UI**
- [ ] Capacity bar on Inventory tab with warning states
- [ ] Equip toggle on Inventory rows
- [ ] Attune toggle on Inventory rows with slot counter
- [ ] Encumbrance-rule selector on Character settings

#### R1 — Notes

> -

---

### R2 — Magic items + charges (outline M2)

- [ ] `seed/dmg-2024.json` placed (private, same disclaimer as PHB)
- [ ] DMG seed Zod schema + loader + tests
- [ ] `ItemDefinition` extended: `rarity`, `requiresAttunement`, `attunementPrereq`, `charges`
- [ ] `ItemInstance.identified` allowed to be `false`
- [ ] `ItemInstance.currentCharges` allowed to be a number
- [ ] `packages/rules/charges.ts` implemented
- [ ] `charges.ts` tests (spend, max, never-negative)
- [ ] Recharge action types + reducer cases + tests (per-rest, dawn, etc.)
- [ ] Identification flow action + reducer + test
- [ ] UI: unidentified items show as "Unknown Magic Item" + DM hint
- [ ] UI: charge counter + recharge button on item detail

#### R2 — Notes

> -

---

### R3 — Backend skeleton + Discord OAuth + sync (outline M3)

**Backend bootstrap (`apps/server`)**
- [ ] `apps/server` Fastify + TypeScript app scaffolded
- [ ] Postgres + Prisma set up with migrations matching shared schemas
- [ ] Auth.js + Discord provider wired
- [ ] `User.id` migration: local UUID → linked `discordId`
- [ ] `User.avatarUrl` field added
- [ ] Socket.IO sync channel (single-user at this stage)
- [ ] Snapshot backup endpoint
- [ ] `infra/docker/` compose file for local dev (web + server + postgres)

**Web integration**
- [ ] Web auth flow (login with Discord)
- [ ] Web sync client (push reducer actions → server)
- [ ] Web reconciles server events back into the store
- [ ] Offline-first behavior: local Dexie remains primary cache

#### R3 — Notes

> -

---

### R4 — Multi-member parties + Banker + roles (outline M4)

- [ ] New parties default `isSoloShortcut: false`; legacy solo parties keep `true`
- [ ] `PartyMembership` count > 2 supported
- [ ] Invite-code generation + redemption flow
- [ ] Join / leave / kick actions (with Recovered Loot transfer)
- [ ] Role distinction enforced at reducer + API layer
- [ ] `appoint-banker` / `revoke-banker` actions + tests
- [ ] DM-cannot-self-appoint invariant test
- [ ] Banker-mediated claim rules (per outline §8)
- [ ] No-Banker free-claim rules
- [ ] UI: party member list + role badges
- [ ] UI: Banker controls on Party Stash + Recovered Loot
- [ ] UI: claim queue when Banker is active

#### R4 — Notes

> -

---

### R5 — Live history UI + sessions (outline M5)

- [ ] `Session` entity added (schema + migrations)
- [ ] Start-session / end-session actions
- [ ] History view rendering existing `TransactionLog`
- [ ] Per-item history view
- [ ] Permission rule: owner + DM only see per-item history
- [ ] Filter / search across log entries
- [ ] Pagination or virtualized list for long histories

#### R5 — Notes

> -

---

### R6 — DM tools (outline M6)

- [ ] Hoard generator (per outline §3.x — confirm specifics before building)
- [ ] Identification flow UI (DM marks items identified; players see updated names)
- [ ] Shop manager: static catalog + manual purchases
- [ ] `packages/rules/hoard.ts` implemented + tests
- [ ] `packages/rules/pricing.ts` implemented + tests
- [ ] `packages/rules/search.ts` activated (fuzzy across name + description + tags)

#### R6 — Notes

> -

---

### R7 — Polish (outline M7)

- [ ] Light/dark theme toggle
- [ ] Mobile-responsive layout for player views
- [ ] Fuzzy multi-field search wired into Catalog + stash tables
- [ ] Accessibility pass (keyboard nav, ARIA labels, contrast)
- [ ] Performance pass on log size (capping, IndexedDB pagination if needed)
- [ ] Re-seed conflict hints ("this item has updates" on duplicated PHB rows)

#### R7 — Notes

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
