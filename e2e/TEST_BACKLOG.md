# E2E test backlog

Candidate end-to-end journeys not yet covered by the suite. This is a
**backlog + design notes**, not a spec — see `README.md` for how the rig
runs and the 3-layer (`pages/` → `steps/` → `tests/`) convention any new
spec must follow. The numbered rows in the table map to the **Candidate
cases** section below.

## Summary

Status legend: ✅ done (spec exists) · 📋 planned (ready to write) ·
🚧 blocked (needs infrastructure).

| #   | Test                      | Description                                                            | Components checked                                                          | Test data needed                | Status     | Notes                                                        |
| --- | ------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------- | ---------- | ------------------------------------------------------------ |
| —   | `harness`                 | Rig smoke gate before other specs run                                  | API `/healthz`, SPA loads                                                   | none                            | ✅ done    | Fails fast if the stack isn't up                             |
| —   | `auth-otp-login`          | New visitor signs in via email OTP → Hub                               | SMTP → Auth.js → verify-otp → session cookie → Hub                          | fresh email (per-run timestamp) | ✅ done    | Widest single reach; reads OTP from mailpit                  |
| —   | `party-lifecycle`         | DM+player: join, leave, rejoin, kick                                   | Invite redeem, membership rebind, kick cascade, 2 browser contexts          | 2 fresh emails                  | ✅ done    | Regression fence for join→leave→rejoin + kick-with-character |
| 1   | Item lifecycle (solo)     | Add → move → remove an item, survive reload                            | `acquire`/`move`/`consume` reducer + server persist + pull-state re-hydrate | catalog seed (an item id)       | 📋 planned | Needs `characterSheet.page`, `stash.page` POMs               |
| 2   | Currency round-trip       | Deposit → convert → withdraw                                           | CP-integer math, net-zero convert, no negative balance                      | starting coin amounts           | 📋 planned | Guards `SECURITY §3.2` on the full path                      |
| 3   | Two-member sync           | DM's mutation appears in player's view live                            | WebSocket broadcast + `applyBroadcast` (RH2.6 log-authority)                | 2 emails, shared party          | 📋 planned | Only observable with 2 live clients                          |
| 4   | Offline write-block       | Offline mutation blocked in 2-member party; outbox drains on reconnect | `useCanDispatch` gate (§9), Dexie outbox, reconnect drain                   | 2-member party                  | 📋 planned | Uses `context.setOffline()`; may need a `sync` fixture       |
| 5   | Shop buy/sell             | Player buys then sells against a DM shop                               | Currency ↔ item transfer, stock decrement, price math, permissions          | catalog seed, shop, coin        | 📋 planned | Needs `shop.page` POM                                        |
| 6   | Banker-mediated claim     | Banker gates self-claim from shared pools                              | Banker appointment + §3.14 claim permissions (multi-role)                   | 2+ member party                 | 📋 planned | View-only currency for non-Banker                            |
| 7   | JSON backup round-trip    | Export → wipe → import, replace-all confirm                            | Export/import lossless round-trip, Zod boundary parse (`SECURITY §3.13`)    | a populated party               | 📋 planned | Local-mode journey                                           |
| 8   | DM tools chain            | Hoard roll → loot distribute → identify                                | Item minting into Recovered Loot, distribute, identify; audit log           | catalog seed, DM party          | 📋 planned | Needs `dmTools.page` POM                                     |
| 9   | Discord OAuth link/unlink | Link Discord, enforce ≥1 login method                                  | OAuth+PKCE round-trip, unlink invariant                                     | a stub Discord IdP              | 🚧 blocked | Needs a test IdP in the compose stack                        |

## Guiding principles (when to add an E2E case here vs. a lower layer)

E2E is the most expensive layer (full Postgres + server + SPA + mailpit
per run). Only promote a journey to E2E when it catches a defect class a
cheaper layer **cannot** — per `docs/TECH_STACK.md` §3.5:

- **Server-integration test** (real DB, not mocked) already covers FK /
  constraint / permission defects on mutation routes. Prefer it for
  "does this route persist correctly" questions.
- **Vitest + RTL component test** covers UI logic, reducer wiring, and
  optimistic rendering without a server.
- **Reach for E2E** only for journeys that span the **full server ↔ DB ↔
  client path under real state shapes** — auth/session/cookies, sync
  reconciliation across two browsers, redirects, and multi-actor
  permission interplay.

Keep the suite small and high-signal. Every case below should justify
its cost against that bar before being written.

## Current coverage (for reference)

- `harness.spec.ts` — rig smoke gate.
- `auth-otp-login.spec.ts` — email-OTP sign-in → Hub.
- `party-lifecycle.spec.ts` — DM creates party+character; player joins,
  adds character, leaves, rejoins, is kicked (two browser contexts).

## Candidate cases

### 1. Item lifecycle in a solo party (single actor)

**Why E2E:** exercises `acquire` → `move` → `consume` persisting through
the server and surviving a reload (server-authoritative state, not just
optimistic UI).

- Solo user creates a character, adds a catalog item to Inventory,
  moves it to a Storage stash, then removes it.
- **Assert:** counts update; after `page.reload()` the state re-hydrates
  from the server identically (guards the pull-state path).
- New POM: `characterSheet.page.ts` (item rows, +/−, kebab / inline
  actions), `stash.page.ts`.

### 2. Currency transfer + convert round-trip

**Why E2E:** currency math is CP-integer with net-zero invariants
(`SECURITY §3.2`); worth one full-path check that a deposit/withdraw/
convert nets correctly server-side and re-hydrates.

- Deposit coin into Party Stash, convert denominations, withdraw.
- **Assert:** balances match expected CP after reload; no negative
  balance surfaced.

### 3. Two-member sync reconciliation (broadcast path)

**Why E2E:** the WebSocket broadcast + `applyBroadcast` reconciliation
(RH2.6 log-authority) is only observable with two live clients — no
lower layer can cover it.

- DM and player in the same party, both on a shared-pool screen. DM
  adds an item; **assert** it appears in the player's view without a
  manual reload (socket broadcast), and the player's transaction log
  gains the server `applied[]` entry.

### 4. Offline write-block for a multi-member party (§9)

**Why E2E:** the offline gate (`isServerMode && !online && memberCount

> = 2`) + Dexie outbox drain on reconnect is a browser-context concern.

- In a 2-member party, go offline (`context.setOffline(true)`), attempt
  a mutation → **assert** the primary Save button is disabled
  (`useCanDispatch`, R9.13a) and a toast explains the block. Go back
  online → **assert** a solo-party buffered write drains from the outbox.

### 5. Shop buy/sell across two actors

**Why E2E:** buy moves currency + items between a shop and a character's
Inventory through the server; sell is the inverse. Permission + price
math + stock decrement in one path.

- DM opens a shop, stocks an item, opens it to the party. Player buys it
  (**assert** currency debited, item in Inventory, stock decremented),
  then sells something back.

### 6. Banker-mediated claim flow (§3.14)

**Why E2E:** Banker gating changes who can self-claim from Party Stash /
Recovered Loot — a multi-role, server-enforced permission interplay.

- DM appoints a Banker (2+ member party). **Assert** a non-Banker
  player sees Party Stash currency as view-only and cannot self-claim;
  the Banker can distribute.

### 7. JSON backup export → wipe → import round-trip

**Why E2E:** the export/import round-trip must be bit-for-bit lossless
(`CLAUDE.md` key invariant) and import parses through Zod at the boundary
with a user confirm (`SECURITY §3.13`). Local-mode journey.

- Export a populated party, wipe all data, import the file, confirm the
  replace-all dialog. **Assert** the restored state matches.

### 8. DM tools: hoard generate → loot distribute → identify

**Why E2E:** the DM-tools chain mints items into Recovered Loot, then
distributes and identifies them — a multi-step server-authoritative
sequence culminating in per-character Inventory changes.

- DM rolls a hoard, runs the Loot Distribution Wizard to hand items to a
  player, then identifies an unidentified magic item. **Assert** the
  player's Inventory + the audit log reflect each step.

### 9. Discord OAuth link/unlink (if a stub IdP is available)

**Why E2E:** the OAuth+PKCE round-trip and the "must keep at least one
login method" invariant. **Blocked** until a test Discord IdP or stub is
wired into the compose stack — capture here so it isn't forgotten.

## Infrastructure the backlog implies

- **New page objects:** `characterSheet.page.ts`, `stash.page.ts`,
  `shop.page.ts`, `dmTools.page.ts` — role/label locators only, no
  assertions (mirror the existing POMs).
- **Offline control:** cases 3–4 need `browserContext.setOffline()` and a
  way to wait on the socket; add a `sync` fixture if it recurs.
- **Seed dependency:** several cases need the WotC catalog seed, which is
  git-ignored (see `project_ci_scope` — CI runs static checks only
  because so much test surface depends on it). E2E already boots the real
  server, so confirm the seed is present in the image before relying on
  specific catalog ids.
