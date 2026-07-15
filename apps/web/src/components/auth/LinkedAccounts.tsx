import { useEffect, useState, type ReactElement } from 'react';
import { Link as LinkIcon, Mail } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Label } from '@/components/ui/label';
import { ApiError, getAuthMethods, requestLinkEmailOtp, verifyLinkEmailOtp } from '@/lib/api';
import { SERVER_URL } from '@/lib/serverMode';
import { useSession } from '@/store/session';

/**
 * R3.5 — Settings → Linked accounts panel.
 *
 * Two rows: Discord and Email. Each independently shows "Connected"
 * (with the relevant identifier) or "Connect" (with the appropriate
 * flow):
 *
 *   - Discord: full-page anchor to `${SERVER_URL}/auth/discord/login?link=1`
 *     so the OAuth-state + PKCE cookies the server sets land on the
 *     same browsing context. The server handles the rest and 302s
 *     back to `${WEB_ORIGIN}/settings?linked=discord` (or
 *     `?linkError=discord_already_linked`); the Settings screen reads
 *     those params and toasts. The "Connect" button is hidden when the
 *     server has no Discord OAuth triple configured (probed via
 *     `GET /auth/methods`, same as the Login screen) — clicking it would
 *     otherwise just lead to a 503. An already-linked account still shows
 *     its "Connected" badge regardless of config.
 *   - Email: inline two-step form — request OTP → verify OTP. Uses
 *     the link-flow endpoints (`/auth/email/link/*`) so the session
 *     cookie carries; on success the user's row gets the email +
 *     `emailVerified` set.
 */
export function LinkedAccounts(): ReactElement {
  const session = useSession((s) => s);
  const [discordEnabled, setDiscordEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    if (SERVER_URL === null) return;
    let cancelled = false;
    getAuthMethods()
      .then((res) => {
        if (!cancelled) setDiscordEnabled(res.discord);
      })
      .catch(() => {
        // On probe failure, treat Discord as unconfigured — hiding the
        // Connect button is safer than surfacing one that would 503.
        if (!cancelled) setDiscordEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (session.user === null) {
    return (
      <p className="text-sm text-muted-foreground">Sign in first to manage linked accounts.</p>
    );
  }

  return (
    <div className="space-y-4">
      <DiscordRow
        discordId={session.user.discordId ?? null}
        discordEnabled={discordEnabled ?? false}
      />
      <EmailRow email={session.user.email ?? null} />
    </div>
  );
}

/** R9.11 — green "Connected" badge (matches the Settings `LinkPill` mockup). */
function ConnectedBadge(): ReactElement {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
      Connected
    </span>
  );
}

function DiscordRow({
  discordId,
  discordEnabled,
}: {
  discordId: string | null;
  discordEnabled: boolean;
}): ReactElement {
  return (
    <div className="flex items-center justify-between rounded-md border border-border p-4">
      <div className="flex items-center gap-3">
        <LinkIcon className="h-5 w-5 text-muted-foreground" aria-hidden />
        <div>
          <p className="text-sm font-medium">Discord</p>
          <p className="text-xs text-muted-foreground">
            {discordId !== null
              ? `id ${discordId}`
              : discordEnabled
                ? 'Not connected.'
                : 'Not configured on this server.'}
          </p>
        </div>
      </div>
      {discordId !== null ? (
        <ConnectedBadge />
      ) : discordEnabled ? (
        <Button asChild size="sm" variant="outline">
          <a
            href={SERVER_URL === null ? '#' : `${SERVER_URL}/auth/discord/login?link=1`}
            aria-label="Connect Discord"
          >
            Connect
          </a>
        </Button>
      ) : null}
    </div>
  );
}

function EmailRow({ email }: { email: string | null }): ReactElement {
  const setUserPatch = useSession((s) => s.setUserPatch);
  const user = useSession((s) => s.user);
  const [stage, setStage] = useState<'idle' | 'enterEmail' | 'enterOtp'>('idle');
  const [emailInput, setEmailInput] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (email !== null) {
    return (
      <div className="flex items-center justify-between rounded-md border border-border p-4">
        <div className="flex items-center gap-3">
          <Mail className="h-5 w-5 text-muted-foreground" aria-hidden />
          <div>
            <p className="text-sm font-medium">Email</p>
            <p className="text-xs text-muted-foreground">{email}</p>
          </div>
        </div>
        <ConnectedBadge />
      </div>
    );
  }

  async function sendOtp(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      await requestLinkEmailOtp(emailInput);
      setStage('enterOtp');
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.code);
      } else {
        setError('Network error');
      }
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(): Promise<void> {
    if (user === null) return;
    setError(null);
    setBusy(true);
    try {
      const res = await verifyLinkEmailOtp(emailInput, otp);
      setUserPatch({ ...res.user, id: res.user.id });
      setStage('idle');
      toast.success('Email linked');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'email_already_linked') {
          setError('That email is already in use by another account.');
        } else {
          setError(err.code);
        }
      } else {
        setError('Network error');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-border p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Mail className="h-5 w-5 text-muted-foreground" aria-hidden />
          <div>
            <p className="text-sm font-medium">Email</p>
            <p className="text-xs text-muted-foreground">Not connected.</p>
          </div>
        </div>
        {stage === 'idle' ? (
          <Button size="sm" variant="outline" onClick={() => setStage('enterEmail')}>
            Connect
          </Button>
        ) : null}
      </div>

      {stage === 'enterEmail' ? (
        <div className="space-y-2 pt-2">
          <Label htmlFor="link-email">Email</Label>
          <Input
            id="link-email"
            type="email"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            autoFocus
          />
          {error !== null ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setStage('idle')}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={busy || emailInput.length === 0}
              onClick={() => void sendOtp()}
            >
              {busy ? 'Sending…' : 'Send code'}
            </Button>
          </div>
        </div>
      ) : null}

      {stage === 'enterOtp' ? (
        <div className="space-y-2 pt-2">
          <Label htmlFor="link-otp">8-digit code sent to {emailInput}</Label>
          <InputOTP id="link-otp" maxLength={8} value={otp} onChange={setOtp}>
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
              <InputOTPSlot index={3} />
              <InputOTPSlot index={4} />
              <InputOTPSlot index={5} />
              <InputOTPSlot index={6} />
              <InputOTPSlot index={7} />
            </InputOTPGroup>
          </InputOTP>
          {error !== null ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setStage('enterEmail')}>
              Back
            </Button>
            <Button size="sm" disabled={busy || otp.length !== 8} onClick={() => void verifyOtp()}>
              {busy ? 'Verifying…' : 'Verify'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
