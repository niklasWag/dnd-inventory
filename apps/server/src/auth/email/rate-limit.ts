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
 * The `@@index([lockedUntil])` makes such a sweep cheap. Tracked in
 * `docs/roadmap.md` → **Operational followups (unscheduled)** →
 * "EmailAuthAttempt cron sweep".
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

/**
 * R8.1 — per-IP request-side rate limit for `POST /auth/email/request-otp`.
 *
 * The verify side is already lockout-protected via `recordFailedAttempt`
 * (5 strikes → 15-min lockout). The request side is only protected by
 * the constant-time pad, which defends against timing enumeration but
 * NOT against request-flood abuse (an attacker can burn the SMTP quota
 * by requesting codes for every guessable email).
 *
 * The request-side rate limit reuses the `EmailAuthAttempt` keyspace
 * per SECURITY §1.2 (roadmap R8.1 directive): rows with `email = ''`
 * represent the IP-only axis. `checkLockout` already queries
 * `email = ? OR ip = ?`, so an empty-string-email row matches only the
 * IP axis and never a real-email query — the two axes don't
 * cross-contaminate.
 *
 * Threshold: OTP_REQUEST_MAX per IP within OTP_REQUEST_WINDOW_MS. Once
 * the threshold trips, the IP-only row's `lockedUntil` is set to
 * `now + LOCKOUT_DURATION_MS` and the verify-side `checkLockout` picks
 * it up automatically.
 */
export const OTP_REQUEST_MAX = 10;
export const OTP_REQUEST_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/** Sentinel value used as `EmailAuthAttempt.email` for IP-only rows. */
const IP_ONLY_EMAIL = '';

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

/**
 * R8.1 — record a `POST /auth/email/request-otp` hit from `ip`. On the
 * Nth call within OTP_REQUEST_WINDOW_MS we set `lockedUntil = now +
 * LOCKOUT_DURATION_MS` on the IP-only row so `checkLockout` picks it
 * up at the top of the next request (and any concurrent verify from
 * the same IP is also blocked, symmetric with the verify-side lockout).
 *
 * The counter reads `lastAttempt` to decide whether to increment the
 * existing row or start over: if the previous request was OUTSIDE the
 * window, we reset `failedCount` to 1. Inside the window, we increment.
 * (Prisma's `upsert` doesn't support conditional field updates in a
 * single query, so we read + branch in code. Two round-trips per hit
 * is fine — this is a low-frequency endpoint by design.)
 *
 * Returns whether the caller should short-circuit with 429 without
 * doing the OTP send. Callers that get `{ locked: false }` should
 * proceed to the normal `checkLockout` (per-email + per-IP mix) before
 * sending.
 */
export async function recordOtpRequest(prisma: PrismaClient, ip: string): Promise<LockoutCheck> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - OTP_REQUEST_WINDOW_MS);

  const existing = await prisma.emailAuthAttempt.findUnique({
    where: { email_ip: { email: IP_ONLY_EMAIL, ip } },
  });

  // Already locked and the lockout hasn't elapsed? Return it verbatim
  // so the caller can surface `retry-after`. The row is preserved; the
  // sweep (attempt-sweep.ts) reaps it once `lockedUntil < now - 24h`.
  if (existing?.lockedUntil && existing.lockedUntil > now) {
    return { locked: true, until: existing.lockedUntil };
  }

  // Compute the next counter value:
  //   - no existing row → 1
  //   - existing row's lastAttempt is BEFORE the sliding window → reset to 1
  //   - existing row within the window → increment
  const nextCount =
    existing === null || existing.lastAttempt < windowStart ? 1 : existing.failedCount + 1;

  // Nth hit trips the lockout. Store `lockedUntil` so `checkLockout`
  // picks it up on the next request from any endpoint using this
  // keyspace.
  const shouldLock = nextCount >= OTP_REQUEST_MAX;
  const lockedUntil = shouldLock ? new Date(now.getTime() + LOCKOUT_DURATION_MS) : null;

  await prisma.emailAuthAttempt.upsert({
    where: { email_ip: { email: IP_ONLY_EMAIL, ip } },
    create: {
      email: IP_ONLY_EMAIL,
      ip,
      failedCount: nextCount,
      lastAttempt: now,
      lockedUntil,
    },
    update: {
      failedCount: nextCount,
      lastAttempt: now,
      lockedUntil,
    },
  });

  if (shouldLock) {
    return { locked: true, until: lockedUntil! };
  }
  return { locked: false };
}
