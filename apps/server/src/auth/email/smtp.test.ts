/**
 * R3.3 — Tests for the SMTP wrapper. Uses `vi.mock` to replace Nodemailer
 * with a fake whose `sendMail` records calls in an exported array —
 * exercises the wrapper logic (renderOtpEmail → sendMail) without
 * actually opening a socket.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted shared state so the mock factory + tests both reference the
// same array. `vi.hoisted` is the recommended way to share state with a
// `vi.mock` factory; the factory runs before any module code so plain
// top-level `const` doesn't work.
const { sentMails } = vi.hoisted(() => ({
  sentMails: [] as Array<{
    from: string;
    to: string;
    subject: string;
    text: string;
    html: string;
  }>,
}));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => ({
      // Nodemailer's sendMail returns a Promise; declaring this as a
      // plain function returning a resolved promise satisfies the
      // interface without an empty async body (which eslint flags).
      sendMail: (mail: {
        from: string;
        to: string;
        subject: string;
        text: string;
        html: string;
      }) => {
        sentMails.push(mail);
        return Promise.resolve({ messageId: 'mock-' + sentMails.length });
      },
    })),
  },
}));

import { buildMailService } from './smtp.js';
import type { Env } from '../../config/env.js';

const env: Env = {
  NODE_ENV: 'test',
  PORT: 0,
  HOST: '127.0.0.1',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://dnd:dnd@localhost:5434/dnd_inv_test',
  WEB_ORIGIN: 'http://localhost:5173',
  AUTH_SECRET: 'test-secret-padding-to-meet-32-char-min-XXXXX',
  SESSION_COOKIE_INSECURE: false,
  SMTP_HOST: 'smtp.test',
  SMTP_PORT: 587,
  SMTP_USER: 'test-user',
  SMTP_PASS: 'test-pass',
  SMTP_FROM: 'dnd@test.example',
  SNAPSHOTS_ENABLED: false,
  SNAPSHOT_DIR: './snapshots',
  SNAPSHOT_RETENTION_DAYS: 30,
};

beforeEach(() => {
  sentMails.length = 0;
});

describe('buildMailService.sendOtp', () => {
  it('calls nodemailer.sendMail with from + to + subject + text + html', async () => {
    const svc = buildMailService(env);
    await svc.sendOtp('user@example.com', '12345678');

    expect(sentMails).toHaveLength(1);
    const mail = sentMails[0]!;
    expect(mail.from).toBe('dnd@test.example');
    expect(mail.to).toBe('user@example.com');
    expect(mail.subject).toContain('sign-in code');
  });

  it('includes the OTP in both `text` and `html` (no inline-image / CSS-hidden tricks)', async () => {
    const svc = buildMailService(env);
    await svc.sendOtp('user@example.com', '87654321');

    const mail = sentMails[0]!;
    expect(mail.text).toContain('87654321');
    expect(mail.html).toContain('87654321');
  });

  it('mentions the 15-minute expiry so users know not to ignore the code', async () => {
    const svc = buildMailService(env);
    await svc.sendOtp('user@example.com', '00000000');
    const mail = sentMails[0]!;
    expect(mail.text).toContain('15 minutes');
    expect(mail.html).toContain('15 minutes');
  });

  it('does not leak the OTP into any field other than text/html (e.g. subject)', async () => {
    const svc = buildMailService(env);
    await svc.sendOtp('user@example.com', '13579246');
    const mail = sentMails[0]!;
    expect(mail.subject).not.toContain('13579246');
    expect(mail.from).not.toContain('13579246');
    expect(mail.to).not.toContain('13579246');
  });
});
