/**
 * R8.1 — periodic sweep of expired `PendingDiscordLink` rows.
 *
 * `discord-link.ts::initiate` already does a drive-by
 * `deleteMany({ where: { expires: { lt: new Date() } } })` on every
 * link-initiation request. That keeps the table bounded for users who
 * complete the link flow OR return to Settings for another attempt.
 * The gap: a user who starts a link flow and NEVER RETURNS leaves an
 * expired row behind forever (a new row is minted per initiation; the
 * old one is only reaped when the user re-initiates).
 *
 * This cron is defense-in-depth for that case. Every row is a one-off
 * consent-flow handoff; there's no `retentionHours` knob — expired
 * means expired.
 *
 * Cheap: `@@index([expires])` on the model makes the sweep O(matches)
 * regardless of table size.
 */
import { schedule, type ScheduledTask } from 'node-cron';

import type { Env } from '../config/env.js';
import type { PrismaClient } from '../../prisma/generated/prisma/client.js';

/**
 * Cron pattern: 03:37 every day, local time. Offset from
 * `snapshots/scheduler.ts` (03:07) and `email/attempt-sweep.ts` (03:23)
 * so the three background sweeps don't fire simultaneously.
 */
const DAILY_CRON = '37 3 * * *';

export interface PendingLinkSweepResult {
  triggeredAt: string;
  deleted: number;
}

/**
 * Run the sweep ONCE. Exported separately from `startPendingLinkSweepCron`
 * so tests + an operator-facing "manual sweep" CLI can invoke it
 * without scheduling a cron.
 */
export async function runPendingLinkSweep(opts: {
  prisma: PrismaClient;
  /** Injected for tests; production passes `new Date()`. */
  now?: Date;
}): Promise<PendingLinkSweepResult> {
  const nowDate = opts.now ?? new Date();
  const { count } = await opts.prisma.pendingDiscordLink.deleteMany({
    where: { expires: { lt: nowDate } },
  });
  return { triggeredAt: nowDate.toISOString(), deleted: count };
}

export interface ScheduledPendingLinkSweepCron {
  task: ScheduledTask;
  stop: () => Promise<void>;
}

/**
 * Register the daily sweep cron. Returns a handle the caller can stop
 * on SIGTERM. No-op (returns `null`) when
 * `env.PENDING_LINK_SWEEP_ENABLED === false`.
 */
export function startPendingLinkSweepCron(opts: {
  env: Env;
  prisma: PrismaClient;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}): ScheduledPendingLinkSweepCron | null {
  if (!opts.env.PENDING_LINK_SWEEP_ENABLED) return null;

  const task = schedule(DAILY_CRON, async () => {
    try {
      const result = await runPendingLinkSweep({ prisma: opts.prisma });
      opts.log?.('pending-link-sweep tick complete', {
        deleted: result.deleted,
        triggeredAt: result.triggeredAt,
      });
    } catch (e) {
      opts.log?.('pending-link-sweep tick failed', { error: (e as Error).message });
    }
  });

  return {
    task,
    stop: async () => {
      await task.stop();
    },
  };
}
