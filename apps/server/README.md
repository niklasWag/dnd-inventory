# `@app/server` — D&D Inventory Manager backend (R3.1+)

Fastify + Postgres + Prisma 7 server. R3.1 ships the scaffold (no auth, no sync); R3.2 adds Discord OAuth + email OTP; R3.4 wires authoritative sync.

## Stack

- **Runtime**: Node.js 22 (ESM-only, `"type": "module"`)
- **Server**: Fastify 5 + `@fastify/cors` + `@fastify/sensible`
- **DB**: PostgreSQL 18 via Prisma 7 (driver adapter: `@prisma/adapter-pg` + `pg`)
- **Tests**: Vitest 4 (node env)
- **Validation**: Zod 4 (shared with `@app/shared`)

## Env vars

| Var                 | Purpose                                          | Default                                     |
| ------------------- | ------------------------------------------------ | ------------------------------------------- |
| `DATABASE_URL`      | Postgres connection string. Required.            | _none_                                      |
| `DATABASE_URL_TEST` | Test DB connection string. Used by Vitest setup. | falls back to `…/dnd_inv_test` on port 5433 |
| `PORT`              | HTTP listen port.                                | `3000`                                      |
| `HOST`              | Network interface to bind. Loopback by default so local dev never exposes the port on Wi-Fi / VPN. Compose / production override to `0.0.0.0`. | `127.0.0.1` |
| `WEB_ORIGIN`        | CORS allow-origin for the SPA.                   | `http://localhost:5173`                     |
| `LOG_LEVEL`         | Pino level (`fatal` … `trace`, or `silent`).     | `info`                                      |
| `NODE_ENV`          | `development` / `test` / `production`.           | `development`                               |

Local dev reads `apps/server/.env` (see `.env.example`); production / Docker pass env vars directly.

## Local dev workflow

```bash
# One-time: bring up a Postgres for dev + tests.
docker run -d --name dnd-inv-pg \
  -e POSTGRES_USER=dnd -e POSTGRES_PASSWORD=dnd -e POSTGRES_DB=dnd_inv \
  -p 5433:5432 postgres:18-alpine
docker exec dnd-inv-pg psql -U dnd -d dnd_inv -c "CREATE DATABASE dnd_inv_test;"

# Install deps + apply migrations + start the dev server.
cp apps/server/.env.example apps/server/.env
pnpm install
pnpm --filter @app/server db:migrate     # applies migrations to dev DB
pnpm --filter @app/server dev            # tsx watch on :3000

# Quick health check.
curl http://localhost:3000/healthz
# → {"status":"ok","db":"ok","seedVersion":3}
```

Useful scripts (all under `pnpm --filter @app/server …`):

| Script                        | What it does                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `dev`                         | `tsx watch src/index.ts` (runs the seed runner on every reload)               |
| `build`                       | `tsc -p tsconfig.json`                                                        |
| `start`                       | `node dist/index.js` (production-style boot)                                  |
| `typecheck` / `lint` / `test` | standard workspace gates                                                      |
| `db:migrate`                  | `prisma migrate dev` (creates + applies migrations against the dev DB)        |
| `db:migrate:deploy`           | `prisma migrate deploy` (applies pending migrations; used in production / CI) |
| `db:seed`                     | Standalone seed runner (`tsx prisma/seed.ts`)                                 |
| `db:studio`                   | `prisma studio` — visual DB inspector                                         |
| `db:reset`                    | `prisma migrate reset --force` — drops everything in the dev DB and reapplies |

## Docker compose workflow

```bash
cd infra/docker
cp .env.example .env
docker compose up --build
```

Brings up Postgres 18 → server (with `prisma migrate deploy` then the seed runner) → web (vite preview).

- Server: `http://localhost:${SERVER_PORT:-3000}`
- Web: `http://localhost:${WEB_PORT:-5173}`
- Postgres: `localhost:${POSTGRES_PORT:-5433}` (non-standard host port to avoid clashing)

`docker compose down` preserves the `postgres-data` volume; `down -v` drops it (triggers a fresh reseed on next boot).

## Prisma 7 notes

- `prisma.config.ts` at `apps/server/` is mandatory in v7; it sources `DATABASE_URL` via `dotenv/config`.
- The Prisma client is generated to `prisma/generated/prisma/` (the v7 default is no longer `node_modules`). The directory is gitignored; CI regenerates it via `prisma generate`.
- Driver adapter: `new PrismaPg({ connectionString })` → `new PrismaClient({ adapter })`. Hardcoded in `src/db/prisma.ts`.
- The boot-time seed runner is **not** Prisma's `db seed` hook (removed in v7). It runs as a step in `src/index.ts` and is version-gated by `Metadata.seedVersion`.

## Schema invariants

The Prisma schema (`prisma/schema.prisma`) mirrors the Zod schemas in `packages/shared/src/schemas/`. CHECK constraints + a `DEFERRABLE INITIALLY DEFERRED` FK on `Character.inventoryStashId` are appended to the init migration by hand — see `prisma/migrations/<ts>_init/migration.sql` for the canonical list.

## Forward references

- **R3.2**: `@fastify/cookie`, `@fastify/auth`, Auth.js wiring; new `User` columns (`discordId`, `email`, `emailVerified`, `avatarUrl`).
- **R3.4**: authoritative reducer + `/sync` route; nightly snapshot job.
- **R3.5**: web client points at the server; offline-first Dexie cache.
- **R5**: WebSocket (Socket.IO) per-party broadcast.
