import { describe, expect, it } from 'vitest';

import { canDispatchFor } from './index';

/**
 * R5.1.d — pure-function tests for the offline write-block predicate.
 * Covers every (isServer, online, memberCount >= 2) combination.
 */
describe('canDispatchFor', () => {
  it('local mode: always allowed regardless of connectivity or member count', () => {
    expect(canDispatchFor(false, true, 1)).toBe(true);
    expect(canDispatchFor(false, true, 5)).toBe(true);
    expect(canDispatchFor(false, false, 1)).toBe(true);
    expect(canDispatchFor(false, false, 5)).toBe(true);
  });

  it('server mode + online: always allowed', () => {
    expect(canDispatchFor(true, true, 1)).toBe(true);
    expect(canDispatchFor(true, true, 2)).toBe(true);
    expect(canDispatchFor(true, true, 10)).toBe(true);
  });

  it('server mode + offline + solo (memberCount 1 or 0): allowed', () => {
    // Solo works offline indefinitely per OUTLINE §9; buffered writes
    // drain to the outbox (R5.1.c).
    expect(canDispatchFor(true, false, 0)).toBe(true);
    expect(canDispatchFor(true, false, 1)).toBe(true);
  });

  it('server mode + offline + multi-member (memberCount >= 2): BLOCKED', () => {
    // The one forbidden combination per §9 — a write here would
    // desync from other members.
    expect(canDispatchFor(true, false, 2)).toBe(false);
    expect(canDispatchFor(true, false, 3)).toBe(false);
    expect(canDispatchFor(true, false, 10)).toBe(false);
  });
});
