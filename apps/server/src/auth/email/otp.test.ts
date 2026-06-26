/**
 * R3.3 — Tests for pure OTP helpers. No DB, no I/O, no fixtures needed.
 */
import { describe, expect, it } from 'vitest';

import { constantTimeEqual, generateOtp, isOtpExpired, OTP_LENGTH } from './otp.js';

describe('generateOtp', () => {
  it('returns a string of exactly OTP_LENGTH digits', () => {
    for (let i = 0; i < 100; i++) {
      const code = generateOtp();
      expect(code).toHaveLength(OTP_LENGTH);
      expect(code).toMatch(/^\d+$/);
    }
  });

  it('pads leading zeros — does not return e.g. "42" for the integer 42', () => {
    // We can't deterministically hit n < 10, but we CAN assert that across
    // ~10,000 samples, the all-digit invariant always holds AND at least
    // one sample has a leading zero. (P(no leading zero in 10k samples) =
    // 0.9^10000, vanishingly small.)
    let sawLeadingZero = false;
    for (let i = 0; i < 10_000; i++) {
      const code = generateOtp();
      expect(code).toMatch(/^\d{8}$/);
      if (code.startsWith('0')) sawLeadingZero = true;
    }
    expect(sawLeadingZero).toBe(true);
  });

  it('produces a roughly uniform distribution (smoke check)', () => {
    // First-digit distribution should be ~10% per digit across many
    // samples. We don't need a real chi-square test — anything radically
    // skewed (e.g. always returning the same digit) would fail this.
    const counts = new Map<string, number>();
    const N = 10_000;
    for (let i = 0; i < N; i++) {
      const first = generateOtp()[0]!;
      counts.set(first, (counts.get(first) ?? 0) + 1);
    }
    expect(counts.size).toBe(10); // all 10 digits seen
    for (const c of counts.values()) {
      // Each bucket should be within 5pp of 10%. P(any bucket < 5% or > 15%
      // in 10k binomial-0.1 samples) is negligible.
      expect(c).toBeGreaterThan(N * 0.05);
      expect(c).toBeLessThan(N * 0.15);
    }
  });
});

describe('isOtpExpired', () => {
  it('returns true for a past timestamp', () => {
    expect(isOtpExpired(new Date(Date.now() - 1000))).toBe(true);
  });

  it('returns true for now (boundary — expires <= now)', () => {
    // Pin a single moment to dodge the millisecond between two Date.now()
    // calls. The function uses `getTime() <= Date.now()` so equal means
    // expired.
    const t = new Date(Date.now());
    expect(isOtpExpired(t)).toBe(true);
  });

  it('returns false for a future timestamp', () => {
    expect(isOtpExpired(new Date(Date.now() + 60_000))).toBe(false);
  });
});

describe('constantTimeEqual', () => {
  it('returns true for identical strings', () => {
    expect(constantTimeEqual('12345678', '12345678')).toBe(true);
  });

  it('returns false for different strings of the same length', () => {
    expect(constantTimeEqual('12345678', '12345679')).toBe(false);
    expect(constantTimeEqual('00000000', '99999999')).toBe(false);
  });

  it('returns false for strings of different length (no exception thrown)', () => {
    // node:crypto timingSafeEqual throws on length mismatch; our wrapper
    // pre-checks and returns false. Important: the caller does NOT need
    // to validate length first.
    expect(constantTimeEqual('1234567', '12345678')).toBe(false);
    expect(constantTimeEqual('', '12345678')).toBe(false);
  });

  it('returns true for empty strings (degenerate case)', () => {
    expect(constantTimeEqual('', '')).toBe(true);
  });
});
