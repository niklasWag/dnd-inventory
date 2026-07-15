import { useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, MessageSquare } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { AuthShell } from '@/components/auth/AuthShell';
import { getAuthMethods } from '@/lib/api';
import { SERVER_URL } from '@/lib/serverMode';

/**
 * R3.5 — Login screen. Two methods per OUTLINE §3.1:
 *
 *   - Discord OAuth — full-page anchor to `${SERVER_URL}/auth/discord/login`
 *     so the browser carries the OAuth state/PKCE cookies the server sets.
 *     A `navigate()` would lose them.
 *   - Email OTP — navigates to `/login/email` (purely client-side).
 *
 * On mount, the screen probes `GET /auth/methods` to learn which sign-in
 * paths the server has configured (Discord requires the CLIENT_ID +
 * CLIENT_SECRET + REDIRECT_URI triple; email requires SMTP_*). Buttons
 * for unconfigured methods are hidden — clicking one would otherwise
 * just lead to a 503.
 *
 * Always rendered behind `<PublicOnlyRoute />` so local-mode users never
 * see it. If somehow reached with `SERVER_URL === null`, the page
 * surfaces a helpful message rather than crashing.
 */
export function Login(): ReactElement {
  const navigate = useNavigate();
  const [methods, setMethods] = useState<{ discord: boolean; email: boolean } | null>(null);
  const [methodsError, setMethodsError] = useState(false);

  useEffect(() => {
    if (SERVER_URL === null) return;
    let cancelled = false;
    getAuthMethods()
      .then((res) => {
        if (!cancelled) setMethods(res);
      })
      .catch(() => {
        // On probe failure, surface a generic error rather than guessing
        // — showing buttons that 503 would be worse UX than a clear "try
        // again later" message.
        if (!cancelled) setMethodsError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (SERVER_URL === null) {
    return (
      <AuthShell
        title="Login unavailable"
        description="This deployment is running in local-only mode. The application is being used without a server."
      >
        <span className="sr-only">No server configured.</span>
      </AuthShell>
    );
  }

  if (methodsError) {
    return (
      <AuthShell
        title="Sign in unavailable"
        description="Could not reach the server. Please try again in a moment."
      >
        <span className="sr-only">Server unreachable.</span>
      </AuthShell>
    );
  }

  if (methods === null) {
    // Initial probe in flight — render the shell + title so the buttons
    // don't pop in jarringly.
    return <AuthShell title="Sign in">{null}</AuthShell>;
  }

  const noMethods = !methods.discord && !methods.email;

  return (
    <AuthShell
      title="Sign in"
      description={
        noMethods
          ? undefined
          : methods.discord && methods.email
            ? 'Use Discord or your email — both work and can be linked later in Settings.'
            : methods.discord
              ? 'Use Discord to sign in.'
              : 'Use your email to sign in.'
      }
    >
      {noMethods ? (
        <p className="text-center text-sm text-muted-foreground">
          No sign-in methods are configured on this server. Ask the operator to set up Discord OAuth
          or SMTP email.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {methods.discord && (
            <Button asChild size="lg" className="w-full">
              <a href={`${SERVER_URL}/auth/discord/login`} aria-label="Sign in with Discord">
                <MessageSquare className="h-4 w-4" />
                Sign in with Discord
              </a>
            </Button>
          )}

          {methods.email && (
            <Button
              size="lg"
              variant={methods.discord ? 'outline' : 'default'}
              className="w-full"
              onClick={() => {
                void navigate('/login/email');
              }}
            >
              <Mail className="h-4 w-4" />
              Sign in with email
            </Button>
          )}
        </div>
      )}

      {!noMethods && (
        <p className="mt-4 text-center text-xs text-muted-foreground">
          No passwords. Discord uses OAuth; email uses a one-time code.
        </p>
      )}
    </AuthShell>
  );
}
