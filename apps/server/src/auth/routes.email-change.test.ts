/**
 * R10.1 — integration tests for the /auth/email/change/* dual-OTP flow.
 *
 * Mirrors routes.email.test.ts + routes.discord-link.test.ts:
 *   - Build the real Fastify app via `buildServer`.
 *   - Inject the in-memory `MailService` mock (`setupMailerMock`) to capture
 *     the OTP codes sent to the CURRENT then the NEW address.
 *   - Seed an authenticated session (email user) and drive via `app.inject()`.
 *   - Assert against DB rows (User.email swap, PendingEmailChange lifecycle)
 *     + response codes + sent mail.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../prisma/generated/prisma/client.js';
import type { Env } from '../config/env.js';
import { buildServer } from '../server.js';
import { setupMailerMock } from '../test/mailer-mock.js';
import { sessionCookieName } from './config.js';
import { createSessionForUser } from './session.js';

const TEST_DB_URL =
  process.env['DATABASE_URL_TEST'] ?? 'postgresql://dnd:dnd@localhost:5434/dnd_inv_test';

const baseEnv: Env = {
  NODE_ENV: 'test',
  PORT: 0,
  HOST: '127.0.0.1',
  LOG_LEVEL: 'silent',
  DATABASE_URL: TEST_DB_URL,
  WEB_ORIGIN: 'http://localhost:5173',
  AUTH_SECRET: 'test-secret-padding-to-meet-32-char-min-XXXXXX',
  SESSION_COOKIE_INSECURE: false,
  SNAPSHOTS_ENABLED: false,
  SNAPSHOT_DIR: './snapshots',
  SNAPSHOT_RETENTION_DAYS: 30,
  EMAIL_ATTEMPT_SWEEP_ENABLED: false,
  EMAIL_ATTEMPT_SWEEP_RETENTION_HOURS: 24,
  PENDING_LINK_SWEEP_ENABLED: false,
};

const envWithSmtp: Env = {
  ...baseEnv,
  SMTP_HOST: 'smtp.test',
  SMTP_PORT: 587,
  SMTP_USER: 'test-user',
  SMTP_PASS: 'test-pass',
  SMTP_FROM: 'dnd@test.example',
};

let prisma: PrismaClient;

beforeAll(() => {
  const adapter = new PrismaPg({ connectionString: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "PendingEmailChange", "EmailAuthAttempt", "VerificationToken", "Session", "Account", "User" CASCADE',
  );
});

const CURRENT_EMAIL = 'alice@example.com';
const NEW_EMAIL = 'alice-new@example.com';

async function seedEmailUser(email = CURRENT_EMAIL): Promise<{ userId: string }> {
  const userId = `u-${Math.random().toString(36).slice(2, 10)}`;
  await prisma.user.create({
    data: {
      id: userId,
      displayName: 'Alice',
      email,
      emailVerified: new Date(),
      needsDisplayName: false,
    },
  });
  return { userId };
}

async function seedDiscordOnlyUser(): Promise<{ userId: string }> {
  const userId = `d-${Math.random().toString(36).slice(2, 10)}`;
  await prisma.user.create({
    data: { id: userId, displayName: 'Dana', discordId: `snow-${userId}` },
  });
  return { userId };
}

async function cookieFor(userId: string): Promise<string> {
  const { sessionToken } = await createSessionForUser(prisma, userId);
  return `${sessionCookieName(baseEnv)}=${sessionToken}`;
}

/** Drive start → verify-current → verify-new. Returns the final response. */
async function runFullChange(
  app: Awaited<ReturnType<typeof buildServer>>,
  cookie: string,
  mailer: ReturnType<typeof setupMailerMock>,
  newEmail = NEW_EMAIL,
) {
  const start = await app.inject({
    method: 'POST',
    url: '/auth/email/change/start',
    headers: { cookie },
    payload: { newEmail },
  });
  expect(start.statusCode).toBe(200);
  const { token } = start.json<{ token: string }>();
  // First code went to the CURRENT address.
  const curCode = mailer.sent.at(-1)!;
  expect(curCode.to).toBe(CURRENT_EMAIL);

  const vc = await app.inject({
    method: 'POST',
    url: '/auth/email/change/verify-current',
    headers: { cookie },
    payload: { token, otp: curCode.code },
  });
  expect(vc.statusCode).toBe(200);
  // Second code went to the NEW address.
  const newCode = mailer.sent.at(-1)!;
  expect(newCode.to).toBe(newEmail);

  const vn = await app.inject({
    method: 'POST',
    url: '/auth/email/change/verify-new',
    headers: { cookie },
    payload: { token, otp: newCode.code },
  });
  return { token, vn };
}

describe('POST /auth/email/change — happy path', () => {
  it('swaps User.email, clears the pending row, and reaps old EmailAuthAttempt rows', async () => {
    const { userId } = await seedEmailUser();
    const cookie = await cookieFor(userId);
    // A stale lockout row for the OLD address that should be reaped on commit.
    await prisma.emailAuthAttempt.create({
      data: { email: CURRENT_EMAIL, ip: '1.2.3.4', failedCount: 1 },
    });

    const mailer = setupMailerMock();
    const app = await buildServer({ env: envWithSmtp, prisma, mailService: mailer.service });
    try {
      const { vn } = await runFullChange(app, cookie, mailer);
      expect(vn.statusCode).toBe(200);
      expect(vn.json<{ user: { email: string } }>().user.email).toBe(NEW_EMAIL);

      const after = await prisma.user.findUnique({ where: { id: userId } });
      expect(after?.email).toBe(NEW_EMAIL);
      expect(after?.emailVerified).not.toBeNull();

      expect(await prisma.pendingEmailChange.count()).toBe(0);
      // Old-address lockout row reaped.
      expect(await prisma.emailAuthAttempt.count({ where: { email: CURRENT_EMAIL } })).toBe(0);
      // Both OTP codes consumed.
      expect(await prisma.verificationToken.count()).toBe(0);
    } finally {
      await app.close();
    }
  });
});

describe('POST /auth/email/change/start — guards', () => {
  it('401 when unauthenticated', async () => {
    const mailer = setupMailerMock();
    const app = await buildServer({ env: envWithSmtp, prisma, mailService: mailer.service });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/email/change/start',
        payload: { newEmail: NEW_EMAIL },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('400 no_current_email for a Discord-only account', async () => {
    const { userId } = await seedDiscordOnlyUser();
    const cookie = await cookieFor(userId);
    const mailer = setupMailerMock();
    const app = await buildServer({ env: envWithSmtp, prisma, mailService: mailer.service });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/email/change/start',
        headers: { cookie },
        payload: { newEmail: NEW_EMAIL },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'no_current_email' });
    } finally {
      await app.close();
    }
  });

  it('400 email_unchanged when newEmail equals the current email', async () => {
    const { userId } = await seedEmailUser();
    const cookie = await cookieFor(userId);
    const mailer = setupMailerMock();
    const app = await buildServer({ env: envWithSmtp, prisma, mailService: mailer.service });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/email/change/start',
        headers: { cookie },
        payload: { newEmail: CURRENT_EMAIL },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'email_unchanged' });
    } finally {
      await app.close();
    }
  });

  it('409 email_already_linked when the new address belongs to another user', async () => {
    const { userId } = await seedEmailUser();
    await prisma.user.create({
      data: { id: 'other', displayName: 'Bob', email: NEW_EMAIL, emailVerified: new Date() },
    });
    const cookie = await cookieFor(userId);
    const mailer = setupMailerMock();
    const app = await buildServer({ env: envWithSmtp, prisma, mailService: mailer.service });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/email/change/start',
        headers: { cookie },
        payload: { newEmail: NEW_EMAIL },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'email_already_linked' });
    } finally {
      await app.close();
    }
  });

  it('multi-tab: a second start invalidates the first pending row (token rotates)', async () => {
    const { userId } = await seedEmailUser();
    const cookie = await cookieFor(userId);
    const mailer = setupMailerMock();
    const app = await buildServer({ env: envWithSmtp, prisma, mailService: mailer.service });
    try {
      const s1 = await app.inject({
        method: 'POST',
        url: '/auth/email/change/start',
        headers: { cookie },
        payload: { newEmail: NEW_EMAIL },
      });
      const t1 = s1.json<{ token: string }>().token;
      const s2 = await app.inject({
        method: 'POST',
        url: '/auth/email/change/start',
        headers: { cookie },
        payload: { newEmail: 'alice-other@example.com' },
      });
      const t2 = s2.json<{ token: string }>().token;
      expect(t2).not.toBe(t1);
      // Only one pending row (upsert), holding the second token/email.
      expect(await prisma.pendingEmailChange.count()).toBe(1);
      const row = await prisma.pendingEmailChange.findUnique({ where: { userId } });
      expect(row?.token).toBe(t2);
      expect(row?.newEmail).toBe('alice-other@example.com');
      // The first token is now rejected at verify-current.
      const curCode = mailer.sent.at(-1)!;
      const vc = await app.inject({
        method: 'POST',
        url: '/auth/email/change/verify-current',
        headers: { cookie },
        payload: { token: t1, otp: curCode.code },
      });
      expect(vc.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});

describe('POST /auth/email/change/verify-current', () => {
  it('locks out after 5 wrong codes', async () => {
    const { userId } = await seedEmailUser();
    const cookie = await cookieFor(userId);
    const mailer = setupMailerMock();
    const app = await buildServer({ env: envWithSmtp, prisma, mailService: mailer.service });
    try {
      const start = await app.inject({
        method: 'POST',
        url: '/auth/email/change/start',
        headers: { cookie },
        payload: { newEmail: NEW_EMAIL },
      });
      const token = start.json<{ token: string }>().token;
      for (let i = 0; i < 5; i++) {
        const r = await app.inject({
          method: 'POST',
          url: '/auth/email/change/verify-current',
          headers: { cookie },
          payload: { token, otp: '00000001' },
        });
        expect(r.statusCode).toBe(401);
      }
      // 6th attempt (even the correct code) is now rate-limited.
      const curCode = mailer.sent.at(-1)!;
      const locked = await app.inject({
        method: 'POST',
        url: '/auth/email/change/verify-current',
        headers: { cookie },
        payload: { token, otp: curCode.code },
      });
      expect(locked.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });
});

describe('POST /auth/email/change/verify-new', () => {
  it('409 current_not_verified when the current leg has not been confirmed', async () => {
    const { userId } = await seedEmailUser();
    const cookie = await cookieFor(userId);
    const mailer = setupMailerMock();
    const app = await buildServer({ env: envWithSmtp, prisma, mailService: mailer.service });
    try {
      const start = await app.inject({
        method: 'POST',
        url: '/auth/email/change/start',
        headers: { cookie },
        payload: { newEmail: NEW_EMAIL },
      });
      const token = start.json<{ token: string }>().token;
      const res = await app.inject({
        method: 'POST',
        url: '/auth/email/change/verify-new',
        headers: { cookie },
        payload: { token, otp: '00000000' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'current_not_verified' });
    } finally {
      await app.close();
    }
  });

  it('409 email_already_linked when the new address is claimed between start and commit', async () => {
    const { userId } = await seedEmailUser();
    const cookie = await cookieFor(userId);
    const mailer = setupMailerMock();
    const app = await buildServer({ env: envWithSmtp, prisma, mailService: mailer.service });
    try {
      const start = await app.inject({
        method: 'POST',
        url: '/auth/email/change/start',
        headers: { cookie },
        payload: { newEmail: NEW_EMAIL },
      });
      const token = start.json<{ token: string }>().token;
      const curCode = mailer.sent.at(-1)!;
      await app.inject({
        method: 'POST',
        url: '/auth/email/change/verify-current',
        headers: { cookie },
        payload: { token, otp: curCode.code },
      });
      const newCode = mailer.sent.at(-1)!;
      // Race: another user grabs NEW_EMAIL before we commit.
      await prisma.user.create({
        data: { id: 'racer', displayName: 'Rae', email: NEW_EMAIL, emailVerified: new Date() },
      });
      const res = await app.inject({
        method: 'POST',
        url: '/auth/email/change/verify-new',
        headers: { cookie },
        payload: { token, otp: newCode.code },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'email_already_linked' });
      // Original user's email untouched.
      expect((await prisma.user.findUnique({ where: { id: userId } }))?.email).toBe(CURRENT_EMAIL);
    } finally {
      await app.close();
    }
  });
});

describe('POST /auth/email/change/abort', () => {
  it('deletes the pending row and both codes', async () => {
    const { userId } = await seedEmailUser();
    const cookie = await cookieFor(userId);
    const mailer = setupMailerMock();
    const app = await buildServer({ env: envWithSmtp, prisma, mailService: mailer.service });
    try {
      const start = await app.inject({
        method: 'POST',
        url: '/auth/email/change/start',
        headers: { cookie },
        payload: { newEmail: NEW_EMAIL },
      });
      const token = start.json<{ token: string }>().token;
      expect(await prisma.pendingEmailChange.count()).toBe(1);
      const res = await app.inject({
        method: 'POST',
        url: '/auth/email/change/abort',
        headers: { cookie },
        payload: { token },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'aborted' });
      expect(await prisma.pendingEmailChange.count()).toBe(0);
      expect(await prisma.verificationToken.count()).toBe(0);
    } finally {
      await app.close();
    }
  });
});
