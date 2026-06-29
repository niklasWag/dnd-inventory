import { Outlet, useNavigate } from 'react-router-dom';
import type { ReactElement } from 'react';
import { BookOpen, LogOut, Settings as SettingsIcon, Users } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import { Button } from '@/components/ui/button';
import { isServerMode } from '@/lib/serverMode';
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
  // R4.1-followup — show the Party nav button whenever an AppState is
  // loaded (i.e. the user is "inside" a party). Subscribe via
  // `useShallow` on a boolean so the header doesn't re-render on every
  // reducer mutation.
  const hasParty = useStore(useShallow((s) => s.appState !== null));

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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void navigate('/catalog');
              }}
              aria-label="Catalog"
            >
              <BookOpen className="h-4 w-4" />
              <span className="sr-only sm:not-sr-only">Catalog</span>
            </Button>
            {hasParty ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  void navigate('/party/settings');
                }}
                aria-label="Party settings"
              >
                <Users className="h-4 w-4" />
                <span className="sr-only sm:not-sr-only">Party</span>
              </Button>
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
      <main className="container py-8">
        <Outlet />
      </main>
    </div>
  );
}
