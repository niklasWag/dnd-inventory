/**
 * R3.3 — Durable rate-limit / lockout state for the email OTP verify flow.
 *
 * Encapsulates every read/write against the `EmailAuthAttempt` table so the
 * route handler stays declarative ("did this attempt push us over?") and
 * the schema/threshold values live in one place.
 *
 * Per SECURITY §1.2:
 *   - 5 failed verify attempts per code → code invalidated AND
 *   - 15-minute per-IP + per-email lockout before a new code can be requested.
 *
 * The `(email, ip)` UNIQUE constraint in `prisma/schema.prisma` makes the
 * row keyspace bounded: a single attacker IP attacking many emails creates
 * one row per email; a single email being attacked from many IPs creates
 * one row per IP. We check BOTH axes by aggregating over rows that match
 * either the `email` OR the `ip` — see `checkLockout`.
 *
 * Cleanup of dead rows is a followup (a cron sweep over `lockedUntil < now()`).
 * The `@@index([lockedUntil])` makes such a sweep cheap.
 */
import type { PrismaClient } from '../../../prisma/generated/prisma/client.js';

/**
 * Number of failed verify attempts allowed before the code is invalidated
 * and a lockout is imposed. Per SECURITY §1.2.
 */
export const MAX_FAILED_ATTEMPTS = 5;

/**
 * Duration of the lockout that follows the 5th failed attempt. Per
 * SECURITY §1.2 — same as the OTP lifetime so an attacker can't just
 * request a new code and immediately resume guessing.
 */
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

export type LockoutCheck = { locked: true; until: Date } | { locked: false };

/**
 * Is the (email, ip) pair currently locked out? We check across the
 * UNION of rows matching either axis — a per-email lockout AND a per-IP
 * lockout should both block the next attempt.
 *
 * Rows with `lockedUntil <= now` are NOT locked (the lockout has elapsed).
 * Returns the latest `until` timestamp among locked rows so the caller can
 * surface `Retry-After`.
 */
export async function checkLockout(
  prisma: PrismaClient,
  email: string,
  ip: string,
): Promise<LockoutCheck> {
  const now = new Date();
  // Find rows that match EITHER axis AND are still within their lockout
  // window. `OR` means "any row matching this email regardless of IP" plus
  // "any row matching this IP regardless of email" — both perspectives.
  const lockedRows = await prisma.emailAuthAttempt.findMany({
    where: {
      AND: [{ lockedUntil: { gt: now } }, { OR: [{ email }, { ip }] }],
    },
    orderBy: { lockedUntil: 'desc' },
    take: 1,
  });
  const top = lockedRows[0];
  if (top?.lockedUntil) {
    return { locked: true, until: top.lockedUntil };
  }
  return { locked: false };
}

/**
 * Record a failed verify attempt against (email, ip). Returns whether the
 * caller should additionally invalidate the OTP code row (true when this
 * attempt was the Nth that crosses MAX_FAILED_ATTEMPTS).
 *
 * Implementation note: we upsert on (email, ip) so concurrent failures
 * across different IPs from the same email create separate rows — exactly
 * the granularity we want for the lockout check.
 */
export async function recordFailedAttempt(
  prisma: PrismaClient,
  email: string,
  ip: string,
): Promise<{ shouldInvalidateCode: boolean }> {
  // Upsert is atomic at the SQL layer (Postgres ON CONFLICT) so a
  // concurrent failed attempt from the same (email, ip) can't double-count
  // or race.
  const row = await prisma.emailAuthAttempt.upsert({
    where: { email_ip: { email, ip } },
    create: { email, ip, failedCount: 1, lastAttempt: new Date() },
    update: {
      failedCount: { increment: 1 },
      lastAttempt: new Date(),
    },
  });

  // Hit the 5-strikes threshold? Set the lockout NOW (separate update so
  // we know the post-increment count before deciding).
  if (row.failedCount >= MAX_FAILED_ATTEMPTS) {
    await prisma.emailAuthAttempt.update({
      where: { email_ip: { email, ip } },
      data: { lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) },
    });
    return { shouldInvalidateCode: true };
  }
  return { shouldInvalidateCode: false };
}

/**
 * Reset the failure counter for (email, ip) after a successful verify.
 * Idempotent — no-op when no row exists.
 *
 * We DELETE the row rather than zero-it-out so the table doesn't accumulate
 * stale "I tried and succeeded" markers. A successful (email, ip) pair
 * that's later attacked starts fresh.
 */
export async function resetAttempts(
  prisma: PrismaClient,
  email: string,
  ip: string,
): Promise<void> {
  // deleteMany rather than delete: the where clause may or may not match
  // an existing row, and deleteMany silently no-ops on zero matches
  // (delete throws P2025).
  await prisma.emailAuthAttempt.deleteMany({ where: { email, ip } });
}
