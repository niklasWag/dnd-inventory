/**
 * Env loader. Zod-validated at startup so missing required vars surface
 * with a clear error before Fastify boots.
 *
 * Note on dotenv loading: this module relies on `dotenv` having been
 * imported by an earlier module in the boot path (`src/index.ts` does
 * `import 'dotenv/config'` at the top). The boot path is documented in
 * `apps/server/README.md`.
 */
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  /**
   * Network interface to bind. Defaults to `127.0.0.1` (loopback) so
   * local `pnpm dev` never exposes the port on Wi-Fi / VPN interfaces.
   * Override to `0.0.0.0` for Docker / production where the container
   * needs to accept connections from the compose network. The compose
   * `server.environment` block sets it explicitly.
   */
  HOST: z.string().min(1).default('127.0.0.1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url(),
  WEB_ORIGIN: z.url().default('http://localhost:5173'),

  // -------- R3.2 — Auth.js (Discord OAuth + DB sessions) --------
  //
  // AUTH_SECRET is REQUIRED at all times: Auth.js uses it to sign cookies
  // and the session record. SECURITY §1.1 says "rotating it invalidates
  // all existing sessions" — we treat it as a non-optional 32+ byte secret.
  // 32 bytes ≈ 44 base64 characters; the lower bound here just rejects
  // obviously-broken values.
  AUTH_SECRET: z.string().min(32),

  // Opt-in escape hatch for self-hosted deployments that serve the app
  // over plain http://localhost (e.g. the docker-compose `proxy` profile
  // without a TLS terminator). When true, the session cookie name is
  // NOT `__Host-` prefixed and the `Secure` flag is dropped, even when
  // NODE_ENV=production. Without this, browsers silently refuse to
  // store the cookie on plain HTTP and the user appears to be logged
  // out on every navigation. Defaults to false so a misconfigured prod
  // deploy doesn't silently weaken its cookie posture.
  SESSION_COOKIE_INSECURE: z.coerce.boolean().default(false),

  // Discord OAuth credentials. Optional in every env — the /auth/discord/*
  // routes return 503 with `{error: 'discord_auth_disabled'}` when any of
  // the triple is missing, and the web Login screen hides the button via
  // the `GET /auth/methods` probe (R3.5). Production booting without
  // these logs a startup warning (see the bottom of this file) but does
  // not crash, allowing email-only deployments.
  DISCORD_CLIENT_ID: z.string().min(1).optional(),
  DISCORD_CLIENT_SECRET: z.string().min(1).optional(),
  DISCORD_REDIRECT_URI: z.url().optional(),

  // -------- R3.3 — Email OTP (SMTP) --------
  //
  // SMTP transport for the 8-digit one-time-code email login flow. All five
  // must be set together — the `isEmailAuthEnabled(env)` sentinel in
  // `src/auth/config.ts` checks all of them, and the /auth/email/* routes
  // return 503 `{error: 'email_auth_disabled'}` when any is missing.
  // SECURITY §1.2 codifies the misconfig-disables-the-feature pattern so
  // users don't sit waiting for an email that will never arrive. A startup
  // warning logs the disabled state in production.
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  SMTP_FROM: z.email().optional(),

  // -------- R3.4.b — Nightly snapshots --------
  //
  // OUTLINE §9 / MVP §11: server takes nightly snapshots of every party's
  // AppState to disk. Each snapshot is a Zod-validated `exportEnvelope`
  // wrapper + a sidecar SHA-256 file for restore-time integrity check
  // (SECURITY §8). Retention sweep deletes files older than
  // SNAPSHOT_RETENTION_DAYS so the on-disk footprint stays bounded.
  //
  // SNAPSHOTS_ENABLED defaults true (production wants snapshots by
  // default). Tests disable it via the build option override or by
  // setting SNAPSHOTS_ENABLED=false in the test env so the cron timer
  // never schedules. CI doesn't need to land snapshot files.
  //
  // SNAPSHOT_DIR is a filesystem path. The cron job mkdirs it on first
  // write; the docker-compose layer mounts it as a volume so snapshots
  // survive container restarts (R3.4.b README addition).
  SNAPSHOTS_ENABLED: z.coerce.boolean().default(true),
  SNAPSHOT_DIR: z.string().min(1).default('./snapshots'),
  SNAPSHOT_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Env vars that may legitimately be absent — for which an empty string
 * should be treated the same as "not set". docker-compose substitutes
 * `${VAR:-}` to an empty string when the .env file omits the key, which
 * Zod's `.optional()` does NOT accept (optional means "may be missing",
 * not "may be empty"). Strip empty strings to `undefined` before parsing
 * so a stack like `DISCORD_CLIENT_ID=` (set but empty in the container
 * env) is equivalent to the var not appearing at all.
 */
const OPTIONAL_KEYS = [
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'DISCORD_REDIRECT_URI',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM',
] as const;

export function loadEnv(): Env {
  // Snapshot process.env into a mutable object so we can blank out empty
  // strings on optional keys without touching the real process env.
  const raw: Record<string, string | undefined> = { ...process.env };
  for (const key of OPTIONAL_KEYS) {
    if (raw[key] === '') raw[key] = undefined;
  }
  const env = envSchema.parse(raw);

  // R3.2 / R3.3 — log a clear startup warning when production is booting
  // with an incomplete Discord triple or SMTP quintuple. The routes
  // self-disable (503 `discord_auth_disabled` / `email_auth_disabled`)
  // and the web Login screen hides the corresponding buttons via the
  // `GET /auth/methods` probe (R3.5), so a partial config is a valid
  // deployment shape — but the operator must see at boot that the
  // affected login method is OFF.
  //
  // SECURITY §1.2 codifies this for SMTP ("if SMTP env vars are absent
  // or incomplete, email auth is disabled entirely"); the Discord
  // branch is by analogy.
  //
  // We use `console.warn` rather than the Fastify logger because env
  // loading runs before the server (and its logger) is constructed.
  if (env.NODE_ENV === 'production') {
    const missingDiscord = [
      env.DISCORD_CLIENT_ID ? null : 'DISCORD_CLIENT_ID',
      env.DISCORD_CLIENT_SECRET ? null : 'DISCORD_CLIENT_SECRET',
      env.DISCORD_REDIRECT_URI ? null : 'DISCORD_REDIRECT_URI',
    ].filter((s): s is string => s !== null);
    const missingSmtp = [
      env.SMTP_HOST ? null : 'SMTP_HOST',
      env.SMTP_PORT ? null : 'SMTP_PORT',
      env.SMTP_USER ? null : 'SMTP_USER',
      env.SMTP_PASS ? null : 'SMTP_PASS',
      env.SMTP_FROM ? null : 'SMTP_FROM',
    ].filter((s): s is string => s !== null);

    if (missingDiscord.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[env] Discord OAuth is DISABLED: missing ${missingDiscord.join(', ')}. ` +
          `The /auth/discord/* routes will return 503 and the web Login button is hidden.`,
      );
    }
    if (missingSmtp.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[env] Email OTP is DISABLED: missing ${missingSmtp.join(', ')}. ` +
          `The /auth/email/* routes will return 503 and the web Login button is hidden.`,
      );
    }
    if (missingDiscord.length > 0 && missingSmtp.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[env] NO sign-in methods are configured. Users cannot log in until ` +
          `Discord OAuth or SMTP env vars are provided.`,
      );
    }
  }

  return env;
}
