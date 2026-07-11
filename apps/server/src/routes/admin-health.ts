/**
 * R8.2 — `GET /admin/health` operator metric.
 *
 * Session-authenticated: returns snapshot age per party the caller is
 * an ACTIVE member of. Snapshot age = hours since the newest snapshot
 * `.json` file's mtime in `<SNAPSHOT_DIR>/<partyId>/`.
 *
 * This is a targeted single-metric endpoint. If we later add a fleet
 * of operator metrics (queue depth, socket connection count, etc.) or
 * an OTel/Prometheus exporter this becomes the natural home.
 *
 * Auth model per user selection (session-authenticated, per-user scope):
 *   - No session → 401 unauthenticated.
 *   - Session valid → returns only parties the caller is a member of
 *     (`PartyMembership.leftAt IS NULL`), archived parties excluded (same
 *     visibility filter as `GET /sync/parties`).
 *   - Missing snapshot dir OR party subdir → `null` for that party (not
 *     an error). The scheduler creates subdirs lazily on first write.
 *
 * Response shape:
 *   `{ snapshotAges: { <partyId>: <hoursSinceLastSnapshot> | null } }`
 *
 * The value is `null` when no snapshot has ever been written for a
 * party (fresh party, or SNAPSHOTS_ENABLED=false in dev/test).
 * Operators reading the metric distinguish "cron is stuck / disk full"
 * (`> 25` hours for a nightly schedule) from "never ran" (`null`).
 */
import { stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';

import type { Env } from '../config/env.js';
import type { PrismaClient } from '../../prisma/generated/prisma/client.js';

export interface AdminHealthBody {
  snapshotAges: Record<string, number | null>;
}

/**
 * Age (in hours) of the most recent `.json` snapshot in `partyDir`.
 * Returns `null` when the directory doesn't exist OR contains no
 * `.json` files. Non-`.json` entries (the `.sha256` sidecars) are
 * ignored — they mirror the `.json` mtimes anyway.
 */
export async function snapshotAgeHoursForParty(
  partyDir: string,
  now: Date,
): Promise<number | null> {
  let entries: string[];
  try {
    entries = await readdir(partyDir);
  } catch (err) {
    // ENOENT: dir hasn't been created yet (no snapshot ever written).
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }

  let newestMtime = -Infinity;
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const st = await stat(join(partyDir, entry));
    if (st.mtimeMs > newestMtime) newestMtime = st.mtimeMs;
  }
  if (newestMtime === -Infinity) return null;
  return (now.getTime() - newestMtime) / (60 * 60 * 1000);
}

export function registerAdminHealthRoute(
  app: FastifyInstance,
  opts: { env: Env; prisma: PrismaClient; now?: () => Date },
): void {
  const now = opts.now ?? (() => new Date());

  app.get(
    '/admin/health',
    { logLevel: 'silent' },
    async (req, reply): Promise<AdminHealthBody | { error: string }> => {
      const su = await app.getSession(req);
      if (su === null) {
        reply.code(401);
        return { error: 'unauthenticated' };
      }

      // Only surface parties the caller is an ACTIVE member of AND that
      // aren't archived. Matches the SECURITY §2.1 read-scope rule: no
      // information about parties you can't touch. Archived parties are
      // excluded because the metric's purpose is operational (is the
      // cron running?) — archived data is frozen and its snapshot age
      // is uninformative.
      const memberships = await opts.prisma.partyMembership.findMany({
        where: {
          userId: su.user.id,
          leftAt: null,
          party: { archivedAt: null },
        },
        select: { partyId: true },
      });

      const snapshotAges: Record<string, number | null> = {};
      const currentNow = now();
      // Dedupe: a user with both `dm` and `player` rows on the same
      // party (creator-plays-a-character case) shows up twice in the
      // membership query result.
      const partyIds = Array.from(new Set(memberships.map((m) => m.partyId)));
      for (const partyId of partyIds) {
        const partyDir = join(opts.env.SNAPSHOT_DIR, partyId);
        snapshotAges[partyId] = await snapshotAgeHoursForParty(partyDir, currentNow);
      }

      return { snapshotAges };
    },
  );
}
