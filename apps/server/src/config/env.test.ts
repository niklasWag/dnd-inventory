import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadEnv } from './env.js';

/**
 * Unit tests for `loadEnv`. Mutates `process.env` per-test via vi.stubEnv,
 * then restores. The schema itself is a thin Zod parse; the interesting
 * behavior is the production-only soft-warn for missing Discord / SMTP
 * env vars (R3.5 — replaces the previous fail-fast: SECURITY §1.2 says
 * "misconfig disables the feature", and the route layer already self-
 * disables with 503).
 */

const minimalEnv = {
  DATABASE_URL: 'postgresql://stub:stub@localhost:5432/stub',
  AUTH_SECRET: 'test-secret-padding-to-meet-32-char-min-XXXXXX',
};

/**
 * Test helper — vitest's `vi.stubEnv(k, '')` SETS the var to empty string,
 * which Zod's `.optional()` treats as "present but invalid" (the regexes
 * for `z.email()` / `z.url()` reject the empty string). To express
 * "this var is absent", we have to `delete process.env[k]` directly and
 * restore on teardown.
 */
const AUTH_VARS = [
  'NODE_ENV',
  'DATABASE_URL',
  'AUTH_SECRET',
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'DISCORD_REDIRECT_URI',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM',
] as const;
const originalEnv: Record<string, string | undefined> = {};

function applyEnv(values: Record<string, string | undefined>): void {
  for (const k of AUTH_VARS) {
    // Reset to absent at the start of each apply call.
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(values)) {
    if (v !== undefined) process.env[k] = v;
  }
}

let warnSpy: ReturnType<typeof vi.spyOn>;

function warnMessages(): string[] {
  return warnSpy.mock.calls.map((args: unknown[]) => String(args[0]));
}

beforeEach(() => {
  // Snapshot only the keys we touch so we can restore them cleanly.
  for (const k of AUTH_VARS) originalEnv[k] = process.env[k];
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  for (const k of AUTH_VARS) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
  warnSpy.mockRestore();
});

describe('loadEnv — non-production', () => {
  it('parses successfully with only DATABASE_URL + AUTH_SECRET set', () => {
    applyEnv({ ...minimalEnv, NODE_ENV: 'development' });
    const env = loadEnv();
    expect(env.NODE_ENV).toBe('development');
    expect(env.DISCORD_CLIENT_ID).toBeUndefined();
    expect(env.SMTP_HOST).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not warn when Discord/SMTP are absent and NODE_ENV is not production', () => {
    applyEnv({ ...minimalEnv, NODE_ENV: 'test' });
    loadEnv();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('loadEnv — production soft-warn (R3.5)', () => {
  it('does NOT throw when Discord vars are missing in production', () => {
    applyEnv({ ...minimalEnv, NODE_ENV: 'production' });
    expect(() => loadEnv()).not.toThrow();
  });

  it('warns about missing Discord vars in production', () => {
    applyEnv({
      ...minimalEnv,
      NODE_ENV: 'production',
      // All SMTP vars present — only Discord missing.
      SMTP_HOST: 'smtp.test',
      SMTP_PORT: '587',
      SMTP_USER: 'u',
      SMTP_PASS: 'p',
      SMTP_FROM: 'a@b.test',
    });
    loadEnv();
    const messages = warnMessages();
    expect(messages.some((m) => /Discord OAuth is DISABLED/.test(m))).toBe(true);
    expect(messages.some((m) => /DISCORD_CLIENT_ID/.test(m))).toBe(true);
    // SMTP is fully set — no SMTP warning.
    expect(messages.some((m) => /Email OTP is DISABLED/.test(m))).toBe(false);
  });

  it('warns about missing SMTP vars in production', () => {
    applyEnv({
      ...minimalEnv,
      NODE_ENV: 'production',
      DISCORD_CLIENT_ID: 'cid',
      DISCORD_CLIENT_SECRET: 'csec',
      DISCORD_REDIRECT_URI: 'http://localhost:3000/auth/callback/discord',
    });
    loadEnv();
    const messages = warnMessages();
    expect(messages.some((m) => /Email OTP is DISABLED/.test(m))).toBe(true);
    expect(messages.some((m) => /SMTP_HOST/.test(m))).toBe(true);
    expect(messages.some((m) => /Discord OAuth is DISABLED/.test(m))).toBe(false);
  });

  it('emits a no-sign-in-methods warning when BOTH providers are missing', () => {
    applyEnv({ ...minimalEnv, NODE_ENV: 'production' });
    loadEnv();
    const messages = warnMessages();
    expect(messages.some((m) => /NO sign-in methods are configured/.test(m))).toBe(true);
  });

  it('does not warn when both Discord and SMTP are fully configured in production', () => {
    applyEnv({
      ...minimalEnv,
      NODE_ENV: 'production',
      DISCORD_CLIENT_ID: 'cid',
      DISCORD_CLIENT_SECRET: 'csec',
      DISCORD_REDIRECT_URI: 'http://localhost:3000/auth/callback/discord',
      SMTP_HOST: 'smtp.test',
      SMTP_PORT: '587',
      SMTP_USER: 'u',
      SMTP_PASS: 'p',
      SMTP_FROM: 'a@b.test',
    });
    loadEnv();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('treats empty-string optional vars the same as absent (docker-compose ${VAR:-} case)', () => {
    // docker-compose substitutes `${DISCORD_CLIENT_ID:-}` to an empty
    // string when the .env file omits the key, so the container env
    // has `DISCORD_CLIENT_ID=` (set but empty). Zod's `.optional()`
    // does NOT accept empty strings, so loadEnv must coerce them to
    // undefined before parsing. Regression test: this exact case used
    // to throw `Too small: expected string to have >=1 characters`.
    applyEnv({
      ...minimalEnv,
      NODE_ENV: 'production',
      DISCORD_CLIENT_ID: '',
      DISCORD_CLIENT_SECRET: '',
      DISCORD_REDIRECT_URI: '',
      SMTP_HOST: '',
      SMTP_PORT: '',
      SMTP_USER: '',
      SMTP_PASS: '',
      SMTP_FROM: '',
    });
    expect(() => loadEnv()).not.toThrow();
    const messages = warnMessages();
    // Both should warn as missing.
    expect(messages.some((m) => /Discord OAuth is DISABLED/.test(m))).toBe(true);
    expect(messages.some((m) => /Email OTP is DISABLED/.test(m))).toBe(true);
  });
});
