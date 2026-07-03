import { describe, expect, it } from 'vitest';

import { BASE_DELAY_MS, computeBackoff, JITTER_RATIO, MAX_ATTEMPTS, MAX_DELAY_MS } from './backoff';

/**
 * R5.1.c — pure-function tests for the retry-backoff formula.
 */
describe('computeBackoff', () => {
  it('produces roughly base * 2^attempt for early attempts (with jitter applied)', () => {
    // Fixed random=0.5 removes jitter (0.5 lands mid-range, multiplier = 1).
    const r = () => 0.5;
    expect(computeBackoff(0, r)).toBe(BASE_DELAY_MS);
    expect(computeBackoff(1, r)).toBe(BASE_DELAY_MS * 2);
    expect(computeBackoff(2, r)).toBe(BASE_DELAY_MS * 4);
    expect(computeBackoff(3, r)).toBe(BASE_DELAY_MS * 8);
  });

  it('caps at MAX_DELAY_MS regardless of attempt', () => {
    const r = () => 0.5;
    expect(computeBackoff(4, r)).toBe(MAX_DELAY_MS);
    expect(computeBackoff(10, r)).toBe(MAX_DELAY_MS);
    expect(computeBackoff(100, r)).toBe(MAX_DELAY_MS);
  });

  it('applies jitter of ±JITTER_RATIO around the base', () => {
    // random=0 → lowest jitter (base * (1 - JITTER_RATIO))
    const low = computeBackoff(0, () => 0);
    expect(low).toBe(Math.round(BASE_DELAY_MS * (1 - JITTER_RATIO)));
    // random=1 (just below actually, but Math.random() < 1) → highest
    // (base * (1 + JITTER_RATIO)). We clamp with 0.9999 to stay inside.
    const high = computeBackoff(0, () => 0.9999);
    // Allow ±1ms rounding slack.
    expect(high).toBeGreaterThanOrEqual(Math.round(BASE_DELAY_MS * (1 + JITTER_RATIO)) - 1);
    expect(high).toBeLessThanOrEqual(Math.round(BASE_DELAY_MS * (1 + JITTER_RATIO)) + 1);
  });

  it('MAX_ATTEMPTS is 5 — the queue caps retries after that many failures', () => {
    expect(MAX_ATTEMPTS).toBe(5);
  });
});
