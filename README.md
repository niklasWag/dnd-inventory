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

## Hosting (self-hosted deployment)

> R3.2+ — Discord OAuth + DB-backed sessions are operational on the server. The web client doesn't talk to the server yet (lands in R3.5), but `/healthz` + `/auth/*` already work end-to-end.

This app is designed to run on **a single Linux box behind a reverse proxy** — no Kubernetes, no managed cloud needed. Below is the end-to-end path.

### 1. Prerequisites

- A Linux server (Debian / Ubuntu / Alpine — anything that runs Docker).
- Docker + Docker Compose v2.
- A domain name pointed at the server (`dnd.example.com` in the examples below).
- TLS certificates — easiest via [Caddy](https://caddyserver.com/) (auto-issues Let's Encrypt) or [nginx + certbot](https://certbot.eff.org/).
- A Discord application registered at [https://discord.com/developers/applications](https://discord.com/developers/applications) — gives users a way to log in.
- An SMTP relay that can submit mail on your behalf — used by **email OTP login (R3.3)**. Options:
  - A transactional provider — [Postmark](https://postmarkapp.com/), [AWS SES](https://aws.amazon.com/ses/), [Mailgun](https://www.mailgun.com/), [SendGrid](https://sendgrid.com/). Set their submission host + the API key they hand you.
  - Self-hosted Postfix on the same Linux box if you'd rather not depend on a third party.
  - For local testing: [Mailpit](https://github.com/axllent/mailpit) (`docker run -p 1025:1025 -p 8025:8025 axllent/mailpit`) gives you a zero-config SMTP server with a web inbox at `http://localhost:8025`.

### 2. Register a Discord application

1. Visit [https://discord.com/developers/applications](https://discord.com/developers/applications) → **New Application** → give it a name (e.g. "DnD Inventory — Friends").
2. Under **OAuth2** → **General**:
   - Copy the **Client ID** → you'll set `DISCORD_CLIENT_ID`.
   - **Reset Secret** → copy the **Client Secret** → `DISCORD_CLIENT_SECRET`. (Treat it like a password; it never reaches the browser.)
   - Add a **Redirect URI** that matches `https://<your-domain>/auth/discord/callback` **exactly** (trailing slash and protocol matter). This is `DISCORD_REDIRECT_URI`.
3. The app only requests scope `identify` — Discord shows users a minimal consent screen (username + avatar; no email, no guilds).

### 3. Clone + configure

```bash
git clone https://github.com/<you>/invManagement.git
cd invManagement/infra/docker
cp .env.example .env
$EDITOR .env   # fill in the values below
```

Set these in `infra/docker/.env`:

| Variable                | Value                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`     | Long random string. **Change from the default `dnd`.**                                              |
| `AUTH_SECRET`           | Output of `openssl rand -base64 32`. Rotating this signs everyone out.                              |
| `DISCORD_CLIENT_ID`     | From step 2.                                                                                        |
| `DISCORD_CLIENT_SECRET` | From step 2.                                                                                        |
| `DISCORD_REDIRECT_URI`  | `https://<your-domain>/auth/discord/callback` — must match the Discord registration exactly.        |
| `SMTP_HOST`             | SMTP submission host from your transactional provider (e.g. `smtp.postmarkapp.com`).                |
| `SMTP_PORT`             | `587` for STARTTLS, `465` for implicit TLS. Most providers use `587`.                               |
| `SMTP_USER`             | SMTP auth username (often a provider API-key id).                                                   |
| `SMTP_PASS`             | SMTP auth password (often a provider API-key secret). Treat like a password.                        |
| `SMTP_FROM`             | From-address on outgoing OTP mail. Must be a domain your relay is authorized to send for.           |
| `SERVER_PORT`           | Internal port the server listens on (default `3000`). Keep firewalled; only the proxy reaches it.   |
| `WEB_PORT`              | Internal port for the web container (default `5173`). Same firewalling note.                        |
| `POSTGRES_PORT`         | Host-side Postgres port (default `5433`). Bind to `127.0.0.1` only; never expose Postgres publicly. |

Once migrated, you can drop the `POSTGRES_PORT` host mapping entirely — nothing outside the compose network needs to reach Postgres.

### 4. Bring up the stack

```bash
cd infra/docker
docker compose up -d --build
docker compose logs server  # watch the seed runner + Fastify boot
```

What this does:

1. Postgres starts and waits for healthcheck.
2. Server container runs `prisma migrate deploy` (idempotent) then the boot-time PHB+DMG seed runner.
3. Server begins listening on `0.0.0.0:${SERVER_PORT}` **inside the container** — see step 5 for exposing it to the world.
4. Web container serves the SPA via `vite preview`.

Smoke-check from the host:

```bash
curl http://127.0.0.1:${SERVER_PORT}/healthz
# → {"status":"ok","db":"ok","seedVersion":3}
```

### 5. Reverse proxy + TLS

The Fastify server binds inside the container only; it expects a reverse proxy to terminate TLS and forward HTTPS traffic. **Trust-host requirement** (Auth.js v5): the proxy must pass the canonical `Host` header so Auth.js can build correct callback URLs. Don't blindly forward `X-Forwarded-Host` from clients — that's a Host-header injection vector. Standard Caddy / nginx defaults are safe.

#### Caddy (easiest — auto-TLS)

`/etc/caddy/Caddyfile`:

```caddyfile
dnd.example.com {
    encode gzip
    # Server endpoints (auth + health + future /sync).
    handle_path /healthz* { reverse_proxy 127.0.0.1:3000 }
    handle_path /auth/*   { reverse_proxy 127.0.0.1:3000 }
    handle_path /sync/*   { reverse_proxy 127.0.0.1:3000 }  # R3.4
    # Everything else → SPA.
    reverse_proxy 127.0.0.1:5173
}
```

`sudo systemctl reload caddy` — done. Let's Encrypt certs are auto-issued + renewed.

#### nginx + certbot (more conventional)

```nginx
server {
    listen 443 ssl http2;
    server_name dnd.example.com;

    ssl_certificate     /etc/letsencrypt/live/dnd.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dnd.example.com/privkey.pem;

    location /healthz { proxy_pass http://127.0.0.1:3000; }
    location /auth/   { proxy_pass http://127.0.0.1:3000; }
    location /sync/   { proxy_pass http://127.0.0.1:3000; }   # R3.4
    location /        { proxy_pass http://127.0.0.1:5173; }   # SPA

    proxy_set_header Host              $host;          # canonical host
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

server {
    listen 80;
    server_name dnd.example.com;
    return 301 https://$host$request_uri;
}
```

Issue certs with `sudo certbot --nginx -d dnd.example.com`.

### 6. Verify

1. Browse to `https://dnd.example.com` — the SPA loads.
2. `curl https://dnd.example.com/healthz` — returns `{"status":"ok","db":"ok",...}`.
3. `https://dnd.example.com/auth/discord/login` — redirects to Discord's consent screen. After approving, the redirect lands back on `/auth/discord/callback`; the server creates the `User` + `Account` + `Session` rows, sets the `__Host-auth-session-token` cookie, and 302's back to the SPA origin.
4. `psql "$DATABASE_URL" -c '\dt'` — confirms `User`, `Account`, `Session`, `ItemDefinition`, etc. are present.

### 7. Day 2 operations

- **Updates**: `git pull && docker compose up -d --build`. Migrations run on the server container's startup; brief downtime is acceptable for a private app.
- **Logs**: `docker compose logs -f server`. Auth.js never logs cookie values, the auth secret, or Discord credentials — but PII (display names, item names) does appear in some log lines.
- **Backups**: nightly `pg_dump` outside the container (host-level cron is fine):
  ```bash
  docker exec -t infra-docker-postgres-1 \
    pg_dump -U dnd dnd_inv > /var/backups/dnd-inv/dump-$(date +%F).sql
  ```
  Keep these somewhere off-box. SECURITY §8 covers retention + integrity expectations.
- **Rotating `AUTH_SECRET`**: set a new value in `.env` and restart the server. Every existing session cookie becomes invalid; users re-auth with Discord.
- **Rotating the Discord secret**: bump it in the Discord developer portal, update `DISCORD_CLIENT_SECRET` in `.env`, restart. Existing sessions keep working (Discord tokens aren't persisted; see SECURITY §1.1).
- **Wiping the install**: `docker compose down -v` drops the Postgres volume — fresh reseed on next boot.

### 8. Security posture quick reference

- Postgres is firewalled to `127.0.0.1` on the host; only the compose network reaches it.
- The server cookie is `HttpOnly`, `SameSite=Lax`, `Secure`, with the `__Host-` prefix in production (browser-enforced HTTPS).
- Discord tokens never reach the database (`access_token` / `refresh_token` / `id_token` are written as `NULL` by `apps/server/src/auth/adapter-overrides.ts`).
- Sliding 30-day session expiry; deleting a `Session` row instantly revokes that device.
- `NODE_ENV=production` makes the server **refuse to boot** without `AUTH_SECRET` + all three `DISCORD_*` vars + all five `SMTP_*` vars — no silent misconfig.
- See `docs/SECURITY.md` for the full threat model.

### Per-app deeper details

- Server-specific env vars + scripts: [`apps/server/README.md`](apps/server/README.md).
- Compose reference: [`infra/docker/docker-compose.yml`](infra/docker/docker-compose.yml).

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
