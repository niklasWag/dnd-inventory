import type { ReactElement } from 'react';
import { Navigate, Outlet } from 'react-router-dom';

import { isServerMode } from '@/lib/serverMode';
import { useSession } from '@/store/session';

/**
 * R3.5 — Route guard that gates server-mode protected screens on a
 * resolved session.
 *
 * Local mode short-circuits: every protected route renders for everyone
 * (today's MVP behavior). Server mode branches on session status:
 *
 *   - `loading` → render a minimal spinner.
 *   - `anonymous` → redirect to `/login`.
 *   - `needsDisplayName` → redirect to `/login/display-name`.
 *   - `authenticated` → render `<Outlet />`.
 */
export function ProtectedRoute(): ReactElement {
  const status = useSession((s) => s.status);

  if (!isServerMode) {
    return <Outlet />;
  }

  switch (status) {
    case 'loading':
      return (
        <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
          Loading…
        </div>
      );
    case 'anonymous':
      return <Navigate to="/login" replace />;
    case 'needsDisplayName':
      return <Navigate to="/login/display-name" replace />;
    case 'authenticated':
      return <Outlet />;
  }
}

/**
 * Inverse of `ProtectedRoute` — for routes that should only render
 * when the user is NOT authenticated yet (e.g. `/login`). In local
 * mode these routes redirect to `/hub` (no Login UI per user
 * directive). In server mode an authenticated user gets bounced to
 * `/hub` too; only `anonymous` + `needsDisplayName` see the screen.
 *
 * `needsDisplayName` is allowed to see `/login/display-name` (the
 * post-OTP onboarding screen); other public routes redirect.
 */
export function PublicOnlyRoute({
  allowNeedsDisplayName = false,
}: {
  allowNeedsDisplayName?: boolean;
}): ReactElement {
  const status = useSession((s) => s.status);

  // Local mode: never show login UI.
  if (!isServerMode) {
    return <Navigate to="/hub" replace />;
  }

  switch (status) {
    case 'loading':
      return (
        <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
          Loading…
        </div>
      );
    case 'anonymous':
      return <Outlet />;
    case 'needsDisplayName':
      return allowNeedsDisplayName ? <Outlet /> : <Navigate to="/login/display-name" replace />;
    case 'authenticated':
      return <Navigate to="/hub" replace />;
  }
}
