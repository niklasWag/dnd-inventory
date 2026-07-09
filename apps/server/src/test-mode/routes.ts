/**
 * R8.4.d — Test-only helper routes for the Playwright E2E rig.
 *
 * These routes exist SOLELY to scaffold the E2E test stack — they let
 * the rig create users and sessions without driving the full OTP flow
 * for every spec. They are mounted from `server.ts` ONLY when
 * `env.E2E_TEST_MODE === true`, which is set by `e2e/docker-compose.yml`
 * and defaults to `false` everywhere else.
 *
 * Never enable this flag in production. Per SECURITY §1 (Auth surface),
 * these endpoints bypass the normal Discord / email-OTP auth flows by
 * design — the whole point is to avoid the OTP round-trip in specs.
 * Mounting them in prod would let anyone mint a session for any user.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { PrismaClient } from '../../prisma/generated/prisma/client.js';
import { sessionCookieName, useSecureCookies } from '../auth/config.js';
import { createSessionForUser } from '../auth/session.js';
import type { Env } from '../config/env.js';

const seedUserBodySchema = z
  .object({
    displayName: z.string().min(1).max(64),
    email: z.email().optional(),
  })
  .strict();

const seedSessionBodySchema = z
  .object({
    userId: z.string().min(1),
  })
  .strict();

export interface RegisterTestModeRoutesOptions {
  env: Env;
  prisma: PrismaClient;
}

export function registerTestModeRoutes(
  app: FastifyInstance,
  opts: RegisterTestModeRoutesOptions,
): void {
  const { env, prisma } = opts;

  /**
   * POST /test/seed-user
   *
   * Creates a User row with the given displayName. `email` defaults to
   * `<displayName>@e2e.local` — deterministic per name so specs can
   * re-seed the same user without needing to remember the exact email.
   */
  app.post('/test/seed-user', async (req, reply) => {
    const parsed = seedUserBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body' });
    }
    const { displayName } = parsed.data;
    const email = parsed.data.email ?? `${displayName}@e2e.local`;

    const user = await prisma.user.upsert({
      where: { email },
      update: { displayName, needsDisplayName: false },
      create: {
        email,
        displayName,
        needsDisplayName: false,
        emailVerified: new Date(),
      },
    });

    return reply.code(200).send({ userId: user.id });
  });

  /**
   * POST /test/seed-session
   *
   * Creates a fresh Session row for `userId` and returns the session
   * cookie via `Set-Cookie`. Cookie shape mirrors the one set by the
   * OTP verify route (`apps/server/src/auth/routes.ts:546`) so the
   * client sees the same auth surface it would in production.
   */
  app.post('/test/seed-session', async (req, reply) => {
    const parsed = seedSessionBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid_body' });
    }
    const { userId } = parsed.data;

    const { sessionToken, expires } = await createSessionForUser(prisma, userId);
    reply.setCookie(sessionCookieName(env), sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: useSecureCookies(env),
      expires,
    });

    return reply.code(200).send({ ok: true });
  });
}
