/**
 * R3.5 — Session store (server-mode auth state).
 *
 * Orthogonal to the gameplay store (`@/store`): mixing them would force
 * every reducer test to seed a session, and the gameplay store's `AppState`
 * shouldn't grow a non-gameplay field.
 *
 * Status FSM:
 *   - `loading` — initial. `hydrate()` resolves it.
 *   - `anonymous` — no session cookie (or local mode).
 *   - `needsDisplayName` — authenticated but `User.needsDisplayName === true`.
 *     Every `/sync/*` returns 409 in this state; the only allowed mutation
 *     is `POST /auth/email/set-display-name`.
 *   - `authenticated` — fully usable session.
 *
 * In LOCAL mode `hydrate()` is a synchronous no-op that lands at
 * `'anonymous'`. `ProtectedRoute` short-circuits on `isServerMode === false`
 * so the status is essentially unused, but we still set it explicitly to
 * keep callers free of "what mode are we in?" checks.
 */
import { create } from 'zustand';

import { ApiError, getSessionMe, signOut as signOutRequest } from '@/lib/api';
import { isServerMode } from '@/lib/serverMode';
import type { SessionUser } from '@app/shared';

export type SessionStatus = 'loading' | 'anonymous' | 'authenticated' | 'needsDisplayName';

export interface SessionStoreState {
  status: SessionStatus;
  user: SessionUser | null;
  hydrate: () => Promise<void>;
  setUserPatch: (patch: Partial<SessionUser> & Pick<SessionUser, 'id'>) => void;
  setSession: (user: SessionUser) => void;
  signOut: () => Promise<void>;
  reset: () => void;
}

function deriveStatus(user: SessionUser): Exclude<SessionStatus, 'loading' | 'anonymous'> {
  return user.needsDisplayName ? 'needsDisplayName' : 'authenticated';
}

export const useSession = create<SessionStoreState>((set, get) => ({
  status: 'loading',
  user: null,

  hydrate: async () => {
    if (!isServerMode) {
      // Local mode never has a session — settle immediately.
      set({ status: 'anonymous', user: null });
      return;
    }
    try {
      const res = await getSessionMe();
      if (res.user === undefined) {
        set({ status: 'anonymous', user: null });
        return;
      }
      set({ status: deriveStatus(res.user), user: res.user });
    } catch (e) {
      // A 401 from /auth/session is unusual (it's an always-on endpoint),
      // but we treat any failure as "anonymous" to avoid an unbootable app.
      // The user can still attempt to log in.
      if (e instanceof ApiError && e.status === 401) {
        set({ status: 'anonymous', user: null });
        return;
      }
      // Network error / 5xx — log and continue as anonymous. Callers that
      // need stricter behavior can branch on `status` themselves.

      console.warn('[session] hydrate failed; treating as anonymous', e);
      set({ status: 'anonymous', user: null });
    }
  },

  setSession: (user) => {
    set({ status: deriveStatus(user), user });
  },

  setUserPatch: (patch) => {
    const current = get().user;
    // Merging into a nonexistent user would be a logic bug; surface it
    // rather than silently materialising a session from a partial.
    if (current === null || current.id !== patch.id) {
      throw new Error('setUserPatch: no active session to patch (or id mismatch)');
    }
    const merged: SessionUser = { ...current, ...patch };
    set({ status: deriveStatus(merged), user: merged });
  },

  signOut: async () => {
    if (isServerMode) {
      try {
        await signOutRequest();
      } catch (e) {
        // Even if the server signout fails (network), we always clear local
        // state so the user isn't trapped in a half-logged-in UI.

        console.warn('[session] signOut request failed; clearing local state anyway', e);
      }
    }
    set({ status: 'anonymous', user: null });
  },

  reset: () => {
    set({ status: 'loading', user: null });
  },
}));
