import { describe, expect, it } from 'vitest';

import { CLOCK_SKEW_TOLERANCE_MS, isValidUuidV7, newUuidV7, timestampFromUuidV7 } from './ids';

/**
 * RH1.1 — `ids.ts` covers the three surfaces every id-minting call site
 * needs after RH1.2 flips the authority from server-mint to client-mint:
 *
 * - `newUuidV7()`     — mint (client dispatch sites).
 * - `isValidUuidV7()` — validate shape (server guard layer).
 * - `timestampFromUuidV7()` — extract embedded timestamp (server clock-skew
 *   guard). Not exposed by the `uuid` package directly; a 6-byte read out
 *   of the first octets, per RFC 9562 §5.7.
 *
 * The tests below lock in the contract each of those functions offers.
 */
describe('ids — RH1.1', () => {
  describe('newUuidV7', () => {
    it('produces a 36-character canonical UUID string', () => {
      const id = newUuidV7();

      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(id).toHaveLength(36);
    });

    it('sets the version nibble to 7 (RFC 9562 §5.7)', () => {
      // The version nibble is the 15th character (index 14) — first char of the
      // third dash-separated group.
      const id = newUuidV7();

      expect(id[14]).toBe('7');
    });

    it('sets the variant bits to 10xx (RFC 9562 §4)', () => {
      // Variant nibble is the 20th character (index 19) — first char of the
      // fourth dash-separated group. Must be one of 8, 9, a, b (binary 10xx).
      const id = newUuidV7();

      expect(id[19]).toMatch(/^[89ab]$/);
    });

    it('emits monotonically-increasing ids across successive calls', () => {
      // UUID v7 embeds a 48-bit ms timestamp in the leading bytes. Time-
      // ordered lex sort must line up with mint order for logs / debugging
      // to be readable. Same-ms collisions are permitted by RFC 9562 but
      // vanishingly rare — we assert `>=` not `>`.
      const first = newUuidV7();
      const second = newUuidV7();
      const third = newUuidV7();

      expect(first <= second).toBe(true);
      expect(second <= third).toBe(true);
    });

    it('emits unique ids across a burst of mints', () => {
      // 74 bits of random entropy per ms — collisions are effectively impossible.
      const ids = new Set<string>();
      for (let i = 0; i < 1000; i++) {
        ids.add(newUuidV7());
      }

      expect(ids.size).toBe(1000);
    });
  });

  describe('isValidUuidV7', () => {
    it('accepts a fresh mint', () => {
      const id = newUuidV7();

      expect(isValidUuidV7(id)).toBe(true);
    });

    it('rejects a UUID v4', () => {
      // crypto.randomUUID() emits v4 (version nibble = 4).
      const v4 = crypto.randomUUID();

      expect(isValidUuidV7(v4)).toBe(false);
    });

    it('rejects a malformed string (wrong length)', () => {
      expect(isValidUuidV7('not-a-uuid')).toBe(false);
      expect(isValidUuidV7('')).toBe(false);
      // 35 chars — one short.
      expect(isValidUuidV7('01234567-89ab-7def-8123-456789abcde')).toBe(false);
    });

    it('rejects a non-hex character', () => {
      // Same length + version + variant nibbles, but a `z` mid-string.
      expect(isValidUuidV7('01234567-89ab-7def-8123-456z89abcdef')).toBe(false);
    });

    it('rejects a UUID with wrong version nibble', () => {
      // Version nibble at index 14 changed from 7 to 5.
      expect(isValidUuidV7('01234567-89ab-5def-8123-456789abcdef')).toBe(false);
    });

    it('rejects a UUID with wrong variant nibble', () => {
      // Variant nibble at index 19 changed from 8 to c (not 10xx).
      expect(isValidUuidV7('01234567-89ab-7def-c123-456789abcdef')).toBe(false);
    });

    it('accepts uppercase hex (case-insensitive per RFC 9562)', () => {
      const id = newUuidV7();

      expect(isValidUuidV7(id.toUpperCase())).toBe(true);
    });
  });

  describe('timestampFromUuidV7', () => {
    it('recovers the mint timestamp within ~1 ms', () => {
      const before = Date.now();
      const id = newUuidV7();
      const after = Date.now();

      const embedded = timestampFromUuidV7(id);

      expect(embedded).toBeGreaterThanOrEqual(before);
      expect(embedded).toBeLessThanOrEqual(after);
    });

    it('is monotonic with mint order across a burst', () => {
      const ts1 = timestampFromUuidV7(newUuidV7());
      const ts2 = timestampFromUuidV7(newUuidV7());
      const ts3 = timestampFromUuidV7(newUuidV7());

      expect(ts1).toBeLessThanOrEqual(ts2);
      expect(ts2).toBeLessThanOrEqual(ts3);
    });

    it('extracts the embedded timestamp from a hand-crafted v7 (RFC 9562 §5.7 vector)', () => {
      // RFC 9562 example: unix_ts_ms = 0x017F22E279B0. Fill the rest with a
      // valid version + variant + arbitrary tail.
      const rfcExample = '017f22e2-79b0-7cc3-98c4-dc0c0c07398f';
      // 0x017F22E279B0 = 1_645_557_742_000 ms since Unix epoch.
      const expected = 0x017f22e279b0;

      expect(timestampFromUuidV7(rfcExample)).toBe(expected);
    });

    it('throws when given a non-v7 UUID', () => {
      const v4 = crypto.randomUUID();

      expect(() => timestampFromUuidV7(v4)).toThrow();
    });
  });

  describe('CLOCK_SKEW_TOLERANCE_MS', () => {
    it('is exported as a positive number in the low minutes range', () => {
      // The RH1.1 charter fixes the default at ±5 minutes. Wide enough to
      // absorb a misconfigured client, narrow enough that backdated
      // forgeries can't poison the log.
      expect(CLOCK_SKEW_TOLERANCE_MS).toBe(5 * 60 * 1000);
    });
  });
});
