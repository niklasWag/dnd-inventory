/**
 * R3.2 — Fastify routes that bridge @auth/core's framework-agnostic
 * `Auth(request, config)` function into Fastify's request/reply abstraction.
 *
 * Auth.js v5 (`@auth/core`) ships a single entry point that takes a Web
 * `Request` and returns a Web `Response`. Fastify uses Node's stream-based
 * abstraction, so we need adapters at the boundary:
 *   - `fastifyToWebRequest(req)`: rebuild a `Request` from the Fastify req.
 *   - `webResponseToFastifyReply(res, reply)`: copy status + headers +
 *     body from a `Response` into a Fastify reply.
 *
 * The four routes proxy four well-known Auth.js endpoints:
 *   - `GET /auth/discord/login`     → /auth/signin/discord       (302 to Discord)
 *   - `GET /auth/callback/discord`  → /auth/callback/discord     (token exchange + session cookie)
 *   - `POST /auth/signout`           → /auth/signout             (session row deletion + cookie clear)
 *   - `GET /auth/session`            → /auth/session             (current session JSON, or 401)
 *
 * The callback path is `/auth/callback/discord` (NOT `/auth/discord/callback`)
 * because Auth.js's `parseProviders` hardcodes `callbackUrl =
 * ${basePath}/callback/${providerId}` (see @auth/core/lib/utils/providers.js).
 * That is the URI Discord will redirect back to, so the Fastify route
 * MUST live at that exact path.
 *
 * When `DISCORD_*` env vars are absent, the OAuth routes return 503
 * (SECURITY §1.2 SMTP-disabled parallel). `GET /auth/session` keeps
 * working without Discord — useful for R3.5 client probes.
 */
import { Auth } from '@auth/core';
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { Env } from '../config/env.js';
import type { PrismaClient } from '../../prisma/generated/prisma/client.js';

import {
  buildAuthConfig,
  isDiscordAuthEnabled,
  isEmailAuthEnabled,
  sessionCookieName,
  useSecureCookies,
} from './config.js';
import { handleLoginLinkBranch, registerDiscordLinkRoutes } from './discord-link.js';
import {
  constantTimeEqual,
  generateOtp,
  isOtpExpired,
  OTP_LENGTH,
  OTP_LIFETIME_MS,
} from './email/otp.js';
import {
  checkLockout,
  recordFailedAttempt,
  recordOtpRequest,
  resetAttempts,
} from './email/rate-limit.js';
import type { MailService } from './email/smtp.js';
import { createSessionForUser } from './session.js';

export interface RegisterAuthRoutesOptions {
  env: Env;
  prisma: PrismaClient;
  /**
   * R3.3 — injected mail service. Optional because the OTP routes return
   * 503 when `isEmailAuthEnabled(env)` is false; in that case nothing in
   * the route layer touches the service. Pass `setupMailerMock().service`
   * in integration tests.
   */
  mailService?: MailService;
  /**
   * R3.5 — injected fetch implementation for the Discord-link OAuth
   * flow. Tests pass a stub so they don't hit Discord. Production
   * leaves it `undefined`, defaulting to global `fetch`.
   */
  fetchImpl?: typeof fetch;
}

/**
 * Convert a Fastify request into a standard Web Request. The Body of POST
 * requests is preserved (Auth.js POSTs application/x-www-form-urlencoded
 * for signout/callback). Fastify's `req.body` is already parsed when
 * `@fastify/formbody` is registered, so we re-serialize to URLSearchParams.
 *
 * `pathOverride` lets `delegateToAuthJs` retarget the URL at Auth.js's
 * internal action router (e.g. our public `/auth/discord/login` → Auth.js's
 * `/auth/signin/discord`) WITHOUT mutating the original Fastify request
 * object. Mutating `req.raw.url` worked but left a stale path visible to
 * Fastify's onResponse hooks / loggers.
 */
function fastifyToWebRequest(req: FastifyRequest, pathOverride?: string): Request {
  // Reconstruct the full URL. Fastify gives us req.url (path + query) and
  // we know the protocol + host from headers. When a pathOverride is
  // supplied, we splice in the new path while preserving the original
  // query string (Auth.js's callback action reads `code` + `state` from it).
  const protocol = req.protocol;
  const host = req.headers.host ?? 'localhost';
  const path = pathOverride ?? req.url;
  const queryIndex = req.url.indexOf('?');
  const finalPath =
    pathOverride !== undefined && queryIndex !== -1 ? path + req.url.slice(queryIndex) : path;
  const url = `${protocol}://${host}${finalPath}`;

  // Copy headers — Fastify lowercases keys. The Cookie header is
  // load-bearing (Auth.js reads PKCE/state/session cookies from it).
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, String(value));
    }
  }

  let body: BodyInit | null = null;
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined) {
    // For form-encoded bodies (the @fastify/formbody case), Fastify gives
    // us a plain object — serialize back to URLSearchParams.
    if (typeof req.body === 'object' && req.body !== null) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(req.body as Record<string, unknown>)) {
        params.append(k, String(v));
      }
      body = params;
    } else if (typeof req.body === 'string') {
      body = req.body;
    }
    // Other body shapes (Buffer, Stream, etc.) aren't expected from the
    // Auth.js callback path — formbody parses form-encoded into a plain
    // object; anything else would mean a misconfigured route.
  }

  return new Request(url, { method: req.method, headers, body });
}

/**
 * Copy a Web Response's status, headers, and body into a Fastify reply.
 * Multi-value Set-Cookie headers are handled explicitly because Fastify's
 * reply.headers() only sets one value per key.
 */
async function webResponseToFastifyReply(
  res: Response,
  reply: FastifyReply,
): Promise<FastifyReply> {
  reply.status(res.status);

  // Set-Cookie may appear multiple times in a single response; preserve
  // each as its own header line.
  const setCookies: string[] = [];
  res.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') {
      setCookies.push(value);
    } else {
      reply.header(key, value);
    }
  });
  if (setCookies.length > 0) {
    reply.header('set-cookie', setCookies);
  }

  const body = await res.text();
  return reply.send(body);
}

/**
 * Rewrite the Fastify request URL so Auth.js sees the path it expects.
 * Auth.js's internal action router dispatches on `/<basePath>/<action>/<provider>?`,
 * The Fastify routes mirror Auth.js's internal paths so we forward straight
 * through without a rewrite. The only special case is the GET-ified login
 * (`/auth/discord/login`) that internally fires Auth.js's POST-only
 * `/auth/signin/discord` action — see the comment on that route.
 */
function authJsPathFor(publicPath: string): string {
  if (publicPath === '/auth/discord/login') return '/auth/signin/discord';
  return publicPath;
}

export function registerAuthRoutes(app: FastifyInstance, opts: RegisterAuthRoutesOptions): void {
  const { env, prisma, mailService } = opts;
  const authConfig = buildAuthConfig({ prisma, env });

  // R3.5 — register the Discord-link sub-routes BEFORE the primary
  // `/auth/discord/login` handler. They live in their own module
  // (`./discord-link.ts`) because the OAuth code-exchange is owned at
  // the route layer (does NOT delegate to Auth.js); keeping the logic
  // separate prevents the two flows from interfering with each other.
  registerDiscordLinkRoutes(app, {
    env,
    prisma,
    ...(opts.fetchImpl !== undefined ? { fetchImpl: opts.fetchImpl } : {}),
  });

  /**
   * Helper that takes a Fastify req/reply, rewrites the path for Auth.js's
   * router, calls `Auth(request, config)`, and copies the result back.
   * The auth core handles PKCE, state, the token exchange call to Discord,
   * the user upsert via the adapter, the events.signIn callback that
   * resyncs displayName/avatarUrl, and finally the Set-Cookie for the
   * session token.
   */
  async function delegateToAuthJs(
    req: FastifyRequest,
    reply: FastifyReply,
    publicPath: string,
  ): Promise<FastifyReply> {
    const internalPath = authJsPathFor(publicPath);
    // Pass the rewritten path through to fastifyToWebRequest as an
    // override — preserves immutability of the live Fastify request so
    // downstream onResponse hooks / loggers still see the original URL.
    const webReq = fastifyToWebRequest(req, internalPath);
    const webRes = await Auth(webReq, authConfig);
    return webResponseToFastifyReply(webRes, reply);
  }

  // ---------------- Discord OAuth routes (gated on env) ----------------

  // The login flow is a two-step dance because Auth.js v5's `signin` action
  // is POST-only (with CSRF protection). Public clients can't do a GET to
  // discord.com directly anymore; they have to:
  //   1. Fetch CSRF (`GET /auth/csrf`) — sets `__Host-authjs.csrf-token` cookie.
  //   2. POST `/auth/signin/discord` with that token in the body.
  //   3. Receive a 302 to discord.com.
  //
  // We collapse those into ONE Fastify route so the public API stays a
  // simple `GET /auth/discord/login`. The route makes two internal calls
  // to `Auth(req, config)` and forwards cookies between them.
  app.get('/auth/discord/login', async (req, reply) => {
    if (!isDiscordAuthEnabled(env)) {
      return reply.code(503).send({ error: 'discord_auth_disabled' });
    }

    // R3.5 — `?link=1` is the link-flow entry. Hand off to the
    // dedicated handler that owns the OAuth code-exchange at the
    // route layer (rather than delegating to Auth.js).
    if (await handleLoginLinkBranch(req, reply)) return reply;

    const protocol = req.protocol;
    const host = req.headers.host ?? 'localhost';
    const origin = `${protocol}://${host}`;

    // Step 1: ask Auth.js for a CSRF token. This returns a 200 with the
    // token in the JSON body AND sets the CSRF cookie.
    const csrfReq = new Request(`${origin}/auth/csrf`, { method: 'GET' });
    const csrfRes = await Auth(csrfReq, authConfig);
    const csrfJson = (await csrfRes.json()) as { csrfToken: string };
    const csrfCookies = csrfRes.headers.get('set-cookie') ?? '';

    // Step 2: POST /auth/signin/discord with the CSRF token, forwarding
    // the CSRF cookie. Auth.js returns a 302 to discord.com.
    const signInBody = new URLSearchParams({
      csrfToken: csrfJson.csrfToken,
      callbackUrl: env.WEB_ORIGIN,
    });
    const signInReq = new Request(`${origin}/auth/signin/discord`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        // Forward CSRF cookie so Auth.js's CSRF check passes.
        cookie: csrfCookies,
      },
      body: signInBody,
    });
    const signInRes = await Auth(signInReq, authConfig);

    // Copy both the CSRF cookie (still needed for the callback) AND the
    // PKCE/state cookies (Set-Cookie from the signIn response) into the
    // outgoing reply. Then forward the 302.
    const cookieHeaders: string[] = [];
    if (csrfCookies) cookieHeaders.push(csrfCookies);
    signInRes.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') cookieHeaders.push(value);
    });
    if (cookieHeaders.length > 0) reply.header('set-cookie', cookieHeaders);

    const location = signInRes.headers.get('location');
    if (location && signInRes.status >= 300 && signInRes.status < 400) {
      return reply.code(signInRes.status).header('location', location).send();
    }
    // Auth.js returned something unexpected — surface it so debugging is
    // straightforward.
    reply.code(signInRes.status);
    return reply.send(await signInRes.text());
  });

  // Auth.js hardcodes the OAuth `redirect_uri` to `${basePath}/callback/${id}`
  // (see `@auth/core/lib/utils/providers.js` `callbackUrl` construction).
  // With basePath `/auth` the URI is `/auth/callback/discord`, so that's
  // where Discord will redirect back to. We register a Fastify route at
  // that exact path and forward directly to Auth.js without a path rewrite.
  app.get('/auth/callback/discord', async (req, reply) => {
    if (!isDiscordAuthEnabled(env)) {
      return reply.code(503).send({ error: 'discord_auth_disabled' });
    }
    return delegateToAuthJs(req, reply, '/auth/callback/discord');
  });

  // ---------------- Always-on routes ----------------

  /**
   * R3.5 — unauthenticated probe so the web Login screen can decide which
   * sign-in buttons to render. Mirrors the `isDiscordAuthEnabled` /
   * `isEmailAuthEnabled` sentinels — the same disabled state already
   * surfaces as 503 from each provider's routes, so this endpoint reveals
   * no additional information (the Discord button would otherwise just
   * lead the user to a 503).
   */
  app.get('/auth/methods', () => {
    return {
      discord: isDiscordAuthEnabled(env),
      email: isEmailAuthEnabled(env),
    };
  });

  // Sign out works whether Discord is configured or not — an authenticated
  // user with a valid cookie always deserves a clean exit.
  //
  // Implemented as a direct teardown rather than a proxy to Auth.js's
  // signout action: Auth.js v5's signout is POST-only AND CSRF-protected
  // (requires a csrfToken in a form-encoded body that matches the
  // `__Host-authjs.csrf-token` cookie). Our JSON client doesn't carry
  // that, and proxying produces a 400 / "Unexpected end of JSON input"
  // when Auth.js fails to parse the missing form body.
  //
  // This is symmetric with the email-OTP path, which creates sessions
  // directly via `createSessionForUser` instead of going through Auth.js.
  app.post('/auth/signout', async (req, reply) => {
    const cookieName = sessionCookieName(env);
    const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies;
    const token = cookies?.[cookieName];
    if (token) {
      try {
        await prisma.session.delete({ where: { sessionToken: token } });
      } catch (err) {
        // P2025 = row already gone (concurrent signout, or cookie points
        // at a stale token). Either way the user ends up logged out,
        // which is the desired outcome — swallow it. Any other error
        // is a real DB failure and must surface.
        if (
          typeof err !== 'object' ||
          err === null ||
          (err as { code?: unknown }).code !== 'P2025'
        ) {
          throw err;
        }
      }
    }
    reply.clearCookie(cookieName, { path: '/' });
    return reply.code(200).send({});
  });

  app.get('/auth/session', async (req, reply) => {
    return delegateToAuthJs(req, reply, '/auth/session');
  });

  // ---------------- R3.3 — Email OTP routes ----------------
  //
  // All four mail-sending routes gate on `isEmailAuthEnabled(env)` and the
  // presence of `mailService`. The set-display-name route is post-verify
  // session work, so it does NOT gate on SMTP — a user who already has a
  // session is allowed to set their name even if the operator later
  // disables email.
  //
  // Per SECURITY §1.2:
  //   - 8-digit OTP, 15-minute expiry, single-use (delete on consume)
  //   - 5 failed verify attempts → invalidate code + 15-min (email, ip) lockout
  //   - constant-time response on request-otp (no user enumeration)
  //   - OTP submitted via POST body only, never in a URL
  //   - logs scrub `req.body.otp` (configured in src/server.ts)
  //
  // Identifier namespacing convention (VerificationToken.identifier):
  //   - `otp:<email>`  — primary email login flow
  //   - `link:<userId>:<email>` — backup-email link flow for Discord users
  //
  // The namespace prevents a primary-flow code from accidentally being
  // consumed by the link flow and vice versa.

  const emailSchema = z.object({ email: z.email() });
  const verifySchema = z.object({
    email: z.email(),
    otp: z.string().regex(new RegExp(`^\\d{${OTP_LENGTH}}$`)),
  });
  const setDisplayNameSchema = z.object({ displayName: z.string().min(1).max(80) });

  // R10.1 — change-email flow. Tighter TTL than the 15-min login OTP
  // (OTP_LIFETIME_MS): a sensitive account mutation gets a 10-min window
  // per code. Both legs (current-address code + new-address code) use it.
  const EMAIL_CHANGE_OTP_LIFETIME_MS = 10 * 60 * 1000;
  const emailChangeStartSchema = z.object({ newEmail: z.email() });
  const emailChangeVerifySchema = z.object({
    token: z.string().min(1),
    otp: z.string().regex(new RegExp(`^\\d{${OTP_LENGTH}}$`)),
  });
  const emailChangeAbortSchema = z.object({ token: z.string().min(1) });

  /**
   * Sleep for a `delayMs` to keep request-otp responses constant-time
   * regardless of whether the email is registered. Bounds are chosen to
   * roughly cover the p50 of real SMTP submission latency (one network
   * round-trip + the SMTP STARTTLS dance) — Postmark/SES p50 sit in the
   * 100-400ms band.
   *
   * The constant-time pad defangs the trivial timing-leak case but
   * isn't a defense against request-flood abuse. R8.1 landed a per-IP
   * rate limit (`recordOtpRequest` at the top of the request-otp
   * handler; reuses the `EmailAuthAttempt` keyspace via the empty-string-
   * email sentinel) to cap request volume at OTP_REQUEST_MAX per IP
   * per OTP_REQUEST_WINDOW_MS.
   */
  async function constantTimePad(): Promise<void> {
    const ms = 150 + Math.random() * 200;
    await new Promise<void>((r) => setTimeout(r, ms));
  }

  app.post('/auth/email/request-otp', async (req, reply) => {
    if (!isEmailAuthEnabled(env) || !mailService) {
      return reply.code(503).send({ error: 'email_auth_disabled' });
    }
    const parsed = emailSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_email' });
    }
    const { email } = parsed.data;
    const ip = req.ip;

    // R8.1 — per-IP request-side rate limit. Runs BEFORE the per-(email,ip)
    // lockout check because a request-flooding attacker rotates emails
    // per hit; only the IP axis is stable across their attempts.
    const ipLock = await recordOtpRequest(prisma, ip);
    if (ipLock.locked) {
      return reply
        .code(429)
        .header('retry-after', String(Math.ceil((ipLock.until.getTime() - Date.now()) / 1000)))
        .send({ error: 'rate_limited', retryAfter: ipLock.until.toISOString() });
    }

    // Lockout check on the request side too — an attacker who burns a
    // code via the verify route shouldn't be able to immediately request
    // a fresh one. The verify-side check (in /auth/email/verify-otp) is
    // the load-bearing one for guess-burning; this check just keeps the
    // mail flood symmetric.
    const lock = await checkLockout(prisma, email, ip);
    if (lock.locked) {
      return reply
        .code(429)
        .header('retry-after', String(Math.ceil((lock.until.getTime() - Date.now()) / 1000)))
        .send({ error: 'rate_limited', retryAfter: lock.until.toISOString() });
    }

    const code = generateOtp();
    const expires = new Date(Date.now() + OTP_LIFETIME_MS);
    const identifier = `otp:${email}`;

    // Replace any pending code for this email with the fresh one.
    // Single transaction so a parallel request can't see a "no code +
    // about to insert" gap.
    await prisma.$transaction([
      prisma.verificationToken.deleteMany({ where: { identifier } }),
      prisma.verificationToken.create({ data: { identifier, token: code, expires } }),
    ]);

    try {
      await mailService.sendOtp(email, code);
    } catch (err) {
      // Mail send failed — clean up the row so the user isn't stuck with
      // a code they can't see. SECURITY §1.2: do not leak the failure to
      // the response (could be used to probe SMTP health from outside).
      // 500 is the same shape as any other internal error.
      req.log.error({ err }, 'sendOtp failed');
      await prisma.verificationToken.deleteMany({ where: { identifier } });
      return reply.code(500).send({ error: 'internal' });
    }

    // Always 200 — constant-time across registered/unregistered emails.
    // The padding above runs in parallel with the SMTP send; the outer
    // await fires when both have completed. This collapses the
    // "registered" and "unregistered" timing distributions to roughly
    // the same band (the SMTP send latency dominates).
    await constantTimePad();
    return reply.code(200).send({ status: 'sent' });
  });

  app.post('/auth/email/verify-otp', async (req, reply) => {
    if (!isEmailAuthEnabled(env)) {
      return reply.code(503).send({ error: 'email_auth_disabled' });
    }
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const { email, otp } = parsed.data;
    const ip = req.ip;

    const lock = await checkLockout(prisma, email, ip);
    if (lock.locked) {
      return reply
        .code(429)
        .header('retry-after', String(Math.ceil((lock.until.getTime() - Date.now()) / 1000)))
        .send({ error: 'rate_limited', retryAfter: lock.until.toISOString() });
    }

    const identifier = `otp:${email}`;
    const row = await prisma.verificationToken.findFirst({ where: { identifier } });

    // Determine match in constant time. If the row doesn't exist we still
    // pay the timingSafeEqual cost against a same-length dummy so the
    // "user exists" timing differential is bounded.
    const candidate = row?.token ?? '0'.repeat(OTP_LENGTH);
    const matches = row !== null && constantTimeEqual(candidate, otp);
    const expired = row !== null && isOtpExpired(row.expires);

    if (!matches || expired) {
      const { shouldInvalidateCode } = await recordFailedAttempt(prisma, email, ip);
      if (shouldInvalidateCode && row) {
        // Burned: delete the row so a subsequent correct guess is moot.
        await prisma.verificationToken.deleteMany({ where: { identifier } });
      }
      return reply.code(401).send({ error: 'invalid_code' });
    }

    // Success path. Atomically consume the token so a concurrent request
    // can't reuse it. `row` is guaranteed non-null here: `matches` only
    // becomes true on the non-null branch above.
    try {
      await prisma.verificationToken.delete({ where: { token: row.token } });
    } catch (err) {
      // P2025: the token was already consumed by a parallel request that
      // beat us to it. Treat as a verify failure rather than success.
      if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2025') {
        return reply.code(401).send({ error: 'invalid_code' });
      }
      throw err;
    }

    // Upsert User: existing rows just refresh emailVerified (idempotent —
    // re-verifying the same email re-stamps it but doesn't otherwise
    // change anything); new rows are created with `needsDisplayName: true`
    // so the §8.1 guard layer (R3.4) gates hub access until the user
    // supplies a name via /auth/email/set-display-name.
    const now = new Date();
    const user = await prisma.user.upsert({
      where: { email },
      update: { emailVerified: now },
      create: {
        email,
        emailVerified: now,
        // displayName has NOT NULL — placeholder until set-display-name
        // overwrites it. The needsDisplayName=true flag is what gates
        // access on the client side, so the actual string here is
        // irrelevant beyond satisfying the column constraint.
        displayName: '',
        needsDisplayName: true,
      },
    });

    // Clean up lockout counters on a successful auth.
    await resetAttempts(prisma, email, ip);

    const { sessionToken, expires } = await createSessionForUser(prisma, user.id);
    reply.setCookie(sessionCookieName(env), sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: useSecureCookies(env),
      expires,
    });

    return reply.code(200).send({
      user: {
        id: user.id,
        displayName: user.displayName,
        needsDisplayName: user.needsDisplayName,
        email: user.email,
        emailVerified: user.emailVerified?.toISOString() ?? null,
        avatarUrl: user.avatarUrl,
        discordId: user.discordId,
      },
      expires: expires.toISOString(),
    });
  });

  /**
   * R3.3 — Discord user adding a backup email. Request flow.
   * Requires an authenticated session; namespaces the VerificationToken
   * under `link:<userId>:<email>` so a primary-flow code can't be
   * accidentally consumed here and vice versa.
   */
  app.post('/auth/email/link/request-otp', async (req, reply) => {
    if (!isEmailAuthEnabled(env) || !mailService) {
      return reply.code(503).send({ error: 'email_auth_disabled' });
    }
    const session = await app.getSession(req);
    if (!session) return reply.code(401).send({ error: 'unauthenticated' });

    const parsed = emailSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_email' });
    }
    const { email } = parsed.data;
    const ip = req.ip;

    const lock = await checkLockout(prisma, email, ip);
    if (lock.locked) {
      return reply
        .code(429)
        .header('retry-after', String(Math.ceil((lock.until.getTime() - Date.now()) / 1000)))
        .send({ error: 'rate_limited', retryAfter: lock.until.toISOString() });
    }

    const code = generateOtp();
    const expires = new Date(Date.now() + OTP_LIFETIME_MS);
    const identifier = `link:${session.user.id}:${email}`;

    await prisma.$transaction([
      prisma.verificationToken.deleteMany({ where: { identifier } }),
      prisma.verificationToken.create({ data: { identifier, token: code, expires } }),
    ]);

    try {
      await mailService.sendOtp(email, code);
    } catch (err) {
      req.log.error({ err }, 'sendOtp failed (link flow)');
      await prisma.verificationToken.deleteMany({ where: { identifier } });
      return reply.code(500).send({ error: 'internal' });
    }

    await constantTimePad();
    return reply.code(200).send({ status: 'sent' });
  });

  /**
   * R3.3 — Discord user adding a backup email. Verify flow.
   * On success: write `email` + `emailVerified` to the session user's row.
   * Conflict (email is already attached to a different user) → 409.
   */
  app.post('/auth/email/link/verify-otp', async (req, reply) => {
    if (!isEmailAuthEnabled(env)) {
      return reply.code(503).send({ error: 'email_auth_disabled' });
    }
    const session = await app.getSession(req);
    if (!session) return reply.code(401).send({ error: 'unauthenticated' });

    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_request' });
    }
    const { email, otp } = parsed.data;
    const ip = req.ip;

    const lock = await checkLockout(prisma, email, ip);
    if (lock.locked) {
      return reply
        .code(429)
        .header('retry-after', String(Math.ceil((lock.until.getTime() - Date.now()) / 1000)))
        .send({ error: 'rate_limited', retryAfter: lock.until.toISOString() });
    }

    const identifier = `link:${session.user.id}:${email}`;
    const row = await prisma.verificationToken.findFirst({ where: { identifier } });

    const candidate = row?.token ?? '0'.repeat(OTP_LENGTH);
    const matches = row !== null && constantTimeEqual(candidate, otp);
    const expired = row !== null && isOtpExpired(row.expires);

    if (!matches || expired) {
      const { shouldInvalidateCode } = await recordFailedAttempt(prisma, email, ip);
      if (shouldInvalidateCode && row) {
        await prisma.verificationToken.deleteMany({ where: { identifier } });
      }
      return reply.code(401).send({ error: 'invalid_code' });
    }

    // Email already in use by someone else? Conflict — surface the error
    // before consuming the code so the user can request a new one with a
    // different email.
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing && existing.id !== session.user.id) {
      return reply.code(409).send({ error: 'email_already_linked' });
    }

    try {
      await prisma.verificationToken.delete({ where: { token: row.token } });
    } catch (err) {
      if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2025') {
        return reply.code(401).send({ error: 'invalid_code' });
      }
      throw err;
    }

    const now = new Date();
    const updated = await prisma.user.update({
      where: { id: session.user.id },
      data: { email, emailVerified: now },
    });
    await resetAttempts(prisma, email, ip);

    return reply.code(200).send({
      user: {
        id: updated.id,
        displayName: updated.displayName,
        needsDisplayName: updated.needsDisplayName,
        email: updated.email,
        emailVerified: updated.emailVerified?.toISOString() ?? null,
      },
    });
  });

  /**
   * R3.3 — Email-only signup completion. Requires an authenticated
   * session AND `needsDisplayName === true`. The §8.1 guard layer (R3.4)
   * will return 409 `display_name_required` on every OTHER protected
   * route until this endpoint flips the flag.
   *
   * Idempotent: if `needsDisplayName` is already false we accept the new
   * name (rename) but the existing-name case is the same 200. Tests cover
   * both branches.
   */
  app.post('/auth/email/set-display-name', async (req, reply) => {
    const session = await app.getSession(req);
    if (!session) return reply.code(401).send({ error: 'unauthenticated' });

    const parsed = setDisplayNameSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_display_name' });
    }
    const { displayName } = parsed.data;

    const updated = await prisma.user.update({
      where: { id: session.user.id },
      data: { displayName, needsDisplayName: false },
    });

    return reply.code(200).send({
      user: {
        id: updated.id,
        displayName: updated.displayName,
        needsDisplayName: updated.needsDisplayName,
        email: updated.email,
        emailVerified: updated.emailVerified?.toISOString() ?? null,
        avatarUrl: updated.avatarUrl,
        discordId: updated.discordId,
      },
    });
  });

  // ===== R10.1 — user-initiated email change (dual-OTP) ==================
  //
  // Proves possession of BOTH the current address (code #1) and the new
  // address (code #2) before swapping User.email. Requires an authenticated
  // session; identity comes from the cookie (SECURITY §6), never the body.
  //
  // A PendingEmailChange row (unique per userId) holds the target address +
  // which legs are consumed. The two OTP codes live in VerificationToken
  // under namespaced identifiers so a login/link code can never be consumed
  // here and vice versa:
  //   - `emailchange-cur:<userId>`            → sent to the CURRENT address
  //   - `emailchange-new:<userId>:<newEmail>` → sent to the NEW address
  //
  // No party-scoped TransactionLog entry is written: TransactionLog.partyId
  // is non-nullable (every entry is party-scoped) and an account-level email
  // change has no party context. The audit record is the server request log
  // + the emailVerified re-stamp on the User row.

  function emailChangeCurIdentifier(userId: string): string {
    return `emailchange-cur:${userId}`;
  }
  function emailChangeNewIdentifier(userId: string, newEmail: string): string {
    return `emailchange-new:${userId}:${newEmail}`;
  }

  /**
   * Step 1 — start the flow. Body `{ newEmail }`. Mints + sends a code to the
   * CURRENT address (proving the caller still controls the stored email).
   * Upserts the PendingEmailChange row, invalidating any prior in-flight
   * change for this user (multi-tab: last start wins).
   */
  app.post('/auth/email/change/start', async (req, reply) => {
    if (!isEmailAuthEnabled(env) || !mailService) {
      return reply.code(503).send({ error: 'email_auth_disabled' });
    }
    const session = await app.getSession(req);
    if (!session) return reply.code(401).send({ error: 'unauthenticated' });

    // Discord-only accounts (no current email) use the existing add-backup
    // flow, not this change flow.
    const currentEmail = session.user.email;
    if (!currentEmail) return reply.code(400).send({ error: 'no_current_email' });

    const parsed = emailChangeStartSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_email' });
    const { newEmail } = parsed.data;

    if (newEmail === currentEmail) {
      return reply.code(400).send({ error: 'email_unchanged' });
    }

    const ip = req.ip;
    const ipLock = await recordOtpRequest(prisma, ip);
    if (ipLock.locked) {
      return reply
        .code(429)
        .header('retry-after', String(Math.ceil((ipLock.until.getTime() - Date.now()) / 1000)))
        .send({ error: 'rate_limited', retryAfter: ipLock.until.toISOString() });
    }

    // Fast-fail if the new address is already taken. Re-checked at commit so
    // a race between start and commit can't slip a duplicate through.
    const collision = await prisma.user.findUnique({ where: { email: newEmail } });
    if (collision && collision.id !== session.user.id) {
      return reply.code(409).send({ error: 'email_already_linked' });
    }

    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    const rowExpires = new Date(now + EMAIL_CHANGE_OTP_LIFETIME_MS);
    const code = generateOtp();
    const curIdentifier = emailChangeCurIdentifier(session.user.id);

    // Upsert the pending row (one per user) + replace any stale current-leg
    // code in one transaction so a parallel start can't see a torn state.
    await prisma.$transaction([
      prisma.pendingEmailChange.upsert({
        where: { userId: session.user.id },
        create: {
          token,
          userId: session.user.id,
          newEmail,
          expires: rowExpires,
        },
        update: {
          token,
          newEmail,
          currentOtpConsumedAt: null,
          newOtpConsumedAt: null,
          expires: rowExpires,
        },
      }),
      prisma.verificationToken.deleteMany({ where: { identifier: curIdentifier } }),
      prisma.verificationToken.create({
        data: {
          identifier: curIdentifier,
          token: code,
          expires: new Date(now + EMAIL_CHANGE_OTP_LIFETIME_MS),
        },
      }),
    ]);

    try {
      await mailService.sendOtp(currentEmail, code);
    } catch (err) {
      req.log.error({ err }, 'sendOtp failed (email-change current)');
      await prisma.verificationToken.deleteMany({ where: { identifier: curIdentifier } });
      return reply.code(500).send({ error: 'internal' });
    }

    await constantTimePad();
    return reply.code(200).send({ status: 'sent', token });
  });

  /**
   * Step 2 — verify the CURRENT-address code. Body `{ token, otp }`. On
   * success stamps `currentOtpConsumedAt` and sends code #2 to the new
   * address.
   */
  app.post('/auth/email/change/verify-current', async (req, reply) => {
    if (!isEmailAuthEnabled(env) || !mailService) {
      return reply.code(503).send({ error: 'email_auth_disabled' });
    }
    const session = await app.getSession(req);
    if (!session) return reply.code(401).send({ error: 'unauthenticated' });

    const currentEmail = session.user.email;
    if (!currentEmail) return reply.code(400).send({ error: 'no_current_email' });

    const parsed = emailChangeVerifySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    const { token, otp } = parsed.data;

    const pending = await prisma.pendingEmailChange.findUnique({
      where: { userId: session.user.id },
    });
    if (!pending || pending.token !== token) {
      return reply.code(404).send({ error: 'no_pending_change' });
    }
    if (pending.expires.getTime() <= Date.now()) {
      return reply.code(410).send({ error: 'change_expired' });
    }

    const ip = req.ip;
    // Lockout keyed on the CURRENT address for this leg.
    const lock = await checkLockout(prisma, currentEmail, ip);
    if (lock.locked) {
      return reply
        .code(429)
        .header('retry-after', String(Math.ceil((lock.until.getTime() - Date.now()) / 1000)))
        .send({ error: 'rate_limited', retryAfter: lock.until.toISOString() });
    }

    const curIdentifier = emailChangeCurIdentifier(session.user.id);
    const row = await prisma.verificationToken.findFirst({ where: { identifier: curIdentifier } });
    const candidate = row?.token ?? '0'.repeat(OTP_LENGTH);
    const matches = row !== null && constantTimeEqual(candidate, otp);
    const expired = row !== null && isOtpExpired(row.expires);

    if (!matches || expired) {
      const { shouldInvalidateCode } = await recordFailedAttempt(prisma, currentEmail, ip);
      if (shouldInvalidateCode && row) {
        await prisma.verificationToken.deleteMany({ where: { identifier: curIdentifier } });
      }
      return reply.code(401).send({ error: 'invalid_code' });
    }

    try {
      await prisma.verificationToken.delete({ where: { token: row.token } });
    } catch (err) {
      if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2025') {
        return reply.code(401).send({ error: 'invalid_code' });
      }
      throw err;
    }
    await resetAttempts(prisma, currentEmail, ip);

    // Stamp the current leg + mint the new-address code.
    const code = generateOtp();
    const newIdentifier = emailChangeNewIdentifier(session.user.id, pending.newEmail);
    await prisma.$transaction([
      prisma.pendingEmailChange.update({
        where: { userId: session.user.id },
        data: { currentOtpConsumedAt: new Date() },
      }),
      prisma.verificationToken.deleteMany({ where: { identifier: newIdentifier } }),
      prisma.verificationToken.create({
        data: {
          identifier: newIdentifier,
          token: code,
          expires: new Date(Date.now() + EMAIL_CHANGE_OTP_LIFETIME_MS),
        },
      }),
    ]);

    try {
      await mailService.sendOtp(pending.newEmail, code);
    } catch (err) {
      req.log.error({ err }, 'sendOtp failed (email-change new)');
      await prisma.verificationToken.deleteMany({ where: { identifier: newIdentifier } });
      return reply.code(500).send({ error: 'internal' });
    }

    await constantTimePad();
    return reply.code(200).send({ status: 'sent' });
  });

  /**
   * Step 3 — verify the NEW-address code and commit. Body `{ token, otp }`.
   * Swaps User.email + re-stamps emailVerified, deletes the pending row, and
   * reaps stale EmailAuthAttempt rows for the old address — all in one txn.
   */
  app.post('/auth/email/change/verify-new', async (req, reply) => {
    if (!isEmailAuthEnabled(env)) {
      return reply.code(503).send({ error: 'email_auth_disabled' });
    }
    const session = await app.getSession(req);
    if (!session) return reply.code(401).send({ error: 'unauthenticated' });

    const oldEmail = session.user.email;
    if (!oldEmail) return reply.code(400).send({ error: 'no_current_email' });

    const parsed = emailChangeVerifySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    const { token, otp } = parsed.data;

    const pending = await prisma.pendingEmailChange.findUnique({
      where: { userId: session.user.id },
    });
    if (!pending || pending.token !== token) {
      return reply.code(404).send({ error: 'no_pending_change' });
    }
    if (pending.expires.getTime() <= Date.now()) {
      return reply.code(410).send({ error: 'change_expired' });
    }
    if (!pending.currentOtpConsumedAt) {
      return reply.code(409).send({ error: 'current_not_verified' });
    }

    const ip = req.ip;
    // Lockout keyed on the NEW address for this leg.
    const lock = await checkLockout(prisma, pending.newEmail, ip);
    if (lock.locked) {
      return reply
        .code(429)
        .header('retry-after', String(Math.ceil((lock.until.getTime() - Date.now()) / 1000)))
        .send({ error: 'rate_limited', retryAfter: lock.until.toISOString() });
    }

    const newIdentifier = emailChangeNewIdentifier(session.user.id, pending.newEmail);
    const row = await prisma.verificationToken.findFirst({ where: { identifier: newIdentifier } });
    const candidate = row?.token ?? '0'.repeat(OTP_LENGTH);
    const matches = row !== null && constantTimeEqual(candidate, otp);
    const expired = row !== null && isOtpExpired(row.expires);

    if (!matches || expired) {
      const { shouldInvalidateCode } = await recordFailedAttempt(prisma, pending.newEmail, ip);
      if (shouldInvalidateCode && row) {
        await prisma.verificationToken.deleteMany({ where: { identifier: newIdentifier } });
      }
      return reply.code(401).send({ error: 'invalid_code' });
    }

    // Re-check uniqueness just before committing (a fresh signup could have
    // claimed newEmail between start and now).
    const collision = await prisma.user.findUnique({ where: { email: pending.newEmail } });
    if (collision && collision.id !== session.user.id) {
      return reply.code(409).send({ error: 'email_already_linked' });
    }

    const now = new Date();
    let updated;
    try {
      [, updated] = await prisma.$transaction([
        prisma.verificationToken.delete({ where: { token: row.token } }),
        prisma.user.update({
          where: { id: session.user.id },
          data: { email: pending.newEmail, emailVerified: now },
        }),
        prisma.pendingEmailChange.delete({ where: { userId: session.user.id } }),
        // The old address is released outright — reap its lockout rows so
        // they don't linger as noise (roadmap R10.1 "freeing the old email").
        prisma.emailAuthAttempt.deleteMany({ where: { email: oldEmail } }),
      ]);
    } catch (err) {
      // P2025: the new-address code was consumed by a parallel request, or
      // the pending row vanished (concurrent abort). Treat as verify failure.
      if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2025') {
        return reply.code(401).send({ error: 'invalid_code' });
      }
      // P2002: unique violation on email — lost the uniqueness race.
      if (typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002') {
        return reply.code(409).send({ error: 'email_already_linked' });
      }
      throw err;
    }
    await resetAttempts(prisma, pending.newEmail, ip);

    return reply.code(200).send({
      user: {
        id: updated.id,
        displayName: updated.displayName,
        needsDisplayName: updated.needsDisplayName,
        email: updated.email,
        emailVerified: updated.emailVerified?.toISOString() ?? null,
        avatarUrl: updated.avatarUrl,
        discordId: updated.discordId,
      },
    });
  });

  /**
   * Abort — explicit cancel. Body `{ token }`. Deletes the pending row + both
   * namespaced codes. Idempotent: a missing/mismatched row is still a 200.
   */
  app.post('/auth/email/change/abort', async (req, reply) => {
    const session = await app.getSession(req);
    if (!session) return reply.code(401).send({ error: 'unauthenticated' });

    const parsed = emailChangeAbortSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });

    const pending = await prisma.pendingEmailChange.findUnique({
      where: { userId: session.user.id },
    });
    if (pending && pending.token === parsed.data.token) {
      await prisma.$transaction([
        prisma.pendingEmailChange.delete({ where: { userId: session.user.id } }),
        prisma.verificationToken.deleteMany({
          where: { identifier: emailChangeCurIdentifier(session.user.id) },
        }),
        prisma.verificationToken.deleteMany({
          where: { identifier: emailChangeNewIdentifier(session.user.id, pending.newEmail) },
        }),
      ]);
    }
    return reply.code(200).send({ status: 'aborted' });
  });
}
