# D&D Inventory Manager

<p align="center">
  <img alt="Node" src="https://img.shields.io/badge/node-%E2%89%A5%2022-brightgreen">
  <img alt="pnpm" src="https://img.shields.io/badge/pnpm-11-orange">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-blue">
  <img alt="React" src="https://img.shields.io/badge/React-19-149ECA">
  <img alt="Fastify" src="https://img.shields.io/badge/Fastify-5-black">
  <img alt="Postgres" src="https://img.shields.io/badge/Postgres-18-336791">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-informational">
</p>

A **private-use** D&D 5e (2024) inventory manager. Local-first browser app with an optional self-hosted backend for multi-member parties, Discord / email login, authoritative sync, and live WebSocket broadcast.

> ⚠️ **Private use only.** No PHB / DMG content ships in this repo. Seed JSON lives outside git; see [`packages/seeds/data/examples/`](packages/seeds/data/examples/) for the file shape.

## Table of contents

- [Features](#features)
- [Status](#status)
- [Quick start](#quick-start)
- [Local vs server mode](#local-vs-server-mode)
- [Backup & restore](#backup--restore)
- [Self-hosted deployment](#self-hosted-deployment)
- [Repo layout](#repo-layout)
- [Docs](#docs)

## Features

| Feature             | Details                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| 🎒 **Stashes**      | Inventory, Storage, Party Stash, Recovered Loot — with containers (Bag of Holding etc.)        |
| 💰 **Currency**     | Per-stash CP/SP/EP/GP/PP holdings, integer-CP math, convert, transfer, split evenly, bulk edit |
| 🗡️ **Catalog**      | PHB mundane + DMG magic items, homebrew CRUD, fuzzy multi-field search                         |
| ✨ **Magic items**  | Charges + recharge, identification, attunement (with DM cap-override)                          |
| 🧙 **Multi-member** | DM / Player / Banker roles, invite codes, DM cross-character actions                           |
| 💾 **Backup**       | JSON export / import (round-trip lossless), server-side export                                 |
| 🌐 **Modes**        | Local-only IndexedDB **or** self-hosted server with Discord / email login                      |
| ⚡ **Live sync**    | WebSocket broadcast, optimistic writes, persisted outbox, auto-reconnect                       |
| 📜 **History**      | Party log timeline + per-item history, permission-gated                                        |
| 🎲 **DM tools**     | Loot distribution wizard, hoard generator, shop manager, batch identify                        |
| 🌓 **Theme**        | Light / dark / system                                                                          |

## Status

**MVP + R1–R6 shipped; R7 (polish) in progress.** Full history in [`docs/roadmap.md`](docs/roadmap.md).

| Milestone / Slice | Scope                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| **M0 – M7** ✅    | MVP: skeleton → character → catalog → storage → currency → move/split → homebrew → backup          |
| **R1** ✅         | Characters & encumbrance (equip, attune, containers, hard-mode enforcement)                        |
| **R2** ✅         | Magic items (DMG seed, charges, identification)                                                    |
| **R3** ✅         | Backend skeleton (Fastify + Postgres, Discord OAuth + email OTP, sync queue, snapshots)            |
| **R4** ✅         | Multi-member parties (join/leave/kick, Banker, DM cross-character actions, DM Dashboard)           |
| **R5** ✅         | Live sync (Socket.IO), reconnect + outbox, sessions UI, history timeline                           |
| **R6** ✅         | DM tools (economy, shops, hoard generator, loot wizard, identification, catalog search)            |
| **R7** 🚧         | Polish — theme + bulk currency edit + fuzzy stash search shipped; log-perf / vault-export deferred |
| **RH1 – RH5** ✅  | Hardening: server-authoritative IDs, determinism, `GameSession`, URL routing, Dexie hydration      |

## Quick start

**Requirements:** Node ≥ 22, pnpm 11.

```bash
pnpm install
pnpm --filter @app/web dev        # http://localhost:5173 — local mode
```

Common scripts:

```bash
pnpm --filter @app/web build      # production build
pnpm --filter @app/web test       # Vitest
pnpm --filter @app/web lint       # ESLint
pnpm typecheck                    # tsc --noEmit across workspace
pnpm format                       # Prettier write
```

## Local vs server mode

The web app has two build-time modes selected by `VITE_SERVER_URL`:

| Mode       | `VITE_SERVER_URL`   | Backend            | Auth chrome               | Live sync |
| ---------- | ------------------- | ------------------ | ------------------------- | --------- |
| **Local**  | unset / empty       | IndexedDB only     | hidden                    | —         |
| **Server** | `https://your-host` | Fastify + Postgres | Login / Settings / Logout | Socket.IO |

Vite **inlines** the value at build time — flipping modes means rebuilding the bundle, not restarting the container.

```bash
# Local (default)
pnpm --filter @app/web dev

# Server-mode dev (same-origin required — use Vite proxy or matching localhost)
VITE_SERVER_URL=http://localhost:3000 pnpm --filter @app/web dev

# Server-mode production build
VITE_SERVER_URL=https://dnd.example.com pnpm --filter @app/web build
```

In server mode the SPA + API **must share an origin** (`SameSite=Lax` cookie). See the [self-hosted deployment](#self-hosted-deployment) section for the reverse-proxy setup.

## Backup & restore

Local mode runs entirely in your browser. In **Settings**:

- **Export JSON** — versioned snapshot of your full party (character, stashes, items, currency, homebrew, transaction log).
- **Import JSON** — restore after a replace-all confirm. Round-trip is bit-for-bit lossless.

Server mode exposes the same envelope shape via `GET /sync/export?partyId=<id>`.

## Self-hosted deployment

Designed for a **single Linux box behind a reverse proxy** — no Kubernetes, no managed cloud.

### 1. Prerequisites

- Linux server with Docker + Docker Compose v2 (Proxmox LXC works — give it ≥ 2 GB RAM).
- Domain name pointed at the server.
- TLS via [Caddy](https://caddyserver.com/) (auto Let's Encrypt), [Traefik](https://traefik.io/), or `nginx + certbot`.
- **At least one login provider:**
  - Discord application ([developer portal](https://discord.com/developers/applications)) — see step 2.
  - SMTP relay for email OTP — Postmark / SES / Mailgun / SendGrid / self-hosted Postfix. Local test: [Mailpit](https://github.com/axllent/mailpit) or the `--profile mail` compose target.

The server boots successfully with **any combination** of the two — leave the unused env vars blank and the corresponding Login button is hidden.

<details>
<summary><b>2. Register a Discord application (optional)</b></summary>

Skip if you're deploying email-OTP-only.

1. [Discord developer portal](https://discord.com/developers/applications) → **New Application** → name it.
2. Under **OAuth2 → General**:
   - Copy **Client ID** → `DISCORD_CLIENT_ID`.
   - **Reset Secret** → copy → `DISCORD_CLIENT_SECRET`. Treat like a password.
   - Add **two Redirect URIs** (exact match, trailing slash matters):
     - `https://<your-domain>/auth/callback/discord` — primary. Sets `DISCORD_REDIRECT_URI`.
     - `https://<your-domain>/auth/callback/discord/link` — used by Settings → Linked accounts.

The app only requests scope `identify` (username + avatar). No email, no guilds.

</details>

### 3. Configure

```bash
git clone https://github.com/<you>/invManagement.git
cd invManagement/infra/docker
cp .env.example .env
$EDITOR .env
```

<details>
<summary><b>Environment variables</b></summary>

| Variable                                        | Purpose                                                                                                                |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`                             | Long random string. **Change from the default.**                                                                       |
| `AUTH_SECRET`                                   | `openssl rand -base64 32`. Rotating invalidates all sessions.                                                          |
| `WEB_ORIGIN`                                    | Public origin (e.g. `https://dnd.example.com`). Used for CORS + Auth.js + Socket.IO. **Must match `VITE_SERVER_URL`.** |
| `SESSION_COOKIE_INSECURE`                       | `false` in production (HTTPS). `true` only for local HTTP proxy profile.                                               |
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET`   | From step 2. Blank → Discord login disabled.                                                                           |
| `DISCORD_REDIRECT_URI`                          | `https://<your-domain>/auth/callback/discord` (must match Discord portal).                                             |
| `SMTP_HOST` / `PORT` / `USER` / `PASS` / `FROM` | Blank → email OTP disabled.                                                                                            |
| `SERVER_PORT` / `WEB_PORT` / `POSTGRES_PORT`    | Internal ports. Keep firewalled.                                                                                       |
| `VITE_SERVER_URL`                               | **Build-time.** Public origin, or blank for a local-only bundle. Change requires `docker compose up -d --build web`.   |

</details>

### 4. Bring up the stack

```bash
cd infra/docker
docker compose up -d --build
docker compose logs -f server        # watch seed runner + Fastify boot
```

The server container runs `prisma migrate deploy` (idempotent) then seeds PHB + DMG catalog content. Smoke-check:

```bash
curl http://127.0.0.1:${SERVER_PORT:-3000}/healthz
# → {"status":"ok","db":"ok","seedVersion":3}
```

> ⚠️ **`VITE_SERVER_URL` is baked into the JS bundle.** Changing it later requires `--build`; a bare `docker compose up -d` will keep serving the old bundle.

### 5. Reverse proxy + TLS

Fastify binds inside the container only. The proxy must route these paths to the **server**, everything else to the **web** container:

| Path                     | Purpose                                                  |
| ------------------------ | -------------------------------------------------------- |
| `/healthz`               | liveness probe                                           |
| `/auth/*`                | Auth.js + email OTP                                      |
| `/sync/*`                | authoritative sync (state, actions, export)              |
| `/parties`, `/parties/*` | join / leave / kick / invite / members                   |
| `/socket.io/*`           | **WebSocket transport** (Engine.IO polling + WS upgrade) |

> ⚠️ **Common gotchas:**
>
> - Missing `/socket.io/*` route → client emits `connect_error: server error` every reconnect tick.
> - `vite preview` rejects reverse-proxied requests by default. Set `VITE_ALLOWED_HOSTS=<domain>` (or `*` behind a trusted proxy).
> - Auth.js v5 needs the canonical `Host` header. Don't forward `X-Forwarded-Host` blindly.
> - SPA + API **must share an origin** so the `SameSite=Lax` session cookie is sent on every fetch.

<details>
<summary><b>Caddy (easiest — auto-TLS)</b></summary>

`/etc/caddy/Caddyfile`:

```caddyfile
dnd.example.com {
    encode gzip

    @server {
        path /healthz /healthz/* /auth/* /sync/* /parties /parties/* /socket.io /socket.io/*
    }
    handle @server {
        reverse_proxy 127.0.0.1:3000
    }

    handle {
        reverse_proxy 127.0.0.1:5173
    }
}
```

`sudo systemctl reload caddy` — done. Let's Encrypt certs auto-issued + renewed. `reverse_proxy` auto-upgrades WebSockets.

</details>

<details>
<summary><b>nginx + certbot</b></summary>

nginx doesn't auto-rewrite the `Upgrade` / `Connection` headers required for WebSocket. Add the `map` block:

```nginx
# In the http { } block:
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl http2;
    server_name dnd.example.com;

    ssl_certificate     /etc/letsencrypt/live/dnd.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dnd.example.com/privkey.pem;

    proxy_http_version 1.1;
    proxy_set_header Upgrade    $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    location /healthz    { proxy_pass http://127.0.0.1:3000; }
    location /auth/      { proxy_pass http://127.0.0.1:3000; }
    location /sync/      { proxy_pass http://127.0.0.1:3000; }
    location /parties/   { proxy_pass http://127.0.0.1:3000; }
    location = /parties  { proxy_pass http://127.0.0.1:3000; }
    location /socket.io/ { proxy_pass http://127.0.0.1:3000; }
    location /           { proxy_pass http://127.0.0.1:5173; }
}

server {
    listen 80;
    server_name dnd.example.com;
    return 301 https://$host$request_uri;
}
```

Issue certs: `sudo certbot --nginx -d dnd.example.com`.

</details>

<details>
<summary><b>Traefik (Docker labels)</b></summary>

Add labels to `server` + `web` in `infra/docker/docker-compose.yml` (or a compose override):

```yaml
services:
  server:
    labels:
      - 'traefik.enable=true'
      - 'traefik.http.routers.dnd-server.rule=Host(`dnd.example.com`) && (Path(`/healthz`) || PathPrefix(`/auth`) || PathPrefix(`/sync`) || Path(`/parties`) || PathPrefix(`/parties/`) || PathPrefix(`/socket.io`))'
      - 'traefik.http.routers.dnd-server.entrypoints=websecure'
      - 'traefik.http.routers.dnd-server.tls=true'
      - 'traefik.http.routers.dnd-server.tls.certresolver=dnd'
      - 'traefik.http.services.dnd-server.loadbalancer.server.port=3000'

  web:
    labels:
      - 'traefik.enable=true'
      - 'traefik.http.routers.dnd-web.rule=Host(`dnd.example.com`)'
      - 'traefik.http.routers.dnd-web.priority=1'
      - 'traefik.http.routers.dnd-web.entrypoints=websecure'
      - 'traefik.http.routers.dnd-web.tls=true'
      - 'traefik.http.routers.dnd-web.tls.certresolver=dnd'
      - 'traefik.http.services.dnd-web.loadbalancer.server.port=5173'
```

Traefik auto-detects `Upgrade: websocket` — no extra config for `/socket.io`. Ensure your Traefik network is shared with the compose services.

</details>

<details>
<summary><b>Local Docker Desktop testing (proxy profile)</b></summary>

For local same-origin testing without a real host proxy:

```bash
cd infra/docker
# In .env:
#   VITE_SERVER_URL=http://localhost:8080
#   WEB_ORIGIN=http://localhost:8080
#   SESSION_COOKIE_INSECURE=true    # local HTTP — opt out of __Host- / Secure
docker compose --profile proxy up -d --build
# Browse to http://localhost:8080
```

`docker compose up` without the flag leaves the internal Caddy container out — that's what production behind a real host proxy does.

</details>

**Verify WebSocket end-to-end:**

```bash
curl -s "https://dnd.example.com/socket.io/?EIO=4&transport=polling" | head -c 200
# → 0{"sid":"...","upgrades":["websocket"],"pingInterval":25000,...}
```

### 6. Verify

1. Browse to `https://dnd.example.com` — SPA loads.
2. `curl https://dnd.example.com/healthz` — `{"status":"ok","db":"ok",...}`.
3. `https://dnd.example.com/auth/discord/login` — Discord consent screen (if configured).
4. Log in via SPA → DevTools → Network → WS: live `wss://.../socket.io/?...` connection carrying `applied` events on every mutation.

<details>
<summary><b>Day-2 operations</b></summary>

- **Updates:** `git pull && docker compose up -d --build`. Migrations run on server boot.
- **Logs:** `docker compose logs -f server`. OTP values are scrubbed; PII (names) is not.
- **Backups:** nightly `pg_dump` from host cron:
  ```bash
  docker exec -t infra-docker-postgres-1 \
    pg_dump -U dnd dnd_inv > /var/backups/dnd-inv/dump-$(date +%F).sql
  ```
  Server also writes nightly `AppState` snapshots to `SNAPSHOT_DIR` if `SNAPSHOTS_ENABLED=true`.
- **Rotate `AUTH_SECRET`:** set new value + restart. All sessions invalidated.
- **Rotate Discord secret:** update portal + `DISCORD_CLIENT_SECRET` + restart. Existing sessions keep working.
- **Wipe install:** `docker compose down -v` drops the Postgres volume.
- **Player stuck offline:** R5.1's outbox buffers writes for solo parties indefinitely; multi-member parties see an offline banner and disabled Save buttons until reconnect.

</details>

<details>
<summary><b>Security posture</b></summary>

- Postgres firewalled to `127.0.0.1`; only the compose network reaches it.
- Session cookie: `HttpOnly`, `SameSite=Lax`, `Secure`, `__Host-` prefix in production.
- WebSocket upgrades reuse the session cookie via `io.use()`. Rooms are named server-side from `PartyMembership` — clients never name their own.
- Discord tokens never persisted (`access_token`, `refresh_token`, `id_token` all `NULL`).
- Sliding 30-day session expiry; deleting a `Session` row instantly revokes that device.
- `NODE_ENV=production` refuses to boot without `AUTH_SECRET`.
- See [`docs/SECURITY.md`](docs/SECURITY.md) for the full threat model.

</details>

## Repo layout

```
apps/web              React SPA (Vite)
apps/server           Fastify API + Socket.IO realtime
packages/shared       Cross-cutting Zod schemas + types
packages/rules        Pure rules engine (currency, capacity, search, …)
packages/seeds        PHB / DMG content loader
infra/docker          Compose + Caddy proxy profile
e2e/                  Docker-native Playwright end-to-end suite
docs/                 OUTLINE / MVP / TECH_STACK / SECURITY / roadmap
```

## Docs

| File                                                                 | Purpose                                 |
| -------------------------------------------------------------------- | --------------------------------------- |
| [`docs/OUTLINE.md`](docs/OUTLINE.md)                                 | Full product scope + data model         |
| [`docs/MVP.md`](docs/MVP.md)                                         | MVP cut (strict subset of OUTLINE)      |
| [`docs/TECH_STACK.md`](docs/TECH_STACK.md)                           | Technology choices + rationale          |
| [`docs/SECURITY.md`](docs/SECURITY.md)                               | Threat model + mitigations              |
| [`docs/roadmap.md`](docs/roadmap.md)                                 | Slice-by-slice history + upcoming plans |
| [`docs/BUGS.md`](docs/BUGS.md)                                       | Open + recently-fixed bugs              |
| [`apps/server/README.md`](apps/server/README.md)                     | Server env vars + scripts               |
| [`e2e/README.md`](e2e/README.md)                                     | End-to-end (Playwright) suite           |
| [`infra/docker/docker-compose.yml`](infra/docker/docker-compose.yml) | Compose reference                       |
