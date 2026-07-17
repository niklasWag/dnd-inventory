/**
 * R10.4 — self-service account/profile routes (Settings screen backing).
 *
 *   - `POST /users/me/display-name` — rename an already-onboarded user.
 *   - `GET  /users/me/sessions`     — list the caller's active device sessions.
 *   - `POST /users/me/sessions/revoke` — revoke one session, or all-but-current.
 *   - `GET  /users/me/export`       — account-wide JSON export (one envelope
 *                                     per active party).
 *   - `POST /users/me/delete`       — SOFT-delete the account (leave every
 *                                     party, anonymize, release credentials).
 *
 * Every handler is `getSession`-guarded and `needsDisplayName`-gated like the
 * rest of the surface (SECURITY §6 — identity from the cookie, never the body).
 */
import type { AccountExportResponse, ExportEnvelope } from '@app/shared';
import { exportEnvelopeSchema } from '@app/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Env } from '../config/env.js';
import type { PrismaClient } from '../../prisma/generated/prisma/client.js';
import { sessionCookieName } from '../auth/config.js';
import { resolveActor } from '../sync/actor.js';
import { loadAppStateForUser } from '../sync/state-loader.js';
import { leavePartyForUser } from '../parties/leave.js';

const displayNameSchema = z.object({ displayName: z.string().min(1).max(80) });
const revokeSchema = z.union([
  z.object({ sessionId: z.string().min(1) }),
  z.object({ allOthers: z.literal(true) }),
]);

export function registerUserRoutes(app: FastifyInstance, prisma: PrismaClient, env: Env): void {
  // ----- POST /users/me/display-name -----
  //
  // A pure rename. Distinct from `/auth/email/set-display-name`, which also
  // flips `needsDisplayName` for the email-signup onboarding gate; this route
  // is for users who are already past onboarding.
  app.post('/users/me/display-name', async (req, reply) => {
    const su = await app.getSession(req);
    if (su === null) return reply.code(401).send({ error: 'unauthenticated' });
    if (su.user.needsDisplayName) return reply.code(409).send({ error: 'display_name_required' });

    const parsed = displayNameSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_display_name' });

    const updated = await prisma.user.update({
      where: { id: su.user.id },
      data: { displayName: parsed.data.displayName },
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
        createdAt: updated.createdAt.toISOString(),
      },
    });
  });

  // ----- GET /users/me/sessions -----
  //
  // The Auth.js `Session` model carries no device/user-agent data, so each
  // row surfaces as `{ id, createdAt, expires, current }`. `current` is true
  // for the row whose token matches the request cookie (from the resolved
  // session on the decorator — no re-reading the cookie).
  app.get('/users/me/sessions', async (req, reply) => {
    const su = await app.getSession(req);
    if (su === null) return reply.code(401).send({ error: 'unauthenticated' });
    if (su.user.needsDisplayName) return reply.code(409).send({ error: 'display_name_required' });

    const rows = await prisma.session.findMany({
      where: { userId: su.user.id },
      orderBy: { expires: 'desc' },
      select: { id: true, sessionToken: true, expires: true },
    });

    // Session has no createdAt column; the row `id` is a cuid (time-sortable
    // but not a timestamp). We surface `expires` (the meaningful field) and,
    // for `createdAt`, derive the issue time as `expires − 30d` (the fixed
    // session lifetime) so the client has a stable "signed in" instant.
    const LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
    return reply.code(200).send({
      sessions: rows.map((r) => ({
        id: r.id,
        createdAt: new Date(r.expires.getTime() - LIFETIME_MS).toISOString(),
        expires: r.expires.toISOString(),
        current: r.sessionToken === su.session.sessionToken,
      })),
    });
  });

  // ----- POST /users/me/sessions/revoke -----
  //
  // Body is either `{ sessionId }` (revoke one) or `{ allOthers: true }`
  // (revoke every session except the current). Revoking the CURRENT session
  // via this route is rejected — that's Logout (`POST /auth/signout`), which
  // also clears the cookie.
  app.post('/users/me/sessions/revoke', async (req, reply) => {
    const su = await app.getSession(req);
    if (su === null) return reply.code(401).send({ error: 'unauthenticated' });
    if (su.user.needsDisplayName) return reply.code(409).send({ error: 'display_name_required' });

    const parsed = revokeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });

    if ('allOthers' in parsed.data) {
      const res = await prisma.session.deleteMany({
        where: { userId: su.user.id, NOT: { sessionToken: su.session.sessionToken } },
      });
      return reply.code(200).send({ revoked: res.count });
    }

    // Single session by id — scoped to the caller's own rows, and never the
    // current one.
    const target = await prisma.session.findUnique({
      where: { id: parsed.data.sessionId },
      select: { userId: true, sessionToken: true },
    });
    if (target === null || target.userId !== su.user.id) {
      return reply.code(404).send({ error: 'session_not_found' });
    }
    if (target.sessionToken === su.session.sessionToken) {
      return reply.code(400).send({ error: 'cannot_revoke_current' });
    }
    await prisma.session.delete({ where: { id: parsed.data.sessionId } });
    return reply.code(200).send({ revoked: 1 });
  });

  // ----- GET /users/me/export -----
  //
  // Account-wide JSON: one `exportEnvelope` (SECURITY §7 shape) per active,
  // non-archived party the user belongs to. Each envelope is parsed at the
  // boundary before it hits the wire so any loader/schema drift surfaces as
  // a 500 rather than shipping malformed bytes.
  app.get('/users/me/export', async (req, reply) => {
    const su = await app.getSession(req);
    if (su === null) return reply.code(401).send({ error: 'unauthenticated' });
    if (su.user.needsDisplayName) return reply.code(409).send({ error: 'display_name_required' });

    const memberships = await prisma.partyMembership.findMany({
      where: { userId: su.user.id, leftAt: null, party: { archivedAt: null } },
      select: { partyId: true },
    });
    const partyIds = [...new Set(memberships.map((m) => m.partyId))];

    const parties: ExportEnvelope[] = [];
    for (const partyId of partyIds) {
      const state = await loadAppStateForUser(prisma, su.user.id, partyId);
      if (state === null) continue; // defensive; a member's party always materializes
      const envelope: ExportEnvelope = {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        appVersion: '0.0.0',
        seedVersion: state.seedVersion,
        payload: { appState: state, log: state.log },
      };
      parties.push(exportEnvelopeSchema.parse(envelope));
    }

    const body: AccountExportResponse = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      parties,
    };
    return reply.code(200).send(body);
  });

  // ----- POST /users/me/delete -----
  //
  // SOFT delete (see `User.deactivatedAt` + OUTLINE §8.3). Steps:
  //   1. Leave every active party (reuses `leavePartyForUser`: sole-member →
  //      archive; multi-member → §8.3 cascade). If the user is the sole DM of
  //      a multi-member party, abort the WHOLE deletion with 422 +
  //      `sole_dm_must_transfer_first` and the offending partyId, so the
  //      client can direct them to transfer DM first. No partial state — a
  //      failed leave aborts before any User mutation.
  //   2. Anonymize + release credentials + clear login state in one txn:
  //      `displayName='[deleted user]'`, null email/emailVerified/discordId,
  //      stamp `deactivatedAt`, delete all Session + Account + pending rows.
  //   3. Clear the caller's session cookie on the reply.
  app.post('/users/me/delete', async (req, reply) => {
    const su = await app.getSession(req);
    if (su === null) return reply.code(401).send({ error: 'unauthenticated' });
    if (su.user.needsDisplayName) return reply.code(409).send({ error: 'display_name_required' });

    const userId = su.user.id;

    // Step 1 — leave every active party. Do this BEFORE any User mutation so
    // a sole-DM blocker leaves the account fully intact.
    const memberships = await prisma.partyMembership.findMany({
      where: { userId, leftAt: null, party: { archivedAt: null } },
      select: { partyId: true },
    });
    const partyIds = [...new Set(memberships.map((m) => m.partyId))];

    for (const partyId of partyIds) {
      const actorRes = await resolveActor(prisma, userId, partyId);
      if (!actorRes.ok) {
        // The membership row exists but the actor didn't resolve — treat as
        // already-left (idempotent) and skip.
        continue;
      }
      const result = await leavePartyForUser(prisma, actorRes.actor, partyId);
      if (!result.ok && result.error === 'sole_dm_must_transfer_first') {
        return reply.code(422).send({ error: 'sole_dm_must_transfer_first', partyId });
      }
      // Other leave errors (party_not_found / not_a_member) mean the row is
      // already stale — safe to skip.
    }

    // Step 2 — soft-delete the User + tear down login state.
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          displayName: '[deleted user]',
          email: null,
          emailVerified: null,
          discordId: null,
          deactivatedAt: new Date(),
        },
      }),
      prisma.session.deleteMany({ where: { userId } }),
      prisma.account.deleteMany({ where: { userId } }),
      prisma.pendingEmailChange.deleteMany({ where: { userId } }),
      prisma.pendingDiscordLink.deleteMany({ where: { userId } }),
    ]);

    // Step 3 — clear the caller's cookie (symmetric with /auth/signout).
    reply.clearCookie(sessionCookieName(env), { path: '/' });
    return reply.code(200).send({ deleted: true });
  });
}
