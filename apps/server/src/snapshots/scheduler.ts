/**
 * R3.4.b — nightly snapshot cron.
 *
 * Registers a `node-cron` task at 03:00 local (per MVP §11 + R3.4
 * design decisions). Each tick:
 *   1. Enumerates every Party.
 *   2. For each: `writeSnapshot(...)`. Per-party failures are collected
 *      into a log line; the sweep continues on the next party.
 *   3. After all writes: `sweepSnapshots(...)` removes files older than
 *      `SNAPSHOT_RETENTION_DAYS`.
 *
 * Disabled when `env.SNAPSHOTS_ENABLED === false`. Tests pass that flag;
 * the docker-compose deployment leaves it on the default `true`.
 *
 * Stop / restart: `start` returns a handle whose `.stop()` cancels the
 * cron task without unwinding any in-flight tick. Suitable for SIGTERM
 * handling.
 */
import { schedule, type ScheduledTask } from 'node-cron';

import type { Env } from '../config/env.js';
import type { PrismaClient } from '../../prisma/generated/prisma/client.js';
import { sweepSnapshots, type RetentionSweepResult } from './retention.js';
import { writeSnapshot, type SnapshotWriteResult } from './writer.js';

/** Cron pattern: 03:07 every day, local time. Picking 03:07 (rather
 * than 00:00 / 03:00 sharp) matches the R3.3 "avoid the :00 / :30
 * minute marks" guidance loosely — but we DO want a predictable hour
 * for operators / log scraping, so 03:07 is the compromise.
 *
 * Single-binary deployment assumption: `schedule()` registers an
 * in-process timer; in a multi-replica deployment every replica would
 * fire its own tick and write duplicate snapshots. Followup tracked
 * in `docs/roadmap.md` → **Operational followups (unscheduled)** →
 * "Snapshot cron coordination for multi-replica deploys" — node-cron
 * v4's `runCoordinator` / `distributed` options solve this. */
const NIGHTLY_CRON = '7 3 * * *';

export interface SnapshotTickResult {
  triggeredAt: string;
  writes: SnapshotWriteResult[];
  writeErrors: { partyId: string; error: string }[];
  retention: RetentionSweepResult;
}

/**
 * Run the snapshot job ONCE. Exported separately from `startSnapshotCron`
 * so tests + an operator-facing "manual snapshot" CLI can invoke it
 * without scheduling a cron.
 */
export async function runSnapshotTick(opts: {
  prisma: PrismaClient;
  snapshotDir: string;
  retentionDays: number;
}): Promise<SnapshotTickResult> {
  const triggeredAt = new Date().toISOString();
  const writes: SnapshotWriteResult[] = [];
  const writeErrors: { partyId: string; error: string }[] = [];

  const parties = await opts.prisma.party.findMany({ select: { id: true } });
  for (const party of parties) {
    try {
      const result = await writeSnapshot({
        prisma: opts.prisma,
        partyId: party.id,
        snapshotDir: opts.snapshotDir,
        nowIso: triggeredAt,
      });
      writes.push(result);
    } catch (e) {
      writeErrors.push({ partyId: party.id, error: (e as Error).message });
    }
  }

  const retention = await sweepSnapshots({
    snapshotDir: opts.snapshotDir,
    retentionDays: opts.retentionDays,
    now: new Date(triggeredAt),
  });

  return { triggeredAt, writes, writeErrors, retention };
}

export interface ScheduledSnapshotCron {
  task: ScheduledTask;
  stop: () => Promise<void>;
}

/**
 * Register the nightly snapshot cron. Returns a handle the caller can
 * stop on SIGTERM. No-op (and returns `null`) when
 * `env.SNAPSHOTS_ENABLED === false`.
 */
export function startSnapshotCron(opts: {
  env: Env;
  prisma: PrismaClient;
  // Optional structured logger to record tick outcomes. The Fastify
  // app's `app.log` is the typical caller; tests can pass a stub.
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}): ScheduledSnapshotCron | null {
  if (!opts.env.SNAPSHOTS_ENABLED) return null;

  const task = schedule(NIGHTLY_CRON, async () => {
    try {
      const result = await runSnapshotTick({
        prisma: opts.prisma,
        snapshotDir: opts.env.SNAPSHOT_DIR,
        retentionDays: opts.env.SNAPSHOT_RETENTION_DAYS,
      });
      opts.log?.('snapshot tick complete', {
        writes: result.writes.length,
        writeErrors: result.writeErrors.length,
        retentionDeleted: result.retention.deleted.length,
        retentionErrors: result.retention.errors.length,
      });
    } catch (e) {
      opts.log?.('snapshot tick failed', { error: (e as Error).message });
    }
  });

  return {
    task,
    stop: async () => {
      await task.stop();
    },
  };
}
