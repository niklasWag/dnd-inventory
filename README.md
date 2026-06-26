# D&D Inventory Manager

A **private-use** D&D 5e (2024) inventory manager. Local-first browser app that grows into a self-hosted backend with Discord OAuth and live party sync.

> ⚠️ **Private use only.** This project does not ship seed data derived from the **2024 Player's Handbook** and **Dungeon Master's Guide**. PHB/DMG content is **not redistributed** — seed JSON files live outside git and the repo never includes them in any public history.

See `docs/OUTLINE.md` for the full product scope, `docs/MVP.md` for the MVP cut, `docs/TECH_STACK.md` for technology choices, and `docs/SECURITY.md` for the threat model and mitigations.

## Status

**MVP complete** (M0 → M7) — all seven milestones shipped per `docs/MVP.md` §11 Definition-of-Done. See `docs/roadmap.md` for the full milestone history.

- M0 — Skeleton
- M1 — Character + auto-provisioned stashes
- M2 / M2.5 — Catalog + Inventory adds + Item Detail
- M3 — Storage stashes (create / rename / delete)
- M4 — Currency (per-stash holdings, conversion, GP-equivalents)
- M5 / M5.5 — Move + Split + currency self-transfer
- M6 — Custom items + duplicate (homebrew CRUD)
- M7 — Backup (JSON export/import + character/party rename)

**R1 in progress** (post-MVP) — Characters & encumbrance per `docs/OUTLINE.md` §10 M1.

- R1.1 — Encumbrance display (rules `off | phb | variant`, `STR × 15 × sizeMultiplier`, CapacityBar UI) ✅
- R1.2 — Equip / Attune toggles + `edit-character` catch-all + cap pre-disable ✅
- R1.3 — One-level containers (`containerInstanceId`, `flatWeight`), §3.4 leave-Inventory cascade, container-aware weight ✅
- R1.4 — Hard-mode enforcement (reducer rejects acquire / transfer that exceed the carrying-capacity ceiling when `enforceEncumbrance: true`) ✅
- R1.5 — Packing UI (pack/take-out actions on container rows) — next

See `docs/roadmap.md` for the full slice history.

## Requirements

- Node ≥ 22
- pnpm 11

## Commands

```bash
pnpm install                              # install all workspace deps
pnpm --filter @app/web dev                # start the frontend
pnpm --filter @app/web build              # production build
pnpm --filter @app/web test               # Vitest
pnpm --filter @app/web lint               # ESLint
pnpm typecheck                            # tsc --noEmit across workspace
pnpm format                               # Prettier write
```

## Backup & restore

The MVP runs entirely in your browser. Settings → **Export JSON** downloads a versioned snapshot of your full state (character, stashes, items, currency, homebrew, transaction log). Settings → **Import JSON** restores any prior export after a replace-all confirm. Round-trip is bit-for-bit lossless — exports drop into a fresh browser and pick up exactly where you left off.

## Repo layout

```
apps/web                React SPA (Vite, M0+)
apps/server             Fastify API (lands at M3 / R3)
packages/shared         Cross-cutting Zod schemas + types (M1+)
packages/rules          Pure rules engine — stubs only in M0
packages/seeds          PHB / DMG content loader (M2+)
infra/docker            Compose + nginx (R3+)
docs/                   OUTLINE.md, MVP.md, TECH_STACK.md, SECURITY.md, roadmap.md
```
