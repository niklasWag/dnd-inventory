/**
 * R3.5 — integration tests for the Discord-account-link OAuth flow.
 *
 * The flow owns its OAuth code-exchange at the route layer (NOT via
 * Auth.js), so testing reduces to:
 *
 *   1. Drive `GET /auth/discord/login?link=1` with an authenticated
 *      session — assert redirect to `/auth/discord/link/initiate`,
 *      which mints a PendingDiscordLink row and 302s to `/start?token=`.
 *   2. Drive `GET /auth/discord/link/start?token=...` — assert 302 to
 *      `discord.com/api/oauth2/authorize?...`, including PKCE challenge
 *      and HMAC-signed state, and a `r35-discord-link-pkce` cookie.
 *   3. Drive `GET /auth/callback/discord/link?code=...&state=...` with
 *      the cookies from step 2, a stubbed Discord token endpoint, and
 *      a stubbed userinfo endpoint — assert
 *      `User.discordId = <snowflake>` and a redirect to
 *      `${WEB_ORIGIN}/settings?linked=discord`.
 *   4. Repeat step 3 with a snowflake already attached to a DIFFERENT
 *      user — assert the redirect carries
 *      `?linkError=discord_already_linked`.
 *   5. Unauthenticated `?link=1` → 401.
 *   6. Tampered state HMAC → linkError=invalid_state redirect.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../prisma/generated/prisma/client.js';
import type { Env } from '../config/env.js';
import { sessionCookieName } from '../auth/config.js';
import { createSessionForUser } from '../auth/session.js';
import { buildServer } from '../server.js';

const TEST_DB_URL =
  process.env['DATABASE_URL_TEST'] ?? 'postgresql://dnd:dnd@localhost:5434/dnd_inv_test';

const env: Env = {
  NODE_ENV: 'test',
  PORT: 0,
  HOST: '127.0.0.1',
  LOG_LEVEL: 'silent',
  DATABASE_URL: TEST_DB_URL,
  WEB_ORIGIN: 'http://localhost:5173',
  AUTH_SECRET: 'test-secret-padding-to-meet-32-char-min-XXXXXX',
  SESSION_COOKIE_INSECURE: false,
  // Discord creds are required for the link routes to be enabled.
  DISCORD_CLIENT_ID: 'test-client-id',
  DISCORD_CLIENT_SECRET: 'test-client-secret',
  DISCORD_REDIRECT_URI: 'http://localhost:3000/auth/callback/discord',
  SNAPSHOTS_ENABLED: false,
  SNAPSHOT_DIR: './snapshots',
  SNAPSHOT_RETENTION_DAYS: 30,
  EMAIL_ATTEMPT_SWEEP_ENABLED: false,
  EMAIL_ATTEMPT_SWEEP_RETENTION_HOURS: 24,
  PENDING_LINK_SWEEP_ENABLED: false,
  E2E_TEST_MODE: false,
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
    'TRUNCATE TABLE "TransactionLog", "CurrencyHolding", "ItemInstance", "Stash", "Character", "PartyMembership", "Party", "PendingDiscordLink", "EmailAuthAttempt", "VerificationToken", "Session", "Account", "User" CASCADE',
  );
});

async function seedEmailOnlyUser(): Promise<{ userId: string }> {
  const userId = `u-${Math.random().toString(36).slice(2, 10)}`;
  await prisma.user.create({
    data: {
      id: userId,
      displayName: 'Alice',
      email: `${userId}@example.com`,
      emailVerified: new Date(),
      needsDisplayName: false,
    },
  });
  return { userId };
}

async function seedSession(userId: string): Promise<string> {
  const { sessionToken } = await createSessionForUser(prisma, userId);
  return sessionToken;
}

function cookieHeader(token: string): string {
  return `${sessionCookieName(env)}=${token}`;
}

/**
 * Stub Discord's two endpoints — token + userinfo. Returns a fetch
 * impl that the route accepts via `fetchImpl` (passed through
 * `registerAuthRoutes` opts).
 */
function stubDiscordFetch(opts: {
  snowflake: string;
  username: string;
  globalName?: string | null;
  avatar?: string | null;
  tokenFails?: boolean;
}): typeof fetch {
  const impl = (input: RequestInfo | URL): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('oauth2/token')) {
      if (opts.tokenFails) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }),
        );
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: 'test-access-token',
            token_type: 'Bearer',
            expires_in: 604800,
            scope: 'identify',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
    if (url.includes('users/@me')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: opts.snowflake,
            username: opts.username,
            global_name: opts.globalName ?? null,
            avatar: opts.avatar ?? null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }
    return Promise.resolve(new Response('not stubbed', { status: 404 }));
  };
  return impl;
}

async function runLinkFlow(opts: {
  userCookie: string;
  fetchImpl: typeof fetch;
}): Promise<{ redirectLocation: string }> {
  const app = await buildServer({ env, prisma, authFetchImpl: opts.fetchImpl });
  try {
    // 1. /auth/discord/login?link=1 → 302 to /auth/discord/link/initiate
    const r1 = await app.inject({
      method: 'GET',
      url: '/auth/discord/login?link=1',
      headers: { cookie: opts.userCookie },
    });
    expect(r1.statusCode).toBeGreaterThanOrEqual(300);
    expect(r1.statusCode).toBeLessThan(400);
    expect(r1.headers.location).toBe('/auth/discord/link/initiate');

    // 2. /auth/discord/link/initiate → 302 to /start?token=...
    const r2 = await app.inject({
      method: 'GET',
      url: '/auth/discord/link/initiate',
      headers: { cookie: opts.userCookie },
    });
    expect(r2.statusCode).toBeGreaterThanOrEqual(300);
    expect(r2.statusCode).toBeLessThan(400);
    const startUrl = r2.headers.location as string;
    expect(startUrl).toContain('/auth/discord/link/start?token=');

    // 3. /auth/discord/link/start → 302 to discord.com/...
    const startPath =
      new URL(startUrl, 'http://localhost').pathname +
      '?' +
      new URL(startUrl, 'http://localhost').searchParams.toString();
    const r3 = await app.inject({
      method: 'GET',
      url: startPath,
      headers: { cookie: opts.userCookie },
    });
    expect(r3.statusCode).toBeGreaterThanOrEqual(300);
    expect(r3.statusCode).toBeLessThan(400);
    const discordUrl = new URL(r3.headers.location as string);
    expect(discordUrl.host).toBe('discord.com');
    const state = discordUrl.searchParams.get('state')!;
    // Capture the PKCE cookie the route set.
    const setCookies = r3.headers['set-cookie'];
    const pkceCookie = Array.isArray(setCookies)
      ? setCookies.find((c) => c.startsWith('r35-discord-link-pkce='))
      : typeof setCookies === 'string' && setCookies.startsWith('r35-discord-link-pkce=')
        ? setCookies
        : undefined;
    expect(pkceCookie).toBeTruthy();
    const pkceValue = pkceCookie!.split(';')[0]!; // "r35-discord-link-pkce=...."

    // 4. /auth/callback/discord/link → 302 to ${WEB_ORIGIN}/settings?...
    const r4 = await app.inject({
      method: 'GET',
      url: `/auth/callback/discord/link?code=test-code&state=${encodeURIComponent(state)}`,
      headers: { cookie: `${opts.userCookie}; ${pkceValue}` },
    });
    expect(r4.statusCode).toBeGreaterThanOrEqual(300);
    expect(r4.statusCode).toBeLessThan(400);
    return { redirectLocation: r4.headers.location as string };
  } finally {
    await app.close();
  }
}

describe('Discord link — authentication gate', () => {
  it('returns 401 when ?link=1 is hit anonymously', async () => {
    const app = await buildServer({ env, prisma });
    try {
      // The unauth path: ?link=1 redirects to /initiate, which returns 401.
      const r1 = await app.inject({ method: 'GET', url: '/auth/discord/login?link=1' });
      expect(r1.headers.location).toBe('/auth/discord/link/initiate');
      const r2 = await app.inject({ method: 'GET', url: '/auth/discord/link/initiate' });
      expect(r2.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});

describe('Discord link — happy path', () => {
  it('attaches discordId to the existing user and redirects with ?linked=discord', async () => {
    const { userId } = await seedEmailOnlyUser();
    const token = await seedSession(userId);
    const before = await prisma.user.findUnique({ where: { id: userId } });
    expect(before?.discordId).toBeNull();

    const { redirectLocation } = await runLinkFlow({
      userCookie: cookieHeader(token),
      fetchImpl: stubDiscordFetch({
        snowflake: 'snowflake-12345',
        username: 'alice-discord',
        globalName: 'Alice Discord',
        avatar: 'abcdef',
      }),
    });

    expect(redirectLocation).toBe('http://localhost:5173/settings?linked=discord');

    const after = await prisma.user.findUnique({ where: { id: userId } });
    expect(after?.discordId).toBe('snowflake-12345');
    // Discord avatar URL is composed from snowflake + avatar hash.
    expect(after?.avatarUrl).toContain('snowflake-12345');
    // Display name preserved (Alice was already set; OUTLINE §3.1
    // "their displayName is not overwritten").
    expect(after?.displayName).toBe('Alice');

    // PendingDiscordLink row was consumed.
    expect(await prisma.pendingDiscordLink.count()).toBe(0);
  });
});

describe('Discord link — conflict', () => {
  it('redirects with ?linkError=discord_already_linked when the snowflake is in use', async () => {
    // Existing user with the snowflake we'll try to claim.
    await prisma.user.create({
      data: {
        id: 'other-user',
        displayName: 'Bob',
        discordId: 'snowflake-12345',
      },
    });
    const { userId } = await seedEmailOnlyUser();
    const token = await seedSession(userId);

    const { redirectLocation } = await runLinkFlow({
      userCookie: cookieHeader(token),
      fetchImpl: stubDiscordFetch({
        snowflake: 'snowflake-12345',
        username: 'alice',
      }),
    });

    expect(redirectLocation).toContain('linkError=discord_already_linked');
    // Original user's row unchanged.
    const after = await prisma.user.findUnique({ where: { id: userId } });
    expect(after?.discordId).toBeNull();
  });
});

describe('Discord link — tampered state', () => {
  it('redirects with linkError=invalid_state when the HMAC is bad', async () => {
    const { userId } = await seedEmailOnlyUser();
    const token = await seedSession(userId);
    const app = await buildServer({ env, prisma });
    try {
      const r = await app.inject({
        method: 'GET',
        url: '/auth/callback/discord/link?code=anything&state=not-a-real-signed-state',
        headers: { cookie: cookieHeader(token) },
      });
      expect(r.headers.location).toContain('linkError=invalid_state');
    } finally {
      await app.close();
    }
  });
});
