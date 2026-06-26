/**
 * PrismaClient singleton with the Postgres driver adapter (Prisma 7
 * requirement). The `globalThis.__prisma` cache survives `tsx watch`
 * module reloads in dev without leaking connections.
 *
 * The connection string is read from `process.env.DATABASE_URL`, set by:
 *   - `apps/server/.env` for local dev (loaded by `dotenv` from
 *     `prisma.config.ts` and from `src/config/env.ts`),
 *   - the compose `server.environment` block in containers,
 *   - `src/test/setup.ts` redirecting to the test DB before tests load
 *     this module.
 */
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../prisma/generated/prisma/client.js';

declare global {
  var __prisma: PrismaClient | undefined;
}

export function getPrisma(): PrismaClient {
  if (globalThis.__prisma === undefined) {
    const connectionString = process.env['DATABASE_URL'];
    if (connectionString === undefined || connectionString === '') {
      throw new Error('DATABASE_URL must be set before instantiating PrismaClient');
    }
    const adapter = new PrismaPg({ connectionString });
    globalThis.__prisma = new PrismaClient({ adapter });
  }
  return globalThis.__prisma;
}
