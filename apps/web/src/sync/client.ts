/**
 * R3.5 — Sync client (server-mode push/pull).
 *
 * Thin re-exports + typed helpers around `lib/api.ts` for the queue
 * + boot path. The boundary lives here so the queue file stays focused
 * on debounce / rollback semantics.
 */
import {
  pullState as apiPullState,
  pushActions as apiPushActions,
  BatchRejectedError,
} from '@/lib/api';
import type { Action } from '@/store/types';

export { BatchRejectedError };

export async function pullState(partyId: string): ReturnType<typeof apiPullState> {
  return apiPullState(partyId);
}

export async function pushActions(
  partyId: string,
  actions: readonly Action[],
): ReturnType<typeof apiPushActions> {
  // Cast through `unknown[]` because the typed boundary at the api
  // layer accepts unknown arrays and validates the response shape.
  // The action types are structurally identical (the server's Zod
  // schema mirrors the reducer's type union).
  return apiPushActions(partyId, actions as unknown as unknown[]);
}
