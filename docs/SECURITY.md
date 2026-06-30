# Security Concerns & Mitigations

Derived from `OUTLINE.md`. Section references (§) point into that document.

This app is **private-use only** (§1 Non-Goals: not a public SaaS). The threat model is *trusted users, untrusted network*, not *untrusted users at scale*. Mitigations are scaled accordingly.

The two deployment modes have very different attack surfaces:

- **Local mode (M0–M2)**: single browser, no network, no auth, IndexedDB only.
- **Self-hosted mode (M3+)**: Linux server, Discord OAuth, multi-user parties, WebSocket sync.

Where a concern applies to only one mode, it is labeled.

---

## 1. Authentication & Sessions (self-hosted, M3+)

### 1.1 Discord OAuth2

Per §9: authorization code flow with PKCE, scope `identify`, session cookies after token exchange.

| Concern | Notes |
|---|---|
| **Token interception on redirect** | Without PKCE, an attacker intercepting the `code` could exchange it for tokens. |
| **CSRF on the OAuth callback** | Without a `state` parameter, an attacker could trick a logged-in user into linking the attacker's Discord identity. |
| **`access_token` exposure in URLs / logs / browser history** | Tokens in query strings leak through referrers, access logs, and history. |
| **Over-broad scope** | Requesting more than `identify` (e.g., `guilds`, `email`) collects data the app doesn't need. |
| **Discord outage** | If Discord is unreachable, all logins fail. |

**Mitigations:**
- PKCE on every OAuth flow (S256 code challenge) — required by §9.
- `state` parameter bound to the user's pre-auth session; reject mismatched callbacks.
- Code exchange happens **server-side only**. The browser never sees the `access_token` or `refresh_token`.
- Discord tokens are not persisted in the DB — only `discordId`, `displayName`, `avatarUrl` per §4 `User`.
- Session cookies: `HttpOnly`, `Secure`, `SameSite=Lax`, signed with a server-only key. In production the cookie name carries the `__Host-` prefix, which the browser enforces as Path=/, no Domain attribute, and `Secure` required — stricter than any flag the server could set itself. The `Secure` + `__Host-` pair can be opted out of via `SESSION_COOKIE_INSECURE=true` for self-hosted deployments served over plain HTTP (e.g. the docker compose `proxy` profile on `http://localhost:8080`); real HTTPS deployments MUST leave this off. The opt-out is single-use: it only drops the `__Host-` prefix and the `Secure` flag, never the `HttpOnly` / `SameSite=Lax` pair.
- Sliding session expiry: **30 days idle** with refresh-on-activity. Tuned for private campaigns that often go 2–4 weeks between sessions; 7-day expiry would force re-auth every campaign night. On expiry, re-auth with Discord.
- **Discord misconfiguration guard:** at server startup, if `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / `DISCORD_REDIRECT_URI` are absent or any value is the empty string, Discord auth is **disabled entirely** — the `/auth/discord/*` routes return `503 discord_auth_disabled`, the web's `GET /auth/methods` probe reports `discord: false`, and the Login screen hides the button. In production the server logs a startup warning listing the missing vars but continues to boot (so email-only deployments are first-class). Mirrors the SMTP guard in §1.2.
- **Outage policy:** existing valid session cookies remain accepted without contacting Discord; only new logins fail during an outage. Users with a verified backup email (§1.2) can log in via email OTP while Discord is down. Document this in admin settings.

### 1.2 Email OTP (passwordless fallback / standalone)

Per §3.1: 8-digit one-time code delivered over email. Used as a fallback for Discord users and as the sole login method for non-Discord users.

| Concern | Notes |
|---|---|
| **OTP brute-force** | 8 digits = 100 million combinations, but repeated guessing against a live endpoint is feasible without rate limiting. |
| **OTP interception in transit** | Code delivered over email; email is not end-to-end encrypted in general. |
| **Email-as-account-takeover for Discord users** | If an attacker can receive mail to a Discord user's linked email address, they could log in as that user. |
| **Discord-as-account-takeover for email-only users** | If an attacker controls a Discord account and links it to an existing email-only account, they gain access. |
| **Account enumeration** | Response differences on "email exists" vs "email unknown" leak the user list. |
| **Account linking collision** | Two users trying to register the same email address. |
| **SMTP dependency** | Email delivery requires an operator-supplied SMTP relay; misconfiguration silently breaks email login. |
| **Token replay** | A used or expired code accepted a second time. |
| **Display name missing for email-only users** | No Discord profile to pull a name from. |

**Mitigations:**
- **Rate limiting:** 5 OTP attempts per code; after 5 failures the code is invalidated and a 15-minute per-IP + per-email lockout is applied before a new code can be requested.
- **Short-lived codes:** OTP codes expire after 15 minutes. The expiry timestamp is stored server-side; the client cannot extend it.
- **Single-use:** each code is marked consumed on first successful verification. A second submission of the same code is rejected regardless of expiry.
- **Code never in URLs or logs:** OTP is submitted via `POST` body only, never in a query string. Server logs must not record OTP values — redact the body field in the logging middleware.
- **Verification before activation (both directions):** a Discord user's linked email is not accepted as a login credential until the user completes a fresh OTP challenge. An email-only user's linked Discord account is not accepted as a login credential until the OAuth flow completes successfully from within an authenticated session — the server confirms the session's `User.id` before writing `discordId`, so an attacker cannot link an arbitrary Discord identity to someone else's account.
- **Constant-time response:** the `/auth/email/request-otp` endpoint returns the same response and takes the same time whether the email is registered or not ("if this address is associated with an account, a code was sent"). Prevents user enumeration.
- **Unique constraint:** `User.email` has a `UNIQUE` index. A second account cannot claim an already-verified email. If an unverified email is already pending for another user, the new request replaces the pending code (preventing a pre-registration squatting attack).
- **SMTP misconfiguration guard:** at server startup, if any of `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` is absent **or set to the empty string** (docker-compose's `${VAR:-}` substitution lands on empty strings, not "missing"), email auth is **disabled entirely** — the `/auth/email/*` routes return `503 email_auth_disabled`, the web's `GET /auth/methods` probe reports `email: false`, and the Login screen hides the button. In production the server logs a startup warning listing the missing vars but continues to boot. Mirrored by the Discord guard in §1.1.
- **Display name prompt:** email-only users are prompted to enter a display name on first successful login before reaching the hub. The `displayName` field is required; the server rejects hub access until it is set.
- **DB constraint:** `User` must have at least one of `discordId` (non-null) or `emailVerified` (non-null). Enforced as a Postgres `CHECK` constraint to prevent orphaned accounts.

### 1.3 Invite Codes

Per §3.2: rotatable code/link generated by the DM; revocable.

| Concern | Notes |
|---|---|
| **Brute-force / enumeration** | A short or predictable code lets an attacker join an arbitrary party. |
| **Code leakage** (chat history, screenshots, server logs) | The code is the only thing standing between an attacker and party data. |

**Mitigations:**
- Generate codes as cryptographically random tokens, ≥ 128 bits of entropy (22+ chars base62).
- Rate-limit join attempts per IP and per authenticated user; exponential backoff after repeated failures.
- DM can rotate the code at any time (§3.2). Rotation immediately invalidates the previous code.
- Redemption is a `POST` to `/parties/join` with the code in the body — not a `GET` redirect — so codes don't end up in browser history or access logs.

---

## 2. Authorization (self-hosted, M3+)

§9 states the server is authoritative; the client rules engine runs **only for optimistic UI**. All permission decisions must be re-made server-side.

### 2.1 Permission Matrix Enforcement

Per §8.1: a detailed matrix of who can do what depending on `PartyMembership.role` and Banker state.

| Concern | Notes |
|---|---|
| **Modified client bypassing UI guards** | The client could submit any action; the server must not trust the UI. |
| **Horizontal escalation** | Player A acting as Player B (their character, their stash, their Inventory items). |
| **Vertical escalation** | A player submitting a DM-only action (`identify`, `appoint-banker`, `kick-player`, hoard generation, shop management). |
| **Role spoofing** | Client sending `actorRole: "dm"` in a request body. |

**Mitigations:**
- Every API route resolves the actor from the **session cookie**, then loads their `PartyMembership` for the target party. Request body never supplies `actorUserId` or `actorRole`.
- `actorRole` on `TransactionLog` is **derived server-side at log-write time** per §4: it equals `"banker"` if `Party.bankerUserId === actorUserId`, otherwise the relevant `PartyMembership.role`. The client cannot influence this value.
- The §8.1 matrix is codified as a server-side guard layer (one guard per action type). Adding a new action requires adding a guard — enforced in code review, not optional.
- Every stash/character access checks ownership:
  - `Stash.scope === "character"` → guard requires actor owns the character or holds `role="dm"` in the same party.
  - `Stash.scope === "party" | "recovered-loot"` → guard requires active membership in `partyId`.
  - Per §4, stash invariants (e.g., `ownerCharacterId != null` iff `scope === "character"`) are enforced at write time, not assumed.

### 2.2 Banker Role

Per §3.14 + §4: `Party.bankerUserId` is denormalized; the DM cannot self-appoint; auto-clears when the Banker leaves or is kicked (§8.3).

| Concern | Notes |
|---|---|
| **DM self-appointment** | §3.14 explicitly forbids it. |
| **Banker without active membership** | A `bankerUserId` pointing at a user whose `PartyMembership.leftAt` is set. |
| **Race during DM-distribution while Banker is active** | §8.1 blocks DM from distributing to specific players while a Banker is appointed; a stale check could allow it. |

**Mitigations:**
- `appoint-banker` server guard checks: `bankerUserId !== party.ownerUserId` AND `bankerUserId` has an active (`leftAt = null`) `PartyMembership` with `role = "player"` in this party AND `memberCount >= 2`.
- `leave-party` / `kick-player` handlers clear `bankerUserId` **in the same DB transaction** as setting `leftAt`, and emit a `revoke-banker` log entry with `reason: "left-party" | "kicked"` per §4.
- DM distribution guards (`distribute-currency-to-player`, `distribute-item-to-player`, `split-evenly`) re-read `Party.bankerUserId` inside the same transaction as the mutation. If a Banker is active, the action is rejected.

### 2.3 Cross-Character Mutations by DM

§8 principle: "The DM never silently edits a player's character."

| Concern | Notes |
|---|---|
| **Silent write path** | A bug or backdoor route that lets a DM change another player's data without a log entry. |

**Mitigations:**
- There is no "silent update" code path. Every DM action that touches another character is routed through a typed `TransactionLog` entry per §4 (`transfer`, `identify`, `recharge`, `edit-character`, `edit-item-instance`, `currency-change`, `attune`/`unattune`, etc.).
- The service layer (not individual route handlers) writes the log entry. Routes that bypass the service layer fail in review — they cannot mutate state without producing a log row.
- Player-visible log (§3.11, §5.8) makes every DM action auditable by the affected player.

---

## 3. Data Integrity & Input Validation

### 3.1 Zod at All Boundaries

Per CLAUDE.md: "Validation: Zod everywhere data crosses a boundary (forms, IndexedDB I/O, future API)."

| Concern | Notes |
|---|---|
| **Malformed payloads from clients** | Wrong shapes, missing fields, extra fields. |
| **Type confusion against §4 invariants** | e.g., `ownerType: "character"` (the data model explicitly only allows `"stash" \| "shop"` per §4); `scope: "solo"` (only `character \| party \| recovered-loot` are valid). |
| **Stale data from IndexedDB** | Old schema versions persisted before a code update. |

**Mitigations:**
- All request bodies (server) and all reads from IndexedDB (local mode) go through a Zod schema in `packages/shared/schemas/`.
- Object schemas use `.strict()` — unknown keys are rejected, not silently dropped.
- Enum fields use `z.enum()` with the exact §4 values (`scope`, `ownerType`, `actorRole`, every `TransactionLog.type`).
- Discriminated unions for `TransactionLog.type` use Zod's `discriminatedUnion` so the wrong payload for a given type is a parse error.
- IndexedDB reads carry a schema version; migration logic handles older shapes explicitly (no silent reinterpretation).

### 3.1.5 Entity ID contract (RH1)

Per `OUTLINE.md` §4 "Entity IDs (RH1 — Server-Authoritative ID contract)": every entity id in the data model is a **UUID v7** minted **by the client** and carried in the action payload (`new<EntityName>Id` field). The server validates rather than mints. Three new guard rejection codes capture the validation surface:

| Code | When |
|---|---|
| `id_malformed` | Client-supplied id is not a valid UUID v7 (wrong shape, wrong version nibble, etc.). |
| `id_clock_skew` | Client-supplied id's embedded timestamp is outside the server's tolerance window (±5 minutes default). Rejects backdated forgeries and clock-far-future ids. |
| `id_already_exists` | Client-supplied id collides with an existing row. UUID v7 has 74 bits of random entropy per millisecond, so this is effectively impossible by accident — collision means a buggy / malicious client. The Prisma unique constraint catches it at the persistor; the route layer translates `P2002` into the 422 response with this code. |

**Why this is safe.** Client-minted ids might look like "the client controls the namespace," but the server still controls every other invariant: who can dispatch which action (§2), what state mutations are legal (§3.4 stash/character invariants, §3.2 currency math), and whether the id collides with an existing row (Prisma unique constraint). The client only chooses **which** new UUID v7 to use; the server still decides **whether** to accept it.

**Pre-RH1 deployments (R3 through R4.5)** mint UUID v4 server-side and don't yet validate client ids — see `docs/roadmap.md` RH1 for the migration plan. UUID v7 is structurally compatible with v4 columns; no DB migration is needed and existing v4 rows continue to work.

### 3.2 Currency Math

Per §3.5: all storage is in CP (integer); `priceModifier` is a float applied only at the seed-price interpretation boundary; rounding happens once.

| Concern | Notes |
|---|---|
| **Resulting negative balance** | A `currency-change` with a negative delta larger than the source stash's holding. |
| **Integer overflow** | A pathological hoard or malicious input pushing CP beyond safe integer range. |
| **Floating-point drift** | Repeated `priceModifier` applications producing non-integer CP. |
| **Convert reason misuse** | The `"convert"` reason on `currency-change` (§4) shifts coin denominations; an unchecked convert could create coins out of nothing. |

**Mitigations:**
- Currency stored as signed integer CP. The coin ladder (`cp=1, sp=10, ep=50, gp=100, pp=1000`) per §3.5 is the only conversion factor.
- Pre-commit check: for every affected `CurrencyHolding`, `newAmount >= 0` per denomination. Reject the action if any would go negative.
- `Number.MAX_SAFE_INTEGER` is ≈ 9 × 10¹⁵ CP, far beyond any realistic D&D total. Still, the action handler validates the sum stays within safe integer range as a defense-in-depth check.
- Per §3.5: `priceModifier` is applied to the seed cost once, at the `purchase` / `sale` boundary, rounded immediately to CP using the rules in §3.5 (sub-cp ties round up). `CurrencyHolding` never stores a float.
- `convert` deltas must net-zero in CP terms (10 sp → 1 gp = -10·10 cp + 1·100 cp = 0). Server validates the invariant.

### 3.3 Homebrew Item Authorship

Per §3.7: party-of-one — any user can create homebrew; 2+ members — DM only.

| Concern | Notes |
|---|---|
| **Player griefing the shared catalog** | In a multi-member party, a player creating misleading or offensive `ItemDefinition` entries. |
| **Cross-party catalog leakage** | Homebrew from Party A appearing in Party B's catalog. |

**Mitigations:**
- `create-homebrew` / `edit-homebrew` / `delete-homebrew` guards check: `memberCount === 1` OR actor holds `role="dm"` in `partyId`.
- `ItemDefinition.partyId` per §4 scopes homebrew per-party. Catalog queries always filter to `partyId IS NULL` (PHB/DMG) plus `partyId = actorPartyId`. No cross-party joins anywhere.
- PHB/DMG entries are read-only at the service layer; "Duplicate to edit" (§3.7) produces a new homebrew row with `duplicatedFromId` set — the original is untouched.

### 3.4 Stash & Character Invariants

§4 defines several invariants that the server must enforce on every write:

- `scope === "character"` ⇒ `ownerCharacterId != null`, `partyId == null`.
- `scope === "party" | "recovered-loot"` ⇒ `partyId != null`, `ownerCharacterId == null`, `isCarried === false`.
- Exactly **one** `isCarried === true` stash per character (the Inventory), referenced by `Character.inventoryStashId`.
- Exactly **one** `recovered-loot` stash per party, referenced by `Party.recoveredLootStashId`.
- `ItemInstance.ownerType ∈ {"stash", "shop"}` — there is no `"character"` value.
- `equipped`/`attuned`/`identified`/`currentCharges` are only meaningful when the containing stash is `scope=character, isCarried=true` (per §4) — writes to these fields on Storage/Party Stash/Recovered Loot/Shop items must be rejected.

| Concern | Notes |
|---|---|
| **State that violates these invariants** | Either via a malicious client or a buggy migration. |

**Mitigations:**
- DB-level constraints where the storage layer supports them (Prisma `@@check` / Postgres `CHECK`).
- Service-layer validation as a backup, run before every mutation.
- A test fixture that re-asserts every invariant on the full state after each reducer action.

---

## 4. Injection & XSS

| Concern | Notes |
|---|---|
| **Stored XSS via user text fields** | Item `customName`, `notes`, `description`, character `name`, DM `hint` for unidentified items (§3.8), homebrew descriptions, party `name`. |
| **SQL injection** (self-hosted) | Dynamic query construction in custom endpoints. |
| **Markdown / HTML in descriptions** | Future temptation to allow rich text in item descriptions. |

**Mitigations:**
- React's JSX escapes text children by default. **Never** use `dangerouslySetInnerHTML` with any user-controlled value.
- All `string` fields in §4 are stored and rendered as plain text. No HTML, no markdown rendering in v1.
- If markdown is ever added: sanitize with a strict allowlist library (e.g., DOMPurify) before render; never trust the stored value.
- Self-hosted mode uses Prisma per TECH_STACK.md — all queries are parameterized; no string concatenation into SQL.
- Local mode uses Dexie/IndexedDB, which has no string query language (lookups are by key/index), so SQL-style injection is structurally impossible there.
- A baseline Content Security Policy is applied on self-hosted: `default-src 'self'; script-src 'self'; style-src 'self'`. No `'unsafe-inline'` — Tailwind's output is a single bundled stylesheet of utility classes with no inline `<style>` blocks. Blocks inline scripts even if a stored-XSS bug slipped past React.

---

## 5. CSRF & Cross-Origin (self-hosted, M3+)

| Concern | Notes |
|---|---|
| **State-changing requests from other origins** | An attacker site causing the logged-in user's browser to submit mutations. |
| **WebSocket cross-origin handshake** | A malicious page opening a WebSocket to the server. |

**Mitigations:**
- Session cookie set with `SameSite=Lax`. This blocks cross-site `POST` / `PUT` / `DELETE` requests by default.
- For mutating endpoints, require a custom header (`X-Requested-With: fetch` or a CSRF token) that cross-origin forms cannot set without CORS preflight.
- CORS configured to only allow the app's own origin; no wildcard.
- WebSocket `Origin` header is validated on upgrade; mismatched origins are rejected.

---

## 6. WebSocket Security (self-hosted, M5+)

Per §9: WebSocket carries live party-sync events; clients receive updates within seconds.

| Concern | Notes |
|---|---|
| **Unauthorized subscription to another party's events** | A client subscribing to `party:<otherId>` and reading another party's data. |
| **Client-pushed mutations over the socket** | A client trying to push fabricated `transfer` events. |
| **Connection / event flood** | One client overwhelming the server with traffic. |

**Mitigations:**
- WebSocket upgrade reuses the session cookie. Unauthenticated upgrades are rejected.
- Subscription room is **derived server-side** from the authenticated user's `PartyMembership`. Clients do not name the room; they receive events for parties they belong to and nothing else.
- The WebSocket is **broadcast-only**: clients receive events; mutations always go through authenticated HTTP endpoints with full Zod + permission validation. No state-changing message types exist on the inbound socket.
- Rate limits: max connections per session, max messages per second per connection. Excess closes the socket.

---

## 7. JSON Export / Import

§3.13 + the CLAUDE.md invariant: "JSON export/import round-trip is bit-for-bit lossless."

| Concern | Notes |
|---|---|
| **Malicious / malformed import payload** | A crafted file producing invalid state. |
| **Importing another user's export and overwriting current data** | Either accidentally or maliciously. |
| **Importing a payload that claims a different `partyId` than the URL/session** | Privilege confusion. |

**Mitigations:**
- Import is parsed through the full `AppState` Zod schema before any write. Any failure produces a user-facing error; no partial import.
- Import requires explicit user confirmation ("this will replace all current data") per §3.13.
- Self-hosted: the import target `partyId` is taken from the URL / session, **not** the payload. If the payload's IDs don't match (or the actor isn't a DM of that party), reject.
- Imports do not execute code. All fields are plain data; there are no `function`, `eval`, `Function`, or prototype-pollution paths from imported JSON (Zod `.strict()` plus a flat data model preclude prototype injection).

### 7.1 Server-side export endpoint (R3.4.b)

R3.4.b adds `GET /sync/export?partyId=<id>` so a synced user can download their authoritative AppState without round-tripping through the web's Dexie cache.

| Concern | Notes |
|---|---|
| **Cross-party data leak** | An authenticated user requests another party's export. |
| **Pre-onboarding leak** | An email-only user mid-onboarding (`needsDisplayName: true`) attempts an export before display-name setup. |
| **Envelope drift between export + snapshot** | A schema change would silently desync the operator's snapshots from user-driven exports. |

**Mitigations:**
- Same auth + party-membership + `needsDisplayName` gates as `GET /sync/state` (per §2.1, identity is session-derived, never trusted from the request body); a non-member request returns `403`, an unknown party returns `404`, a `needsDisplayName: true` session returns `409 display_name_required`.
- The endpoint returns the SAME `exportEnvelope` shape that the nightly snapshot writer produces (`packages/shared/src/schemas/exportEnvelope.ts`) — both go through `exportEnvelopeSchema.parse()` at the wire boundary, so any drift surfaces as a parse error before bytes leave the server. The web's existing import flow already round-trips this shape losslessly.
- Snapshot files and the export endpoint are equivalent in terms of leaked data; the file-permission + retention guidance in §8 applies equally to whatever the user downloads (storing an export on a shared host is the user's responsibility, same as for snapshots).

---

## 8. Server & Infrastructure (self-hosted, M3+)

| Concern | Notes |
|---|---|
| **Snapshot file exposure** | §3.13 + §9: nightly snapshots contain full party data. |
| **Snapshot integrity** | A corrupted or tampered snapshot silently breaking restore. |
| **Secrets in env / config** | Discord `CLIENT_SECRET`, DB credentials, session signing key. |
| **Dependency vulnerabilities** | Third-party packages. |
| **HTTPS termination** | App expects to live behind a reverse proxy. |

**Mitigations:**
- Snapshots are written outside the web root (the static-asset path served by nginx is `apps/web/dist`; the snapshot directory is a sibling docker-compose volume) and owned by the server-container process user. **Filesystem permissions are the host operator's responsibility** per the deployment model: the application writes files with Node's default mode (umask-dependent; typically `0644` in a stock container, `0600` under `umask 077`). Operators who need stricter access control set the container's `umask`, mount the snapshot volume read-only outside the server, or wrap the volume in an LUKS / EBS-encryption layer — same delegation as the Postgres data directory.
- Each snapshot file has a SHA-256 checksum stored alongside (R3.4.b ships a `sha256sum`-compatible `<digest>  <filename>` sidecar; plain checksum, not signed — the private-use threat model doesn't include an attacker substituting snapshot files; the checksum is for detecting accidental corruption). The `snapshot:restore` CLI verifies the checksum and refuses to apply on mismatch.
- Default retention: 30 days; operator-configurable via `SNAPSHOT_RETENTION_DAYS`.
- All secrets loaded from environment variables; `.env` is in `.gitignore`, `.env.example` documents the variables.
- Session signing key is a 256-bit random value generated at install time; rotating it invalidates all existing sessions.
- `pnpm audit` runs in CI; high/critical findings block release.
- HTTPS is the operator's responsibility (Nginx / Caddy / Traefik in front of the Node app). README documents the minimum reverse-proxy config.

---

## 9. PHB / DMG Content Handling

Per §1 Scope note + §7: PHB / DMG content is **private use only, not for distribution**.

| Concern | Notes |
|---|---|
| **Accidental commit of seed files to a public repo** | Legal/IP risk. |

**Mitigations:**
- `seed/phb-2024.json` and `seed/dmg-2024.json` are listed in `.gitignore`. CI checks that no file under `packages/seeds/` outside a private allowlist is added in PRs.
- README states: *"PHB/DMG content is for private use under D&D 2024 rules; do not redistribute. The app runs with an empty catalog if seed files are absent."*
- Seeding is a manual step (`pnpm seed`); the binary doesn't ship with WotC content.

---

## 10. Local Mode (MVP, M0–M2)

Local mode has no network, no auth, and no multi-user data, so most concerns above don't apply. The remaining ones are device-level.

| Concern | Notes |
|---|---|
| **Same-origin script access to IndexedDB** | Any JS running on the app's origin can read the store. |
| **Shared device / unprotected disk** | Another OS user, a stolen device, or an unencrypted backup. |
| **Browser-extension access** | Extensions with broad permissions can read page state and storage. |

**Mitigations:**
- Local mode is scoped to private/trusted-device use per §1 Non-Goals. We do not pretend it is hardened.
- No third-party scripts are loaded. The app is self-contained (Vite-bundled) — no analytics, no CDN-hosted libraries at runtime, no external fonts. This minimizes the same-origin attack surface.
- README documents that IndexedDB is **not encrypted at rest** and recommends OS-level disk encryption (FileVault, BitLocker, LUKS) for users storing meaningful campaign data.
- If a future milestone adds a local PIN or passphrase, the encryption story is revisited.

---

## 11. Explicitly Out of Scope (Private Use)

Per §1 Non-Goals, the project is not a public SaaS. The following are intentionally not addressed:

- Multi-tenant abuse prevention (per-user rate limiting beyond the auth / WebSocket basics above, anti-spam, anti-bot).
- GDPR data-portability or right-to-erasure pipelines beyond the manual JSON export and snapshot deletion.
- Penetration testing or third-party security audit.
- Compliance frameworks (SOC 2, ISO 27001, HIPAA, etc.).
- DDoS mitigation (assumed handled by the operator's hosting provider / reverse proxy).

These decisions must be revisited if the project is ever opened to public sign-ups.
