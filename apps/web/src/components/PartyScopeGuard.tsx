import { useEffect, type ReactElement } from 'react';
import { Navigate, Outlet, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { isServerMode } from '@/lib/serverMode';
import { useStore } from '@/store';

/**
 * RH4.3 — Cross-party access denial for the `/party/:partyId/*` subtree.
 *
 * Runs INSIDE `PartyScopeSync` (which has already reconciled the store's
 * `appState` with the URL's partyId). If the URL's partyId doesn't
 * correspond to an active membership for the current user, redirect to
 * `/hub` with a toast. Prevents URL tampering (deep-linking to another
 * party's screen the user isn't a member of).
 *
 * **Server-side denial is authoritative** per SECURITY §2.1 — the
 * server's `resolveActor` returns 403 for cross-party access on every
 * mutation. `PartyScopeGuard` is the client-side UX mirror: it catches
 * the case before a round-trip so the user sees an immediate redirect
 * instead of a rejected 403 flash.
 *
 * **Local mode:** always allow. Local mode has one user, one set of
 * memberships; visiting a foreign partyId is a stale-URL condition
 * handled by PartyScopeSync's re-hydrate flow (which fails cleanly to
 * `/hub` when the blob doesn't exist).
 *
 * **Server mode:** checks `state.memberships.some(m => m.partyId ===
 * urlPartyId && m.userId === state.user.id && m.leftAt === null)`. On
 * mismatch, redirects to `/hub` + toasts.
 *
 * **Composition.** Placed inside `PartyScopeSync`'s Outlet in the
 * router table, so it runs AFTER state has been reconciled:
 *
 * ```
 * <PartyScopeSync>            // loads state for URL partyId
 *   <PartyScopeGuard>         // checks membership in URL partyId
 *     <PartySettings />       // children
 * ```
 *
 * Rationale for AFTER: to check membership client-side we need the
 * user's memberships loaded. `state.memberships` is only populated
 * once PartyScopeSync has pulled state. Running BEFORE would either
 * (a) require a separate memberships fetch (round-trip we're trying
 * to avoid), or (b) fall through to the server's 403 anyway (which
 * PartyScopeSync's error handler already redirects to `/hub`).
 */
export function PartyScopeGuard(): ReactElement {
  const { partyId } = useParams<{ partyId: string }>();
  const isMember = useStore((s) => {
    if (!isServerMode) return true;
    if (s.appState === null) return true; // still loading; PartyScopeSync will handle
    if (partyId === undefined) return true; // defensive
    // Only judge membership when PartyScopeSync has fully reconciled
    // (state.party.id === urlPartyId). If they still differ, we're
    // mid-reconciliation — trust PartyScopeSync to either succeed
    // (memberships repopulated) or fail via the server's 403 (which
    // PartyScopeSync's error handler already redirects to /hub).
    if (s.appState.party.id !== partyId) return true;
    return s.appState.memberships.some(
      (m) => m.partyId === partyId && m.userId === s.appState!.user.id && m.leftAt === null,
    );
  });

  useEffect(() => {
    if (!isServerMode) return;
    if (isMember) return;
    // Only toast once per redirect; the useEffect only fires when
    // isMember flips false, so this doesn't spam.
    toast.error("You're not a member of that party.");
  }, [isMember]);

  if (!isMember) {
    return <Navigate to="/hub" replace />;
  }
  return <Outlet />;
}
