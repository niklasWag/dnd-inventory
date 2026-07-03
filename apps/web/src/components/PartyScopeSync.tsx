import { useEffect, useState, type ReactElement } from 'react';
import { Navigate, Outlet, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';

import { loadAppState } from '@/db/load';
import { ApiError } from '@/lib/api';
import { isServerMode } from '@/lib/serverMode';
import { appStateSchema, transactionLogEntrySchema } from '@app/shared';
import { useStore } from '@/store';
import { pullState } from '@/sync/client';

/**
 * Shape of the persisted local-mode blob (mirrors
 * `apps/web/src/store/hydrate.ts` `persistedBlobSchema`). Kept
 * here to avoid importing across the store/hydrate boundary — the
 * two hydration paths are logically parallel: hydrate.ts is the
 * boot-time cold-start; PartyScopeSync is the runtime URL-driven
 * reconciliation.
 */
const persistedBlobSchema = z.object({
  appState: z.union([appStateSchema, z.null()]),
  log: z.array(transactionLogEntrySchema),
});

/**
 * RH4.1 — URL-vs-state reconciliation guard for the `/party/:partyId/*`
 * subtree.
 *
 * The URL is authoritative for `partyId` per the RH4 charter. When the
 * URL says party A but `state.appState.party.id` is B (or null), this
 * component:
 *   1. In **server mode**: `pullState(partyId)` → replace store.
 *   2. In **local mode**: `loadAppState(partyId)` → replace store.
 *   3. On failure (party not found in Dexie / server 404): redirect to
 *      `/hub` with a toast; the user picks another party (or creates
 *      one).
 *
 * While reconciling, renders the same spinner style as ProtectedRoute
 * so the transition looks intentional.
 *
 * **Scope.** This guard handles only the "URL says A, state has B"
 * mismatch. Cross-party access denial (URL says A but the user isn't a
 * member of A) is `PartyScopeGuard`'s job in RH4.3 — it composes AROUND
 * this component so the membership check short-circuits before we
 * bother hydrating.
 *
 * **Idempotency.** The guard's `useEffect` keys on `partyId`. Multiple
 * mounts with the same partyId (e.g. navigating between siblings under
 * the same party subtree) don't re-hydrate; only a partyId change
 * triggers the pull.
 */
export function PartyScopeSync(): ReactElement {
  const { partyId } = useParams<{ partyId: string }>();
  const currentStatePartyId = useStore((s) => s.appState?.party.id ?? null);

  // `status` moves loading → ready | error. `error` triggers the redirect
  // branch; `ready` renders the child Outlet.
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    partyId !== undefined && currentStatePartyId === partyId ? 'ready' : 'loading',
  );

  useEffect(() => {
    if (partyId === undefined) {
      // Shouldn't happen — the parent route matches `/party/:partyId/*`
      // so partyId is always populated. Defense-in-depth.
      setStatus('error');
      return;
    }
    if (currentStatePartyId === partyId) {
      setStatus('ready');
      return;
    }

    let cancelled = false;
    setStatus('loading');

    async function reconcile(id: string): Promise<void> {
      try {
        if (isServerMode) {
          const pulled = await pullState(id);
          if (cancelled) return;
          useStore.getState().hydrate({ appState: pulled.state, log: pulled.state.log });
        } else {
          const raw = await loadAppState(id);
          if (cancelled) return;
          if (raw === null) {
            toast.error("That party isn't in local storage.");
            setStatus('error');
            return;
          }
          const parsed = persistedBlobSchema.parse(raw);
          useStore.getState().hydrate({ appState: parsed.appState, log: parsed.log });
        }
        if (!cancelled) setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.code === 'not_a_member') {
          // RH4.3 will short-circuit BEFORE this guard runs for the
          // authoritative check, but the server-side check still runs
          // if the client-side membership snapshot is stale. Toast +
          // redirect either way.
          toast.error("You're not a member of that party.");
        } else {
          toast.error(err instanceof Error ? err.message : 'Could not load that party.');
        }
        setStatus('error');
      }
    }

    void reconcile(partyId);
    return () => {
      cancelled = true;
    };
  }, [partyId, currentStatePartyId]);

  if (status === 'error') {
    return <Navigate to="/hub" replace />;
  }
  if (status === 'loading') {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  return <Outlet />;
}
