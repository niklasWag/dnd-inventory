/**
 * R8.5 — Mutation outcome authority.
 *
 * The addressable terminal result of a `dispatch(...)`. Retires the
 * BUG-005 class ("green success toast flashes before red rejection
 * toast") by making the mutation's *final* outcome a value that the UI
 * awaits, rather than firing a success signal the instant the local
 * reducer didn't throw.
 *
 * - **Local mode** — `dispatch` resolves this SYNCHRONOUSLY after the
 *   `set()` + persist: there's no server round-trip, so the local
 *   apply IS the terminal outcome.
 * - **Server mode** — `dispatch` returns a promise the sync queue
 *   resolves once `POST /sync/actions` reaches a terminal state (200
 *   success, 422 rejection, auth failure, or parked-after-retries).
 *   The queue is the single authority producing this value (same
 *   "one canonical layer per concern" pattern as RH1 id-authority /
 *   RH2.6 log-authority / RH4 partyId-authority).
 *
 * Both arms RESOLVE — a mutation outcome is never a rejected promise.
 * `{ ok: false }` carries a stable `code` (server rejection code, or a
 * client-side sentinel like `offline_write_blocked` / `reducer_error`)
 * plus an optional human `message`. Consumers (`useDispatch`) branch on
 * `ok` and route the terminal toast accordingly.
 */
import type { TransactionLogEntry } from './types';

export type MutationOutcome =
  | { ok: true; applied: readonly TransactionLogEntry[] }
  | { ok: false; code: string; message?: string };
