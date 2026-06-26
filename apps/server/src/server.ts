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
 */
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';

import type { Env } from './config/env.js';
import type { PrismaClient } from '../prisma/generated/prisma/client.js';
import { registerAuthRoutes } from './auth/routes.js';
import { getSession, type SessionAndUser } from './auth/session.js';
import { registerHealthRoute } from './routes/health.js';

export interface BuildOptions {
  env: Env;
  prisma: PrismaClient;
}

export async function buildServer(opts: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: opts.env.LOG_LEVEL },
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

  registerHealthRoute(app);
  registerAuthRoutes(app, { env: opts.env, prisma: opts.prisma });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    getSession: (req: FastifyRequest) => Promise<SessionAndUser | null>;
  }
}
