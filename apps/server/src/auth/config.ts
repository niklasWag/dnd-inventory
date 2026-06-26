/**
 * R3.2 — Auth.js (@auth/core) configuration factory.
 *
 * Returns an `AuthConfig` that the `/auth/discord/*` Fastify routes hand to
 * `Auth(request, config)` for every request. The factory is pure (no
 * side effects, no I/O) — `makeAdapter(prisma)` is the only thing it calls.
 *
 * Two-phase init pattern: when Discord credentials are absent, `providers`
 * is empty and the routes return 503. The config itself is still valid so
 * `/auth/session` (which doesn't need a provider) keeps working — useful
 * for the R3.5 web client probing whether anyone is logged in even on
 * misconfigured deployments.
 */
import Discord from '@auth/core/providers/discord';
import type { AuthConfig } from '@auth/core';

import type { PrismaClient } from '../../prisma/generated/prisma/client.js';
import type { Env } from '../config/env.js';

import { makeAdapter } from './adapter-overrides.js';

export interface BuildAuthConfigOptions {
  prisma: PrismaClient;
  env: Env;
}

/**
 * Auth.js cookie names. SECURITY §1.1: HttpOnly + SameSite=Lax + Secure
 * in production. The `__Host-` prefix in production has a browser-enforced
 * contract (no Domain attribute, Path=/, Secure required) that's stricter
 * than any flag we could set ourselves — if a misconfiguration ever strips
 * `Secure`, the cookie is rejected on receipt.
 *
 * `sessionCookieName(env)` is the single source of truth. `session.ts`
 * imports it directly so the dev/prod switch can't drift between the
 * cookie SET (by Auth.js via this config) and the cookie READ (by
 * `getSession`).
 */
export function sessionCookieName(env: Env): string {
  return env.NODE_ENV === 'production' ? '__Host-auth-session-token' : 'auth-session-token';
}

function sessionCookieConfig(env: Env) {
  return {
    name: sessionCookieName(env),
    options: {
      httpOnly: true,
      // 'lax' allows the cookie to ride along on the top-level redirect
      // from discord.com back to /auth/discord/callback (which is the
      // entire point of the OAuth flow). 'strict' would break the flow.
      sameSite: 'lax' as const,
      path: '/',
      secure: env.NODE_ENV === 'production',
    },
  };
}

/**
 * Builds a Discord avatar CDN URL from a Discord user's `avatar` hash, or
 * `null` if the user has no custom avatar.
 *
 * https://discord.com/developers/docs/reference#image-formatting
 */
function discordAvatarUrl(userId: string, avatarHash: string | null): string | null {
  if (!avatarHash) return null;
  // Discord serves animated avatars when the hash starts with `a_`; we
  // request .png so both static and animated avatars render uniformly.
  return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png`;
}

export function buildAuthConfig({ prisma, env }: BuildAuthConfigOptions): AuthConfig {
  // Single source of truth: providers and the /auth/discord/* routes both
  // gate on `isDiscordAuthEnabled` — i.e., the full triple (CLIENT_ID +
  // CLIENT_SECRET + REDIRECT_URI). With just two of three set, the
  // provider used to be added to AuthConfig while the routes returned 503,
  // which left an unreachable provider registered on the engine. Aligning
  // the checks closes that gap.
  const discordEnabled = isDiscordAuthEnabled(env);

  return {
    adapter: makeAdapter(prisma),
    secret: env.AUTH_SECRET,
    // Auth.js v5 refuses to run unless either `AUTH_URL` env / `AUTH_TRUST_HOST`
    // is set, or `trustHost: true` is on the config. We are behind a reverse
    // proxy in production (nginx/caddy/traefik per docs/TECH_STACK.md §7.1)
    // and serve on localhost in dev — both modes derive the URL from the
    // incoming Host header. Setting `trustHost: true` is the explicit
    // "yes, we trust the proxy's Host" knob.
    trustHost: true,
    providers: discordEnabled
      ? [
          Discord({
            clientId: env.DISCORD_CLIENT_ID!,
            clientSecret: env.DISCORD_CLIENT_SECRET!,
            // SECURITY §1.1: scope `identify` ONLY. The provider's default
            // authorization URL hardcodes `scope=identify+email`; supplying
            // a string here REPLACES the default so we can drop `email`.
            // (Supplying `{ params: { scope } }` instead is silently
            // ignored when the default is a string — verified empirically
            // against @auth/core@0.34.3.)
            authorization: 'https://discord.com/api/oauth2/authorize?scope=identify',
            // SECURITY §1.1: "state parameter bound to the user's pre-auth
            // session; reject mismatched callbacks." Auth.js's default for
            // OAuth providers is ['pkce'] only — PKCE alone defends against
            // code-injection, but the explicit state cookie is what the
            // SECURITY doc requires and adds defense-in-depth against
            // session-fixation attacks via crafted callback URLs.
            checks: ['pkce', 'state'],
          }),
        ]
      : [],
    session: {
      strategy: 'database',
      // SECURITY §1.1: "30 days idle expiry with refresh-on-activity."
      maxAge: 60 * 60 * 24 * 30,
      // Refresh `expires` once per day of activity (matches Auth.js
      // default — keeps cookie writes bounded).
      updateAge: 60 * 60 * 24,
    },
    cookies: {
      sessionToken: sessionCookieConfig(env),
    },
    events: {
      /**
       * Fires after a successful sign-in and after the user row exists
       * in the DB (adapter has already done its createUser / linkAccount
       * dance). We use this to:
       *   - persist Discord's snowflake on `User.discordId` (the column
       *     SECURITY §1.2 requires for the auth-present invariant);
       *   - resync `displayName` and `avatarUrl` from the Discord
       *     profile on every login (Discord users change these freely
       *     and we want the latest).
       */
      signIn: async ({ user, account, profile }) => {
        if (account?.provider !== 'discord' || !profile) return;
        if (!user.id) return;
        const discordId = account.providerAccountId;
        // Discord's API returns `global_name` for users with a display
        // name set; otherwise we fall back to `username`. Cast through
        // `unknown` because @auth's Profile type is loosely declared.
        const p = profile as unknown as { global_name?: string | null; username?: string };
        const displayName = p.global_name ?? p.username ?? 'Unknown';
        const avatarRaw = (profile as unknown as { avatar?: string | null }).avatar ?? null;
        await prisma.user.update({
          where: { id: user.id },
          data: {
            discordId,
            displayName,
            avatarUrl: discordAvatarUrl(discordId, avatarRaw),
          },
        });
      },
    },
  };
}

/**
 * Sentinel exported for tests + the route layer: are the OAuth routes
 * eligible to serve requests, or should they return 503?
 */
export function isDiscordAuthEnabled(env: Env): boolean {
  return Boolean(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET && env.DISCORD_REDIRECT_URI);
}

/**
 * R3.3 — Sentinel for the email OTP routes. Mirrors `isDiscordAuthEnabled`:
 * when ANY of the five SMTP env vars is missing, the /auth/email/* routes
 * return 503 with `{error: 'email_auth_disabled'}` rather than silently
 * failing to send mail. Per SECURITY §1.2: "SMTP misconfiguration — at
 * server startup, if SMTP_HOST/PORT/USER/PASS/FROM are absent or incomplete,
 * email auth is disabled entirely."
 */
export function isEmailAuthEnabled(env: Env): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS && env.SMTP_FROM);
}
