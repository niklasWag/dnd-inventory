import { Outlet, useNavigate } from 'react-router-dom';
import { useState, type ReactElement } from 'react';
import { LogOut, Menu, Play } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Sidebar } from '@/components/nav/Sidebar';
import { OfflineBanner } from '@/components/OfflineBanner';
import { isServerMode } from '@/lib/serverMode';
import { useCurrentPartyIdOrNull } from '@/lib/useCurrentPartyId';
import { useSession } from '@/store/session';
import { useStore } from '@/store';

/**
 * R9.2 — Root layout. Two shapes:
 *
 *   - **Inside a party** (`/party/:partyId/*` AND an AppState is loaded):
 *     the grouped nav `Sidebar` frames the content. Desktop = a fixed
 *     left rail; mobile (`< lg`) = a top bar with a hamburger that opens
 *     the sidebar in a `Sheet` drawer ("the drawer IS the sidebar" —
 *     CHARTER). The current-session badge + server-mode logout live in
 *     the mobile top bar / rail footer area.
 *   - **Outside a party** (auth `/login/*`, `/hub`, app `/settings`):
 *     a chrome-light shell — no sidebar (CHARTER: auth routes stay
 *     unscoped) — just the offline banner + the routed screen.
 *
 * Child routes render through `<Outlet />`.
 */
export function RootLayout(): ReactElement {
  const partyId = useCurrentPartyIdOrNull();
  const hasParty = useStore(useShallow((s) => s.appState !== null));
  const inParty = partyId !== null && hasParty;

  if (!inParty) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <OfflineBanner />
        <Outlet />
      </div>
    );
  }

  return <PartyShell />;
}

/**
 * The party-scoped shell: sidebar + content. Split into its own component
 * so the session/logout selectors only subscribe when we're actually
 * inside a party (the chrome-light branch above stays cheap).
 */
function PartyShell(): ReactElement {
  const navigate = useNavigate();
  const session = useSession((s) => s);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // R5.2 — current-session badge (surfaces on every party screen when a
  // GameSession is `isCurrent`). Shallow-selected scalars so the shell
  // doesn't re-render on unrelated session mutations.
  const currentSession = useStore(
    useShallow((s) => {
      const current = s.appState?.gameSessions.find((gs) => gs.isCurrent);
      return current === undefined ? null : { number: current.number, date: current.date };
    }),
  );

  async function handleLogout(): Promise<void> {
    await session.signOut();
    void navigate('/login', { replace: true });
  }

  const sessionBadge =
    currentSession !== null ? (
      <span
        className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300"
        aria-label={`Session ${currentSession.number} in progress, started ${currentSession.date}`}
        title={`Started ${currentSession.date}`}
      >
        <Play className="h-3 w-3" aria-hidden="true" />
        Session {currentSession.number}
      </span>
    ) : null;

  const logoutButton =
    isServerMode && session.status === 'authenticated' && session.user !== null ? (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          void handleLogout();
        }}
        aria-label="Logout"
      >
        <LogOut className="h-4 w-4" />
        <span className="sr-only sm:not-sr-only">Logout</span>
      </Button>
    ) : null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen">
        {/* Desktop rail */}
        <div className="hidden lg:block">
          <div className="sticky top-0 h-screen">
            <Sidebar />
          </div>
        </div>

        {/* Mobile drawer — the sidebar rendered inside a Sheet */}
        <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
          <SheetContent side="left" className="w-60 p-0">
            <Sidebar drawer onNavigate={() => setDrawerOpen(false)} />
          </SheetContent>
        </Sheet>

        {/* Content column */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile top bar (hamburger + session badge + logout) */}
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2 lg:hidden">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Open navigation"
              onClick={() => setDrawerOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              {sessionBadge}
              {logoutButton}
            </div>
          </div>

          {/* Desktop session badge + logout strip (only when there's something to show) */}
          {sessionBadge !== null || logoutButton !== null ? (
            <div className="hidden items-center justify-end gap-2 px-6 pt-4 lg:flex">
              {sessionBadge}
              {logoutButton}
            </div>
          ) : null}

          <OfflineBanner />
          <main className="flex-1">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
