/**
 * R3.3 — DB integration tests for the email OTP rate-limit module.
 *
 * Hits the test DB (`dnd_inv_test`) — same pattern as `session.test.ts`.
 * Each `it` starts from an empty `EmailAuthAttempt` table.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../../prisma/generated/prisma/client.js';

import {
  checkLockout,
  LOCKOUT_DURATION_MS,
  MAX_FAILED_ATTEMPTS,
  OTP_REQUEST_MAX,
  recordFailedAttempt,
  recordOtpRequest,
  resetAttempts,
} from './rate-limit.js';

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

describe('rate-limit: checkLockout', () => {
  it('returns not-locked when no row exists for (email, ip)', async () => {
    const result = await checkLockout(prisma, 'fresh@example.com', '10.0.0.1');
    expect(result).toEqual({ locked: false });
  });

  it('returns not-locked when row exists but lockedUntil is null (only failures, no lockout yet)', async () => {
    await prisma.emailAuthAttempt.create({
      data: { email: 'one@example.com', ip: '10.0.0.1', failedCount: 2 },
    });
    const result = await checkLockout(prisma, 'one@example.com', '10.0.0.1');
    expect(result).toEqual({ locked: false });
  });

  it('returns locked with `until` when lockedUntil is in the future', async () => {
    const until = new Date(Date.now() + 5 * 60 * 1000);
    await prisma.emailAuthAttempt.create({
      data: {
        email: 'locked@example.com',
        ip: '10.0.0.1',
        failedCount: 5,
        lockedUntil: until,
      },
    });
    const result = await checkLockout(prisma, 'locked@example.com', '10.0.0.1');
    expect(result.locked).toBe(true);
    if (result.locked) expect(result.until.getTime()).toBe(until.getTime());
  });

  it('returns not-locked when lockedUntil has passed', async () => {
    await prisma.emailAuthAttempt.create({
      data: {
        email: 'expired@example.com',
        ip: '10.0.0.1',
        failedCount: 5,
        lockedUntil: new Date(Date.now() - 1000),
      },
    });
    const result = await checkLockout(prisma, 'expired@example.com', '10.0.0.1');
    expect(result).toEqual({ locked: false });
  });

  it('locks across both axes — matches when EITHER email OR ip is locked', async () => {
    // (email-A, ip-Z) is locked; querying (email-A, ip-Q) still trips
    // because the email axis matches.
    const until = new Date(Date.now() + 5 * 60 * 1000);
    await prisma.emailAuthAttempt.create({
      data: { email: 'axis@example.com', ip: '10.0.0.99', failedCount: 5, lockedUntil: until },
    });

    const result = await checkLockout(prisma, 'axis@example.com', '10.0.0.1');
    expect(result.locked).toBe(true);

    // And the symmetric case: (email-A, ip-Z) is locked; querying
    // (email-B, ip-Z) trips on the IP axis.
    const result2 = await checkLockout(prisma, 'different@example.com', '10.0.0.99');
    expect(result2.locked).toBe(true);
  });
});

describe('rate-limit: recordFailedAttempt', () => {
  it('creates a new row on first failure with failedCount = 1', async () => {
    const out = await recordFailedAttempt(prisma, 'new@example.com', '10.0.0.1');
    expect(out.shouldInvalidateCode).toBe(false);

    const row = await prisma.emailAuthAttempt.findUnique({
      where: { email_ip: { email: 'new@example.com', ip: '10.0.0.1' } },
    });
    expect(row?.failedCount).toBe(1);
    expect(row?.lockedUntil).toBeNull();
  });

  it('increments failedCount on subsequent failures', async () => {
    await recordFailedAttempt(prisma, 'inc@example.com', '10.0.0.1');
    await recordFailedAttempt(prisma, 'inc@example.com', '10.0.0.1');
    const out3 = await recordFailedAttempt(prisma, 'inc@example.com', '10.0.0.1');
    expect(out3.shouldInvalidateCode).toBe(false);

    const row = await prisma.emailAuthAttempt.findUnique({
      where: { email_ip: { email: 'inc@example.com', ip: '10.0.0.1' } },
    });
    expect(row?.failedCount).toBe(3);
    expect(row?.lockedUntil).toBeNull();
  });

  it('on the Nth failure (N = MAX_FAILED_ATTEMPTS), sets lockedUntil and signals invalidate', async () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) {
      const out = await recordFailedAttempt(prisma, 'fifth@example.com', '10.0.0.1');
      expect(out.shouldInvalidateCode).toBe(false);
    }
    const before = Date.now();
    const out = await recordFailedAttempt(prisma, 'fifth@example.com', '10.0.0.1');
    expect(out.shouldInvalidateCode).toBe(true);

    const row = await prisma.emailAuthAttempt.findUnique({
      where: { email_ip: { email: 'fifth@example.com', ip: '10.0.0.1' } },
    });
    expect(row?.failedCount).toBe(MAX_FAILED_ATTEMPTS);
    expect(row?.lockedUntil).not.toBeNull();
    const expectedAt = before + LOCKOUT_DURATION_MS;
    // Allow a few seconds of slack — recordFailedAttempt does two DB
    // round-trips so the actual `Date.now()` inside the function is
    // slightly later than `before`.
    expect(Math.abs(row!.lockedUntil!.getTime() - expectedAt)).toBeLessThan(5000);
  });
});

describe('rate-limit: resetAttempts', () => {
  it('deletes the row for (email, ip) so a future failure starts at 1', async () => {
    await recordFailedAttempt(prisma, 'reset@example.com', '10.0.0.1');
    await recordFailedAttempt(prisma, 'reset@example.com', '10.0.0.1');
    await resetAttempts(prisma, 'reset@example.com', '10.0.0.1');

    const row = await prisma.emailAuthAttempt.findUnique({
      where: { email_ip: { email: 'reset@example.com', ip: '10.0.0.1' } },
    });
    expect(row).toBeNull();

    // Subsequent failure starts fresh at 1.
    const next = await recordFailedAttempt(prisma, 'reset@example.com', '10.0.0.1');
    expect(next.shouldInvalidateCode).toBe(false);
    const after = await prisma.emailAuthAttempt.findUnique({
      where: { email_ip: { email: 'reset@example.com', ip: '10.0.0.1' } },
    });
    expect(after?.failedCount).toBe(1);
  });

  it('is a no-op when no row exists (idempotent)', async () => {
    await expect(resetAttempts(prisma, 'never@example.com', '10.0.0.1')).resolves.toBeUndefined();
  });
});

describe('rate-limit: recordOtpRequest (R8.1)', () => {
  it('first hit from a fresh IP is not locked', async () => {
    const result = await recordOtpRequest(prisma, '10.0.0.1');
    expect(result).toEqual({ locked: false });
    const row = await prisma.emailAuthAttempt.findUnique({
      where: { email_ip: { email: '', ip: '10.0.0.1' } },
    });
    expect(row?.failedCount).toBe(1);
    expect(row?.lockedUntil).toBeNull();
  });

  it('increments the IP-only counter on subsequent hits within the window', async () => {
    await recordOtpRequest(prisma, '10.0.0.1');
    await recordOtpRequest(prisma, '10.0.0.1');
    const result = await recordOtpRequest(prisma, '10.0.0.1');
    expect(result.locked).toBe(false);
    const row = await prisma.emailAuthAttempt.findUnique({
      where: { email_ip: { email: '', ip: '10.0.0.1' } },
    });
    expect(row?.failedCount).toBe(3);
  });

  it('trips the lockout on the Nth hit (N = OTP_REQUEST_MAX)', async () => {
    for (let i = 0; i < OTP_REQUEST_MAX - 1; i++) {
      const r = await recordOtpRequest(prisma, '10.0.0.1');
      expect(r.locked).toBe(false);
    }
    const before = Date.now();
    const tripping = await recordOtpRequest(prisma, '10.0.0.1');
    expect(tripping.locked).toBe(true);
    if (tripping.locked) {
      const expectedAt = before + LOCKOUT_DURATION_MS;
      expect(Math.abs(tripping.until.getTime() - expectedAt)).toBeLessThan(5000);
    }
  });

  it('once locked, subsequent hits return locked without re-incrementing beyond the trip point', async () => {
    for (let i = 0; i < OTP_REQUEST_MAX; i++) {
      await recordOtpRequest(prisma, '10.0.0.1');
    }
    // The (N+1)th hit: still locked, `until` unchanged.
    const rowBefore = await prisma.emailAuthAttempt.findUniqueOrThrow({
      where: { email_ip: { email: '', ip: '10.0.0.1' } },
    });
    const result = await recordOtpRequest(prisma, '10.0.0.1');
    expect(result.locked).toBe(true);
    if (result.locked) {
      expect(result.until.getTime()).toBe(rowBefore.lockedUntil!.getTime());
    }
    // Guard: counter did NOT advance past OTP_REQUEST_MAX on the read-only
    // return path.
    const rowAfter = await prisma.emailAuthAttempt.findUniqueOrThrow({
      where: { email_ip: { email: '', ip: '10.0.0.1' } },
    });
    expect(rowAfter.failedCount).toBe(rowBefore.failedCount);
  });

  it('is per-IP: two different IPs have independent counters', async () => {
    for (let i = 0; i < OTP_REQUEST_MAX; i++) {
      await recordOtpRequest(prisma, '10.0.0.1');
    }
    const other = await recordOtpRequest(prisma, '10.0.0.2');
    expect(other.locked).toBe(false);
  });

  it('IP-only rows do not interfere with per-(email, ip) lockouts', async () => {
    // Trip the IP-only lockout for 10.0.0.1.
    for (let i = 0; i < OTP_REQUEST_MAX; i++) {
      await recordOtpRequest(prisma, '10.0.0.1');
    }
    // But checkLockout for a (real-email, DIFFERENT-ip) tuple must NOT
    // trip on the IP-only row (the email axis matches an empty string,
    // which we never query with, and the IP axis is different).
    const check = await checkLockout(prisma, 'user@example.com', '10.0.0.99');
    expect(check.locked).toBe(false);
  });

  it('IP-only lockout DOES surface via checkLockout for requests from the same IP', async () => {
    for (let i = 0; i < OTP_REQUEST_MAX; i++) {
      await recordOtpRequest(prisma, '10.0.0.1');
    }
    // A verify-otp attempt from the SAME IP with any email should see
    // the IP-axis lockout (the empty-string-email row still matches
    // `email = ? OR ip = ?` on the IP axis).
    const check = await checkLockout(prisma, 'user@example.com', '10.0.0.1');
    expect(check.locked).toBe(true);
  });
});
