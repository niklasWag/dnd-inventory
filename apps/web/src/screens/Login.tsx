import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, MessageSquare } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SERVER_URL } from '@/lib/serverMode';

/**
 * R3.5 — Login screen. Two methods per OUTLINE §3.1:
 *
 *   - Discord OAuth — full-page anchor to `${SERVER_URL}/auth/discord/login`
 *     so the browser carries the OAuth state/PKCE cookies the server sets.
 *     A `navigate()` would lose them.
 *   - Email OTP — navigates to `/login/email` (purely client-side).
 *
 * Always rendered behind `<PublicOnlyRoute />` so local-mode users never
 * see it. If somehow reached with `SERVER_URL === null`, the page
 * surfaces a helpful message rather than crashing.
 */
export function Login(): ReactElement {
  const navigate = useNavigate();

  if (SERVER_URL === null) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-2xl font-semibold">Login unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This deployment is running in local-only mode. The application is being used without a
          server.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 py-16">
      <header className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Use Discord or your email — both work and can be linked later in Settings.
        </p>
      </header>

      <div className="flex flex-col gap-3">
        <Button asChild size="lg" className="w-full">
          <a href={`${SERVER_URL}/auth/discord/login`} aria-label="Sign in with Discord">
            <MessageSquare className="h-4 w-4" />
            Sign in with Discord
          </a>
        </Button>

        <Button
          size="lg"
          variant="outline"
          className="w-full"
          onClick={() => {
            void navigate('/login/email');
          }}
        >
          <Mail className="h-4 w-4" />
          Sign in with email
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        No passwords. Discord uses OAuth; email uses a one-time code.
      </p>
    </div>
  );
}
