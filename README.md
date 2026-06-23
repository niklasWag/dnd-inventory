# D&D Inventory Manager

A **private-use** D&D 5e (2024) inventory manager. Local-first browser app that grows into a self-hosted backend with Discord OAuth and live party sync.

> ⚠️ **Private use only.** This project ships seed data derived from the **2024 Player's Handbook** and **Dungeon Master's Guide**. PHB/DMG content is **not redistributed** — seed JSON files live outside git and the repo never includes them in any public history.

See `docs/OUTLINE.md` for the full product scope, `docs/MVP.md` for the MVP cut, and `docs/TECH_STACK.md` for technology choices.

## Status

MVP M4 (Currency) complete — see `docs/roadmap.md`. Next: M5 (Move + Split).

## Requirements

- Node ≥ 22
- pnpm 11

## Commands

```bash
pnpm install                              # install all workspace deps
pnpm --filter @app/web dev                # start the MVP frontend
pnpm --filter @app/web build              # production build
pnpm --filter @app/web test               # Vitest
pnpm --filter @app/web lint               # ESLint
pnpm typecheck                            # tsc --noEmit across workspace
pnpm format                               # Prettier write
```

## Repo layout

```
apps/web                React SPA (Vite, M0+)
apps/server             Fastify API (lands at M3 / R3)
packages/shared         Cross-cutting Zod schemas + types (M1+)
packages/rules          Pure rules engine — stubs only in M0
packages/seeds          PHB / DMG content loader (M2+)
infra/docker            Compose + nginx (R3+)
docs/                   OUTLINE.md, MVP.md, TECH_STACK.md, roadmap.md
```
