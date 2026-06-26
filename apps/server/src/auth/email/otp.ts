/**
 * R3.3 — Pure helpers for the 8-digit email OTP flow. No DB, no I/O — just
 * arithmetic + crypto primitives. Tested in `otp.test.ts`.
 *
 * Per SECURITY §1.2 the OTP keyspace is 10⁸ (one hundred million). The
 * protection is the 15-minute expiry + 5-attempt-then-invalidate rate limit
 * implemented in `rate-limit.ts` and the route handler, NOT the entropy of
 * the code itself. Hashing 8-digit codes is theatrical when an attacker
 * with DB read can mint sessions outright; we store the digits in plain
 * text in the `VerificationToken.token` column and document why.
 */
import { randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Length of the OTP in decimal digits. Per OUTLINE §3.1 + SECURITY §1.2.
 * Exported so the email template + the request body validator can reuse it.
 */
export const OTP_LENGTH = 8;

/**
 * Lifetime of a fresh OTP. Per SECURITY §1.2: "OTP codes expire after 15
 * minutes." Stored as `VerificationToken.expires` (now + this).
 */
export const OTP_LIFETIME_MS = 15 * 60 * 1000;

/**
 * Generate a fresh 8-digit OTP using crypto-grade randomness.
 *
 * `randomInt(0, 10**8)` returns a uniformly-distributed integer in
 * [0, 100_000_000), which we then zero-pad to 8 digits. The upper bound
 * is exclusive so 99_999_999 is the largest possible value; 0 is the
 * smallest. Both extremes are legitimate codes (`'00000000'` is a valid
 * OTP — UI must render it as digits, not strip leading zeros).
 *
 * `Math.random()` would NOT be appropriate here: it's a Mersenne-Twister
 * variant in V8 and observable from external timing in some browser
 * builds. The Node `crypto.randomInt` calls into OpenSSL's CSPRNG.
 */
export function generateOtp(): string {
  const n = randomInt(0, 10 ** OTP_LENGTH);
  return n.toString(10).padStart(OTP_LENGTH, '0');
}

/**
 * `true` when `expires` is at or before `now()`. Used by the verify route
 * to short-circuit a soft-expired code (the row may still exist but is no
 * longer redeemable).
 */
export function isOtpExpired(expires: Date): boolean {
  return expires.getTime() <= Date.now();
}

/**
 * Constant-time string equality for OTP comparison.
 *
 * The route handler reads the candidate from the request body and compares
 * against the stored row's `token`. A naive `===` returns early on the
 * first mismatched character, which leaks character-by-character timing.
 * `timingSafeEqual` operates over `Buffer`s of equal length and compares
 * all bytes in fixed time.
 *
 * We early-return on length mismatch (an 8-digit code vs a 7-digit submission
 * is not a meaningful timing leak — the length is public information at
 * the validation layer; the body validator rejects everything other than
 * 8-digit strings before reaching this function).
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  return timingSafeEqual(bufA, bufB);
}
