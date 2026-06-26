# Tech Stack — D&D 5e (2024) Inventory Manager

This document is the **source of truth for technology choices** across both the MVP and the full self-hosted product. Decisions are intentional and chosen to share as much code as possible between frontend, backend, and rules-engine layers.

> See `OUTLINE.md` for product scope and `MVP.md` for the MVP-specific cut.

---

## 1. At-a-glance

| Layer | Choice | Notes |
|---|---|---|
| Language | **TypeScript** end-to-end | One language, shared rules engine code. |
| Frontend | **React 19 + Vite** | SPA; Vite for dev/build. |
| Styling | **Tailwind CSS + shadcn/ui** | Light/dark theme; copy-paste primitives. |
| State | **Zustand + Immer** | Reducer-shaped global store. |
| Local persistence | **Dexie (IndexedDB)** | Async, generous quota. |
| Validation | **Zod** | Schemas shared client ↔ server. |
| Testing | **Vitest + React Testing Library** | E2E deferred. |
| Lint / format | **ESLint + Prettier + Husky + lint-staged** | Pre-commit hygiene. |
| Backend (M3+) | **Node.js + Fastify** | Same TS toolchain as frontend. |
| Database (M3+) | **PostgreSQL + Prisma** | Generated types; first-class migrations. |
| Realtime (M5+) | **Socket.IO** | Room-per-party broadcast. |
| Auth (M3+) | **Auth.js + Discord provider + Email OTP provider** | OAuth2 + passwordless email; session cookies. |
| Snapshots (M3+) | **node-cron + per-party JSON files** | In-process scheduler in the server container; writes `exportEnvelope`-shaped state + SHA-256 sidecar. |
| Deployment | **Docker Compose + nginx + Let's Encrypt** | Single Linux box, self-hosted. |

---

## 2. Frontend

### 2.1 Framework — React 19 + Vite + TypeScript
- React 19's concurrent features (transitions, deferred values, `useActionState`) are useful when bulk operations touch many stashes.
- Vite gives near-instant HMR for the SPA dev loop.
- Largest ecosystem of D&D-adjacent component libraries and icon sets.

### 2.2 Styling — Tailwind CSS + shadcn/ui
- Tailwind utility classes everywhere — no CSS-in-JS runtime cost.
- **shadcn/ui** components copied into the repo (not a dep) so we own the styling and can theme freely.
- **Theme**: light + dark via Tailwind's `dark:` modifier + a `class`-based theme toggle (system / light / dark).
- **Icons**: `lucide-react` (matches shadcn/ui defaults).

### 2.3 State Management — Zustand + Immer
- One global store keyed off the outline's `AppState` shape.
- **Immer middleware** for ergonomic immutable updates inside reducer-style actions.
- Actions correspond 1:1 to `TransactionLog.type` values from the outline — keeps client/server parity.
- **Selectors with `useShallow`** for derived view-models (e.g., stash list with GP totals).
- TanStack Query may be added at M3 (backend) for server cache, but Zustand remains the source of truth for UI state.

### 2.4 Local Persistence — Dexie (IndexedDB)
- IndexedDB via [Dexie](https://dexie.org/) — async, indexed queries, quota typically hundreds of MB.
- **One IndexedDB database** named `dnd-inv`, one object store per entity (`users`, `parties`, `memberships`, `characters`, `stashes`, `items`, `currencies`, `catalog`, `log`, `meta`).
- Mirrors the outline's data model — every entity in `AppState` has a corresponding object store.
- **Migration strategy**: Dexie's `version().stores()` chain; each schema change is an explicit version bump.
- **Backup format**: JSON export/import of the entire DB (matches the MVP's "JSON round-trip" goal).

### 2.5 Validation — Zod
- Schemas live in `packages/shared/schemas/` and are imported by both frontend and backend.
- Every action payload validated at the boundary.
- Used to derive TypeScript types via `z.infer<>` so we don't duplicate type definitions.

### 2.6 Routing — React Router (data router mode)
- Used for browser-back/forward through stashes and character pages.
- Lazy-loaded routes for non-MVP screens (Loot Wizard, Shop Manager) to keep the initial bundle small.

### 2.7 Forms — React Hook Form + Zod resolver
- All forms (create character, custom item editor, etc.) use RHF + Zod for unified validation.

### 2.8 OTP Input — shadcn/ui `input-otp`
- Used on the email OTP verification screen (login + backup-email setup in Settings).
- Built on [`input-otp`](https://github.com/guilhermerodz/input-otp) by guilhermerodz — accessible, copy-paste-friendly, unstyled core wrapped in shadcn/ui primitives.
- Configured with `maxLength={8}` for the 8-digit code per `OUTLINE.md` §3.1 / `SECURITY.md` §1.2.
- Added via `pnpm dlx shadcn@latest add input-otp`. Do not hand-edit `src/components/ui/input-otp.tsx`.

### 2.9 Build & Tooling
- **Vite** for dev + prod build.
- **vite-plugin-pwa** later, when offline-capable PWA is added (outline §9).
- **TypeScript** strict mode (`"strict": true`, `noUncheckedIndexedAccess`, `noImplicitOverride`).

---

## 3. Testing

### 3.1 Unit + Component — Vitest + React Testing Library
- Vitest reuses Vite's config; tests run in the same toolchain as the app.
- RTL for component tests — query by accessible role/label, not test IDs.
- **Rules engine modules** (`currency.ts`, `inventory.ts`, future `capacity.ts`, etc.) get pure unit tests — no mocking needed.

### 3.2 E2E — deferred
- No Playwright/Cypress yet. Re-evaluate at M5 (live sync) when bug categories shift to integration concerns.

### 3.3 Coverage targets
- Rules engine modules: aim for high branch coverage (these are deterministic and easy to test).
- UI components: prioritize critical flows (create character, move item, JSON import/export round-trip) over coverage percent.

---

## 4. Code Quality & Conventions

### 4.1 Lint / Format
- **ESLint** with `typescript-eslint` + `eslint-plugin-react-hooks` + `eslint-plugin-tailwindcss`.
- **Prettier** for formatting; no project-wide config quirks.
- Project root has a single `.eslintrc.cjs` and `.prettierrc`.

### 4.2 Git Hooks — Husky + lint-staged
- **pre-commit**: run ESLint --fix and Prettier on staged files only.
- **pre-push**: run `tsc --noEmit` and `vitest run` (fast feedback before pushing broken code).

### 4.3 TypeScript Conventions
- `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitOverride: true`.
- No `any`. `unknown` + Zod parsing at boundaries.
- Discriminated unions for `TransactionLog.type` (matches outline §4).

### 4.4 File / Folder Conventions
- Component files: `PascalCase.tsx`; one component per file.
- Utility / hook files: `camelCase.ts`.
- Tests: colocated as `*.test.ts(x)` next to the file under test.
- shadcn/ui primitives live in `src/components/ui/`; never edited except via `shadcn-ui add`.

---

## 5. Repository Layout

Monorepo via **pnpm workspaces** (anticipating shared rules engine between client and server):

```
/
├─ apps/
│  ├─ web/                     # React SPA (Vite)
│  └─ server/                  # Fastify API (added at M3)
├─ packages/
│  ├─ shared/                  # Cross-cutting: Zod schemas, types, constants
│  ├─ rules/                   # Pure rules engine (currency, inventory, capacity, …)
│  └─ seeds/                   # PHB / DMG content JSON + loader
├─ infra/
│  └─ docker/                  # docker-compose + nginx config (added at M3)
├─ CLAUDE.md                   # project instructions (auto-loaded at root)
└─ docs/
   ├─ OUTLINE.md
   ├─ MVP.md
   ├─ TECH_STACK.md            # this file
   └─ roadmap.md
```

**Until M3** only `apps/web`, `packages/shared`, `packages/rules`, and `packages/seeds` exist. The monorepo structure is set up from day one so the M3 backend addition is purely additive.

---

## 6. Backend (Outline M3+)

### 6.1 Runtime — Node.js LTS
- Latest LTS at the time of M3 implementation.
- Native `--watch` for dev; no nodemon.

### 6.2 Framework — Fastify
- Faster than Express; first-class TypeScript support.
- Built-in JSON schema validation (we use Zod-to-JSON-schema for now to stay consistent with the frontend).
- Plugin ecosystem covers auth, CORS, rate limiting, websockets.

### 6.3 Database — PostgreSQL
- Single Postgres instance per deployment.
- One database; schema mirrors outline §4 entities directly.
- **Snapshots are application-level, not `pg_dump`.** R3.4.b ships an in-process `node-cron@4` task inside the `server` container that, nightly at 03:07 local, materializes every party's `AppState` via `loadAppStateForParty`, wraps it in an `exportEnvelope` (identical to the web's JSON export — `packages/shared/src/schemas/exportEnvelope.ts`), and writes one file per party to `${SNAPSHOT_DIR}/${partyId}/${ISO_TIMESTAMP}.json` with a SHA-256 sidecar (outline §9, SECURITY §8). Retention sweeper deletes files older than `SNAPSHOT_RETENTION_DAYS` (default 30). The operator-only `pnpm --filter @app/server snapshot:restore <file>` CLI verifies the checksum and reapplies a snapshot into the DB. **`pg_dump` is intentionally NOT used** — the application-level format gives per-party granularity (easier to restore a single party without touching others) and round-trips with the web's existing export-import pipeline. Auth tables (`User`, `Session`, `Account`, etc.) are NOT in the snapshot; operators who want full-DB recovery should set up host-level `pg_dump` or volume snapshots separately.

### 6.4 ORM — Prisma
- Schema-first; generates fully typed client.
- Migrations checked into the repo (`prisma/migrations/`).
- **Mature ecosystem** > Drizzle for a team-of-one private project (less footguns, better docs).

### 6.5 Realtime — Socket.IO
- One **room per party** (`party:<partyId>`); members joined on connect, removed on disconnect.
- Broadcast `AppState` deltas after every server-side mutation.
- Automatic reconnect handled by the client SDK; we layer "queue while disconnected" on top per outline §9 (party mode = online required, solo = offline ok).

### 6.6 Auth — Auth.js (next-auth core) + Discord provider + Email provider
- **Discord OAuth** (primary): scope `identify` only. PKCE handled automatically by Auth.js. The browser never sees the Discord `access_token`.
- **Email OTP** (passwordless fallback / standalone): Auth.js Email provider, customized to issue an 8-digit numeric OTP (default Auth.js email uses a magic link — this project overrides the `generateVerificationToken` callback to produce an 8-digit code and the `sendVerificationRequest` callback to deliver it as an OTP-in-email rather than a clickable link). Code lifetime: 15 minutes. Rate limiting and single-use enforcement live in the server-side token store (Prisma-backed), not in Auth.js itself.
- **SMTP:** operator-supplied via environment variables. Required vars: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`. If any are absent at startup, email auth is **disabled entirely** — the login UI hides the email option and the OTP endpoint returns `503`. This prevents silent SMTP failures.
- Session via signed cookies (`HttpOnly`, `Secure`, `SameSite=Lax`).
- **No passwords.** No password reset flow. No email collection from Discord (scope is `identify` only — Discord emails are never requested).
- See `SECURITY.md` §1.1 (Discord) and §1.2 (Email OTP) for the full threat model and mitigations.

### 6.7 Validation — Zod (shared with client)
- Request body / params / query strings parsed via Zod before reaching handlers.
- Same schemas the client uses — single source of truth.

### 6.8 Rules Engine
- Lives in `packages/rules/`, imported by both `apps/web` and `apps/server`.
- All mutations validated server-side **before** state changes; the client-side use is purely optimistic UI.
- Server is **authoritative** (outline §9).

---

## 7. Deployment (Self-Hosted)

### 7.1 Topology

```
Internet
   │
   ▼
[ nginx + Let's Encrypt ]            (reverse proxy, TLS termination)
   │
   ├─► [ apps/web static bundle ]    (served as static files)
   │
   └─► [ apps/server (Fastify) ] ◄─► [ PostgreSQL ]
                                      │
                                      └─► nightly node-cron in server container
                                           → ${SNAPSHOT_DIR}/<partyId>/<iso>.json (+ .sha256 sidecar)
```

### 7.2 Containers — Docker Compose
- `web` — nginx serving the built React SPA + reverse-proxying API/socket traffic.
- `server` — Node + Fastify app. Also runs the in-process nightly snapshot cron (R3.4.b — no separate sidecar; the snapshot directory is mounted as a named volume so files survive container restarts).
- `db` — official Postgres image, pinned major version.

### 7.3 TLS — Let's Encrypt via certbot
- Either run certbot in a sidecar container or via host-level cron — TBD at deployment time.

### 7.4 Updates
- `git pull && docker compose up -d --build` is the deployment story for v1.
- Prisma migrations run on `server` container start.
- No blue/green; brief downtime during restart is acceptable for a private app.

---

## 8. Development Workflow

### 8.1 Local Dev
```
pnpm install                           # once
pnpm --filter @app/web dev             # MVP: just the frontend
# After M3:
docker compose -f infra/docker/dev.yml up -d db    # local Postgres
pnpm --filter @app/server dev          # API server
pnpm --filter @app/web dev             # React app (proxies API via Vite)
```

### 8.2 Branching
- Single `main` branch; feature branches off it. Squash-merge PRs.
- Private repo — no formal release process; tags optional.

### 8.3 CI (deferred)
- No GitHub Actions in MVP. Add later if needed for the deployment build.

---

## 9. Decision Log (why these choices)

| Decision | Why this, why not the alternative |
|---|---|
| TypeScript everywhere | Shared rules engine code (`packages/rules`) avoids re-implementing currency/encumbrance logic in two languages. |
| React over Svelte/Vue/Solid | Largest ecosystem; shadcn/ui maturity; familiar for most contributors. |
| Vite over Next.js | This is an SPA, not a content site; we don't need SSR or RSC. |
| Tailwind + shadcn/ui | Theme switching is a checklist item; shadcn primitives handle accessibility correctly. |
| Zustand over Redux Toolkit | RTK is overkill for a single-app store; Zustand's minimal API matches our reducer-shaped actions. |
| Immer | Lets us write `state.stashes[id].name = …` while keeping immutability semantically. |
| Dexie over localStorage | The MVP doc anticipated outgrowing localStorage; Dexie ships ready for the larger schema. |
| Vitest over Jest | Native Vite integration, much faster cold start. |
| Fastify over Express | Better TS support, faster, built-in schema validation. |
| Prisma over Drizzle | More mature for a private project; less likely to surface edge cases mid-development. |
| Socket.IO over native ws | Auto-reconnect and rooms out of the box; the modest bundle cost is acceptable. |
| Auth.js over Lucia / hand-rolled | Mature Discord provider, handles PKCE + session cookies; less code to maintain. |
| Zod over Valibot / TypeBox | Maturity, ecosystem (especially RHF integration), type inference quality. |
| Docker Compose + nginx | Standard self-host stack; trivial to reproduce on any Linux box. |

---

## 10. Open Tooling Questions

- **PWA**: when to add `vite-plugin-pwa` and ship a service worker? Suggest: at outline M5 (live sync + offline-capable solo mode).
- **Bundle analyzer**: add `rollup-plugin-visualizer` only when bundle size becomes a concern.
- **Error tracking**: Sentry (self-hosted via GlitchTip?) at the same time as the backend, or skip entirely for a private app?
- **Feature flags**: not needed for a single-user private app, but worth noting if scope expands.
- **API client codegen** (e.g., `prisma-zod-generator`, `tRPC`): if we go full TS top-to-bottom, **tRPC** is worth a serious look at M3 — it removes the REST layer entirely and gives end-to-end type safety. Decision deferred to M3 kickoff.
