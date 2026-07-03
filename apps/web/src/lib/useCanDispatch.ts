/**
 * R5.1.d — reactive hook mirroring the store-level `canDispatch`
 * predicate. UI controls that want to disable their Save/Submit button
 * during a multi-member-party offline window call this and pass the
 * result to `disabled={!canDispatch}`.
 *
 * The store's `dispatch()` itself short-circuits when this returns
 * `false` (correctness backstop, per §9), so the hook is purely for
 * user affordance — a disabled Save button is clearer UX than a click
 * that silently no-ops with a toast.
 *
 * See `apps/web/src/store/index.ts::canDispatchFor` for the pure
 * predicate and its rationale.
 */
import { useShallow } from 'zustand/react/shallow';

import { isServerMode } from '@/lib/serverMode';
import { activeMemberCount, canDispatchFor, useStore } from '@/store';

export function useCanDispatch(): boolean {
  return useStore(
    useShallow((s) => canDispatchFor(isServerMode, s.online, activeMemberCount(s.appState))),
  );
}
