/**
 * Fastify factory. Extracted from `index.ts` so tests can build the app
 * without binding a port (`app.inject(...)`).
 *
 * Plugin set is deliberately minimal for R3.1: `@fastify/cors` (the web
 * SPA at `WEB_ORIGIN` will need it from R3.2 onward) and
 * `@fastify/sensible` (gives us `reply.notFound()` / `reply.internalServerError()`
 * helpers without a custom error layer). Auth / cookies / rate-limit
 * plugins land in R3.2.
 */
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';

import type { Env } from './config/env.js';
import type { PrismaClient } from '../prisma/generated/prisma/client.js';
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

  // Decorate so route handlers reach Prisma without a singleton import.
  app.decorate('prisma', opts.prisma);

  registerHealthRoute(app);

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}
