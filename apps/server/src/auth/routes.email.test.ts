/**
 * R3.3 — integration tests for the /auth/email/* routes.
 *
 * Mirrors the pattern of routes.test.ts:
 *   - Build the real Fastify app via `buildServer`.
 *   - Inject the in-memory `MailService` mock (`setupMailerMock`).
 *   - Drive the flow via `app.inject()`.
 *   - Assert against DB rows + response headers + sent mail.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../prisma/generated/prisma/client.js';
import type { Env } from '../config/env.js';
import { buildServer } from '../server.js';
import { setupMailerMock } from '../test/mailer-mock.js';
import { sessionCookieName } from './config.js';

const TEST_DB_URL =
  process.env['DATABASE_URL_TEST'] ?? 'postgresql://dnd:dnd@localhost:5433/dnd_inv_test';

const baseEnv: Env = {
  NODE_ENV: 'test',
  PORT: 0,
  HOST: '127.0.0.1',
  LOG_LEVEL: 'silent',
  DATABASE_URL: TEST_DB_URL,
  WEB_ORIGIN: 'http://localhost:5173',
  AUTH_SECRET: 'test-secret-padding-to-meet-32-char-min-XXXXXX',
  SNAPSHOTS_ENABLED: false,
  SNAPSHOT_DIR: './snapshots',
  SNAPSHOT_RETENTION_DAYS: 30,
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
    'TRUNCATE TABLE "EmailAuthAttempt", "VerificationToken", "Session", "Account", "User" CASCADE',
  );
});

describe('POST /auth/email/request-otp (R3.3)', () => {
  it('returns 503 with email_auth_disabled when SMTP env vars are absent', async () => {
    const app = await buildServer({ env: baseEnv, prisma });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/email/request-otp',
        payload: { email: 'x@y.com' },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ error: 'email_auth_disabled' });
    } finally {
      await app.close();
    }
  });

  it('returns 400 on invalid email shape', async () => {
    const mailer = setupMailerMock();
    const app = await buildServer({ env: envWithSmtp, prisma, mailService: mailer.service });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/email/request-otp',
        payload: { email: 'not-an-email' },
      });
      expect(res.statusCode).toBe(400);
      expect(mailer.sent).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('writes a VerificationToken row + sends mail with 8-digit code on happy path', async () => {
    const mailer = setupMailerMock();
    const app = await buildServer({ env: envWithSmtp, prisma, mailService: mailer.service });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/email/request-otp',
        payload: { email: 'alice@example.com' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'sent' });
      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]!.to).toBe('alice@example.com');
      expect(mailer.sent[0]!.code).toMatch(/^\d{8}$/);

      const row = await prisma.verificationToken.findFirst({
        where: { identifier: 'otp:alice@example.com' },
      });
      expect(row).not.toBeNull();
      expect(row!.token).toBe(mailer.sent[0]!.code);
    } finally {
      await app.close();
    }
  });

  it('replaces any pending code for the same email on a fresh request', async () => {
    const mailer = setupMailerMock();
    const app = await buildServer({ env: envWithSmtp, prisma, mailService: mailer.service });
    try {
      await app.inject({
        method: 'POST',
        url: '/auth/email/request-otp',
        payload: { email: 'rotator@example.com' },
      });
      await app.inject({
        method: 'POST',
        url: '/auth/email/request-otp',
        payload: { email: 'rotator@example.com' },
      });
      const rows = await prisma.verificationToken.findMany({
        where: { identifier: 'otp:rotator@example.com' },
      });
      expect(rows).toHaveLength(1);
      expect(mailer.sent).toHaveLength(2);
      expect(rows[0]!.token).toBe(mailer.sent[1]!.code);
    } finally {
      await app.close();
    }
  });

  it('returns 200 for a registered AND an unregistered email (no enumeration)', async () => {
    const mailer = setupMailerMock();
    const app = await buildServer({ env: envWithSmtp, prisma, mailService: mailer.service });
    try {
      // pre-create one of the users
      await prisma.user.create({
        data: {
          email: 'known@example.com',
          emailVerified: new Date(),
          displayName: 'Known',
        },
      });

      const known = await app.inject({
        method: 'POST',
        url: '/auth/email/request-otp',
        payload: { email: 'known@example.com' },
      });
      const unknown = await app.inject({
        method: 'POST',
        url: '/auth/email/request-otp',
        payload: { email: 'unknown@example.com' },
      });
      expect(known.statusCode).toBe(200);
      expect(unknown.statusCode).toBe(200);
      // Both branches send mail — request-otp is willing to send to brand
      // new addresses because email-only signup is a thing in R3.3.
      expect(mailer.sent).toHaveLength(2);
    } finally {
      await app.close();
    }
  });
});

describe('POST /auth/email/verify-otp (R3.3)', () => {
  it('returns 503 when SMTP unconfigured', async () => {
    const app = await buildServer({ env: baseEnv, prisma });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/email/verify-otp',
        payload: { email: 'a@b.com', otp: '12345678' },
      });
      expect(res.statusCode).toBe(503);
    } finally {
      await app.close();
    }
  });

  it('returns 400 on malformed otp (non-numeric or wrong length)', async () => {
    const mailer = setupMailerMock();
    const app = await buildServer({ env: envWithSmtp, prisma, mailService: mailer.service });
    try {
      const r1 = await app.inject({
        method: 'POST',
        url: '/auth/email/verify-otp',
        payload: { email: 'a@b.com', otp: 'abcdefgh' },
      });
      expect(r1.statusCode).toBe(400);

      const r2 = await app.inject({
        method: 'POST',
        url: '/auth/email/verify-otp',
        payload: { email: 'a@b.com', otp: '123' },
      });
      expect(r2.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('happy path: creates a User with needsDisplayName=true, issues session cookie, consumes the code', async () => {
    const mailer = setupMailerMock();
    const app = await buildServer({ env: envWithSmtp, prisma, mailService: mailer.service });
    try {
      await app.inject({
        method: 'POST',
        url: '/auth/email/request-otp',
        payload: { email: 'newuser@example.com' },
      });
      const code = mailer.sent[0]!.code;

      const verify = await app.inject({
        method: 'POST',
        url: '/auth/email/verify-otp',
        payload: { email: 'newuser@example.com', otp: code },
      });
      expect(verify.statusCode).toBe(200);
      const body = verify.json<{
        user: { id: string; displayName: string; needsDisplayName: boolean };
        expires: string;
      }>();
      expect(body.user.needsDisplayName).toBe(true);
      expect(body.user.displayName).toBe('');

      // Session cookie is set under the dev cookie name (NODE_ENV=test).
      const setCookie = verify.headers['set-cookie'];
      const cookieHeader = Array.isArray(setCookie) ? setCookie.join(';') : (setCookie ?? '');
      expect(cookieHeader).toContain(sessionCookieName(envWithSmtp) + '=');

      // The VerificationToken row is gone.
      const remaining = await prisma.verificationToken.findMany({
        where: { identifier: 'otp:newuser@example.com' },
      });
      expect(remaining).toHaveLength(0);

      // The Session row exists.
      const sessions = await prisma.session.findMany({
        where: { userId: body.user.id },
      });
      expect(sessions).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it('returns 401 on wrong code and increments EmailAuthAttempt.failedCount', async () => {
    const mailer = setupMailerMock();
    const app = await buildServer({ env: envWithSmtp, prisma, mailService: mailer.service });
    try {
      await app.inject({
        method: 'POST',
        url: '/auth/email/request-otp',
        payload: { email: 'wrong@example.com' },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/auth/email/verify-otp',
        payload: { email: 'wrong@example.com', otp: '00000000' },
      });
      expect(res.statusCode).toBe(401);

      const attempt = await prisma.emailAuthAttempt.findFirst({
        where: { email: 'wrong@example.com' },
      });
      expect(attempt?.failedCount).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('after 5 wrong attempts: invalidates the code AND locks out further requests', async () => {
    const mailer = setupMailerMock();
    const app = await buildServer({ env: envWithSmtp, prisma, mailService: mailer.service });
    try {
      await app.inject({
        method: 'POST',
        url: '/auth/email/request-otp',
        payload: { email: 'brute@example.com' },
      });
      const correctCode = mailer.sent[0]!.code;

      // Burn 5 wrong attempts.
      for (let i = 0; i < 5; i++) {
        const r = await app.inject({
          method: 'POST',
          url: '/auth/email/verify-otp',
          payload: { email: 'brute@example.com', otp: '00000000' },
        });
        expect(r.statusCode).toBe(401);
      }

      // Code is now invalidated — even the correct code returns 401
      // (well: 429, since we're also locked out).
      const final = await app.inject({
        method: 'POST',
        url: '/auth/email/verify-otp',
        payload: { email: 'brute@example.com', otp: correctCode },
      });
      expect(final.statusCode).toBe(429);
      expect(final.headers['retry-after']).toBeDefined();

      // The VerificationToken row is gone.
      const remaining = await prisma.verificationToken.findMany({
        where: { identifier: 'otp:brute@example.com' },
      });
      expect(remaining).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('returns 401 when the code has expired (past row.expires)', async () => {
    const mailer = setupMailerMock();
    const app = await buildServer({ env: envWithSmtp, prisma, mailService: mailer.service });
    try {
      // Plant an already-expired token directly.
      await prisma.verificationToken.create({
        data: {
          identifier: 'otp:expired@example.com',
          token: '11111111',
          expires: new Date(Date.now() - 60_000),
        },
      });
      const res = await app.inject({
        method: 'POST',
        url: '/auth/email/verify-otp',
        payload: { email: 'expired@example.com', otp: '11111111' },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('single-use: replaying the same code returns 401', async () => {
    const mailer = setupMailerMock();
    const app = await buildServer({ env: envWithSmtp, prisma, mailService: mailer.service });
    try {
      await app.inject({
        method: 'POST',
        url: '/auth/email/request-otp',
        payload: { email: 'replay@example.com' },
      });
      const code = mailer.sent[0]!.code;

      const first = await app.inject({
        method: 'POST',
        url: '/auth/email/verify-otp',
        payload: { email: 'replay@example.com', otp: code },
      });
      expect(first.statusCode).toBe(200);

      const second = await app.inject({
        method: 'POST',
        url: '/auth/email/verify-otp',
        payload: { email: 'replay@example.com', otp: code },
      });
      expect(second.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});

describe('POST /auth/email/link/* (R3.3)', () => {
  /**
   * Helper: sign in a Discord user (via the existing R3.2 path simulation —
   * we just create the User + Session rows directly because we're not
   * exercising Discord here).
   */
  async function createDiscordSession(email?: string | null): Promise<{
    userId: string;
    sessionToken: string;
  }> {
    const userId = 'user-' + crypto.randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        displayName: 'Pre-existing Discord User',
        discordId: 'discord-' + userId,
        ...(email !== undefined && email !== null ? { email, emailVerified: new Date() } : {}),
      },
    });
    const sessionToken = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
    await prisma.session.create({
      data: {
        sessionToken,
        userId,
        expires: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    return { userId, sessionToken };
  }

  it('link/request-otp returns 401 without an authenticated session', async () => {
    const mailer = setupMailerMock();
    const app = await buildServer({ env: envWithSmtp, prisma, mailService: mailer.service });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/email/link/request-otp',
        payload: { email: 'add@example.com' },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('link flow happy path: attaches email + emailVerified to existing user', async () => {
    const mailer = setupMailerMock();
    const app = await buildServer({ env: envWithSmtp, prisma, mailService: mailer.service });
    try {
      const { userId, sessionToken } = await createDiscordSession();
      const cookieHeader = `${sessionCookieName(envWithSmtp)}=${sessionToken}`;

      await app.inject({
        method: 'POST',
        url: '/auth/email/link/request-otp',
        payload: { email: 'add@example.com' },
        headers: { cookie: cookieHeader },
      });
      expect(mailer.sent).toHaveLength(1);
      const code = mailer.sent[0]!.code;

      const verify = await app.inject({
        method: 'POST',
        url: '/auth/email/link/verify-otp',
        payload: { email: 'add@example.com', otp: code },
        headers: { cookie: cookieHeader },
      });
      expect(verify.statusCode).toBe(200);

      const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(user.email).toBe('add@example.com');
      expect(user.emailVerified).not.toBeNull();
    } finally {
      await app.close();
    }
  });

  it('link verify returns 409 when email is already attached to a different user', async () => {
    const mailer = setupMailerMock();
    const app = await buildServer({ env: envWithSmtp, prisma, mailService: mailer.service });
    try {
      // User A owns the email; user B is signed in trying to claim it.
      await prisma.user.create({
        data: {
          email: 'taken@example.com',
          emailVerified: new Date(),
          displayName: 'Owner',
        },
      });
      const { sessionToken } = await createDiscordSession();
      const cookieHeader = `${sessionCookieName(envWithSmtp)}=${sessionToken}`;

      await app.inject({
        method: 'POST',
        url: '/auth/email/link/request-otp',
        payload: { email: 'taken@example.com' },
        headers: { cookie: cookieHeader },
      });
      const code = mailer.sent[0]!.code;

      const verify = await app.inject({
        method: 'POST',
        url: '/auth/email/link/verify-otp',
        payload: { email: 'taken@example.com', otp: code },
        headers: { cookie: cookieHeader },
      });
      expect(verify.statusCode).toBe(409);
      expect(verify.json()).toEqual({ error: 'email_already_linked' });
    } finally {
      await app.close();
    }
  });
});

describe('POST /auth/email/set-display-name (R3.3)', () => {
  /**
   * Helper: create an email-only user mid-onboarding (needsDisplayName=true,
   * displayName='') and an active session. Mirrors what verify-otp produces.
   */
  async function createPendingEmailUser(): Promise<{ userId: string; sessionToken: string }> {
    const userId = 'user-' + crypto.randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        displayName: '',
        email: `pending-${userId}@example.com`,
        emailVerified: new Date(),
        needsDisplayName: true,
      },
    });
    const sessionToken = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
    await prisma.session.create({
      data: {
        sessionToken,
        userId,
        expires: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    return { userId, sessionToken };
  }

  it('returns 401 without an authenticated session', async () => {
    const mailer = setupMailerMock();
    const app = await buildServer({ env: envWithSmtp, prisma, mailService: mailer.service });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/email/set-display-name',
        payload: { displayName: 'Alice' },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('returns 400 on empty displayName', async () => {
    const mailer = setupMailerMock();
    const app = await buildServer({ env: envWithSmtp, prisma, mailService: mailer.service });
    try {
      const { sessionToken } = await createPendingEmailUser();
      const res = await app.inject({
        method: 'POST',
        url: '/auth/email/set-display-name',
        payload: { displayName: '' },
        headers: { cookie: `${sessionCookieName(envWithSmtp)}=${sessionToken}` },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('happy path: sets displayName and flips needsDisplayName: false', async () => {
    const mailer = setupMailerMock();
    const app = await buildServer({ env: envWithSmtp, prisma, mailService: mailer.service });
    try {
      const { userId, sessionToken } = await createPendingEmailUser();
      const res = await app.inject({
        method: 'POST',
        url: '/auth/email/set-display-name',
        payload: { displayName: 'Alice' },
        headers: { cookie: `${sessionCookieName(envWithSmtp)}=${sessionToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<{
        user: { id: string; displayName: string; needsDisplayName: boolean };
      }>();
      expect(body.user.displayName).toBe('Alice');
      expect(body.user.needsDisplayName).toBe(false);

      const persisted = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(persisted.displayName).toBe('Alice');
      expect(persisted.needsDisplayName).toBe(false);
    } finally {
      await app.close();
    }
  });

  it('is idempotent: rename after needsDisplayName=false is allowed (200)', async () => {
    const mailer = setupMailerMock();
    const app = await buildServer({ env: envWithSmtp, prisma, mailService: mailer.service });
    try {
      const { userId, sessionToken } = await createPendingEmailUser();
      // first call sets name
      await app.inject({
        method: 'POST',
        url: '/auth/email/set-display-name',
        payload: { displayName: 'First' },
        headers: { cookie: `${sessionCookieName(envWithSmtp)}=${sessionToken}` },
      });
      // second call (flag already false) renames
      const res = await app.inject({
        method: 'POST',
        url: '/auth/email/set-display-name',
        payload: { displayName: 'Second' },
        headers: { cookie: `${sessionCookieName(envWithSmtp)}=${sessionToken}` },
      });
      expect(res.statusCode).toBe(200);
      const persisted = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(persisted.displayName).toBe('Second');
      expect(persisted.needsDisplayName).toBe(false);
    } finally {
      await app.close();
    }
  });
});
