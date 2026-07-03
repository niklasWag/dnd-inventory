/**
 * R5.1.a — Socket.IO server plumbing.
 *
 * Attaches a `socket.io` `Server` to Fastify's underlying HTTP server so
 * that WebSocket upgrades share the same port + TLS termination as the
 * REST API. Registers an `io.use()` middleware that:
 *
 *   1. Extracts the session cookie from the upgrade request's raw
 *      `Cookie` header. `@fastify/cookie`'s parsing decoration only
 *      populates `req.cookies` for HTTP requests routed through
 *      Fastify's handler pipeline — the Socket.IO upgrade sidesteps
 *      that pipeline, so we parse the header manually with the
 *      cookie plugin's stateless `cookie.parse()` helper.
 *   2. Feeds the shim `FastifyRequest`-like object to the existing
 *      `getSession()` helper. Same identity model as HTTP; SECURITY
 *      §6 ("WebSocket upgrade reuses session cookie").
 *   3. Rejects unauthenticated + `needsDisplayName` upgrades.
 *   4. Reads every active + non-archived `PartyMembership` for the
 *      user and calls `socket.join('party:' + partyId)` for each.
 *      Clients NEVER name the room — SECURITY §6 ("subscriptions
 *      derived server-side from PartyMembership").
 *
 * Exports `broadcastApplied(partyId, action, applied)` which emits an
 * `applied` event to `party:<partyId>`. `POST /sync/actions` invokes
 * this AFTER its transaction commits, filtered by the schema-metadata
 * flag `getActionMetadata(type).broadcastOnApplied`.
 */
import { parseCookie } from 'cookie';
import { Server as IoServer, type Socket } from 'socket.io';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { PrismaClient } from '../../prisma/generated/prisma/client.js';
import type { Env } from '../config/env.js';
import { getSession } from '../auth/session.js';
import type { Action, TransactionLogEntry } from '@app/shared';

/**
 * Per-socket observability payload. Populated in the auth middleware
 * and read by future logging / metrics slices. Passed as the fourth
 * generic to `Server` / `Socket` so `socket.data.*` accesses aren't
 * `any`-typed (ESLint no-unsafe-member-access).
 */
export interface AppSocketData {
  userId?: string;
  partyIds?: string[];
}

/**
 * Server → client event map. Only `applied` today; R5.1.b/c may add more
 * (e.g. presence, session-tags). Passed as the second generic to
 * `Server` / `Socket`.
 */
export interface ServerToClientEvents {
  applied: (payload: { partyId: string; action: Action; applied: TransactionLogEntry[] }) => void;
}

/**
 * Client → server event map. Currently EMPTY — R5.1's WebSocket contract
 * is broadcast-only (SECURITY §6: "WebSocket is broadcast-only. Clients
 * receive events; mutations go through HTTP endpoints only"). Kept as an
 * explicit interface so a future contributor sees the constraint.
 */
export type ClientToServerEvents = Record<string, never>;

type InterServerEvents = Record<string, never>;

type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  AppSocketData
>;
type AppIoServer = IoServer<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  AppSocketData
>;

export type BroadcastApplied = (
  partyId: string,
  action: Action,
  applied: TransactionLogEntry[],
) => void;

export interface RealtimeHandle {
  io: AppIoServer;
  broadcastApplied: BroadcastApplied;
  /** Testing seam: close the io server without touching Fastify. */
  close: () => Promise<void>;
}

/**
 * Build a `FastifyRequest`-shaped shim carrying only what `getSession`
 * reads: parsed cookies. Socket.IO's `socket.handshake.headers.cookie`
 * is the raw `Cookie` header string; `cookie.parse()` returns a plain
 * `Record<string, string>` matching `@fastify/cookie`'s output shape.
 *
 * We intentionally do NOT reconstruct a full `FastifyRequest` — the
 * getSession helper only reads `req.cookies[name]`, so a minimal shim
 * is safer than pretending to be Fastify's real request object.
 */
function buildRequestShim(cookieHeader: string | undefined): FastifyRequest {
  const cookies = cookieHeader === undefined ? {} : parseCookie(cookieHeader);
  return { cookies } as unknown as FastifyRequest;
}

export function attachRealtime(
  app: FastifyInstance,
  prisma: PrismaClient,
  env: Env,
): RealtimeHandle {
  const io: AppIoServer = new IoServer(app.server, {
    path: '/socket.io',
    cors: { origin: env.WEB_ORIGIN, credentials: true },
    // Explicit transports: we support both websocket + long-polling so
    // strict corporate proxies that block WS still degrade gracefully.
    // Socket.IO's default is `['polling', 'websocket']`.
    transports: ['polling', 'websocket'],
  });

  io.use((socket: AppSocket, next: (err?: Error) => void): void => {
    void (async () => {
      try {
        const cookieHeader = socket.handshake.headers.cookie;
        const shim = buildRequestShim(cookieHeader);
        const su = await getSession(shim, prisma, env);
        if (su === null) {
          next(new Error('unauthenticated'));
          return;
        }
        if (su.user.needsDisplayName) {
          next(new Error('display_name_required'));
          return;
        }

        // Discover every active + non-archived party the user belongs to.
        // Same filter as `GET /sync/parties` (routes.ts:84–87) — active
        // memberships + non-archived party.
        const memberships = await prisma.partyMembership.findMany({
          where: {
            userId: su.user.id,
            leftAt: null,
            party: { archivedAt: null },
          },
          select: { partyId: true },
        });

        const partyIds = new Set(memberships.map((m) => m.partyId));
        for (const partyId of partyIds) {
          await socket.join(roomForParty(partyId));
        }

        // Store identity on the socket for future observability (log
        // enrichment, per-user rate limiting in a follow-up).
        socket.data.userId = su.user.id;
        socket.data.partyIds = Array.from(partyIds);

        next();
      } catch (err) {
        next(err instanceof Error ? err : new Error('internal_error'));
      }
    })();
  });

  const broadcastApplied: BroadcastApplied = (partyId, action, applied) => {
    try {
      io.to(roomForParty(partyId)).emit('applied', { partyId, action, applied });
    } catch (err) {
      // Broadcast MUST NOT propagate — the DB write already committed.
      // Log through the Fastify logger so ops sees it, then swallow.
      app.log.error({ err, partyId, actionType: action.type }, 'broadcast: emit failed');
    }
  };

  return {
    io,
    broadcastApplied,
    close: async () => {
      // Force-close all sockets before closing the server so pending
      // long-poll requests don't hang the shutdown.
      io.disconnectSockets(true);
      await io.close();
    },
  };
}

/** Room-naming helper. Kept single-source-of-truth so tests + broadcast
 * stay in sync without a string literal drift risk. */
export function roomForParty(partyId: string): string {
  return `party:${partyId}`;
}
