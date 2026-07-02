import { describe, expect, it, vi } from 'vitest';

import type { AdapterAccount } from '@auth/core/adapters';
import type { Account, Profile } from '@auth/core/types';

import type { Env } from '../config/env.js';
import type { PrismaClient } from '../../prisma/generated/prisma/client.js';

import { buildAuthConfig, isDiscordAuthEnabled, isEmailAuthEnabled, useSecureCookies } from './config.js';
import { makeAdapter } from './adapter-overrides.js';

/**
 * R3.2 — pure-unit tests for the Auth.js configuration factory and the
 * token-stripping adapter wrapper. No DB, no network — every dependency
 * is a stub.
 */

const baseEnv: Env = {
  NODE_ENV: 'test',
  PORT: 0,
  HOST: '127.0.0.1',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://stub',
  WEB_ORIGIN: 'http://localhost:5173',
  AUTH_SECRET: 'test-secret-padding-to-meet-32-char-min-XXXXXX',
  SESSION_COOKIE_INSECURE: false,
  SNAPSHOTS_ENABLED: false,
  SNAPSHOT_DIR: './snapshots',
  SNAPSHOT_RETENTION_DAYS: 30,
};

const stubPrisma = {
  // Auth.js never calls these in buildAuthConfig() — only inside the
  // events.signIn callback (covered below). For the rest of the factory's
  // surface a fake PrismaClient is enough.
  user: { update: vi.fn() },
} as unknown as PrismaClient;

describe('isDiscordAuthEnabled', () => {
  it('returns false when DISCORD_CLIENT_ID is unset', () => {
    expect(isDiscordAuthEnabled(baseEnv)).toBe(false);
  });

  it('returns false when only client id is set', () => {
    expect(isDiscordAuthEnabled({ ...baseEnv, DISCORD_CLIENT_ID: 'x' })).toBe(false);
  });

  it('returns true when all three discord vars are present', () => {
    expect(
      isDiscordAuthEnabled({
        ...baseEnv,
        DISCORD_CLIENT_ID: 'cid',
        DISCORD_CLIENT_SECRET: 'csec',
        DISCORD_REDIRECT_URI: 'http://localhost:3000/auth/callback/discord',
      }),
    ).toBe(true);
  });
});

describe('isEmailAuthEnabled (R3.3)', () => {
  const allFive = {
    SMTP_HOST: 'smtp.test',
    SMTP_PORT: 587,
    SMTP_USER: 'u',
    SMTP_PASS: 'p',
    SMTP_FROM: 'a@b.test',
  };

  it('returns false when no SMTP_* vars are set', () => {
    expect(isEmailAuthEnabled(baseEnv)).toBe(false);
  });

  it('returns false when any single var is missing', () => {
    for (const omit of Object.keys(allFive) as Array<keyof typeof allFive>) {
      const partial: Record<string, unknown> = { ...allFive };
      delete partial[omit];
      // partial is a subset of `allFive`; spreading over baseEnv yields
      // an Env-compatible shape without an explicit assertion.
      expect(isEmailAuthEnabled({ ...baseEnv, ...partial })).toBe(false);
    }
  });

  it('returns true when all five SMTP_* vars are set', () => {
    expect(isEmailAuthEnabled({ ...baseEnv, ...allFive })).toBe(true);
  });
});

describe('useSecureCookies / sessionCookieName', () => {
  it('falls back to the non-prefixed cookie name + secure=false in non-production', () => {
    expect(useSecureCookies({ ...baseEnv, NODE_ENV: 'development' })).toBe(false);
  });

  it('uses Secure + __Host- in production by default', () => {
    expect(useSecureCookies({ ...baseEnv, NODE_ENV: 'production' })).toBe(true);
  });

  it('drops Secure + __Host- in production when SESSION_COOKIE_INSECURE=true', () => {
    // Self-hosted HTTP-only deployments (docker compose proxy profile,
    // private LAN, etc.) need to opt out of __Host- so the browser
    // actually stores the cookie over plain http://localhost.
    expect(
      useSecureCookies({
        ...baseEnv,
        NODE_ENV: 'production',
        SESSION_COOKIE_INSECURE: true,
      }),
    ).toBe(false);
  });
});

describe('buildAuthConfig', () => {
  it('returns empty providers when DISCORD_* env vars are absent', () => {
    const cfg = buildAuthConfig({ prisma: stubPrisma, env: baseEnv });
    expect(cfg.providers).toEqual([]);
    expect(cfg.adapter).toBeDefined();
    expect(cfg.secret).toBe(baseEnv.AUTH_SECRET);
  });

  it('registers the Discord provider with scope=identify only when creds are set', () => {
    const cfg = buildAuthConfig({
      prisma: stubPrisma,
      env: {
        ...baseEnv,
        DISCORD_CLIENT_ID: 'cid',
        DISCORD_CLIENT_SECRET: 'csec',
        DISCORD_REDIRECT_URI: 'http://localhost:3000/auth/callback/discord',
      },
    });
    expect(cfg.providers).toHaveLength(1);
    // The Discord provider returns a plain object with the default
    // `authorization` URL hardcoded AND a separate `options` field carrying
    // the user-supplied overrides. @auth/core's parseProviders() (in
    // lib/utils/providers.js) deep-merges `options` over the defaults at
    // request time. So the override lives on `.options.authorization`
    // here until the merge happens.
    const p = cfg.providers[0]! as unknown as {
      id: string;
      authorization: string;
      options?: { authorization?: string };
    };
    expect(p.id).toBe('discord');
    // SECURITY §1.1 — must NOT request `email`. The override is on
    // `options.authorization` and replaces the default at merge time.
    expect(p.options?.authorization).toBe(
      'https://discord.com/api/oauth2/authorize?scope=identify',
    );
    expect(p.options?.authorization).not.toMatch(/email/);
  });

  it('uses database session strategy with 30-day sliding expiry', () => {
    const cfg = buildAuthConfig({ prisma: stubPrisma, env: baseEnv });
    expect(cfg.session?.strategy).toBe('database');
    expect(cfg.session?.maxAge).toBe(60 * 60 * 24 * 30);
    expect(cfg.session?.updateAge).toBe(60 * 60 * 24);
  });

  it('uses __Host-auth-session-token + secure cookie in production', () => {
    const cfg = buildAuthConfig({
      prisma: stubPrisma,
      env: {
        ...baseEnv,
        NODE_ENV: 'production',
        DISCORD_CLIENT_ID: 'a',
        DISCORD_CLIENT_SECRET: 'b',
      },
    });
    const cookie = cfg.cookies?.sessionToken;
    expect(cookie?.name).toBe('__Host-auth-session-token');
    expect(cookie?.options?.secure).toBe(true);
    expect(cookie?.options?.httpOnly).toBe(true);
    expect(cookie?.options?.sameSite).toBe('lax');
    expect(cookie?.options?.path).toBe('/');
  });

  it('uses non-prefixed cookie + insecure flag in dev (localhost http)', () => {
    const cfg = buildAuthConfig({
      prisma: stubPrisma,
      env: { ...baseEnv, NODE_ENV: 'development' },
    });
    const cookie = cfg.cookies?.sessionToken;
    expect(cookie?.name).toBe('auth-session-token');
    expect(cookie?.options?.secure).toBe(false);
  });

  it('drops __Host- + Secure in production when SESSION_COOKIE_INSECURE=true', () => {
    // Self-hosted docker stacks served over plain http://localhost can't
    // store a Secure cookie; the SESSION_COOKIE_INSECURE escape hatch
    // restores the non-prefixed, non-Secure shape while keeping
    // HttpOnly + SameSite=Lax.
    const cfg = buildAuthConfig({
      prisma: stubPrisma,
      env: { ...baseEnv, NODE_ENV: 'production', SESSION_COOKIE_INSECURE: true },
    });
    const cookie = cfg.cookies?.sessionToken;
    expect(cookie?.name).toBe('auth-session-token');
    expect(cookie?.options?.secure).toBe(false);
    expect(cookie?.options?.httpOnly).toBe(true);
    expect(cookie?.options?.sameSite).toBe('lax');
  });

  describe('events.signIn — Discord profile resync', () => {
    it('updates discordId + displayName + avatarUrl on Discord sign-in', async () => {
      const updateMock = vi.fn().mockResolvedValue(undefined);
      const prisma = { user: { update: updateMock } } as unknown as PrismaClient;
      const cfg = buildAuthConfig({ prisma, env: baseEnv });
      const account: Account = {
        provider: 'discord',
        providerAccountId: '123456789012345678',
        type: 'oauth',
      };
      const profile: Profile = {
        sub: '123456789012345678',
      };
      // Discord-specific fields aren't on the base Profile type — attach
      // them via type assertion to satisfy our signIn callback.
      (profile as Record<string, unknown>)['id'] = '123456789012345678';
      (profile as Record<string, unknown>)['global_name'] = 'GandalfTheGrey';
      (profile as Record<string, unknown>)['username'] = 'gandalf';
      (profile as Record<string, unknown>)['avatar'] = 'abc123hash';
      await cfg.events!.signIn!({
        user: { id: 'user-1', name: '', email: null, image: null },
        account,
        profile,
        isNewUser: false,
      });
      expect(updateMock.mock.calls).toHaveLength(1);
      expect(updateMock.mock.calls[0]![0]).toEqual({
        where: { id: 'user-1' },
        data: {
          discordId: '123456789012345678',
          displayName: 'GandalfTheGrey',
          avatarUrl: 'https://cdn.discordapp.com/avatars/123456789012345678/abc123hash.png',
        },
      });
    });

    it('falls back to username when global_name is null', async () => {
      const updateMock = vi.fn().mockResolvedValue(undefined);
      const prisma = { user: { update: updateMock } } as unknown as PrismaClient;
      const cfg = buildAuthConfig({ prisma, env: baseEnv });
      const account: Account = { provider: 'discord', providerAccountId: '999', type: 'oauth' };
      const profile: Profile = { sub: '999' };
      (profile as Record<string, unknown>)['id'] = '999';
      (profile as Record<string, unknown>)['global_name'] = null;
      (profile as Record<string, unknown>)['username'] = 'fallback';
      (profile as Record<string, unknown>)['avatar'] = null;
      await cfg.events!.signIn!({
        user: { id: 'user-1', name: '', email: null, image: null },
        account,
        profile,
        isNewUser: true,
      });
      const dataArg = updateMock.mock.calls[0]![0] as {
        data: { displayName: string; avatarUrl: string | null };
      };
      expect(dataArg.data.displayName).toBe('fallback');
      // No avatar hash → avatarUrl is null.
      expect(dataArg.data.avatarUrl).toBeNull();
    });

    it('is a no-op for non-Discord providers (forward-compat for R3.3 email)', async () => {
      const updateMock = vi.fn();
      const prisma = { user: { update: updateMock } } as unknown as PrismaClient;
      const cfg = buildAuthConfig({ prisma, env: baseEnv });
      const account: Account = { provider: 'email', providerAccountId: 'a@b.com', type: 'email' };
      await cfg.events!.signIn!({
        user: { id: 'u', name: '', email: null, image: null },
        account,
        isNewUser: false,
      });
      expect(updateMock.mock.calls).toHaveLength(0);
    });
  });
});

describe('makeAdapter — Discord token stripping (SECURITY §1.1)', () => {
  it('linkAccount strips access_token / refresh_token / id_token / expires_at / session_state', async () => {
    const linkAccountMock = vi.fn().mockResolvedValue(undefined);
    // Stub PrismaAdapter by passing a PrismaClient stub that exercises only
    // the surface @auth/prisma-adapter touches at module-load time. The
    // adapter exposes `linkAccount` as a function on the returned object —
    // we intercept it by re-wrapping.
    const fakePrisma = {
      account: {
        create: linkAccountMock,
      },
    } as unknown as PrismaClient;
    const adapter = makeAdapter(fakePrisma);
    const account: AdapterAccount = {
      userId: 'user-1',
      type: 'oauth',
      provider: 'discord',
      providerAccountId: '123',
      access_token: 'SHOULD_NOT_PERSIST',
      refresh_token: 'SHOULD_NOT_PERSIST',
      id_token: 'SHOULD_NOT_PERSIST',
      expires_at: 1_234_567_890,
      token_type: 'bearer',
      scope: 'identify',
      session_state: 'state',
    };
    await adapter.linkAccount!(account);
    // The underlying adapter's linkAccount calls prisma.account.create with
    // a `data:` object. Inspect that data to assert tokens were stripped.
    expect(linkAccountMock.mock.calls).toHaveLength(1);
    const callArg = linkAccountMock.mock.calls[0]![0] as { data?: Record<string, unknown> };
    const dataArg = callArg.data ?? (linkAccountMock.mock.calls[0]![0] as Record<string, unknown>);
    expect(dataArg['access_token']).toBeNull();
    expect(dataArg['refresh_token']).toBeNull();
    expect(dataArg['id_token']).toBeNull();
    expect(dataArg['expires_at']).toBeNull();
    expect(dataArg['session_state']).toBeNull();
    // Provider linkage is preserved.
    expect(dataArg['provider']).toBe('discord');
    expect(dataArg['providerAccountId']).toBe('123');
    // Non-sensitive metadata may still pass through (token_type, scope).
    expect(dataArg['type']).toBe('oauth');
  });

  it('getUser preserves email: null for Discord-only users (no email scope per SECURITY §1.1)', async () => {
    // Discord OAuth uses scope `identify` only — no email is ever returned.
    // The DB column User.email is therefore NULL for Discord-only accounts
    // (per OUTLINE §4: "email (nullable — set for email-only users or
    // Discord users who added a backup login)"). The adapter MUST surface
    // that null through to the AdapterUser so the Auth.js session callback
    // can project null onto the public session payload — the client's
    // sessionUserSchema.email is `z.string().email().nullable().optional()`,
    // which accepts null but rejects ''.
    const findUniqueMock = vi.fn(() =>
      Promise.resolve({
        id: 'user-1',
        displayName: 'GandalfTheGrey',
        email: null,
        emailVerified: null,
        avatarUrl: null,
        needsDisplayName: false,
        discordId: '123',
      }),
    );
    const fakePrisma = {
      account: { create: vi.fn() },
      user: { findUnique: findUniqueMock },
    } as unknown as PrismaClient;
    const adapter = makeAdapter(fakePrisma);

    const result = await adapter.getUser!('user-1');
    // Must remain null — coercion to '' would break the client's
    // session-response Zod schema (z.email() rejects empty strings).
    expect(result?.email).toBeNull();
  });

  it('createUser maps AdapterUser name → schema displayName (B7 regression)', async () => {
    // The @auth/prisma-adapter passes Auth.js's `AdapterUser` shape directly
    // to prisma.user.create — but our schema column is `displayName`, not
    // `name`. Without the field mapping in makeAdapter, this throws
    // "Argument `displayName` missing" on every Discord-first signup.
    const createMock = vi.fn(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        id: 'minted-id',
        displayName: (data['displayName'] as string | undefined) ?? '',
        email: (data['email'] as string | null | undefined) ?? null,
        emailVerified: (data['emailVerified'] as Date | null | undefined) ?? null,
        avatarUrl: (data['avatarUrl'] as string | null | undefined) ?? null,
      }),
    );
    const fakePrisma = {
      account: { create: vi.fn() },
      user: { create: createMock },
    } as unknown as PrismaClient;
    const adapter = makeAdapter(fakePrisma);

    // Auth.js calls createUser with the AdapterUser-shaped payload —
    // `name`, `email`, `emailVerified`, `image`. No `displayName`. The
    // `id` field carries the Discord snowflake (Auth.js spreads
    // `profile` into createUser; Discord's profile function returns
    // `id: <snowflake>`).
    const result = await adapter.createUser!({
      id: '948271362817273856',
      email: 'gandalf@example.com',
      emailVerified: null,
      name: 'GandalfTheGrey',
      image: 'https://cdn.discordapp.com/avatars/123/abc.png',
    });

    expect(createMock.mock.calls).toHaveLength(1);
    const writtenData = createMock.mock.calls[0]![0].data;
    // Schema column names are what hit Prisma.
    expect(writtenData['displayName']).toBe('GandalfTheGrey');
    expect(writtenData['avatarUrl']).toBe('https://cdn.discordapp.com/avatars/123/abc.png');
    expect(writtenData['email']).toBe('gandalf@example.com');
    // Adapter-side field names must NOT leak through.
    expect(writtenData['name']).toBeUndefined();
    expect(writtenData['image']).toBeUndefined();
    // The provider snowflake MUST land as discordId so the
    // User_auth_present_check CHECK constraint is satisfied at INSERT —
    // events.signIn would otherwise be too late.
    expect(writtenData['discordId']).toBe('948271362817273856');
    // Discord signups skip the OTP display-name gate.
    expect(writtenData['needsDisplayName']).toBe(false);
    // The returned AdapterUser uses Auth.js's field names again.
    expect(result.name).toBe('GandalfTheGrey');
    expect(result.image).toBe('https://cdn.discordapp.com/avatars/123/abc.png');
  });
});
