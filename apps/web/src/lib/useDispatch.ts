/**
 * R8.5 — `useDispatch`: the single UI seam for mutation-preceded toasts.
 *
 * Retires the BUG-005 class ("green success toast flashes before red
 * rejection toast"). Screens used to do:
 *
 *     dispatch(action);
 *     toast.success('Item updated');   // fires the instant the local
 *                                      // reducer didn't throw — BEFORE
 *                                      // the server ack/rejection
 *
 * which flashes a success signal that a server-side guard rejection
 * then replaces with a red toast. `useDispatch` instead awaits the
 * `MutationOutcome` (server-mode: resolved by the sync queue after the
 * round-trip; local-mode: resolved synchronously by the store) and only
 * runs `onSuccess` on a genuinely terminal success.
 *
 * Usage:
 *
 *     const dispatch = useDispatch();
 *     await dispatch(
 *       { type: 'edit-item-instance', payload: { … } },
 *       { onSuccess: () => toast.success('Item updated') },
 *     );
 *
 * - `onSuccess(applied)` runs only on `{ ok: true }`.
 * - `onRejection(code, message)` runs on `{ ok: false }`. If omitted,
 *   the DEFAULT consumer renders a `toast.error` via the shared
 *   `rejectionToastArgs` map — so a rejection is never silent. A
 *   reducer-invariant violation (the raw `dispatch` throws synchronously)
 *   is caught here and normalized to `{ ok: false, code: 'reducer_error',
 *   message }` so it flows through the same rejection path.
 * - `queuedToast` (server mode only): an optional interim "Queued…"
 *   `toast.loading` shown while the round-trip is in flight, dismissed
 *   when the outcome settles. Omit it for actions where the interim
 *   toast would be noise. In local mode the outcome resolves
 *   synchronously so no interim toast is shown regardless.
 *
 * The returned function still resolves the `MutationOutcome` so callers
 * that need to branch further (batch loops counting successes) can
 * `await` it directly.
 */
import { toast } from 'sonner';

import { isServerMode } from '@/lib/serverMode';
import { useStore } from '@/store';
import type { MutationOutcome } from '@/store/outcome';
import type { Action, TransactionLogEntry } from '@/store/types';
import { rejectionToastArgs } from '@/sync/rejectionToast';

export interface UseDispatchOpts {
  onSuccess?: (applied: readonly TransactionLogEntry[]) => void;
  onRejection?: (code: string, message?: string) => void;
  /** Server-mode interim "Queued…" loading toast label. */
  queuedToast?: string;
}

/** The default rejection consumer: render the shared rejection toast. */
export function defaultRejectionToast(code: string, message?: string): void {
  const args = rejectionToastArgs(code, message);
  toast.error(
    args.title,
    args.description !== undefined ? { description: args.description } : undefined,
  );
}

export type DispatchFn = (action: Action, opts?: UseDispatchOpts) => Promise<MutationOutcome>;

export function useDispatch(): DispatchFn {
  const dispatch = useStore((s) => s.dispatch);

  return (action, opts) => {
    // Server mode: an interim "Queued…" loading toast that we dismiss
    // once the outcome settles (only when the caller asked for one).
    // Local mode resolves synchronously — no interim toast is useful.
    const loadingId =
      isServerMode && opts?.queuedToast !== undefined ? toast.loading(opts.queuedToast) : undefined;

    // R8.5 — the raw `dispatch` throws SYNCHRONOUSLY on a reducer-
    // invariant violation (a local, deterministic rejection). Convert
    // it here into a `{ ok: false, code: 'reducer_error' }` outcome so
    // callers get uniform handling through `onRejection` / the default
    // toast — the reducer-invariant test surface (raw `dispatch` throws)
    // stays intact.
    let promise: Promise<MutationOutcome>;
    try {
      promise = dispatch(action);
    } catch (err) {
      promise = Promise.resolve({
        ok: false,
        code: 'reducer_error',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }

    return promise.then((outcome) => {
      if (loadingId !== undefined) {
        toast.dismiss(loadingId);
      }
      if (outcome.ok) {
        opts?.onSuccess?.(outcome.applied);
      } else if (opts?.onRejection !== undefined) {
        opts.onRejection(outcome.code, outcome.message);
      } else {
        defaultRejectionToast(outcome.code, outcome.message);
      }
      return outcome;
    });
  };
}
