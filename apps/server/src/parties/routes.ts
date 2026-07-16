/**
 * R4.1.e — Party management routes.
 *
 * Handles the multi-member lifecycle that `/sync/actions` doesn't fit:
 *   - `POST /parties/join { inviteCode }` — redeem an invite + mint a
 *     player membership.
 *   - `POST /parties/:partyId/invite/rotate` — DM-only. Mints a new
 *     invite code; old code becomes invalid immediately.
 *   - `POST /parties/:partyId/leave` — actor self-removes. If they
 *     were the sole member, archives the party (`Party.archivedAt`).
 *   - `POST /parties/:partyId/kick { kickedUserId }` — DM-only.
 *   - `GET /parties/:partyId/members` — list active members + their
 *     display names + role tags + character names.
 *
 * Each mutation goes through the shared `@app/rules` reducer +
 * `applyDelta` so the AppState stays canonical and the TransactionLog
 * receives the matching slice (CLAUDE.md "every mutation logs once").
 *
 * Authentication: `app.getSession(req)` per the rest of the route
 * surface. The session cookie is the sole identity source per
 * SECURITY §2.1; the request body never carries `actorUserId`.
 */
import type { Actor, JoinPartyResponse } from '@app/shared';
import {
  joinPartyRequestSchema,
  kickPlayerRequestSchema,
  partyMembersResponseSchema,
} from '@app/shared';
import { generateInviteCode, reduce } from '@app/rules';
import type { FastifyInstance } from 'fastify';

import type { PrismaClient } from '../../prisma/generated/prisma/client.js';
import { resolveActor } from '../sync/actor.js';
import { appendTransactionLog, buildLogEntryServer } from '../sync/log-builder.js';
import { applyDelta } from '../sync/persistor.js';
import { loadAppStateForUser, StateLoaderError } from '../sync/state-loader.js';
import { leavePartyForUser } from './leave.js';

/**
 * The reducer's `Action` (from `@app/rules`) and Zod's inferred
 * `Action` (from `@app/shared`) share the discriminator set but
 * diverge on `exactOptionalPropertyTypes` flavor. Same bridge cast as
 * `apps/server/src/sync/routes.ts:toReducerAction`.
 */
function asReducerAction(action: unknown): Parameters<typeof reduce>[1] {
  return action as Parameters<typeof reduce>[1];
}

export function registerPartyRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  // ----- POST /parties/join -----
  app.post('/parties/join', async (req, reply) => {
    const su = await app.getSession(req);
    if (su === null) return reply.code(401).send({ error: 'unauthenticated' });
    if (su.user.needsDisplayName) return reply.code(409).send({ error: 'display_name_required' });

    const bodyParse = joinPartyRequestSchema.safeParse(req.body);
    if (!bodyParse.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: bodyParse.error.issues });
    }
    const { inviteCode } = bodyParse.data;

    // Resolve the party from the invite code. Active parties only.
    const party = await prisma.party.findUnique({
      where: { inviteCode },
      select: { id: true, name: true, archivedAt: true },
    });
    if (party === null || party.archivedAt !== null) {
      return reply.code(404).send({ error: 'invalid_invite' });
    }

    // Reject if the user is already an active member.
    const existing = await prisma.partyMembership.findFirst({
      where: { userId: su.user.id, partyId: party.id, leftAt: null },
      select: { role: true },
    });
    if (existing !== null) {
      return reply.code(409).send({ error: 'already_member' });
    }

    // Dispatch a `join-party` action authoritatively. The server route
    // owns this entire flow rather than going through the reducer
    // because the joining user is by definition not yet a member of
    // the party they're joining — `loadAppStateForUser` would reject
    // them. We mint the membership + log entry directly.
    const actor: Actor = { userId: su.user.id, partyId: party.id, role: 'player' };
    const ctx = {
      now: () => new Date().toISOString(),
      newInviteCode: generateInviteCode,
    };

    await prisma.$transaction(async (tx) => {
      // 1. Create the membership row.
      await applyDelta(tx, asReducerAction({ type: 'join-party', payload: {} }), actor, ctx);
      // 2. Append the matching log entry. We synthesise the slice
      //    inline rather than running the reducer (which would need
      //    an AppState the joining user can't load yet).
      const entry = buildLogEntryServer(
        { type: 'join-party', payload: { partyId: party.id } },
        actor,
        ctx,
        // RH2.1a — no AppState available here (the joining user isn't
        // yet a member; `loadAppStateForUser` would reject). The shared
        // deriveActorRoleForSlice tolerates null state for join-party
        // and returns 'player' (a brand-new joiner cannot be banker).
        null,
      );
      await appendTransactionLog(tx, entry);
    });

    const response: JoinPartyResponse = { partyId: party.id, partyName: party.name };
    return reply.code(200).send(response);
  });

  // ----- POST /parties/:partyId/invite/rotate -----
  app.post<{ Params: { partyId: string } }>(
    '/parties/:partyId/invite/rotate',
    async (req, reply) => {
      const su = await app.getSession(req);
      if (su === null) return reply.code(401).send({ error: 'unauthenticated' });
      if (su.user.needsDisplayName) return reply.code(409).send({ error: 'display_name_required' });

      const { partyId } = req.params;
      const actorRes = await resolveActor(prisma, su.user.id, partyId);
      if (!actorRes.ok) {
        const code = actorRes.error === 'party_not_found' ? 404 : 403;
        return reply.code(code).send({ error: actorRes.error });
      }
      if (actorRes.actor.role !== 'dm') {
        return reply.code(403).send({ error: 'dm_only' });
      }

      const inviteCode = generateInviteCode();
      await prisma.party.update({
        where: { id: partyId },
        data: { inviteCode },
      });
      return reply.code(200).send({ inviteCode });
    },
  );

  // ----- POST /parties/:partyId/leave -----
  app.post<{ Params: { partyId: string } }>('/parties/:partyId/leave', async (req, reply) => {
    const su = await app.getSession(req);
    if (su === null) return reply.code(401).send({ error: 'unauthenticated' });
    if (su.user.needsDisplayName) return reply.code(409).send({ error: 'display_name_required' });

    const { partyId } = req.params;
    const actorRes = await resolveActor(prisma, su.user.id, partyId);
    if (!actorRes.ok) {
      const code = actorRes.error === 'party_not_found' ? 404 : 403;
      return reply.code(code).send({ error: actorRes.error });
    }
    const actor = actorRes.actor;

    const result = await leavePartyForUser(prisma, actor, partyId);
    if (!result.ok) {
      if (result.error === 'sole_dm_must_transfer_first') {
        return reply.code(422).send({ error: 'sole_dm_must_transfer_first' });
      }
      return reply.code(404).send({ error: result.error });
    }
    return reply.code(200).send({ archived: result.archived });
  });

  // ----- POST /parties/:partyId/kick -----
  app.post<{ Params: { partyId: string } }>('/parties/:partyId/kick', async (req, reply) => {
    const su = await app.getSession(req);
    if (su === null) return reply.code(401).send({ error: 'unauthenticated' });
    if (su.user.needsDisplayName) return reply.code(409).send({ error: 'display_name_required' });

    const { partyId } = req.params;
    const bodyParse = kickPlayerRequestSchema.safeParse(req.body);
    if (!bodyParse.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: bodyParse.error.issues });
    }
    const { kickedUserId } = bodyParse.data;

    const actorRes = await resolveActor(prisma, su.user.id, partyId);
    if (!actorRes.ok) {
      const code = actorRes.error === 'party_not_found' ? 404 : 403;
      return reply.code(code).send({ error: actorRes.error });
    }
    const actor = actorRes.actor;
    if (actor.role !== 'dm') {
      return reply.code(403).send({ error: 'dm_only' });
    }

    try {
      const state = await loadAppStateForUser(prisma, actor.userId, partyId);
      const ctx = {
        now: () => new Date().toISOString(),
        newInviteCode: generateInviteCode,
      };

      await prisma.$transaction(async (tx) => {
        const action = asReducerAction({ type: 'kick-player', payload: { kickedUserId } });
        await applyDelta(tx, action, actor, ctx);
        const result = reduce(state, action, ctx);
        for (const slice of result.logEntries) {
          // RH2.1a — pass pre-reduce state so the shared role deriver
          // sees the party's bankerUserId at dispatch time.
          const entry = buildLogEntryServer(slice, actor, ctx, state);
          await appendTransactionLog(tx, entry);
        }
      });
      return reply.code(200).send({});
    } catch (e) {
      if (e instanceof StateLoaderError) {
        return reply.code(404).send({ error: e.code });
      }
      if (e instanceof Error && e.message.includes('cannot kick a DM')) {
        return reply.code(422).send({ error: 'cannot_kick_dm' });
      }
      if (e instanceof Error && e.message.includes('cannot kick themselves')) {
        return reply.code(422).send({ error: 'cannot_kick_self' });
      }
      if (e instanceof Error && e.message.includes('not an active member')) {
        return reply.code(404).send({ error: 'not_a_member' });
      }
      throw e;
    }
  });

  // ----- GET /parties/:partyId/members -----
  app.get<{ Params: { partyId: string } }>('/parties/:partyId/members', async (req, reply) => {
    const su = await app.getSession(req);
    if (su === null) return reply.code(401).send({ error: 'unauthenticated' });
    if (su.user.needsDisplayName) return reply.code(409).send({ error: 'display_name_required' });

    const { partyId } = req.params;
    const actorRes = await resolveActor(prisma, su.user.id, partyId);
    if (!actorRes.ok) {
      const code = actorRes.error === 'party_not_found' ? 404 : 403;
      return reply.code(code).send({ error: actorRes.error });
    }

    const [party, memberships] = await Promise.all([
      prisma.party.findUniqueOrThrow({
        where: { id: partyId },
        select: { id: true, inviteCode: true },
      }),
      prisma.partyMembership.findMany({
        where: { partyId, leftAt: null },
        include: {
          user: { select: { displayName: true } },
          character: { select: { name: true } },
        },
        orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
      }),
    ]);

    const members = memberships
      .filter((m) => m.role === 'dm' || m.role === 'player')
      .map((m) => ({
        userId: m.userId,
        displayName: m.user.displayName,
        role: m.role as 'dm' | 'player',
        characterId: m.characterId,
        characterName: m.character?.name ?? null,
        joinedAt: m.joinedAt.toISOString(),
      }));

    const response = partyMembersResponseSchema.parse({
      partyId: party.id,
      inviteCode: party.inviteCode,
      members,
    });
    return reply.code(200).send(response);
  });
}

/**
 * Variant of `loadAppStateForUser` that doesn't require the user to
 * already be a member — used by `POST /parties/join` to load the
 * pre-join AppState. The reducer's `join-party` case is the only
 * production action that runs against a state the actor isn't in.
 */
// Removed in favour of dispatching `applyDelta` + writing the log slice
// inline. Kept the comment block for historical context; the helper was
// brittle (would load state under a stranger user) and the simpler
// approach is correct by construction.
