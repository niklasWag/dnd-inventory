# D&D Inventory Manager

A **private-use** D&D 5e (2024) inventory manager. Local-first browser app with an optional self-hosted backend (Discord OAuth / email OTP, authoritative sync, live party broadcast).

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

**R1 — Characters & encumbrance** ✅ (encumbrance rules, equip/attune, containers, hard-mode enforcement, packing UI)

**R2 — Magic items** ✅ (DMG seed, charges/recharge, identification)

**R3 — Backend skeleton** ✅ (self-hosted Fastify + Postgres, Discord OAuth + email OTP, authoritative sync queue, nightly snapshots, web integration)

**R4 — Multi-member parties** ✅ (join/leave/kick, Banker role, DM cross-character actions, cross-character currency, DM Dashboard)

**RH chain — Hardening passes** ✅ (RH1–RH5, all shipped)

- **RH0** — Legacy-data scaffolding strip (Zod `.strict()`, MVP-placeholder cleanup)
- **RH1** — Server-authoritative IDs (client mints UUID v7; server validates)
- **RH2** — Determinism + invariants (server-authoritative `timestamp`, shared actorRole derivation, DB uniqueness/CHECK constraints, action-metadata registry)
- **RH3** — `GameSession` entity + sync-schema readiness (per-party session numbering, `TransactionLog.sessionId`, start/end session actions)
- **RH4** — URL-scoped routing (`/party/:partyId/*` is authoritative for the active party; `PartyScopeSync` reconciles URL ↔ state)
- **RH5** — Dexie hydration hardening (single-path loader, null-state not persisted, corruption UX with Settings "Wipe corrupted party data")

**R5.1 — Live sync + reconnect** ✅ (post-RH-chain, per `docs/OUTLINE.md` §10 M5)

- **R5.1.a** — Socket.IO party-room broadcast. Server attaches Socket.IO to Fastify's HTTP server; `io.use()` middleware reuses the session cookie via `getSession()`, rejects unauthenticated upgrades, auto-joins the connecting user to `party:<partyId>` for every active `PartyMembership`. `POST /sync/actions` emits an `applied` broadcast to the party room after each transaction commits (fire-and-forget, filtered by the shared `getActionMetadata(type).broadcastOnApplied` flag).
- **R5.1.b** — Client socket consumer + inbound reconciliation. `sync/socket.ts` connects `socket.io-client` on server-mode boot; `applyBroadcast()` Zod-parses the broadcast, dedupes by log-entry id, re-runs the reducer against the source `action` for state mutation, and appends the server's `applied[]` verbatim via `appendServerLogEntries()` (RH2.6 log-authority pattern).
- **R5.1.c** — Persisted outbox + bounded retry + reconnect state re-pull. Failed batches persist to a new Dexie `outbox` table (schema v2); the queue retries with exponential backoff (500ms → 8s, ±25% jitter, 5 attempts) and parks the row for next reconnect after that. On `socket.on('connect')`, `drainOutbox()` re-hydrates state via `GET /sync/state?partyId=` and flushes any buffered writes via `POST /sync/actions`.
- **R5.1.d** — Offline write-block + auto-resume. Store guard `dispatch()` short-circuits + toasts when `(isServerMode && !online && memberCount >= 2)` — matches OUTLINE §9. Solo parties (memberCount === 1) stay writable and buffer to the outbox. `useCanDispatch()` reactive hook exposes the same predicate for UI affordance. Auto-resume via the R5.1.c reconnect drain.

**Coming next (unblocked by R5.1):**

- **R5.2** — Session-tools UI on top of RH3's `GameSession` model (Start/End buttons, current-session indicator, session list, distribute-loot session-tagging wizard).
- **R5.3** — History timeline + filters (session, character, item, action-type, actorRole; per-item history with the OUTLINE §3.4 amendment permission rule).

See `docs/roadmap.md` for the full slice history + upcoming plans.

## Local-only vs server modes

The web app has two operating modes, selected at **build time** via `VITE_SERVER_URL`:

- **Local mode** (`VITE_SERVER_URL` unset / empty) — Dexie/IndexedDB is the only backend, no login, no logout, no account chrome. The Hub still appears as the front door but auth-related surfaces (Login, Join party) are hidden. Multiple local-mode parties are supported per browser profile (each keyed under `appState:<partyId>` in IndexedDB).
- **Server mode** (`VITE_SERVER_URL=https://...`) — the web app pulls `AppState` from the server, pushes mutations through the sync queue (optimistic dispatch with 422 rollback, network-error retry with persisted outbox), and surfaces Login / Settings → Account / Linked accounts / Logout. Live changes from other party members arrive via WebSocket (R5.1).

### Building each mode

The value is **inlined into the JavaScript bundle** by Vite at build time — flipping modes means rebuilding the bundle, not restarting the container.

**Local-only build (default):**

```bash
# Local development
pnpm --filter @app/web dev          # vite dev server, local mode

# Local production build
pnpm --filter @app/web build        # outputs apps/web/dist (local mode)

# Docker compose (compose up builds the web image with no VITE_SERVER_URL)
cd infra/docker && docker compose up --build
```

**Server-mode build:**

```bash
# Local development pointing at a same-origin server (Vite dev proxy
# preferred; or run server + web on the same host:port via reverse proxy).
VITE_SERVER_URL=http://localhost:3000 pnpm --filter @app/web dev

# Local production build for a self-hosted deployment
VITE_SERVER_URL=https://dnd.example.com pnpm --filter @app/web build

# Docker compose: set VITE_SERVER_URL in infra/docker/.env, then rebuild
# the web image. A plain `docker compose up` will keep serving the
# previous bundle — you MUST pass --build.
cd infra/docker && docker compose up -d --build web
```

In server mode the web↔server origin must match (`SameSite=Lax` cookie). In production this is handled by the reverse proxy (per `docs/TECH_STACK.md` §7.1); in development, run web on the same origin as the server (Vite proxy or matching `localhost:<port>`).

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

The local-mode build runs entirely in your browser. Settings → **Export JSON** downloads a versioned snapshot of your full state (character, stashes, items, currency, homebrew, transaction log). Settings → **Import JSON** restores any prior export after a replace-all confirm. Round-trip is bit-for-bit lossless — exports drop into a fresh browser and pick up exactly where you left off.

Server-mode users can also `GET /sync/export?partyId=<id>` for a server-side export in the same envelope shape (R3.4.b).

## Hosting (self-hosted deployment)

This app is designed to run on **a single Linux box behind a reverse proxy** — no Kubernetes, no managed cloud needed. Below is the end-to-end path.

### 1. Prerequisites

- A Linux server (Debian / Ubuntu / Alpine — anything that runs Docker). Proxmox LXC containers work fine; give the container ≥ 2 GB RAM.
- Docker + Docker Compose v2.
- A domain name pointed at the server (`dnd.example.com` in the examples below).
- TLS certificates — easiest via [Caddy](https://caddyserver.com/) (auto-issues Let's Encrypt) or [nginx + certbot](https://certbot.eff.org/).
- **At least one login provider.** The server boots successfully with any combination of Discord OAuth, email OTP, or both (leave the unused set of env vars blank; the corresponding Login button is hidden). Options:
  - A Discord application registered at [https://discord.com/developers/applications](https://discord.com/developers/applications) — see step 2.
  - An SMTP relay for email-OTP login (R3.3): [Postmark](https://postmarkapp.com/), [AWS SES](https://aws.amazon.com/ses/), [Mailgun](https://www.mailgun.com/), [SendGrid](https://sendgrid.com/), or self-hosted Postfix. For local testing: [Mailpit](https://github.com/axllent/mailpit) via `docker run -p 1025:1025 -p 8025:8025 axllent/mailpit` (or the `--profile mail` compose target, which spins up the same image inside the compose network).

### 2. Register a Discord application (optional)

Skip this step if you're deploying email-OTP-only.

1. Visit [https://discord.com/developers/applications](https://discord.com/developers/applications) → **New Application** → give it a name (e.g. "DnD Inventory — Friends").
2. Under **OAuth2** → **General**:
   - Copy the **Client ID** → you'll set `DISCORD_CLIENT_ID`.
   - **Reset Secret** → copy the **Client Secret** → `DISCORD_CLIENT_SECRET`. (Treat it like a password; it never reaches the browser.)
   - Add **two Redirect URIs** (both must match exactly — trailing slash and protocol matter):
     - `https://<your-domain>/auth/callback/discord` — primary login. Also the value of `DISCORD_REDIRECT_URI`.
     - `https://<your-domain>/auth/callback/discord/link` — used by Settings → Linked accounts → Connect Discord (R3.5).
   - The paths follow Auth.js's `${basePath}/callback/${provider}` convention — the framework hardcodes that shape, so the URIs you register must match.
3. The app only requests scope `identify` — Discord shows users a minimal consent screen (username + avatar; no email, no guilds).

### 3. Clone + configure

```bash
git clone https://github.com/<you>/invManagement.git
cd invManagement/infra/docker
cp .env.example .env
$EDITOR .env   # fill in the values below
```

Set these in `infra/docker/.env`:

| Variable                  | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`       | Long random string. **Change from the default `dnd`.**                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `AUTH_SECRET`             | Output of `openssl rand -base64 32`. Rotating this signs everyone out (in-flight cookies become unverifiable).                                                                                                                                                                                                                                                                                                                                                                                    |
| `WEB_ORIGIN`              | The public origin the SPA is served from (e.g. `https://dnd.example.com`). Used for CORS allow-origin, Auth.js redirect whitelist, and Socket.IO CORS. **Must match `VITE_SERVER_URL`** — the SPA + API share an origin in production (see step 5).                                                                                                                                                                                                                                               |
| `SESSION_COOKIE_INSECURE` | `false` (default — HTTPS deployments) or `true` (self-hosted HTTP-only deployments such as the docker-compose `proxy` profile on `http://localhost:8080`). When `false` the session cookie is named `__Host-auth-session-token` and carries `Secure`, which the browser refuses to store on a plain HTTP origin. NEVER set this to `true` in real production behind HTTPS.                                                                                                                        |
| `DISCORD_CLIENT_ID`       | From step 2. **Optional**: leave blank to disable Discord login. The `/auth/discord/*` routes return 503 and the web Login screen hides the Discord button. The server logs a startup warning listing missing vars but boots successfully — email-only deployments are first-class.                                                                                                                                                                                                               |
| `DISCORD_CLIENT_SECRET`   | From step 2. Same optional/missing rules as `DISCORD_CLIENT_ID`.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `DISCORD_REDIRECT_URI`    | `https://<your-domain>/auth/callback/discord` — must match the primary Redirect URI registered in the Discord developer portal exactly. The link-flow callback (`/auth/callback/discord/link`) is derived from this at runtime.                                                                                                                                                                                                                                                                   |
| `SMTP_HOST`               | SMTP submission host (e.g. `smtp.postmarkapp.com`). **Optional**: leave blank to disable email OTP. Same startup-warning behavior as the Discord vars.                                                                                                                                                                                                                                                                                                                                            |
| `SMTP_PORT`               | `587` for STARTTLS, `465` for implicit TLS.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `SMTP_USER` / `SMTP_PASS` | SMTP auth credentials (often API-key id + secret).                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `SMTP_FROM`               | From-address on outgoing OTP mail. Must be a domain your relay is authorized to send for.                                                                                                                                                                                                                                                                                                                                                                                                         |
| `SERVER_PORT`             | Internal port the Fastify server listens on (default `3000`). Keep firewalled; only the proxy reaches it.                                                                                                                                                                                                                                                                                                                                                                                         |
| `WEB_PORT`                | Internal port for the web container (default `5173`). Same firewalling note.                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `POSTGRES_PORT`           | Host-side Postgres port (default `5433`). Bind to `127.0.0.1` only; never expose Postgres publicly.                                                                                                                                                                                                                                                                                                                                                                                               |
| `VITE_SERVER_URL`         | **Build-time** flag for the web bundle. **Required for production server-mode deployments** — set to the public origin (e.g. `https://dnd.example.com`). Leaving it blank produces a local-only bundle with NO login UI. The value is inlined into the JS bundle by Vite, so any change requires `docker compose up -d --build web` (a bare restart keeps the old build). For auth + WebSocket sync to work, this MUST be **same-origin** as the server (handled by the reverse proxy in step 5). |

### 4. Bring up the stack

```bash
cd infra/docker
docker compose up -d --build
docker compose logs -f server  # watch the seed runner + Fastify boot
```

What this does:

1. Postgres starts and waits for healthcheck.
2. Server container runs `prisma migrate deploy` (idempotent) then the boot-time PHB+DMG seed runner.
3. Server begins listening on `0.0.0.0:${SERVER_PORT}` **inside the container** — expose to the world via step 5.
4. Web container builds with the `VITE_SERVER_URL` you set in `.env`, then serves the SPA via `vite preview`.

**Important about the web build:** if you initially brought the stack up with an empty `VITE_SERVER_URL` (the default — a local-only bundle), then later set the value and `docker compose up -d` without `--build`, the old bundle keeps serving. Always pass `--build` (or run `docker compose build web` separately) after changing `VITE_SERVER_URL`.

Smoke-check from the host:

```bash
curl http://127.0.0.1:${SERVER_PORT:-3000}/healthz
# → {"status":"ok","db":"ok","seedVersion":3}
```

### 5. Reverse proxy + TLS

The Fastify server binds inside the container only; it expects a reverse proxy to terminate TLS and forward HTTPS traffic. The proxy MUST route **five categories of path** to the server; anything else falls through to the SPA:

| Path           | Purpose                                                                              |
| -------------- | ------------------------------------------------------------------------------------ |
| `/healthz`     | liveness probe (R3.1)                                                                |
| `/auth/*`      | Auth.js + email OTP (R3.2 / R3.3)                                                    |
| `/sync/*`      | authoritative sync (`GET /sync/state`, `POST /sync/actions`, `GET /sync/export`, ..) |
| `/parties`     | `POST /parties/join` (R4.1.e)                                                        |
| `/parties/*`   | `/leave`, `/kick`, `/invite/rotate`, `GET /:partyId/members` (R4.1.e)                |
| `/socket.io/*` | **R5.1 WebSocket transport** — Engine.IO polling + WS upgrade                        |

**R5.1 gotcha:** if `/socket.io/*` is missing from the proxy config, the client's polling handshake falls through to the SPA reverse-proxy, returns `index.html`, and the client emits `[socket] connect_error: server error` every reconnect tick. Both examples below include this path.

**Trust-host requirement** (Auth.js v5): the proxy must pass the canonical `Host` header so Auth.js can build correct callback URLs. Don't blindly forward `X-Forwarded-Host` from clients — that's a Host-header injection vector. The examples below are safe.

#### Same-origin requirement (why a proxy is mandatory for server mode)

`SameSite=Lax` session cookies (per SECURITY §1.1) are **not** sent on cross-origin `fetch` requests. If the SPA is loaded from `http://localhost:5173` and the API lives at `http://localhost:3000`, the browser will silently drop the session cookie on every API call — the user appears logged out the moment they navigate to a protected screen even though Discord OAuth succeeded.

Fix: the SPA and the API must share an origin. Either:

- **In prod** — reverse-proxy the paths in the table above to the server container and everything else to the web container. Sections below show the exact configs.
- **For local Docker Desktop testing** — bring the stack up with `--profile proxy` so compose spins up an internal Caddy on `${PROXY_PORT:-8080}` that routes the same way:

  ```bash
  cd infra/docker
  # In .env, point both VITE_SERVER_URL and WEB_ORIGIN at the proxy:
  #   VITE_SERVER_URL=http://localhost:8080
  #   WEB_ORIGIN=http://localhost:8080
  #   SESSION_COOKIE_INSECURE=true   # local HTTP; opt out of __Host- / Secure
  # Then rebuild + bring up with the proxy profile:
  docker compose --profile proxy up -d --build
  # Browse to http://localhost:8080 — same origin for SPA + API + WebSocket.
  ```

  `docker compose up` (without the flag) leaves the Caddy container out — that's what production deployments behind a real host nginx do.

#### Caddy (easiest — auto-TLS)

`/etc/caddy/Caddyfile`:

```caddyfile
dnd.example.com {
    encode gzip

    # Server-owned paths. Caddy's `reverse_proxy` auto-upgrades
    # WebSockets, so `/socket.io/*` needs no extra directive.
    @server {
        path /healthz /healthz/* /auth/* /sync/* /parties /parties/* /socket.io /socket.io/*
    }
    handle @server {
        reverse_proxy 127.0.0.1:3000
    }

    # Everything else → SPA (SPA fallback for client-side routing).
    handle {
        reverse_proxy 127.0.0.1:5173
    }
}
```

`sudo systemctl reload caddy` — done. Let's Encrypt certs are auto-issued + renewed.

#### nginx + certbot (more conventional)

Nginx doesn't auto-rewrite the `Upgrade` / `Connection` headers required for the polling → WebSocket transport upgrade. Add the `map` block and the two `proxy_set_header` directives shown below.

```nginx
# In the top-level http { ... } block (usually /etc/nginx/nginx.conf).
# Maps the incoming Upgrade header onto Connection: upgrade, or falls
# back to Connection: close. Required for /socket.io/* to complete
# its transport upgrade.
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl http2;
    server_name dnd.example.com;

    ssl_certificate     /etc/letsencrypt/live/dnd.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dnd.example.com/privkey.pem;

    # WebSocket support — enable on all upstream calls so /socket.io/*
    # upgrades correctly. Harmless on non-upgrade requests.
    proxy_http_version 1.1;
    proxy_set_header Upgrade    $http_upgrade;
    proxy_set_header Connection $connection_upgrade;

    proxy_set_header Host              $host;          # canonical host (Auth.js trust-host)
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Server-owned paths.
    location /healthz    { proxy_pass http://127.0.0.1:3000; }
    location /auth/      { proxy_pass http://127.0.0.1:3000; }
    location /sync/      { proxy_pass http://127.0.0.1:3000; }   # R3.4
    location /parties/   { proxy_pass http://127.0.0.1:3000; }   # R4.1.e
    location = /parties  { proxy_pass http://127.0.0.1:3000; }   # R4.1.e (POST /parties/join)
    location /socket.io/ { proxy_pass http://127.0.0.1:3000; }   # R5.1 WebSocket

    # SPA fallback — everything else served from the web container.
    location / { proxy_pass http://127.0.0.1:5173; }
}

server {
    listen 80;
    server_name dnd.example.com;
    return 301 https://$host$request_uri;
}
```

Issue certs with `sudo certbot --nginx -d dnd.example.com`.

**Verifying WebSocket end-to-end:**

```bash
# Polling handshake (initial transport). A missing /socket.io/ route
# returns the SPA's index.html instead of Engine.IO's session JSON.
curl -s "https://dnd.example.com/socket.io/?EIO=4&transport=polling" | head -c 200
# → 0{"sid":"...","upgrades":["websocket"],"pingInterval":25000,...}
```

### 6. Verify

1. Browse to `https://dnd.example.com` — the SPA loads.
2. `curl https://dnd.example.com/healthz` — returns `{"status":"ok","db":"ok",...}`.
3. `https://dnd.example.com/auth/discord/login` — redirects to Discord's consent screen (if Discord is configured). After approving, the redirect lands back on `/auth/callback/discord`; the server creates the `User` + `Account` + `Session` rows, sets the session cookie, and 302's back to the SPA origin.
4. Log in via the SPA, open DevTools → Network → WS. On any party-scoped route you should see a live `wss://dnd.example.com/socket.io/?...` connection carrying `applied` events after any mutation.
5. `psql "$DATABASE_URL" -c '\dt'` — confirms `User`, `Account`, `Session`, `Party`, `PartyMembership`, `Character`, `Stash`, `ItemDefinition`, `ItemInstance`, `CurrencyHolding`, `TransactionLog`, `GameSession` etc. are present.

### 7. Day 2 operations

- **Updates**: `git pull && docker compose up -d --build`. Migrations run on the server container's startup; brief downtime is acceptable for a private app.
- **Logs**: `docker compose logs -f server`. Auth.js never logs cookie values, the auth secret, or Discord credentials — but PII (display names, item names) does appear in some log lines. OTP values are redacted (`req.body.otp` scrubbed by Pino).
- **Backups**: nightly `pg_dump` outside the container (host-level cron is fine):
  ```bash
  docker exec -t infra-docker-postgres-1 \
    pg_dump -U dnd dnd_inv > /var/backups/dnd-inv/dump-$(date +%F).sql
  ```
  Keep these somewhere off-box. The server also writes structured `AppState` snapshots to `SNAPSHOT_DIR` nightly (R3.4.b) if `SNAPSHOTS_ENABLED=true` — see `apps/server/README.md`. SECURITY §8 covers retention + integrity expectations.
- **Rotating `AUTH_SECRET`**: set a new value in `.env` and restart the server. Every existing session cookie becomes invalid; users re-auth.
- **Rotating the Discord secret**: bump it in the Discord developer portal, update `DISCORD_CLIENT_SECRET` in `.env`, restart. Existing sessions keep working (Discord tokens aren't persisted; see SECURITY §1.1).
- **Wiping the install**: `docker compose down -v` drops the Postgres volume — fresh reseed on next boot.
- **When a player is stuck offline**: R5.1's outbox buffers optimistic writes for solo parties indefinitely; multi-member parties see a banner ("Offline — changes are disabled until you reconnect") and Save buttons disable. On reconnect the socket auto-attaches, `drainOutbox()` re-pulls state via `GET /sync/state` and flushes any buffered actions in FIFO order.

### 8. Security posture quick reference

- Postgres is firewalled to `127.0.0.1` on the host; only the compose network reaches it.
- The server cookie is `HttpOnly`, `SameSite=Lax`, `Secure`, with the `__Host-` prefix in production (browser-enforced HTTPS).
- WebSocket upgrades reuse the same session cookie via `io.use()` middleware. Unauthenticated + `needsDisplayName` upgrades are rejected. Rooms are named `party:<partyId>` and clients NEVER name their own — the server auto-joins from active `PartyMembership` on connect (per SECURITY §6).
- Discord tokens never reach the database (`access_token` / `refresh_token` / `id_token` are written as `NULL` by `apps/server/src/auth/adapter-overrides.ts`).
- Sliding 30-day session expiry; deleting a `Session` row instantly revokes that device.
- `NODE_ENV=production` makes the server **refuse to boot** without `AUTH_SECRET`. The `DISCORD_*` triple and `SMTP_*` quintuple are individually optional: missing or empty values disable the corresponding login method (the routes return 503 and the web Login button is hidden) and the server logs a startup warning. The `__Host-` + `Secure` cookie pair is on by default in production; opt out with `SESSION_COOKIE_INSECURE=true` only for HTTP-only self-hosted stacks (docker-compose proxy profile). See `docs/SECURITY.md` §1.1 / §1.2.
- See `docs/SECURITY.md` for the full threat model.

### Per-app deeper details

- Server-specific env vars + scripts: [`apps/server/README.md`](apps/server/README.md).
- Compose reference: [`infra/docker/docker-compose.yml`](infra/docker/docker-compose.yml).

## Repo layout

```
apps/web                React SPA (Vite)
apps/server             Fastify API + Socket.IO realtime (R3+, R5.1+)
packages/shared         Cross-cutting Zod schemas + types
packages/rules          Pure rules engine
packages/seeds          PHB / DMG content loader
infra/docker            Compose + Caddy proxy profile
docs/                   OUTLINE.md, MVP.md, TECH_STACK.md, SECURITY.md, roadmap.md
```
