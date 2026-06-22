import type { ReactElement, ReactNode } from 'react';
import { Settings } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { Route } from '@/router/route';

interface LayoutProps {
  route: Route;
  onNavigate: (route: Route) => void;
  children: ReactNode;
}

export function Layout({ route, onNavigate, children }: LayoutProps): ReactElement {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="container flex h-14 items-center justify-between">
          <button
            type="button"
            onClick={() => onNavigate('welcome')}
            className="text-base font-semibold tracking-tight hover:opacity-80"
          >
            D&amp;D Inventory Manager
          </button>
          <nav className="flex items-center gap-2">
            <Button
              variant={route === 'settings' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => onNavigate('settings')}
              aria-label="Settings"
            >
              <Settings className="h-4 w-4" />
              <span className="sr-only sm:not-sr-only">Settings</span>
            </Button>
          </nav>
        </div>
      </header>
      <main className="container py-8">{children}</main>
    </div>
  );
}
