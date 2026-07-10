/**
 * R8.5 — Shared rejection-code → toast copy.
 *
 * Extracted from the inline `toast.error(...)` body that lived in
 * `queue.ts` on the 422 path. Now shared by TWO consumers so the copy
 * is identical wherever a rejection surfaces:
 *
 *   1. `useDispatch`'s default rejection consumer (the primary path —
 *      a live component awaited the outcome).
 *   2. `queue.ts::replayOutboxRow` reconnect-drain rejections, where no
 *      live `useDispatch` awaiter exists (the dispatching component
 *      unmounted long ago) so the queue toasts directly.
 *
 * Keep this a pure `(code, message?) => { title, description? }` mapper
 * with no `sonner` import — callers own the `toast.error(...)` call so
 * this stays trivially unit-testable and free of side effects.
 */

export interface RejectionToastArgs {
  title: string;
  description?: string;
}

/**
 * Map a server rejection `code` (+ optional server `message`) to the
 * `toast.error(title, { description })` arguments. The generic shape
 * matches the pre-R8.5 inline copy (`Action rejected: <code>` with the
 * server message as the description) so existing UX is preserved; the
 * client-side sentinels get friendlier phrasing.
 */
export function rejectionToastArgs(code: string, message?: string): RejectionToastArgs {
  switch (code) {
    case 'offline_write_blocked':
      return { title: 'Offline — changes are disabled until you reconnect.' };
    case 'sync_paused':
      return { title: 'Sync paused — will retry on reconnect.' };
    case 'reducer_error':
      return {
        title: 'Action failed.',
        ...(message !== undefined ? { description: message } : {}),
      };
    default:
      // Server rejection codes (dm_only, banker_required_for_claim, …)
      // and transient sync errors keep the original `Action rejected:
      // <code>` surface with the server message as the description.
      return {
        title: `Action rejected: ${code}`,
        ...(message !== undefined ? { description: message } : {}),
      };
  }
}
