/**
 * R8.1 — DB integration tests for `runEmailAttemptSweep`.
 *
 * Pattern follows `rate-limit.test.ts`: real Postgres test DB + a fresh
 * `EmailAuthAttempt` table per test. `runEmailAttemptSweep` takes an
 * injected `now` so the "age vs. threshold" logic can be exercised
 * deterministically without waiting real hours.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../../prisma/generated/prisma/client.js';

import { runEmailAttemptSweep } from './attempt-sweep.js';

const TEST_DB_URL =
  process.env['DATABASE_URL_TEST'] ?? 'postgresql://dnd:dnd@localhost:5434/dnd_inv_test';

let prisma: PrismaClient;

beforeAll(() => {
  const adapter = new PrismaPg({ connectionString: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "EmailAuthAttempt" CASCADE');
});

describe('runEmailAttemptSweep (R8.1)', () => {
  it('deletes rows whose lockedUntil is older than the retention window', async () => {
    const now = new Date('2026-07-08T12:00:00Z');
    // 25 hours ago — older than the 24h retention window.
    const stale = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    await prisma.emailAuthAttempt.create({
      data: { email: 'stale@example.com', ip: '10.0.0.1', failedCount: 5, lockedUntil: stale },
    });

    const result = await runEmailAttemptSweep({ prisma, retentionHours: 24, now });
    expect(result.deleted).toBe(1);
    const remaining = await prisma.emailAuthAttempt.count();
    expect(remaining).toBe(0);
  });

  it('preserves in-progress rows (lockedUntil IS NULL)', async () => {
    const now = new Date('2026-07-08T12:00:00Z');
    // A user has 2 failed attempts but hasn't tripped the lockout yet.
    // Row has `lockedUntil: null`; the sweep must NOT touch it or the
    // rate-limit counter resets on every sweep tick.
    await prisma.emailAuthAttempt.create({
      data: { email: 'in-progress@example.com', ip: '10.0.0.2', failedCount: 2 },
    });

    const result = await runEmailAttemptSweep({ prisma, retentionHours: 24, now });
    expect(result.deleted).toBe(0);
    const remaining = await prisma.emailAuthAttempt.count();
    expect(remaining).toBe(1);
  });

  it('preserves recently-locked rows (lockedUntil within the retention window)', async () => {
    const now = new Date('2026-07-08T12:00:00Z');
    // Locked 1 hour ago — well within the 24h retention window, so the
    // row's lockedUntil is still meaningful to `checkLockout` (which
    // reads it in the future direction) OR the lockout has just recently
    // elapsed but we want to keep the row a bit longer for audit / retry.
    const recent = new Date(now.getTime() - 1 * 60 * 60 * 1000);
    await prisma.emailAuthAttempt.create({
      data: { email: 'recent@example.com', ip: '10.0.0.3', failedCount: 5, lockedUntil: recent },
    });

    const result = await runEmailAttemptSweep({ prisma, retentionHours: 24, now });
    expect(result.deleted).toBe(0);
    const remaining = await prisma.emailAuthAttempt.count();
    expect(remaining).toBe(1);
  });

  it('mixed batch — deletes stale, preserves in-progress + recent', async () => {
    const now = new Date('2026-07-08T12:00:00Z');
    const stale = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const recent = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    await prisma.emailAuthAttempt.createMany({
      data: [
        { email: 'a@ex.com', ip: '1.1.1.1', failedCount: 5, lockedUntil: stale },
        { email: 'b@ex.com', ip: '1.1.1.2', failedCount: 5, lockedUntil: stale },
        { email: 'c@ex.com', ip: '1.1.1.3', failedCount: 3 }, // in-progress
        { email: 'd@ex.com', ip: '1.1.1.4', failedCount: 5, lockedUntil: recent },
      ],
    });

    const result = await runEmailAttemptSweep({ prisma, retentionHours: 24, now });
    expect(result.deleted).toBe(2);
    const remaining = await prisma.emailAuthAttempt.count();
    expect(remaining).toBe(2);
  });

  it('no rows → 0 deleted, no error', async () => {
    const result = await runEmailAttemptSweep({
      prisma,
      retentionHours: 24,
      now: new Date('2026-07-08T12:00:00Z'),
    });
    expect(result.deleted).toBe(0);
  });
});
