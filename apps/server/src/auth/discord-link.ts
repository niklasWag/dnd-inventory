/**
 * R3.5 — Discord account-link OAuth flow.
 *
 * An authenticated user (Discord-only OR email-only) clicks "Connect
 * Discord" in Settings → Linked accounts. The web hits this server with
 * `GET /auth/discord/login?link=1`, which:
 *
 *   1. Verifies the session (else 401).
 *   2. Sweeps expired `PendingDiscordLink` rows (cheap drive-by cleanup).
 *   3. Mints a fresh `PendingDiscordLink` row keyed by a random token.
 *   4. Redirects to `/auth/discord/link/start?token=<token>`, which owns
 *      the OAuth code-exchange directly (NOT via Auth.js).
 *
 * The link flow deliberately does NOT delegate to Auth.js:
 *
 *   - Auth.js's adapter would either create a new User (wrong) or merge
 *     the OAuth Account into the existing one by email (also wrong:
 *     Discord scope is `identify` only, so we never have an email to
 *     merge by).
 *   - Owning the OAuth exchange ourselves lets us:
 *       * keep the EXISTING session cookie (no rotation),
 *       * attach `discordId` / `avatarUrl` / `displayName` to the live
 *         User row in a single `prisma.user.update`,
 *       * surface snowflake-conflict cleanly via a 302 redirect to
 *         `${WEB_ORIGIN}/settings?linkError=discord_already_linked`.
 *
 * PKCE + state CSRF are still enforced. State is `${token}.${nonce}`
 * with an HMAC tail signed by `AUTH_SECRET`. PKCE verifier rides along
 * in a short-lived `HttpOnly` cookie scoped to the link callback path.
 *
 * Followup (operational): an unscheduled cron sweeper for old
 * PendingDiscordLink rows is tracked in `docs/roadmap.md` →
 * **Operational followups (unscheduled)** → "PendingDiscordLink cron
 * sweep". The inline `delete where expires < now()` on every link
 * initiation keeps the table from accumulating indefinitely.
 */
import crypto from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { PrismaClient } from '../../prisma/generated/prisma/client.js';
import type { Env } from '../config/env.js';

/**
 * Lifetime of the link-flow handoff row. 10 minutes is long enough for a
 * user to complete the Discord consent screen on a slow phone but short
 * enough that a leaked token expires well before it could be abused.
 */
const LINK_EXPIRY_MS = 10 * 60 * 1000;

/**
 * Cookie carrying the PKCE verifier between `/start` and `/callback`.
 * `HttpOnly` + `SameSite=Lax` + 10-min `Max-Age` matches Auth.js's own
 * PKCE-cookie semantics. The cookie name is namespaced under the
 * link-flow so it can't collide with Auth.js's own PKCE cookie.
 */
const PKCE_COOKIE_NAME = 'r35-discord-link-pkce';

export interface RegisterDiscordLinkOptions {
  env: Env;
  prisma: PrismaClient;
  /**
   * Test seam — lets the discord-link integration tests stub Discord's
   * token + userinfo endpoints without monkey-patching `fetch`. In
   * production this is `undefined` and the routes hit Discord directly.
   */
  fetchImpl?: typeof fetch;
}

interface DiscordTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

interface DiscordUserResponse {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}

function generatePkcePair(): { verifier: string; challenge: string } {
  // 32 bytes → 43 base64url chars. Discord's spec wants 43–128.
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function signState(payload: string, secret: string): string {
  const mac = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

function verifyState(signed: string, secret: string): string | null {
  const lastDot = signed.lastIndexOf('.');
  if (lastDot === -1) return null;
  const payload = signed.slice(0, lastDot);
  const mac = signed.slice(lastDot + 1);
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  // timingSafeEqual requires equal-length buffers; treat unequal lengths
  // as failure directly.
  if (expected.length !== mac.length) return null;
  const a = Buffer.from(expected);
  const b = Buffer.from(mac);
  if (!crypto.timingSafeEqual(a, b)) return null;
  return payload;
}

function discordAvatarUrl(userId: string, avatarHash: string | null | undefined): string | null {
  if (!avatarHash) return null;
  return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png`;
}

/**
 * Build the Discord authorize URL. Scope is `identify` only per
 * SECURITY §1.1.
 */
function buildAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    response_type: 'code',
    scope: 'identify',
    redirect_uri: opts.redirectUri,
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: 'S256',
  });
  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

export function registerDiscordLinkRoutes(
  app: FastifyInstance,
  opts: RegisterDiscordLinkOptions,
): void {
  const { env, prisma } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;

  /**
   * Initiate the link flow. `?link=1` on the primary
   * `GET /auth/discord/login` route delegates here. We branch on the
   * query param in `registerAuthRoutes`, not inside this handler, so
   * the link flow is a separate code path with its own tests.
   */
  app.get('/auth/discord/link/initiate', async (req, reply) => {
    if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.DISCORD_REDIRECT_URI) {
      return reply.code(503).send({ error: 'discord_auth_disabled' });
    }

    const session = await app.getSession(req);
    if (!session) {
      return reply.code(401).send({ error: 'link_requires_session' });
    }

    // Drive-by sweep of expired rows. Inline keeps the table size
    // bounded without scheduling a cron — the table will be tiny in
    // practice (a row per link click).
    await prisma.pendingDiscordLink.deleteMany({
      where: { expires: { lt: new Date() } },
    });

    const token = crypto.randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + LINK_EXPIRY_MS);
    await prisma.pendingDiscordLink.create({
      data: { token, userId: session.user.id, expires },
    });

    // Redirect to the start route. We re-derive the URL via the
    // request's Host header so dev (localhost:3000) and prod (the real
    // origin behind a reverse proxy) both work without extra config.
    const protocol = req.protocol;
    const host = req.headers.host ?? 'localhost';
    return reply.redirect(`${protocol}://${host}/auth/discord/link/start?token=${token}`);
  });

  /**
   * Step 2: build PKCE + state, redirect to Discord. Separated from
   * `initiate` so a curl-against-tests path can hit `/start?token=...`
   * directly without needing to go through the `?link=1` redirect.
   */
  app.get('/auth/discord/link/start', async (req, reply) => {
    if (!env.DISCORD_CLIENT_ID || !env.DISCORD_REDIRECT_URI) {
      return reply.code(503).send({ error: 'discord_auth_disabled' });
    }

    const session = await app.getSession(req);
    if (!session) {
      return reply.code(401).send({ error: 'link_requires_session' });
    }

    const query = req.query as { token?: unknown };
    const token = typeof query.token === 'string' ? query.token : '';
    if (token.length === 0) {
      return reply.code(400).send({ error: 'invalid_token' });
    }

    const row = await prisma.pendingDiscordLink.findUnique({ where: { token } });
    if (!row) {
      return reply.code(400).send({ error: 'invalid_token' });
    }
    if (row.userId !== session.user.id) {
      // A user only ever consumes their own link tokens. Reject
      // cross-user attempts rather than silently following them.
      return reply.code(400).send({ error: 'invalid_token' });
    }
    if (row.expires <= new Date()) {
      return reply.code(400).send({ error: 'expired_token' });
    }

    const { verifier, challenge } = generatePkcePair();
    // Nonce makes the signed state opaque even if the token is reused
    // (it shouldn't be, but defense-in-depth).
    const nonce = crypto.randomBytes(16).toString('base64url');
    const state = signState(`${token}.${nonce}`, env.AUTH_SECRET);

    reply.setCookie(PKCE_COOKIE_NAME, verifier, {
      httpOnly: true,
      sameSite: 'lax',
      // Scope to the callback path so it never leaks to other routes.
      path: '/auth/callback/discord/link',
      secure: env.NODE_ENV === 'production',
      maxAge: Math.floor(LINK_EXPIRY_MS / 1000),
    });

    const url = buildAuthorizeUrl({
      clientId: env.DISCORD_CLIENT_ID,
      redirectUri: linkCallbackUri(env),
      state,
      codeChallenge: challenge,
    });
    return reply.redirect(url);
  });

  /**
   * Step 3: Discord redirects here with `code` + `state`. We
   * exchange the code, fetch identity, update the user row, and
   * 302 to `${WEB_ORIGIN}/settings?linked=discord` (or
   * `?linkError=...` on failure).
   */
  app.get('/auth/callback/discord/link', async (req, reply) => {
    if (!env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET || !env.DISCORD_REDIRECT_URI) {
      return reply.code(503).send({ error: 'discord_auth_disabled' });
    }

    const session = await app.getSession(req);
    if (!session) {
      return reply.code(401).send({ error: 'link_requires_session' });
    }

    const query = req.query as { code?: unknown; state?: unknown; error?: unknown };

    // Discord can return `?error=access_denied` if the user cancels on
    // the consent screen. Surface that as a non-error redirect so the
    // web doesn't think something broke.
    if (typeof query.error === 'string') {
      return reply.redirect(
        `${env.WEB_ORIGIN}/settings?linkError=${encodeURIComponent(query.error)}`,
      );
    }

    const code = typeof query.code === 'string' ? query.code : '';
    const state = typeof query.state === 'string' ? query.state : '';
    if (code.length === 0 || state.length === 0) {
      return redirectWithLinkError(reply, env, 'invalid_callback');
    }

    const verifiedPayload = verifyState(state, env.AUTH_SECRET);
    if (verifiedPayload === null) {
      return redirectWithLinkError(reply, env, 'invalid_state');
    }
    const firstDot = verifiedPayload.indexOf('.');
    if (firstDot === -1) {
      return redirectWithLinkError(reply, env, 'invalid_state');
    }
    const token = verifiedPayload.slice(0, firstDot);

    const row = await prisma.pendingDiscordLink.findUnique({ where: { token } });
    if (!row) {
      return redirectWithLinkError(reply, env, 'invalid_token');
    }
    // Always delete the row on this side — even on failure paths
    // below, the token is now spent.
    await prisma.pendingDiscordLink.delete({ where: { token } }).catch(() => undefined);

    if (row.userId !== session.user.id) {
      return redirectWithLinkError(reply, env, 'invalid_token');
    }
    if (row.expires <= new Date()) {
      return redirectWithLinkError(reply, env, 'expired_token');
    }

    const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies;
    const verifier = cookies?.[PKCE_COOKIE_NAME];
    if (!verifier) {
      return redirectWithLinkError(reply, env, 'invalid_pkce');
    }
    // Clear the PKCE cookie regardless of outcome.
    reply.clearCookie(PKCE_COOKIE_NAME, { path: '/auth/callback/discord/link' });

    // Exchange the code for a token at Discord's token endpoint.
    let tokenRes: Response;
    try {
      tokenRes = await fetchImpl('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: env.DISCORD_CLIENT_ID,
          client_secret: env.DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
          redirect_uri: linkCallbackUri(env),
          code_verifier: verifier,
        }),
      });
    } catch (err) {
      req.log.error({ err }, '[discord-link] token endpoint unreachable');
      return redirectWithLinkError(reply, env, 'discord_unreachable');
    }
    if (!tokenRes.ok) {
      req.log.warn({ status: tokenRes.status }, '[discord-link] token endpoint rejected');
      return redirectWithLinkError(reply, env, 'discord_token_failed');
    }
    const tokenJson = (await tokenRes.json()) as DiscordTokenResponse;

    // Pull the user's identity. `identify` is the only scope, so we
    // get `id`, `username`, optional `global_name`, optional `avatar`.
    let meRes: Response;
    try {
      meRes = await fetchImpl('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      });
    } catch (err) {
      req.log.error({ err }, '[discord-link] userinfo endpoint unreachable');
      return redirectWithLinkError(reply, env, 'discord_unreachable');
    }
    if (!meRes.ok) {
      return redirectWithLinkError(reply, env, 'discord_userinfo_failed');
    }
    const me = (await meRes.json()) as DiscordUserResponse;

    const displayName = me.global_name ?? me.username ?? 'Unknown';
    const avatar = discordAvatarUrl(me.id, me.avatar ?? null);

    try {
      // Only overwrite displayName if the user didn't already set one.
      // Per OUTLINE §3.1: "their displayName is not overwritten (they
      // keep the name they set at first login; they can update it
      // manually if desired)."
      const existing = session.user;
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          discordId: me.id,
          avatarUrl: avatar,
          ...(existing.displayName === '' || existing.needsDisplayName
            ? { displayName, needsDisplayName: false }
            : {}),
        },
      });
    } catch (err) {
      // P2002 = unique constraint failed; the only unique here is
      // discordId. Surface as `discord_already_linked` per the plan.
      if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002') {
        return redirectWithLinkError(reply, env, 'discord_already_linked');
      }
      throw err;
    }

    return reply.redirect(`${env.WEB_ORIGIN}/settings?linked=discord`);
  });
}

function linkCallbackUri(env: Env): string {
  // Derive from `DISCORD_REDIRECT_URI` (the primary callback) by
  // swapping the path. Operators only have to register two redirect
  // URIs in the Discord developer portal: the primary
  // `/auth/callback/discord` AND `/auth/callback/discord/link`.
  // Symmetric with Auth.js's `/auth/callback/<provider>` convention.
  const url = new URL(env.DISCORD_REDIRECT_URI!);
  url.pathname = '/auth/callback/discord/link';
  return url.toString();
}

function redirectWithLinkError(reply: FastifyReply, env: Env, code: string): FastifyReply {
  return reply.redirect(`${env.WEB_ORIGIN}/settings?linkError=${encodeURIComponent(code)}`);
}

/**
 * Helper used by `registerAuthRoutes` to handle the
 * `GET /auth/discord/login?link=1` short-circuit. Returns `true` if
 * the request was handled here; the caller should NOT fall through to
 * the normal Auth.js delegation.
 */
export async function handleLoginLinkBranch(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  const query = req.query as { link?: unknown };
  if (query.link !== '1') return false;
  // Rewriting `req.url` to point at `/auth/discord/link/initiate` would
  // require Fastify's internal router to re-dispatch — easier to just
  // forward via `reply.redirect`, which preserves the user's cookies and
  // re-enters the handler that owns this branch.
  await reply.redirect('/auth/discord/link/initiate');
  return true;
}
