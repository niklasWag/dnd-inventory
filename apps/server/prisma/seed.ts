/**
 * CLI shim for `pnpm --filter @app/server db:seed`. Standalone path —
 * not invoked by Prisma 7's removed auto-seed hook. The runner is the
 * same function the server's boot path calls (`src/db/seed-runner.ts`).
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './generated/prisma/client.js';
import { runSeed } from '../src/db/seed-runner.js';

const connectionString = process.env['DATABASE_URL'];
if (connectionString === undefined || connectionString === '') {
  throw new Error('DATABASE_URL must be set');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

try {
  const result = await runSeed(prisma);
  console.warn(`[seed-runner] ${JSON.stringify(result)}`);
} finally {
  await prisma.$disconnect();
}
