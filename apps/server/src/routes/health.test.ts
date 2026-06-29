import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../prisma/generated/prisma/client.js';
import { buildServer } from '../server.js';
import { runSeed } from '../db/seed-runner.js';

const TEST_DB_URL =
  process.env['DATABASE_URL_TEST'] ?? 'postgresql://dnd:dnd@localhost:5433/dnd_inv_test';

const env = {
  NODE_ENV: 'test' as const,
  PORT: 0,
  HOST: '127.0.0.1',
  LOG_LEVEL: 'silent' as const,
  DATABASE_URL: TEST_DB_URL,
  WEB_ORIGIN: 'http://localhost:5173',
  // R3.2 — buildServer no longer parses env; we construct it as a literal
  // and rely on TS to keep it aligned with the Env type. AUTH_SECRET is
  // required at the schema level (min 32 chars) so test envs supply a
  // dev-only placeholder. DISCORD_* are absent so the /auth/discord/*
  // routes return 503 in this suite — R3.2 routes have their own test
  // file with msw fixtures.
  AUTH_SECRET: 'test-secret-padding-to-meet-32-char-min-XXXXXX',
  SESSION_COOKIE_INSECURE: false,
  // R3.4.b — snapshots off in tests; the cron job is a singleton on the
  // Fastify instance and tests build many instances.
  SNAPSHOTS_ENABLED: false,
  SNAPSHOT_DIR: './snapshots',
  SNAPSHOT_RETENTION_DAYS: 30,
};

let prisma: PrismaClient;

beforeAll(async () => {
  const adapter = new PrismaPg({ connectionString: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
  // Ensure the DB is reachable and seedVersion is current; the seed
  // runner is the same one the server boot path uses.
  await runSeed(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /healthz (R3.1)', () => {
  it('returns 200 with status=ok when DB is reachable and seedVersion matches', async () => {
    const app = await buildServer({ env, prisma });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string; db: string; seedVersion: number | null }>();
    expect(body.status).toBe('ok');
    expect(body.db).toBe('ok');
    expect(typeof body.seedVersion).toBe('number');
    await app.close();
  });

  it('returns 503 with status=degraded when Metadata.seedVersion is missing', async () => {
    // Simulate a fresh / unseeded DB by wiping Metadata. The next runSeed
    // would restore it; we deliberately don't call it in this test.
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Metadata" RESTART IDENTITY CASCADE');
    const app = await buildServer({ env, prisma });
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(503);
    const body = res.json<{ status: string; db: string; seedVersion: number | null }>();
    expect(body.status).toBe('degraded');
    expect(body.db).toBe('ok');
    expect(body.seedVersion).toBeNull();
    await app.close();
    // Restore state so the next test file (e.g. seed-runner.test.ts run order) sees a clean DB.
    await runSeed(prisma);
  });
});
