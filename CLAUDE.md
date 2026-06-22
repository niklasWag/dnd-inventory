# CLAUDE.md

Project guidance for Claude Code. Read these rules before working on this codebase.

## What this project is

A **D&D 5e (2024 rules) inventory management web app**, intended for private use. Designed as a party manager where "solo" is a party-of-one (same data model, single member). Local-first browser app that grows into a self-hosted backend with Discord OAuth and live party sync.

**Authoritative specs — read first if relevant to the task:**
- `docs/OUTLINE.md` — full product scope, data model, permissions, milestones.
- `docs/MVP.md` — MVP scope (single-user, browser-local). The MVP `AppState` is a strict subset of the final outline.
- `docs/TECH_STACK.md` — all technology choices with rationale.

If you find anything in code that contradicts these docs, **the docs win** — update the code or surface the conflict.

## Rules

### Doing tasks

- Read the relevant docs before non-trivial work. Do not infer architecture from code alone.
- Prefer editing existing files over creating new ones. Never create stray docs unless asked.
- When the user asks for an outline/plan/design doc, **ask clarifying questions first**, then write — don't guess at decisions.
- After non-trivial implementation work, propose a commit but **do not commit without explicit permission**.

### Tech stack (see `docs/TECH_STACK.md` for full rationale)

- TypeScript everywhere. Strict mode (`strict: true`, `noUncheckedIndexedAccess`, `noImplicitOverride`).
- Frontend: React 18 + Vite. Styling: Tailwind + shadcn/ui. State: Zustand + Immer.
- Local persistence: Dexie (IndexedDB). **Not** localStorage.
- Validation: Zod everywhere data crosses a boundary (forms, IndexedDB I/O, future API).
- Backend (post-M3): Node + Fastify + Postgres + Prisma. Auth: Auth.js + Discord. Realtime: Socket.IO.
- Repo layout: pnpm monorepo — `apps/web`, `apps/server` (M3+), `packages/{shared,rules,seeds}`, `infra/docker`.

### Code conventions

- **No `any`.** Use `unknown` + Zod parse at boundaries.
- Discriminated unions for `TransactionLog.type` and action shapes. Match the outline §4 schema exactly.
- One component per file; `PascalCase.tsx` for components, `camelCase.ts` for utilities/hooks.
- Tests colocated as `*.test.ts(x)` next to the file under test.
- shadcn/ui primitives live in `src/components/ui/` and are managed by `shadcn-ui add`. **Do not hand-edit them.**
- Use `useShallow` (or equivalent) for Zustand selectors that derive multiple fields.
- Reducer actions correspond 1:1 to `TransactionLog.type` values. Adding a mutation means adding both an action and a log type.
- All mutations go through the reducer: validate → apply → append log entry → persist (debounced).

### Data model rules (see `docs/OUTLINE.md` §4)

- **Every user is always in a party.** Solo = party-of-one with `isSoloShortcut: true`. Never invent a parallel solo path.
- Stash `scope` is `character | party | recovered-loot`. There is **no `solo` scope**.
- A character has exactly one `isCarried: true` stash (the Inventory), referenced by `Character.inventoryStashId`. Encumbrance applies only there.
- `ItemInstance.ownerType` is `stash | shop`. The `character` value does not exist.
- `equipped` / `attuned` / `identified` / `currentCharges` are only meaningful on items in a `scope=character, isCarried=true` stash.
- Currency lives on every stash uniformly via `CurrencyHolding.stashId`.
- `PartyMembership` primary key is composite `(userId, partyId, role)` — a party creator has two rows (dm + player).
- The MVP hard-codes some fields to placeholder values (`equipped: false`, `encumbranceRule: "off"`, `bankerUserId: null`, etc.). Do not redesign the schema to "remove" them — they're placeholders for future features.

### Permissions / behavior rules (see `docs/OUTLINE.md` §3.14 + §8)

- DM never silently edits a player's character. Every cross-character mutation goes through an explicit action that is logged.
- Banker only exists when the party has 2+ members. DM cannot self-appoint as Banker.
- When a Banker is active, Party Stash & Recovered Loot become Banker-mediated (players can't self-claim). When no Banker exists, players claim freely.
- Identification is a display invariant, not a permission: unidentified items show as "Unknown Magic Item" + DM hint.

### Testing — TDD where it pays off

- **Always TDD** for:
  - `packages/rules/*` (pure functions — easy to test, expensive to get wrong).
  - Reducer actions that touch the transaction log.
  - Anything that handles currency math or stash transfers.
- **Pragmatic testing** elsewhere — component tests for critical flows (create character, move item, JSON round-trip), not coverage chasing.
- Use Vitest + React Testing Library. Query by accessible role/label, not test IDs.
- When invoking calm-dev TDD skills, follow the RED → GREEN → REFACTOR cycle strictly.

### Things to avoid

- **Don't** introduce localStorage as a storage backend — Dexie/IndexedDB only.
- **Don't** add CSS-in-JS libraries (styled-components, emotion). Tailwind only.
- **Don't** add a router state library (Redux, Jotai, Recoil) — Zustand only.
- **Don't** add `any`, `as any`, or `// @ts-ignore`. Fix the type.
- **Don't** edit files in `src/components/ui/` directly — use `shadcn-ui add`.
- **Don't** redistribute PHB/DMG seed files. They are private-use only; a note in the README must say so.
- **Don't** rename or remove MVP placeholder fields (`equipped`, `attuned`, `encumbranceRule`, `bankerUserId`, etc.). The MVP schema is the final schema with defaults.
- **Don't** create parallel "solo" entities. Solo is a party-of-one — same model.
- **Don't** commit secrets, OAuth client IDs, or PHB/DMG content files to git history.
- **Don't** add error handling for cases that can't happen. Trust internal invariants; validate at boundaries only.

### When in doubt

- If a decision isn't in `docs/OUTLINE.md`, `docs/MVP.md`, or `docs/TECH_STACK.md`, **ask the user** rather than guessing.
- If a request would contradict one of these docs, surface the conflict before implementing.
- Prefer the simpler approach. The right amount of complexity is the minimum needed for the current task.

## Quick reference

### Commands (once `apps/web` exists)

```
pnpm install                              # install all workspace deps
pnpm --filter @app/web dev                # start the MVP frontend
pnpm --filter @app/web build              # production build
pnpm --filter @app/web test               # Vitest
pnpm --filter @app/web lint               # ESLint
pnpm --filter @app/web format             # Prettier
pnpm typecheck                            # tsc --noEmit across workspace
```

### Repo entry points

- `apps/web/src/store/` — Zustand store + reducer actions.
- `packages/rules/` — pure rules engine (currency, inventory, future capacity/attunement/etc.).
- `packages/shared/schemas/` — Zod schemas shared between client and (future) server.
- `packages/seeds/` — PHB / DMG content + seed loader.

### Key invariants to preserve

- `AppState` shape always matches `docs/OUTLINE.md` §4 (with MVP placeholders where applicable).
- Every mutation appends a `TransactionLog` entry with a typed payload.
- JSON export/import round-trip is bit-for-bit lossless (export → wipe → import = identical state).
- Auto-stack key: `(definitionId, notes ?? "")`.
