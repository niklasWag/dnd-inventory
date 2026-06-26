/**
 * Build-time mode flag for the web app.
 *
 * R3.5 — `VITE_SERVER_URL` is the single switch between two operating modes:
 *
 *   - **Local mode** (unset or empty) — the app behaves exactly like the MVP:
 *     Dexie is the only storage backend, no network calls, no login UI, no
 *     account chrome. Hub still renders as the universal front door but its
 *     auth-dependent surfaces (Login / Join party / Linked accounts) stay
 *     hidden.
 *
 *   - **Server mode** (set to a fully-qualified origin) — the app talks to a
 *     running `apps/server` instance: pulls `AppState` via `GET /sync/state`,
 *     pushes mutations via `POST /sync/actions`, and renders the Login → Hub
 *     pipeline plus Settings → Account / Linked accounts / Logout.
 *
 * The value is captured **once at module load**. There is intentionally no
 * runtime probe: a self-hosted private app rebuilds on every deploy, so
 * "rebuild to switch modes" is acceptable, while a per-boot probe would
 * (a) flap on intermittent server flake and (b) cost an extra request.
 *
 * Trailing slashes are trimmed defensively so callers can blindly do
 * `${SERVER_URL}/auth/...` without doubling up.
 */

function readServerUrl(): string | null {
  const raw = import.meta.env.VITE_SERVER_URL;
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  // Drop trailing slashes so concatenation with absolute paths is safe.
  return trimmed.replace(/\/+$/, '');
}

export const SERVER_URL: string | null = readServerUrl();

export const isServerMode: boolean = SERVER_URL !== null;
