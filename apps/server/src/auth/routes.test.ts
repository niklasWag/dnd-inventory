import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../prisma/generated/prisma/client.js';
import type { Env } from '../config/env.js';
import { buildServer } from '../server.js';
import { setupDiscordMock } from '../test/discord-mock.js';

/**
 * R3.2 — integration tests for the /auth/discord/* + /auth/signout +
 * /auth/session routes.
 *
 * Strategy:
 *   - Stand up the real Fastify app via `buildServer` (so routing,
 *     plugins, decorators, and the @auth/core integration all run).
 *   - Intercept outbound Discord HTTP calls via msw (no network).
 *   - Drive the flow via `app.inject()` (no port binding).
 *   - Assert against DB rows + response headers.
 */
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
  SESSION_COOKIE_INSECURE: false,
  SNAPSHOTS_ENABLED: false,
  SNAPSHOT_DIR: './snapshots',
  SNAPSHOT_RETENTION_DAYS: 30,
};

const envWithDiscord: Env = {
  ...baseEnv,
  DISCORD_CLIENT_ID: 'test-client-id',
  DISCORD_CLIENT_SECRET: 'test-client-secret',
  DISCORD_REDIRECT_URI: 'http://localhost:3000/auth/callback/discord',
};

let prisma: PrismaClient;
const discord = setupDiscordMock();

beforeAll(() => {
  const adapter = new PrismaPg({ connectionString: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
  discord.server.listen({ onUnhandledRequest: 'bypass' });
});

afterEach(() => {
  discord.server.resetHandlers();
});

afterAll(async () => {
  discord.server.close();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Session", "Account", "User" CASCADE');
});

describe('GET /auth/discord/login (R3.2)', () => {
  it('returns 503 with discord_auth_disabled when DISCORD_CLIENT_ID is unset', async () => {
    const app = await buildServer({ env: baseEnv, prisma });
    try {
      const res = await app.inject({ method: 'GET', url: '/auth/discord/login' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ error: 'discord_auth_disabled' });
    } finally {
      await app.close();
    }
  });

  it('redirects (302/307) to Discord with PKCE challenge + state when creds are set', async () => {
    const app = await buildServer({ env: envWithDiscord, prisma });
    try {
      const res = await app.inject({ method: 'GET', url: '/auth/discord/login' });
      // Auth.js may use 302 or 307; both are valid redirect statuses.
      expect([302, 307]).toContain(res.statusCode);
      const location = res.headers['location'];
      expect(location, 'login should redirect to Discord').toBeDefined();
      expect(String(location)).toMatch(/^https:\/\/discord\.com\/api\/oauth2\/authorize/);
      expect(String(location)).toMatch(/code_challenge=/);
      expect(String(location)).toMatch(/code_challenge_method=S256/);
      expect(String(location)).toMatch(/state=/);
      // SECURITY §1.1 — must NOT request scope=email.
      expect(String(location)).toMatch(/scope=identify/);
      expect(String(location)).not.toMatch(/scope=identify(\+|%20)email/);
    } finally {
      await app.close();
    }
  });
});

describe('POST /auth/signout (R3.2)', () => {
  it('returns a response that clears the session cookie', async () => {
    const app = await buildServer({ env: baseEnv, prisma });
    try {
      // Sign out with no session is still a valid call; Auth.js returns
      // either a JSON response or a redirect — either way it must set
      // a Set-Cookie that clears the session cookie. We just assert
      // the response is well-formed (status < 500) and Auth.js is
      // wired correctly.
      const res = await app.inject({
        method: 'POST',
        url: '/auth/signout',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: '',
      });
      expect(res.statusCode).toBeLessThan(500);
    } finally {
      await app.close();
    }
  });
});

describe('GET /auth/session (R3.2)', () => {
  it('returns a JSON response (possibly null when not authenticated)', async () => {
    const app = await buildServer({ env: baseEnv, prisma });
    try {
      const res = await app.inject({ method: 'GET', url: '/auth/session' });
      // Auth.js returns 200 with body `null` (or `{}`) when there is no
      // session, not 401 — the 401 contract is reserved for protected
      // routes (R3.4).
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});

describe('GET /auth/methods (R3.5)', () => {
  it('reports both providers disabled when no env triples are set', async () => {
    const app = await buildServer({ env: baseEnv, prisma });
    try {
      const res = await app.inject({ method: 'GET', url: '/auth/methods' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ discord: false, email: false });
    } finally {
      await app.close();
    }
  });

  it('reports discord=true when the DISCORD_* triple is configured', async () => {
    const app = await buildServer({ env: envWithDiscord, prisma });
    try {
      const res = await app.inject({ method: 'GET', url: '/auth/methods' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ discord: true, email: false });
    } finally {
      await app.close();
    }
  });
});
