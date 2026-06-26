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

  // Discord OAuth credentials. Optional at parse time so dev/test/CI can
  // boot without a real Discord app — the /auth/discord/* routes return
  // 503 with `{error: 'discord_auth_disabled'}` when missing (SECURITY
  // §1.2 SMTP-disabled pattern). Production booting without these is
  // rejected by the post-parse check at the bottom of this file.
  DISCORD_CLIENT_ID: z.string().min(1).optional(),
  DISCORD_CLIENT_SECRET: z.string().min(1).optional(),
  DISCORD_REDIRECT_URI: z.url().optional(),

  // -------- R3.3 — Email OTP (SMTP) --------
  //
  // SMTP transport for the 8-digit one-time-code email login flow. All five
  // must be set together — the `isEmailAuthEnabled(env)` sentinel in
  // `src/auth/config.ts` checks all of them, and the /auth/email/* routes
  // return 503 `{error: 'email_auth_disabled'}` when any is missing.
  // SECURITY §1.2 explicitly requires the misconfig-disables-the-feature
  // pattern so users don't sit waiting for an email that will never arrive.
  // Production booting without these is rejected by the post-parse check.
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

export function loadEnv(): Env {
  const env = envSchema.parse(process.env);

  // R3.2 — production-only fail-fast on missing Discord creds. In dev/test
  // the routes self-disable; in production we want the operator to know
  // immediately that the deployment cannot accept logins.
  if (env.NODE_ENV === 'production') {
    const missing: string[] = [];
    if (!env.DISCORD_CLIENT_ID) missing.push('DISCORD_CLIENT_ID');
    if (!env.DISCORD_CLIENT_SECRET) missing.push('DISCORD_CLIENT_SECRET');
    if (!env.DISCORD_REDIRECT_URI) missing.push('DISCORD_REDIRECT_URI');
    if (missing.length > 0) {
      throw new Error(
        `R3.2 — these env vars are required when NODE_ENV=production: ${missing.join(', ')}. ` +
          `Set them in the deployment environment or revert NODE_ENV.`,
      );
    }
  }

  // R3.3 — production-only fail-fast on missing SMTP creds. Same shape as
  // the Discord block above; mirrors SECURITY §1.2's hard-fail-on-SMTP-
  // misconfig stance so silent email-delivery failures cannot ship.
  if (env.NODE_ENV === 'production') {
    const missingSmtp: string[] = [];
    if (!env.SMTP_HOST) missingSmtp.push('SMTP_HOST');
    if (!env.SMTP_PORT) missingSmtp.push('SMTP_PORT');
    if (!env.SMTP_USER) missingSmtp.push('SMTP_USER');
    if (!env.SMTP_PASS) missingSmtp.push('SMTP_PASS');
    if (!env.SMTP_FROM) missingSmtp.push('SMTP_FROM');
    if (missingSmtp.length > 0) {
      throw new Error(
        `R3.3 — these env vars are required when NODE_ENV=production: ${missingSmtp.join(', ')}. ` +
          `Set them in the deployment environment or revert NODE_ENV.`,
      );
    }
  }

  return env;
}
