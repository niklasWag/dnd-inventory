/**
 * R8.1 — periodic sweep of stale `EmailAuthAttempt` rows.
 *
 * The `EmailAuthAttempt` table holds durable rate-limit state for the
 * email OTP verify + request flows. In steady state each row is either:
 *   (a) an in-progress failure counter (`lockedUntil IS NULL`, some
 *       `failedCount > 0`), or
 *   (b) a lockout row (`lockedUntil !== null`) that will expire on its
 *       own — the check queries `lockedUntil > now`.
 *
 * A `(email, ip)` pair that hit MAX_FAILED_ATTEMPTS produces a lockout
 * row. Once its `lockedUntil` elapses the row is harmless (subsequent
 * `checkLockout` calls return `not-locked`), but it stays in the table
 * forever and grows the row count linearly with attack attempts. This
 * sweep is defense-in-depth against unbounded growth.
 *
 * Behaviour:
 *   - Deletes rows with `lockedUntil !== null` AND `lockedUntil < now - retentionHours`.
 *   - Leaves rows with `lockedUntil IS NULL` untouched (in-progress
 *     counters that haven't hit the threshold yet).
 *   - The `@@index([lockedUntil])` on `EmailAuthAttempt` makes the sweep
 *     cheap even when the table is large.
 *
 * See `snapshots/scheduler.ts` for the shape this file mirrors:
 *   - `run<Name>` is a pure function callable from tests + a future
 *     manual-invoke CLI without scheduling a cron.
 *   - `start<Name>Cron` wraps `run<Name>` with `node-cron`; returns a
 *     `{ task, stop }` handle collected by `server.ts` for SIGTERM.
 */
import { schedule, type ScheduledTask } from 'node-cron';

import type { Env } from '../../config/env.js';
import type { PrismaClient } from '../../../prisma/generated/prisma/client.js';

/**
 * Cron pattern: 03:23 every day, local time. Offset from
 * `snapshots/scheduler.ts`'s 03:07 and `pending-link-sweep.ts`'s 03:37
 * so the three background sweeps don't fire simultaneously.
 */
const DAILY_CRON = '23 3 * * *';

export interface EmailAttemptSweepResult {
  triggeredAt: string;
  deleted: number;
}

/**
 * Run the sweep ONCE. Exported separately from `startEmailAttemptSweepCron`
 * so tests + an operator-facing "manual sweep" CLI can invoke it
 * without scheduling a cron.
 */
export async function runEmailAttemptSweep(opts: {
  prisma: PrismaClient;
  /** Rows whose `lockedUntil` is older than `now - retentionHours` are deleted. */
  retentionHours: number;
  /** Injected for tests; production passes `new Date()`. */
  now?: Date;
}): Promise<EmailAttemptSweepResult> {
  const nowDate = opts.now ?? new Date();
  const threshold = new Date(nowDate.getTime() - opts.retentionHours * 60 * 60 * 1000);

  const { count } = await opts.prisma.emailAuthAttempt.deleteMany({
    where: {
      // Not `lockedUntil: { lt: threshold }` alone — Prisma's null
      // semantics on comparison operators are `null NOT < <anything>`,
      // so rows with `lockedUntil IS NULL` are already excluded by the
      // comparison. Being explicit here keeps the SQL readable.
      lockedUntil: { not: null, lt: threshold },
    },
  });

  return { triggeredAt: nowDate.toISOString(), deleted: count };
}

export interface ScheduledEmailAttemptSweepCron {
  task: ScheduledTask;
  stop: () => Promise<void>;
}

/**
 * Register the daily sweep cron. Returns a handle the caller can stop
 * on SIGTERM. No-op (returns `null`) when
 * `env.EMAIL_ATTEMPT_SWEEP_ENABLED === false`.
 */
export function startEmailAttemptSweepCron(opts: {
  env: Env;
  prisma: PrismaClient;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}): ScheduledEmailAttemptSweepCron | null {
  if (!opts.env.EMAIL_ATTEMPT_SWEEP_ENABLED) return null;

  const task = schedule(DAILY_CRON, async () => {
    try {
      const result = await runEmailAttemptSweep({
        prisma: opts.prisma,
        retentionHours: opts.env.EMAIL_ATTEMPT_SWEEP_RETENTION_HOURS,
      });
      opts.log?.('email-attempt-sweep tick complete', {
        deleted: result.deleted,
        triggeredAt: result.triggeredAt,
      });
    } catch (e) {
      opts.log?.('email-attempt-sweep tick failed', { error: (e as Error).message });
    }
  });

  return {
    task,
    stop: async () => {
      await task.stop();
    },
  };
}
