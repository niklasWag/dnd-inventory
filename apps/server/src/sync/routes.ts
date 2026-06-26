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
import { randomUUID } from 'node:crypto';

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
    const memberships = await prisma.partyMembership.findMany({
      where: { userId: su.user.id, leftAt: null },
      include: { party: true },
    });

    // Group by partyId so a user with both dm + player rows in a
    // party-of-one collapses to a single response entry with both
    // roles listed.
    const byPartyId = new Map<
      string,
      {
        id: string;
        name: string;
        roles: ('dm' | 'player')[];
        memberCount: number;
        isSoloShortcut: boolean;
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
        isSoloShortcut: m.party.isSoloShortcut,
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

    // create-character is the ONLY action that's legal pre-membership.
    // For every other action, resolve the actor against an existing
    // membership row; for create-character, the actor is a "synthetic"
    // actor in the user's prospective new party (the persistor mints
    // the party + memberships atomically).
    const isBootstrap = actions.every((a) => a.type === 'create-character');
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

    // Server-side reducer context — same shape as the web's.
    const ctx: ReducerContext = {
      newId: () => randomUUID(),
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

            // Bootstrap seam: create-character mints a fresh party in
            // the reducer's result.state. The actor's partyId arrived
            // as a placeholder ('will-be-minted'); promote it to the
            // freshly-minted id BEFORE building the log entry so the
            // TransactionLog row's partyId FK resolves correctly.
            if (schemaAction.type === 'create-character' && reduced.state !== null) {
              actor = { ...actor, partyId: reduced.state.party.id };
            }

            // The persistor MUST run before the log writes so the
            // TransactionLog.partyId / actorUserId FKs resolve. The
            // log entry's payload describes the post-mutation state.
            if (schemaAction.type === 'create-character' && reduced.state !== null) {
              await applyBootstrapDelta(tx, reduced.state, su.user.id, schemaAction.payload);
            } else {
              await applyDelta(tx, action, actor, ctx);
            }

            for (const slice of reduced.logEntries) {
              const entry = buildLogEntryServer(slice, actor, ctx);
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
