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
 *   - `GET /auth/discord/callback`  → /auth/callback/discord     (token exchange + session cookie)
 *   - `POST /auth/signout`           → /auth/signout             (session row deletion + cookie clear)
 *   - `GET /auth/session`            → /auth/session             (current session JSON, or 401)
 *
 * When `DISCORD_*` env vars are absent, the OAuth routes return 503
 * (SECURITY §1.2 SMTP-disabled parallel). `GET /auth/session` keeps
 * working without Discord — useful for R3.5 client probes.
 */
import { Auth } from '@auth/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { Env } from '../config/env.js';
import type { PrismaClient } from '../../prisma/generated/prisma/client.js';

import { buildAuthConfig, isDiscordAuthEnabled } from './config.js';

export interface RegisterAuthRoutesOptions {
  env: Env;
  prisma: PrismaClient;
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
 * with default basePath = '/auth'. Our public routes are:
 *   /auth/discord/login    → maps to /auth/signin/discord
 *   /auth/discord/callback → maps to /auth/callback/discord
 *   /auth/signout          → already correct
 *   /auth/session          → already correct
 */
function authJsPathFor(publicPath: string): string {
  if (publicPath === '/auth/discord/login') return '/auth/signin/discord';
  if (publicPath === '/auth/discord/callback') return '/auth/callback/discord';
  return publicPath;
}

export function registerAuthRoutes(app: FastifyInstance, opts: RegisterAuthRoutesOptions): void {
  const { env, prisma } = opts;
  const authConfig = buildAuthConfig({ prisma, env });

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

  app.get('/auth/discord/callback', async (req, reply) => {
    if (!isDiscordAuthEnabled(env)) {
      return reply.code(503).send({ error: 'discord_auth_disabled' });
    }
    return delegateToAuthJs(req, reply, '/auth/discord/callback');
  });

  // ---------------- Always-on routes ----------------

  // Sign out works whether Discord is configured or not — an authenticated
  // user with a valid cookie always deserves a clean exit.
  app.post('/auth/signout', async (req, reply) => {
    return delegateToAuthJs(req, reply, '/auth/signout');
  });

  app.get('/auth/session', async (req, reply) => {
    return delegateToAuthJs(req, reply, '/auth/session');
  });
}
