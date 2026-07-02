/**
 * R3.4.a — Sync routes. `GET /sync/state` + `POST /sync/actions`.
 *
 * Per SECURITY §2: the server is authoritative. The actor's identity
 * comes from the session cookie (NEVER the request body). The §8.1
 * matrix is enforced via the shared `checkGuard` map. Every mutation
 * appends a `TransactionLog` entry composed server-side.
 *
 * The push handler runs the WHOLE batch inside a single
 * `prisma.$transaction`. If any action fails its guard, the whole
 * batch rolls back (via `BatchRejected` throw) and the response is a
 * `422 { rejected: { index, code, message } }`. The 30-second timeout
 * + 100-action batch cap (in `types.ts`) bound the worst-case
 * transaction duration.
 *
 * R3.3 carryforward: `user.needsDisplayName === true` on the session
 * means the user has not completed the email-OTP onboarding flow yet.
 * Both routes return `409 { error: 'display_name_required' }` until
 * `POST /auth/email/set-display-name` flips the flag.
 */
import type {
  Actor,
  Action as SchemaAction,
  ExportEnvelope,
  TransactionLogEntry,
} from '@app/shared';
import { checkGuard, exportEnvelopeSchema } from '@app/shared';
import {
  generateInviteCode,
  reduce,
  type Action as ReducerAction,
  type ReducerContext,
} from '@app/rules';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';

import type { PrismaClient } from '../../prisma/generated/prisma/client.js';
import { resolveActor } from './actor.js';
import { appendTransactionLog, buildLogEntryServer } from './log-builder.js';
import { applyBootstrapDelta, applyDelta } from './persistor.js';
import { loadAppStateForUser, StateLoaderError } from './state-loader.js';
import { BatchRejected, syncActionsRequestSchema } from './types.js';

/**
 * The Zod-inferred `Action` from `@app/shared/schemas/action` and the
 * reducer's TS `Action` from `@app/rules/reducer/types` share the same
 * discriminator set but diverge on `exactOptionalPropertyTypes` field
 * flavour (Zod: `field?: T | undefined`; reducer: `field?: T`). The
 * compile-time `types.drift.test.ts` cross-test asserts the
 * discriminator sets are identical. This cast is the boundary that
 * bridges the two — safe because the discriminator + shape are
 * structurally identical at runtime; only the TS optional-field
 * representation differs.
 */
function toReducerAction(action: SchemaAction): ReducerAction {
  return action as unknown as ReducerAction;
}

export function registerSyncRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  // ----- GET /sync/parties (R3.5) -----
  //
  // The Hub screen lists the user's parties. One row per Party, with
  // the user's `roles` collapsed (a party-of-one user holds both
  // 'dm' and 'player' membership rows; we surface them as one array).
  // `lastActivityAt` is the max(TransactionLog.timestamp) so the Hub
  // can sort by recency.
  app.get('/sync/parties', async (req, reply) => {
    const su = await app.getSession(req);
    if (su === null) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    if (su.user.needsDisplayName) {
      return reply.code(409).send({ error: 'display_name_required' });
    }

    // Active memberships only (`leftAt` null). Includes the related
    // Party in one round-trip so we can build the response shape
    // without an N+1.
    //
    // R4.1.e — filter out archived parties (`Party.archivedAt IS NOT NULL`)
    // so the Hub never lists a party that's been sole-member-archived
    // (the DM keeps their last access; UI filtering hides it from the
    // Hub but the data is preserved per OUTLINE §8.3).
    const memberships = await prisma.partyMembership.findMany({
      where: { userId: su.user.id, leftAt: null, party: { archivedAt: null } },
      include: { party: true },
    });

    // Group by partyId so a user with both dm + player rows in a
    // party-of-one collapses to a single response entry with both
    // roles listed.
    //
    // R4.1 — `isSoloShortcut` dropped per OUTLINE §4 amendment
    // (2026-06-24). The Hub UI derives the "solo" badge from
    // `memberCount === 1` instead.
    const byPartyId = new Map<
      string,
      {
        id: string;
        name: string;
        roles: ('dm' | 'player')[];
        memberCount: number;
        lastActivityAt: string | null;
      }
    >();

    // We need memberCount + lastActivityAt per party; fetch both in one
    // additional aggregation per party. Cardinality is tiny in the
    // R3.5 timeframe (single-digit parties per user) — a multi-query
    // batch later is a micro-optimization, not a correctness concern.
    for (const m of memberships) {
      // Banker shows up at the column level but is denormalized on
      // Party.bankerUserId, not as a membership row (the §2.2 guard
      // rejects banker writes). If we somehow see a 'banker' row we
      // skip it here — it would otherwise widen the response role
      // enum and crash the shared Zod parse.
      if (m.role !== 'dm' && m.role !== 'player') continue;

      const existing = byPartyId.get(m.partyId);
      if (existing !== undefined) {
        if (!existing.roles.includes(m.role)) existing.roles.push(m.role);
        continue;
      }

      const [memberRows, latest] = await Promise.all([
        prisma.partyMembership.findMany({
          where: { partyId: m.partyId, leftAt: null },
          select: { userId: true },
        }),
        prisma.transactionLog.findFirst({
          where: { partyId: m.partyId },
          orderBy: { timestamp: 'desc' },
          select: { timestamp: true },
        }),
      ]);
      const uniqueUserIds = new Set(memberRows.map((r) => r.userId));

      byPartyId.set(m.partyId, {
        id: m.partyId,
        name: m.party.name,
        roles: [m.role],
        memberCount: uniqueUserIds.size,
        lastActivityAt: latest?.timestamp.toISOString() ?? null,
      });
    }

    return reply.code(200).send({ parties: Array.from(byPartyId.values()) });
  });

  // ----- GET /sync/state?partyId=... -----
  app.get('/sync/state', async (req, reply) => {
    const su = await app.getSession(req);
    if (su === null) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    if (su.user.needsDisplayName) {
      return reply.code(409).send({ error: 'display_name_required' });
    }

    const queryParse = z.object({ partyId: z.string().min(1) }).safeParse(req.query);
    if (!queryParse.success) {
      return reply.code(400).send({ error: 'invalid_query', issues: queryParse.error.issues });
    }
    const { partyId } = queryParse.data;

    try {
      const state = await loadAppStateForUser(prisma, su.user.id, partyId);
      return reply.code(200).send({ state, serverTime: new Date().toISOString() });
    } catch (e) {
      if (e instanceof StateLoaderError) {
        const code = e.code === 'party_not_found' ? 404 : e.code === 'not_a_member' ? 403 : 404;
        return reply.code(code).send({ error: e.code });
      }
      throw e;
    }
  });

  // ----- GET /sync/export?partyId=... (R3.4.b) -----
  //
  // Server-side parity for the web's JSON export (§3.13 / SECURITY §7).
  // Returns an `exportEnvelope`-shaped JSON wrapper carrying the same
  // AppState the user would see via `/sync/state`, plus the metadata
  // the v1 envelope mandates (schemaVersion, exportedAt, appVersion,
  // seedVersion). Same auth + display-name + party-membership gates
  // as `/sync/state`.
  app.get('/sync/export', async (req, reply) => {
    const su = await app.getSession(req);
    if (su === null) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    if (su.user.needsDisplayName) {
      return reply.code(409).send({ error: 'display_name_required' });
    }

    const queryParse = z.object({ partyId: z.string().min(1) }).safeParse(req.query);
    if (!queryParse.success) {
      return reply.code(400).send({ error: 'invalid_query', issues: queryParse.error.issues });
    }
    const { partyId } = queryParse.data;

    try {
      const state = await loadAppStateForUser(prisma, su.user.id, partyId);
      if (state === null) {
        // Defensive: a party with a successful membership check should
        // always materialize to a non-null AppState. If we ever hit
        // this branch it's a schema-invariant violation.
        return reply.code(500).send({ error: 'state_null' });
      }
      const envelope: ExportEnvelope = {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        appVersion: '0.0.0',
        seedVersion: state.seedVersion,
        payload: { appState: state, log: state.log },
      };
      // Boundary parse — surfaces any drift between the loader's output
      // and the envelope schema before bytes hit the wire.
      return reply.code(200).send(exportEnvelopeSchema.parse(envelope));
    } catch (e) {
      if (e instanceof StateLoaderError) {
        const code = e.code === 'party_not_found' ? 404 : e.code === 'not_a_member' ? 403 : 404;
        return reply.code(code).send({ error: e.code });
      }
      throw e;
    }
  });

  // ----- POST /sync/actions -----
  app.post('/sync/actions', async (req, reply) => {
    const su = await app.getSession(req);
    if (su === null) {
      return reply.code(401).send({ error: 'unauthenticated' });
    }
    if (su.user.needsDisplayName) {
      return reply.code(409).send({ error: 'display_name_required' });
    }

    const bodyParse = syncActionsRequestSchema.safeParse(req.body);
    if (!bodyParse.success) {
      return reply.code(400).send({ error: 'invalid_body', issues: bodyParse.error.issues });
    }
    const { partyId, actions } = bodyParse.data;

    // create-character has TWO valid shapes:
    //
    //   1. Bootstrap — single create-character action against a party that
    //      doesn't exist yet. RH1.2 introduced client-minted UUID v7 ids
    //      in the payload (`newUserId`, `newPartyId`, etc.), so the client
    //      sends the REAL partyId every time (no more `'will-be-minted'`
    //      placeholder). The reducer applies user + party + memberships +
    //      character + stashes atomically, and `applyBootstrapDelta`
    //      writes the new rows keyed on those client-minted ids.
    //
    //   2. Post-bootstrap (R4.1.f) — create-character against a party that
    //      ALREADY exists. The actor is an active member (player with
    //      `characterId: null` OR DM-only DM) who's adding their own
    //      character. The reducer mutates state; `applyDelta` writes only
    //      the new character + inventory stash + currency holding + the
    //      membership update.
    //
    // RH1.3: dispatch on `party.findUnique === null` alone. The
    // `actions.every === 'create-character'` conjunct is gone — a non-
    // create-character action against an unknown party will fall through
    // to `applyDelta` and be rejected by the guards with
    // `state_not_initialized` (state stays null on the isBootstrap path).
    const partyExists = await prisma.party.findUnique({
      where: { id: partyId },
      select: { id: true },
    });
    const isBootstrap = partyExists === null;
    let actor: Actor;
    if (isBootstrap) {
      actor = { userId: su.user.id, partyId, role: 'dm' };
    } else {
      const resolved = await resolveActor(prisma, su.user.id, partyId);
      if (!resolved.ok) {
        const code = resolved.error === 'party_not_found' ? 404 : 403;
        return reply.code(code).send({ error: resolved.error });
      }
      actor = resolved.actor;
    }

    // Server-side reducer context — same shape as the web's. RH1.2:
    // no `newId`; every id comes from the action payload.
    const ctx: ReducerContext = {
      now: () => new Date().toISOString(),
      newInviteCode: generateInviteCode,
    };

    try {
      const applied = await prisma.$transaction(
        async (tx) => {
          // Loaded state for guard + reducer evaluation. The bootstrap
          // create-character case starts from null state.
          let state = isBootstrap ? null : await loadAppStateForUser(tx, su.user.id, partyId);
          const out: TransactionLogEntry[] = [];

          for (let i = 0; i < actions.length; i++) {
            const schemaAction = actions[i]!;
            const action = toReducerAction(schemaAction);
            const memberships = state?.memberships ?? [];
            const g = checkGuard(state, schemaAction, actor, memberships);
            if (!g.ok) throw new BatchRejected(i, g.code, g.message);

            // Validate-and-apply via the shared reducer (server-side
            // re-run per SECURITY §2). Any invariant the reducer
            // enforces (negative balance, missing entity, etc.) throws
            // and rolls back the batch.
            const reduced = reduce(state, action, ctx);

            // Bootstrap seam: the reducer's result.state.party.id is
            // the client-minted `newPartyId` (RH1.2). Post-RH1.3 the
            // client SHOULD also send that same id as the URL
            // partyId, so actor.partyId already equals it — but tests
            // and defensive clients may send a placeholder. Promote
            // actor.partyId to the reducer's canonical value so the
            // log entry's `TransactionLog.partyId` FK resolves.
            if (isBootstrap && schemaAction.type === 'create-character' && reduced.state !== null) {
              actor = { ...actor, partyId: reduced.state.party.id };
            }

            // The persistor MUST run before the log writes so the
            // TransactionLog.partyId / actorUserId FKs resolve. The
            // log entry's payload describes the post-mutation state.
            //
            // RH1.2 — Prisma unique-constraint violations (`P2002`) on
            // the persistor path mean a client-minted id collided with
            // an existing row's primary key. Map to a `BatchRejected`
            // with the `id_already_exists` guard code so the client
            // sees a 422 with a diagnostic RH1 code rather than a raw
            // 500.
            try {
              if (isBootstrap && schemaAction.type === 'create-character' && reduced.state !== null) {
                await applyBootstrapDelta(tx, reduced.state, su.user.id, schemaAction.payload);
              } else {
                await applyDelta(tx, action, actor, ctx);
              }
            } catch (err) {
              if (
                typeof err === 'object' &&
                err !== null &&
                (err as { code?: unknown }).code === 'P2002'
              ) {
                throw new BatchRejected(
                  i,
                  'id_already_exists',
                  `Client-minted id collides with an existing row (Prisma P2002 on ${schemaAction.type}).`,
                );
              }
              throw err;
            }

            for (const slice of reduced.logEntries) {
              // RH2.1a — pass the pre-reduce state so the shared
              // `deriveActorRoleForSlice` can compute the correct
              // per-action-type role. For the bootstrap create-character
              // iteration `state === null` here; the shared function
              // handles that carve-out.
              const entry = buildLogEntryServer(slice, actor, ctx, state);
              await appendTransactionLog(tx, entry);
              out.push(entry);
            }

            state = reduced.state;
          }
          return out;
        },
        { timeout: 30_000 },
      );

      return reply.code(200).send({ applied, serverTime: new Date().toISOString() });
    } catch (e) {
      if (e instanceof BatchRejected) {
        return reply
          .code(422)
          .send({ rejected: { index: e.index, code: e.code, message: e.message } });
      }
      throw e;
    }
  });
}
