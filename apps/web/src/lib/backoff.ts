/**
 * R5.1.c — Exponential backoff with jitter for the sync queue retry
 * loop. Called by `apps/web/src/sync/queue.ts` after each network-error
 * failure to schedule the next attempt.
 *
 * Curve:
 *   attempt 0 → ~500ms
 *   attempt 1 → ~1000ms
 *   attempt 2 → ~2000ms
 *   attempt 3 → ~4000ms
 *   attempt 4 → ~8000ms (capped)
 *
 * `MAX_ATTEMPTS = 5` — after the 5th failure the queue stops scheduling
 * automatic retries and leaves the batch in the outbox for the next
 * `socket.on('connect')` drain.
 *
 * Jitter (±25%) prevents thundering-herd scenarios where many tabs
 * reconnect simultaneously and all fire retries on the same tick.
 */

export const BASE_DELAY_MS = 500;
export const MAX_DELAY_MS = 8000;
export const MAX_ATTEMPTS = 5;
export const JITTER_RATIO = 0.25;

/**
 * Compute the delay (in ms) before the next retry attempt.
 *
 * `attempt` is 0-indexed:
 *   - 0 = "we just tried once, schedule the second attempt"
 *   - 1 = "we just tried twice, schedule the third attempt"
 *   - etc.
 *
 * Returns a positive number of milliseconds. Callers that reach
 * `MAX_ATTEMPTS` should NOT call this — instead they park the batch
 * in the outbox for reconnect drain.
 */
export function computeBackoff(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
  // Jitter: ±25% around the base delay. Uniformly distributed in
  // [base * 0.75, base * 1.25].
  const jitter = 1 - JITTER_RATIO + random() * JITTER_RATIO * 2;
  return Math.round(base * jitter);
}
