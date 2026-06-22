import type { ReactElement } from 'react';
import { UserPlus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { Route } from '@/router/route';

interface WelcomeProps {
  onNavigate: (route: Route) => void;
}

/**
 * Empty-state screen shown when no character exists.
 * Per MVP §7 screen 1: big "Create your character" CTA + settings link.
 * The CTA is a stub until M1 wires the create-character form.
 */
export function Welcome({ onNavigate }: WelcomeProps): ReactElement {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-6 py-16 text-center">
      <h1 className="text-4xl font-bold tracking-tight">Welcome, adventurer.</h1>
      <p className="text-muted-foreground">
        This is your private inventory manager for D&amp;D 5e (2024). Start by creating your
        character.
      </p>
      <Button size="lg" disabled title="Wired in M1 — character creation flow not yet implemented">
        <UserPlus className="h-4 w-4" />
        Create your character
      </Button>
      <button
        type="button"
        onClick={() => onNavigate('settings')}
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        Settings
      </button>
    </div>
  );
}
