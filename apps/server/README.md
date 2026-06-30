# `@app/server` — D&D Inventory Manager backend (R3.1+)

Fastify + Postgres + Prisma 7 server. R3.1 ships the scaffold (no auth, no sync); R3.2 adds Discord OAuth + email OTP; R3.4 wires authoritative sync.

## Stack

- **Runtime**: Node.js 22 (ESM-only, `"type": "module"`)
- **Server**: Fastify 5 + `@fastify/cors` + `@fastify/sensible`
- **DB**: PostgreSQL 18 via Prisma 7 (driver adapter: `@prisma/adapter-pg` + `pg`)
- **Tests**: Vitest 4 (node env)
- **Validation**: Zod 4 (shared with `@app/shared`)

## Env vars

| Var                     | Purpose                                                                                                                                                                                      | Default                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `DATABASE_URL`          | Postgres connection string. Required.                                                                                                                                                        | _none_                                      |
| `DATABASE_URL_TEST`     | Test DB connection string. Used by Vitest setup.                                                                                                                                             | falls back to `…/dnd_inv_test` on port 5434 |
| `PORT`                  | HTTP listen port.                                                                                                                                                                            | `3000`                                      |
| `HOST`                  | Network interface to bind. Loopback by default so local dev never exposes the port on Wi-Fi / VPN. Compose / production override to `0.0.0.0`.                                               | `127.0.0.1`                                 |
| `WEB_ORIGIN`            | CORS allow-origin for the SPA.                                                                                                                                                               | `http://localhost:5173`                     |
| `LOG_LEVEL`             | Pino level (`fatal` … `trace`, or `silent`).                                                                                                                                                 | `info`                                      |
| `NODE_ENV`              | `development` / `test` / `production`.                                                                                                                                                       | `development`                               |
| `AUTH_SECRET`           | **R3.2** Auth.js cookie/session signing key. 32+ chars. Rotating it invalidates all existing sessions. Generate with `openssl rand -base64 32`. **Required.**                                | _none_                                      |
| `SESSION_COOKIE_INSECURE` | **R3.5** Drop the `__Host-` prefix + `Secure` flag from the session cookie even when `NODE_ENV=production`. Set to `true` ONLY for self-hosted HTTP-only deployments (docker-compose proxy profile on `http://localhost:8080`); real HTTPS deployments must leave it `false`. See `docs/SECURITY.md` §1.1. | `false`                                     |
| `DISCORD_CLIENT_ID`     | **R3.2** Discord application client ID. Leave blank (or unset) to disable the OAuth routes (they return 503) and hide the Login button. Missing in production logs a startup warning but does NOT crash. Same rule for empty strings (docker-compose `${VAR:-}` substitution). | _none_                                      |
| `DISCORD_CLIENT_SECRET` | **R3.2** Discord application client secret. Same rules as `DISCORD_CLIENT_ID`.                                                                                                               | _none_                                      |
| `DISCORD_REDIRECT_URI`  | **R3.2** Full callback URL registered with Discord. Must match the registration EXACTLY (including trailing slash). Same rules as `DISCORD_CLIENT_ID`.                                       | _none_                                      |
| `SMTP_HOST`             | **R3.3** SMTP submission host (e.g. `smtp.postmarkapp.com`, `email-smtp.us-east-1.amazonaws.com`, `localhost` for Mailpit). Leave blank to disable `/auth/email/*` routes (they return 503) and hide the Login button. Missing in production logs a startup warning but does NOT crash. | _none_                                      |
| `SMTP_PORT`             | **R3.3** SMTP submission port. `587` STARTTLS, `465` implicit-TLS, `1025` for Mailpit / Mailhog.                                                                                             | _none_                                      |
| `SMTP_USER`             | **R3.3** SMTP auth username. Postmark / SES / Mailgun all use their API-key forms here.                                                                                                      | _none_                                      |
| `SMTP_PASS`             | **R3.3** SMTP auth password / API-key secret. Required when `SMTP_USER` is set.                                                                                                              | _none_                                      |
| `SMTP_FROM`             | **R3.3** RFC-5322 From address used on outgoing OTP mail. Must be a domain your SMTP relay is authorized to send for.                                                                        | _none_                                      |

Local dev reads `apps/server/.env` (see `.env.example`); production / Docker pass env vars directly.

## Local dev workflow

```bash
# One-time: bring up a Postgres for dev on :5433.
docker run -d --name dnd-inv-pg \
  -e POSTGRES_USER=dnd -e POSTGRES_PASSWORD=dnd -e POSTGRES_DB=dnd_inv \
  -p 5433:5432 postgres:18-alpine

# Separate test DB on :5434 so it can run in parallel with the dev stack
# (the docker-compose app stack also binds :5433 for Postgres).
docker run -d --name dnd-inv-pg-test \
  -e POSTGRES_USER=dnd -e POSTGRES_PASSWORD=dnd -e POSTGRES_DB=dnd_inv_test \
  -p 5434:5432 postgres:18-alpine

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

**⚠️ DEFERRABLE FK drift warning** (Prisma issue [#8807](https://github.com/prisma/prisma/issues/8807)). Prisma's DSL cannot express `DEFERRABLE`, so every `prisma migrate dev` run that touches `Character` or `Stash` re-emits the FK without the deferral. Any new migration must append the canonical re-DEFERRABLE block to its `migration.sql`. The defensive test in `src/db/schema-invariants.test.ts` queries `pg_constraint` and fails CI if the FK loses its `condeferrable=t, condeferred=t` flags.

## Auth (R3.2)

Discord OAuth2 + PKCE flow with database-backed sessions via `@auth/core` + `@auth/prisma-adapter`. See `docs/SECURITY.md` §1.1 for the threat model.

- **Boot-time graceful degradation.** If any of `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / `DISCORD_REDIRECT_URI` is unset OR set to the empty string, the `/auth/discord/*` routes return `503 {"error": "discord_auth_disabled"}` instead of crashing. In production (`NODE_ENV=production`) the server logs a startup warning listing the missing vars but boots successfully — email-only deployments are first-class.
- **No Discord token persistence.** The `@auth/prisma-adapter` is wrapped in `src/auth/adapter-overrides.ts` to write `NULL` for `access_token` / `refresh_token` / `id_token` / `expires_at` in the `Account` row (SECURITY §1.1: "Discord tokens are not persisted in the DB").
- **Scope: `identify` only.** Discord emails (and all other PII beyond username + avatar) are never requested. Email comes from the R3.3 OTP flow.
- **Cookie shape.** `__Host-auth-session-token` in production (HTTPS-pinned by browser), `auth-session-token` in dev. Always `HttpOnly`, `SameSite=lax`, `Path=/`. `Secure` is auto-set in production. Setting `SESSION_COOKIE_INSECURE=true` drops the `__Host-` prefix AND `Secure` flag even in production — required for HTTP-only self-hosted stacks (docker-compose proxy profile); real HTTPS deployments must leave it off.
- **Sliding 30-day expiry.** Sessions refresh their `expires` timestamp once per day of activity, matching SECURITY §1.1.

## Email OTP (R3.3)

8-digit one-time-code email login. Used both as the sole login method for users with no Discord account AND as a backup credential a Discord user can add later. See `docs/SECURITY.md` §1.2 for the threat model.

- **Boot-time graceful degradation.** Same pattern as Discord: when any of `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` is unset OR set to the empty string, the `/auth/email/*` routes return `503 {"error": "email_auth_disabled"}`. In production the server logs a startup warning listing the missing vars but boots successfully.
- **Custom flow, not Auth.js Email provider.** R3.3 implements `/auth/email/request-otp` + `/auth/email/verify-otp` directly so the SECURITY §1.2 "OTP submitted via POST body only, never in a query string" mandate is mechanically enforced. The session row is created via the same `createSessionForUser` helper the R3.2 Discord callback uses.
- **5-attempt lockout.** `EmailAuthAttempt` table tracks `(email, ip)` pairs. After 5 failed verify attempts the code is deleted AND a 15-minute lockout is imposed across both axes. Per SECURITY §1.2.
- **Constant-time `/auth/email/request-otp`.** Returns `200 { status: 'sent' }` regardless of whether the email is registered. A synthetic 150–350ms pad runs in parallel with the SMTP send to keep registered/unregistered timing distributions roughly overlapping. SECURITY §1.2: no user enumeration.
- **Single-use codes, 15-minute expiry.** OTP rows live in `VerificationToken` with `identifier = 'otp:<email>'` (primary flow) or `'link:<userId>:<email>'` (backup-email link flow). The row is `delete`d on a successful verify; replay returns 401.
- **OTP never logged.** `logger.redact` strips `req.body.otp` so the digits don't land in pino's log stream. Configured in `src/server.ts`.
- **First-login displayName gate.** Email-only signups create a User row with `needsDisplayName: true`. The `POST /auth/email/set-display-name` endpoint flips the flag; the §8.1 guard layer (R3.4) will return 409 on every other protected route until it does.

**Local dev tip:** run [Mailpit](https://github.com/axllent/mailpit) for a zero-config SMTP server with a web UI that captures every sent email:

```bash
docker run -p 1025:1025 -p 8025:8025 axllent/mailpit
# Then in .env:
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_USER=anything
SMTP_PASS=anything
SMTP_FROM=dnd-inv@localhost
# Inspect mail at http://localhost:8025
```

## Sync API (R3.4.a)

Two routes that make the server authoritative for AppState mutations and reads. Both require an authenticated session (the R3.2 / R3.3 cookie); both return `409 { error: 'display_name_required' }` when the user's `needsDisplayName` is still true (R3.3 carryforward).

### `GET /sync/state?partyId=<id>`

Pulls the user's full `AppState` for the requested party — eight Prisma queries, mapped through `db/mappers.ts`, validated against `appStateSchema` per CLAUDE.md "trust at the boundary".

Responses:

- `200 { state: AppState, serverTime }` — happy path.
- `400 { error: 'invalid_query', issues }` — missing / invalid `partyId`.
- `401 { error: 'unauthenticated' }` — no session cookie.
- `403 { error: 'not_a_member' }` — actor isn't an active member of the requested party.
- `404 { error: 'party_not_found' }` — unknown party.
- `409 { error: 'display_name_required' }` — R3.3 carryforward.

### `POST /sync/actions { partyId, actions: Action[] }`

Pushes a batch of typed reducer actions. Server validates each via the §8.1 guard map (`packages/shared/src/guards/`), re-runs the shared reducer authoritatively, persists Prisma deltas, and appends one `TransactionLog` entry per emitted log slice. The WHOLE batch runs inside one `prisma.$transaction` with a 30-second timeout; on any guard rejection the batch rolls back.

Batch cap: 100 actions per request.

Responses:

- `200 { applied: TransactionLogEntry[], serverTime }` — every action applied; one or more log entries per action.
- `400 { error: 'invalid_body', issues }` — Zod validation failed.
- `401 { error: 'unauthenticated' }` — no session cookie.
- `403 { error: 'not_a_member' }` — actor isn't an active member.
- `404 { error: 'party_not_found' }` — unknown party.
- `409 { error: 'display_name_required' }` — R3.3 carryforward.
- `422 { rejected: { index, code, message } }` — action at `index` failed its §8.1 guard; whole batch rolled back. `code` is from `GuardRejectionCode` in `@app/shared/guards`.

### Permission codification

The §8.1 matrix is codified as `{ actionType → Guard }` in `packages/shared/src/guards/map.ts`. Solo parties (`memberCount === 1`) bypass the matrix per OUTLINE §8.2 — the sole member gets the union of DM + Player rights. Multi-member parties enforce the matrix; `Actor.role` is derived server-side via `deriveActorRole(party, membership)` and never trusted from the request body (per SECURITY §2.1).

## Snapshots (R3.4.b)

The server writes a per-party JSON snapshot of every party's `AppState` nightly at 03:07 local, alongside a SHA-256 sidecar for restore-time integrity verification (SECURITY §8). Files land under `${SNAPSHOT_DIR}/${partyId}/${ISO_TIMESTAMP}.json` + `.sha256`. Files older than `SNAPSHOT_RETENTION_DAYS` (default 30) are swept after each tick.

### Config

| Env var                   | Default       | Notes                                                                                                            |
| ------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------- |
| `SNAPSHOTS_ENABLED`       | `true`        | Set to `false` to skip cron registration. Tests use false.                                                       |
| `SNAPSHOT_DIR`            | `./snapshots` | Filesystem path. The docker-compose layer should mount this as a volume so snapshots survive container restarts. |
| `SNAPSHOT_RETENTION_DAYS` | `30`          | Files older than this are deleted after each tick.                                                               |

### Manual restore

Operator-only — NOT exposed over HTTP per SECURITY §8.

```
pnpm --filter @app/server snapshot:restore ./snapshots/<partyId>/<timestamp>.json
```

Verifies the SHA-256 against the sidecar (sha256sum-compatible `<digest>  <filename>` format), Zod-parses the envelope, then wipes + reapplies the party's rows inside one transaction. A digest mismatch exits non-zero before touching the DB. The sidecar can also be verified with the standard CLI:

```
cd snapshots/<partyId> && sha256sum -c <timestamp>.json.sha256
```

### Export endpoint

`GET /sync/export?partyId=<id>` returns the same `exportEnvelope` shape the snapshot writer produces, gated by the same auth + display-name + party-membership checks as `/sync/state`. Used by the web client (R3.5) for user-driven JSON exports without round-tripping through Dexie.

## R3.5 — additional surfaces

### `GET /auth/methods`

Unauthenticated probe so the web Login screen can decide which sign-in buttons to render. Mirrors the `isDiscordAuthEnabled` / `isEmailAuthEnabled` sentinels:

```json
{ "discord": true, "email": false }
```

Always 200; the same disabled state already surfaces as `503` from each provider's routes, so this endpoint reveals no additional information — it just lets the client know up front rather than letting users click into a 503.

### `GET /sync/parties`

Returns the user's active parties (one entry per Party with `roles[]` collapsed for party-of-one). Same auth + display-name gate as the rest of `/sync/*`. Consumed by the Hub screen.

### Discord account-link OAuth flow

`apps/server/src/auth/discord-link.ts` owns a separate OAuth code-exchange path used by **Settings → Linked accounts → Connect Discord**. Three new routes:

- `GET /auth/discord/login?link=1` — short-circuits to `/auth/discord/link/initiate`, which mints an ephemeral `PendingDiscordLink(token, userId, expires)` row.
- `GET /auth/discord/link/start?token=...` — builds PKCE + HMAC-signed state, 302s to `discord.com`.
- `GET /auth/callback/discord/link?code=...&state=...` — exchanges the code, fetches identity via the `identify` scope, attaches `discordId` + `avatarUrl` to the EXISTING session user (does NOT delegate to Auth.js — keeps the live session cookie intact). On unique-snowflake conflict 302s to `${WEB_ORIGIN}/settings?linkError=discord_already_linked`; happy path lands on `?linked=discord`.

**Operator note:** the Discord developer portal must list TWO redirect URIs (both follow Auth.js's `${basePath}/callback/${provider}` convention — the framework hardcodes that shape, so the URIs registered must match):

1. `https://<your-domain>/auth/callback/discord` (primary OAuth flow)
2. `https://<your-domain>/auth/callback/discord/link` (link flow)

## Forward references

- **R3.2**: ~~`@fastify/cookie`, Auth.js wiring; new `User` columns~~ — **shipped**.
- **R3.3**: ~~email OTP + backup-email link + first-login displayName gate~~ — **shipped**. Discord-link `?link=1` flow ~~deferred to R3.5~~ **shipped in R3.5**.
- **R3.4**: ~~authoritative reducer + `/sync` route + nightly snapshots~~ — **shipped as R3.4.a + R3.4.b** (R3.4.a: `GET /sync/state` + `POST /sync/actions`; §8.1 guard layer in `@app/shared/guards`; reducer moved to `@app/rules` with `ReducerContext` injection. R3.4.b: nightly node-cron snapshots + retention sweeper + `GET /sync/export` + `snapshot:restore` CLI).
- **R3.5**: ~~web client points at the server; offline-first Dexie cache~~ — **web integration shipped** (login screens + Hub + sync queue + linked accounts + `GET /sync/parties` + Discord-link route-layer flow + `PendingDiscordLink` migration). Offline-first Dexie cache deferred to R5.
- **R5**: WebSocket (Socket.IO) per-party broadcast.
