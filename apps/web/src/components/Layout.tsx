import { Outlet, useNavigate } from 'react-router-dom';
import type { ReactElement } from 'react';
import {
  BookOpen,
  History,
  LayoutDashboard,
  LogOut,
  Play,
  Settings as SettingsIcon,
  Store,
  Users,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { Button } from '@/components/ui/button';
import { OfflineBanner } from '@/components/OfflineBanner';
import { isServerMode } from '@/lib/serverMode';
import { isCurrentUserDmOrSolo } from '@/lib/currentUserRole';
import { useCurrentPartyIdOrNull } from '@/lib/useCurrentPartyId';
import { useSession } from '@/store/session';
import { useStore } from '@/store';

/**
 * Root layout shared by every route. The header is route-aware enough to
 * highlight the Settings link but otherwise stays dumb — child routes
 * render through `<Outlet />`.
 *
 * R3.5 — header gains a session-aware right side in server mode only:
 *   - displayName + avatar (left of the nav)
 *   - Logout button (right)
 *
 * Local mode renders the original chrome unchanged.
 */
export function RootLayout(): ReactElement {
  const navigate = useNavigate();
  const session = useSession((s) => s);
  // RH4.1 — URL-scoped `partyId` for party-scoped nav items. Null when
  // the current route is not inside `/party/:partyId/*` (i.e. `/hub`,
  // `/settings`, `/login/*`).
  const partyId = useCurrentPartyIdOrNull();
  // R4.1-followup — show the Party nav button whenever an AppState is
  // loaded (i.e. the user is "inside" a party). Subscribe via
  // `useShallow` on a boolean so the header doesn't re-render on every
  // reducer mutation.
  const hasParty = useStore(useShallow((s) => s.appState !== null));
  const canSeeDmDashboard = useStore(useShallow((s) => isCurrentUserDmOrSolo(s.appState)));
  // R5.2 — surface the current GameSession as a badge whenever we're
  // inside a party AND a session is `isCurrent`. Reads via `useShallow`
  // on `(number, date)` to avoid re-rendering on unrelated GameSession
  // mutations (notes edits, etc. — for the CURRENT session, notes
  // changes DON'T need to re-render the badge because the badge doesn't
  // display notes).
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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="container flex h-14 items-center justify-between">
          <button
            type="button"
            onClick={() => {
              void navigate('/');
            }}
            className="text-base font-semibold tracking-tight hover:opacity-80"
          >
            D&amp;D Inventory Manager
          </button>
          <nav className="flex items-center gap-2">
            {partyId !== null ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void navigate(`/party/${partyId}/catalog`);
                }}
                aria-label="Catalog"
              >
                <BookOpen className="h-4 w-4" />
                <span className="sr-only sm:not-sr-only">Catalog</span>
              </Button>
            ) : null}
            {hasParty && partyId !== null ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void navigate(`/party/${partyId}/settings`);
                }}
                aria-label="Party settings"
              >
                <Users className="h-4 w-4" />
                <span className="sr-only sm:not-sr-only">Party</span>
              </Button>
            ) : null}
            {hasParty && partyId !== null ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void navigate(`/party/${partyId}/history`);
                }}
                aria-label="History"
              >
                <History className="h-4 w-4" />
                <span className="sr-only sm:not-sr-only">History</span>
              </Button>
            ) : null}
            {canSeeDmDashboard && partyId !== null ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void navigate(`/party/${partyId}/dm`);
                }}
                aria-label="DM Dashboard"
              >
                <LayoutDashboard className="h-4 w-4" />
                <span className="sr-only sm:not-sr-only">DM</span>
              </Button>
            ) : null}
            {canSeeDmDashboard && partyId !== null ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void navigate(`/party/${partyId}/shops`);
                }}
                aria-label="Shops"
              >
                <Store className="h-4 w-4" />
                <span className="sr-only sm:not-sr-only">Shops</span>
              </Button>
            ) : null}
            {partyId !== null && currentSession !== null ? (
              <span
                className="ml-1 inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300"
                aria-label={`Session ${currentSession.number} in progress, started ${currentSession.date}`}
                title={`Started ${currentSession.date}`}
              >
                <Play className="h-3 w-3" aria-hidden="true" />
                Session {currentSession.number}
              </span>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void navigate('/settings');
              }}
              aria-label="Settings"
            >
              <SettingsIcon className="h-4 w-4" />
              <span className="sr-only sm:not-sr-only">Settings</span>
            </Button>
            {isServerMode && session.status === 'authenticated' && session.user !== null ? (
              <>
                <span className="ml-2 hidden text-sm text-muted-foreground sm:inline">
                  {session.user.displayName}
                </span>
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
              </>
            ) : null}
          </nav>
        </div>
      </header>
      <OfflineBanner />
      <main className="container py-8">
        <Outlet />
      </main>
    </div>
  );
}
