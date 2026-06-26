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
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  return envSchema.parse(process.env);
}
