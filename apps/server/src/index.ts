/**
 * Server bootstrap. Boot ordering:
 *   1. Load `.env` (dev / standalone) — production uses real env vars.
 *   2. Parse env via Zod (fail fast on missing DATABASE_URL etc.).
 *   3. Instantiate Prisma with the pg driver adapter (Prisma 7).
 *   4. Run the boot-time seed runner (idempotent, version-gated upsert).
 *   5. Build the Fastify app and listen.
 *
 * No try/catch swallowing — uncaught rejections crash the process,
 * which is what we want under a container orchestrator (compose
 * restarts the server on exit).
 */
import 'dotenv/config';

import { loadEnv } from './config/env.js';
import { getPrisma } from './db/prisma.js';
import { runSeed } from './db/seed-runner.js';
import { buildServer } from './server.js';

const env = loadEnv();
const prisma = getPrisma();

const seedResult = await runSeed(prisma);
console.warn(
  `[seed-runner] ${
    seedResult.skipped
      ? `skipped (already at v${seedResult.newVersion})`
      : `upserted ${seedResult.upsertedCount} rows; v${seedResult.previousVersion ?? 'none'} → v${seedResult.newVersion}`
  }`,
);

const app = await buildServer({ env, prisma });
await app.listen({ port: env.PORT, host: env.HOST });
