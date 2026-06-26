/**
 * Fastify factory. Extracted from `index.ts` so tests can build the app
 * without binding a port (`app.inject(...)`).
 *
 * Plugin set:
 *   - `@fastify/cors` — SPA at WEB_ORIGIN needs it.
 *   - `@fastify/sensible` — `reply.notFound()` / `reply.internalServerError()`.
 *   - `@fastify/cookie` (R3.2) — reads the session cookie that
 *     `app.getSession(req)` checks.
 *   - `@fastify/formbody` (R3.2) — Auth.js POSTs application/x-www-form-
 *     urlencoded; this plugin parses them into `req.body`.
 *
 * R3.3 — also constructs the SMTP `MailService` when configured and threads
 * it through to `registerAuthRoutes`. `trustProxy: true` is set on the
 * Fastify constructor so `req.ip` reflects the real client IP behind a
 * reverse proxy (the per-IP lockout in `email/rate-limit.ts` is only
 * meaningful with this on). `logger.redact` scrubs OTP-bearing fields so
 * the digits never appear in log output.
 */
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';

import type { Env } from './config/env.js';
import type { PrismaClient } from '../prisma/generated/prisma/client.js';
import { isEmailAuthEnabled } from './auth/config.js';
import { buildMailService, type MailService } from './auth/email/smtp.js';
import { registerAuthRoutes } from './auth/routes.js';
import { getSession, type SessionAndUser } from './auth/session.js';
import { registerHealthRoute } from './routes/health.js';

export interface BuildOptions {
  env: Env;
  prisma: PrismaClient;
  /**
   * R3.3 — optional override for the mail service. Production calls
   * `buildMailService(env)` itself; integration tests pass
   * `setupMailerMock().service` so OTP sends never hit a real SMTP
   * server.
   */
  mailService?: MailService;
}

export async function buildServer(opts: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: opts.env.LOG_LEVEL,
      // R3.3 — never log OTPs. SECURITY §1.2: "OTP is submitted via POST
      // body only, never in a query string. Server logs must not record
      // OTP values — redact the body field in the logging middleware."
      // Pino's `redact` paths walk the log object; `req.body.otp` matches
      // the OTP field on the verify-otp routes.
      redact: { paths: ['req.body.otp', '*.body.otp'], remove: true },
    },
    // R3.3 — behind a reverse proxy in production (README §3.5). Without
    // this, `req.ip` is the loopback address and the per-IP lockout in
    // `email/rate-limit.ts` cannot distinguish clients. Fastify validates
    // `X-Forwarded-For` against the proxy chain itself; we trust whatever
    // the reverse proxy passes, which is the documented contract.
    trustProxy: true,
  });

  await app.register(cors, { origin: opts.env.WEB_ORIGIN, credentials: true });
  await app.register(sensible);
  // R3.2 — cookie plugin must be registered BEFORE the routes that read
  // cookies (auth routes + getSession decorator).
  await app.register(cookie, { secret: opts.env.AUTH_SECRET });
  await app.register(formbody);

  // Decorate so route handlers reach Prisma without a singleton import.
  app.decorate('prisma', opts.prisma);

  // R3.2 — `app.getSession(req)` is the single-source-of-truth way for
  // R3.4+ guards to identify the actor. Wrapping it as a decorator keeps
  // future code from re-implementing token lookup ad-hoc.
  app.decorate('getSession', async function (this: FastifyInstance, req: FastifyRequest) {
    return getSession(req, this.prisma, opts.env);
  });

  // R3.3 — Resolve the mail service. Prefer the override (tests + future
  // dependency-injection scenarios). Otherwise lazily build from env IFF
  // the operator has configured SMTP; absent config means the email
  // routes will self-disable (503).
  const mailService =
    opts.mailService ?? (isEmailAuthEnabled(opts.env) ? buildMailService(opts.env) : undefined);

  registerHealthRoute(app);
  registerAuthRoutes(app, {
    env: opts.env,
    prisma: opts.prisma,
    ...(mailService !== undefined ? { mailService } : {}),
  });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    getSession: (req: FastifyRequest) => Promise<SessionAndUser | null>;
  }
}
