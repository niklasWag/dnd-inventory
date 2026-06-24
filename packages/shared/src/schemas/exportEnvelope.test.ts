import { describe, expect, it } from 'vitest';

import { exportEnvelopeSchema } from './exportEnvelope';

describe('exportEnvelopeSchema (M7)', () => {
  /**
   * The envelope wraps a `null` AppState too — that's the legitimate
   * "user exported before creating a character" state. The wrapper
   * parses; the inner payload is just the post-wipe blob shape.
   */
  it('parses a minimal empty-state envelope', () => {
    const fixture = {
      schemaVersion: 1,
      exportedAt: '2026-06-24T12:00:00.000Z',
      appVersion: '0.0.0',
      seedVersion: 0,
      payload: { appState: null, log: [] },
    };
    expect(exportEnvelopeSchema.parse(fixture)).toEqual(fixture);
  });

  /**
   * v2 / v0 envelopes are rejected at the wrapper. Future readers can
   * surface a friendly "this file is from a newer/older version" error
   * before they touch `payload`.
   */
  it('rejects schemaVersion !== 1', () => {
    const v0 = {
      schemaVersion: 0,
      exportedAt: '2026-06-24T12:00:00.000Z',
      appVersion: '0.0.0',
      seedVersion: 0,
      payload: { appState: null, log: [] },
    };
    const v2 = { ...v0, schemaVersion: 2 };
    expect(() => exportEnvelopeSchema.parse(v0)).toThrow();
    expect(() => exportEnvelopeSchema.parse(v2)).toThrow();
  });

  it('rejects negative seedVersion', () => {
    const bad = {
      schemaVersion: 1,
      exportedAt: '2026-06-24T12:00:00.000Z',
      appVersion: '0.0.0',
      seedVersion: -1,
      payload: { appState: null, log: [] },
    };
    expect(() => exportEnvelopeSchema.parse(bad)).toThrow();
  });
});
