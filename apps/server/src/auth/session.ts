/**
 * R3.2 — Database-backed session lookup + sliding expiry.
 *
 * The "1 DB read per authenticated request" cost we accept by choosing the
 * database session strategy (vs JWT) lives in this module. Every protected
 * route in R3.4 will call `getSession(req, prisma, env)` to resolve the
 * actor identity. Returns `null` for:
 *   - missing cookie
 *   - cookie value doesn't match a Session row
 *   - Session row is past its `expires` timestamp (we delete the row as a
 *     courtesy)
 *
 * SECURITY §1.1 sliding-30-day-expiry: when the remaining lifetime drops
 * below `maxAge - updateAge`, we bump `expires = now + maxAge` so an
 * active user's session keeps refreshing.
 */
import type { FastifyRequest } from 'fastify';

import type { PrismaClient, Session, User } from '../../prisma/generated/prisma/client.js';
import type { Env } from '../config/env.js';

import { sessionCookieName } from './config.js';

// Re-export so callers + tests can import the name helper from one place
// without having to know it lives in config.ts. The single source of truth
// for the dev/prod switch is `config.ts`.
export { sessionCookieName };

/**
 * Session lifetime constants. Must match `buildAuthConfig`'s
 * `session.maxAge` / `session.updateAge` so cookies that Auth.js issues
 * with one TTL aren't slid forward under a different TTL.
 */
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24;

/**
 * Prisma's "record to delete does not exist" error code. Importing the
 * concrete error class from `@prisma/client/runtime` is fragile across
 * Prisma majors, and our generated client wraps Prisma internally — a
 * structural check on `code === 'P2025'` is portable and avoids the
 * import dance. See:
 * https://www.prisma.io/docs/orm/reference/error-reference#p2025
 */
function isPrismaRecordNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'P2025'
  );
}

export interface SessionAndUser {
  session: Session;
  user: User;
}

/**
 * Read the session cookie from a Fastify request. Returns `undefined` if
 * absent. Requires `@fastify/cookie` to be registered on the app.
 */
function readSessionToken(req: FastifyRequest, env: Env): string | undefined {
  const cookies = (req as unknown as { cookies?: Record<string, string | undefined> }).cookies;
  if (!cookies) return undefined;
  return cookies[sessionCookieName(env)];
}

/**
 * Resolve the actor for the current request. Pure DB lookup — no Discord
 * calls, no Auth.js round-trip. R3.4's route guards will call this on
 * every mutation; the session row's `expires` is the only TTL we trust.
 */
export async function getSession(
  req: FastifyRequest,
  prisma: PrismaClient,
  env: Env,
): Promise<SessionAndUser | null> {
  const token = readSessionToken(req, env);
  if (!token) return null;

  const row = await prisma.session.findUnique({
    where: { sessionToken: token },
    include: { user: true },
  });
  if (!row) return null;

  const now = Date.now();
  const expiresAtMs = row.expires.getTime();
  if (expiresAtMs <= now) {
    // Expired — delete so the table doesn't accumulate dead rows. The
    // await keeps the contract simple: when getSession returns, the DB
    // state is consistent.
    //
    // We catch ONLY Prisma's P2025 ("record to delete does not exist")
    // — that's the benign race where another request beat us to the
    // delete. Any other error (connection drop, FK violation, server
    // panic) is genuinely broken state and must surface, not be
    // silently treated as "session expired". The previous catch-all
    // would have masked real DB failures as auth failures.
    try {
      await prisma.session.delete({ where: { sessionToken: token } });
    } catch (err) {
      if (!isPrismaRecordNotFound(err)) throw err;
    }
    return null;
  }

  // Sliding expiry. We bump `expires` forward when remaining lifetime
  // has dropped below `maxAge - updateAge` — i.e., the session has been
  // touched within the last `updateAge` seconds since the previous bump.
  const remainingSeconds = (expiresAtMs - now) / 1000;
  if (remainingSeconds < SESSION_MAX_AGE_SECONDS - SESSION_UPDATE_AGE_SECONDS) {
    const newExpires = new Date(now + SESSION_MAX_AGE_SECONDS * 1000);
    const updated = await prisma.session.update({
      where: { sessionToken: token },
      data: { expires: newExpires },
      include: { user: true },
    });
    return { session: updated, user: updated.user };
  }

  return { session: row, user: row.user };
}
