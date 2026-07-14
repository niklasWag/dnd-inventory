# End-to-end tests

Docker-native Playwright E2E suite for the D&D inventory manager. Drives
the **real** stack — Postgres + Fastify server + nginx-served SPA +
mailpit — through a browser, exercising user journeys the way a person
would. This is the layer that catches defects only visible in the full
server-DB-client path under real state shapes (see `docs/TECH_STACK.md`
§3.3 / §3.5 for why it exists).

## Running

From the repo root:

```bash
pnpm e2e          # build images, boot the stack, run all specs, tear down
pnpm e2e:down     # force-stop + remove the stack (and its ephemeral volumes)
pnpm e2e:report   # open the HTML report from the last run
```

`pnpm e2e` exits non-zero if any spec fails. First run is slow (image
builds); subsequent runs reuse cached layers.

## What runs where

Everything runs inside `docker compose -f e2e/docker-compose.yml`. No
host dependencies beyond Docker — the browsers ship in the Playwright
image.

| Service      | Role                                                        |
| ------------ | ----------------------------------------------------------- |
| `postgres`   | Ephemeral DB (`dnd_inv_e2e`, no volume — fresh every run)   |
| `server`     | Fastify API (prod `Dockerfile.server`, e2e env overrides)   |
| `web`        | SPA on nginx (prod `Dockerfile.web`)                        |
| `caddy`      | Same-origin reverse proxy (reuses `infra/docker/Caddyfile`) |
| `mailpit`    | SMTP sink — specs read OTP codes from its HTTP API          |
| `playwright` | The test runner (Chromium); shares Caddy's network stack    |

The server + web images are the **production** Dockerfiles — E2E tests
what ships. Only the runtime env differs (ephemeral DB, snapshots/crons
off, mailpit SMTP).

### Why the Playwright container shares Caddy's network namespace

`network_mode: service:caddy` puts the browser on Caddy's network stack,
so it reaches the app at **`http://localhost:8080`** — mirroring how a
real user hits the dev compose's published proxy port. Two reasons this
matters:

1. **Same origin.** SPA + API served under one origin keeps the
   `SameSite=Lax` session cookie first-party (a split origin drops it).
2. **Secure context.** `localhost` is a secure context in Chromium, so
   `navigator.locks` (Web Locks API, used by the sync queue) is
   available. A compose-internal hostname like `caddy:8080` is an
   insecure context → `navigator.locks` is `undefined` → the sync queue
   flush throws. Using `localhost` gives a genuine secure context with
   no unsafe browser flags.

## Layout (3-layer)

```
e2e/
├─ pages/       Page objects — locators + raw interactions only.
│              readonly locators assigned in the ctor; role/label
│              queries (no XPath). No assertions here.
├─ steps/       Descriptive user actions + verifications, grouped by
│              screen/module. Each wrapped in `test.step()` for a
│              labelled report tree. Web-first assertions live here.
├─ fixtures/    Test infrastructure (not user actions) — e.g. reading
│              OTPs from mailpit.
└─ tests/       Specs. Read as prose: a chronological list of step
               calls interleaved with verifications.
```

The layering follows Playwright's Page Object guidance: locators are
isolated in `pages/`, so markup churn touches one file. Steps compose
pages into meaningful actions; specs compose steps into journeys.

## Specs

- **`harness.spec.ts`** — smoke gate. API `/healthz` + SPA loads. If this
  fails, the rig isn't up and other specs are noise.
- **`auth-otp-login.spec.ts`** — a new visitor signs in via email OTP and
  lands on the Hub. Widest single reach (SMTP → Auth.js → verify →
  session cookie).
- **`party-lifecycle.spec.ts`** — two players form a party, one leaves,
  rejoins, and is removed by the DM. Two isolated browser contexts. Also
  the regression fence for the join→leave→rejoin and kick-with-character
  paths.

Candidate journeys not yet written live in **`TEST_BACKLOG.md`** (a
summary table + per-case design notes, each with a "why E2E" justification
against the cheaper test layers).

## Auth in specs

There is **no** test-only auth bypass. Specs sign in through the real
email-OTP flow: the SPA sends the code, the spec reads it from mailpit
(`fixtures/mailpit.ts`), and types it into the UI. This keeps the tests
honest about the auth surface the app actually ships.

## Debugging a failure

`pnpm e2e:report` opens the HTML report. For failed specs it includes the
trace (frame-by-frame DOM + network timeline), a screenshot, and a video
— all retained on failure via `playwright.config.ts`. Passing specs keep
nothing (kept lean by `retain-on-failure`).

Artifacts land in `e2e/playwright-report/` and `e2e/test-results/` (both
git-ignored) via bind mounts, so they survive the container teardown.
