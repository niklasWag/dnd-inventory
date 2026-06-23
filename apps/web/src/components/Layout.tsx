import { Outlet, useNavigate } from 'react-router-dom';
import type { ReactElement } from 'react';
import { BookOpen, Settings as SettingsIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * Root layout shared by every route. The header is route-aware enough to
 * highlight the Settings link but otherwise stays dumb — child routes
 * render through `<Outlet />`.
 */
export function RootLayout(): ReactElement {
  const navigate = useNavigate();

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
          </nav>
        </div>
      </header>
      <main className="container py-8">
        <Outlet />
      </main>
    </div>
  );
}
