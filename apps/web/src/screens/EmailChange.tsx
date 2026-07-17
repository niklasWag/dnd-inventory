import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';

import { AuthShell } from '@/components/auth/AuthShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Label } from '@/components/ui/label';
import {
  ApiError,
  abortEmailChange,
  startEmailChange,
  verifyCurrentEmailOtp,
  verifyNewEmailOtp,
} from '@/lib/api';
import { useSession } from '@/store/session';

/**
 * R10.1 — user-initiated email change with dual-OTP confirmation.
 *
 * Three steps, all on one blocking screen (unscoped, no sidebar — renders
 * its own AuthShell):
 *   1. Enter the new email → `startEmailChange` sends a code to the CURRENT
 *      address (proving the caller still controls the stored email).
 *   2. Enter that code → `verifyCurrentEmailOtp`; the server then sends a
 *      second code to the NEW address.
 *   3. Enter the second code → `verifyNewEmailOtp` commits the swap.
 *
 * Identity is the session cookie server-side (SECURITY §6); the client only
 * threads the pending-change `token`. Cancel calls `abortEmailChange`. A
 * `beforeunload` guard warns on tab-close while a flow is in progress.
 */

const newEmailSchema = z.object({
  newEmail: z.string().trim().email('Enter a valid email'),
});
type NewEmailForm = z.infer<typeof newEmailSchema>;

type Step = 'email' | 'current-otp' | 'new-otp';

export function EmailChange(): ReactElement {
  const navigate = useNavigate();
  const currentEmail = useSession((s) => s.user?.email ?? null);
  const setSession = useSession((s) => s.setSession);

  const [step, setStep] = useState<Step>('email');
  const [token, setToken] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<NewEmailForm>({
    resolver: zodResolver(newEmailSchema),
    defaultValues: { newEmail: '' },
  });

  // A flow is "in progress" once we hold a pending token — warn on tab close.
  const inProgress = token !== null;
  useEffect(() => {
    if (!inProgress) return;
    const handler = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [inProgress]);

  // Discord-only accounts can't use this flow — send them back to Settings.
  const noCurrentEmail = currentEmail === null;

  function messageFor(err: unknown, fallback: string): string {
    if (err instanceof ApiError) {
      switch (err.code) {
        case 'invalid_code':
          return 'Wrong or expired code. Check your email or request a new one.';
        case 'rate_limited':
          return `Too many attempts. Try again after ${err.retryAfter ?? 'a while'}.`;
        case 'email_already_linked':
          return 'That email is already in use by another account.';
        case 'email_unchanged':
          return 'That is already your current email.';
        case 'change_expired':
          return 'This change expired. Start again.';
        default:
          return err.code;
      }
    }
    return fallback;
  }

  async function onStart(values: NewEmailForm): Promise<void> {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await startEmailChange(values.newEmail);
      setToken(res.token);
      setNewEmail(values.newEmail);
      setOtp('');
      setStep('current-otp');
    } catch (err) {
      setSubmitError(messageFor(err, 'Could not start the change. Check your connection.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function onVerifyCurrent(): Promise<void> {
    if (token === null || otp.length !== 8) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      await verifyCurrentEmailOtp(token, otp);
      setOtp('');
      setStep('new-otp');
    } catch (err) {
      setSubmitError(messageFor(err, 'Could not verify. Check your connection.'));
    } finally {
      setSubmitting(false);
    }
  }

  async function onVerifyNew(): Promise<void> {
    if (token === null || otp.length !== 8) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await verifyNewEmailOtp(token, otp);
      setSession(res.user);
      setToken(null);
      toast.success('Email updated');
      void navigate('/settings', { replace: true });
    } catch (err) {
      setSubmitError(messageFor(err, 'Could not verify. Check your connection.'));
    } finally {
      setSubmitting(false);
    }
  }

  const abortRef = useRef(token);
  abortRef.current = token;
  async function onCancel(): Promise<void> {
    const t = abortRef.current;
    if (t !== null) {
      try {
        await abortEmailChange(t);
      } catch {
        // Best-effort — the pending row also expires on its own.
      }
    }
    void navigate('/settings', { replace: true });
  }

  if (noCurrentEmail) {
    return (
      <AuthShell
        title="Change email"
        description="Your account has no email address to change. Add one from Settings first."
      >
        <Button
          className="w-full"
          onClick={() => {
            void navigate('/settings', { replace: true });
          }}
        >
          Back to settings
        </Button>
      </AuthShell>
    );
  }

  if (step === 'email') {
    return (
      <AuthShell
        title="Change email"
        description="Enter the new address. We'll confirm both your current and new email with a code."
      >
        <form
          onSubmit={(e) => {
            void form.handleSubmit((v) => onStart(v))(e);
          }}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-1.5">
            <Label htmlFor="newEmail">New email</Label>
            <Input
              id="newEmail"
              type="email"
              autoFocus
              autoComplete="email"
              {...form.register('newEmail')}
            />
            {form.formState.errors.newEmail ? (
              <p className="text-sm text-destructive" role="alert">
                {form.formState.errors.newEmail.message}
              </p>
            ) : null}
          </div>

          {submitError !== null ? (
            <p className="text-sm text-destructive" role="alert">
              {submitError}
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void onCancel();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={submitting}>
              {submitting ? 'Sending…' : 'Send code'}
            </Button>
          </div>
        </form>
      </AuthShell>
    );
  }

  const onNewAddress = step === 'new-otp';
  const targetEmail = onNewAddress ? newEmail : currentEmail;

  return (
    <AuthShell
      title={onNewAddress ? 'Confirm your new email' : 'Confirm your current email'}
      description={
        <>
          We sent an 8-digit code to{' '}
          <span className="font-medium text-foreground">{targetEmail}</span>. It&apos;s valid for 10
          minutes.
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void (onNewAddress ? onVerifyNew() : onVerifyCurrent());
        }}
        className="space-y-4"
        noValidate
      >
        <div className="flex flex-col items-center space-y-1.5">
          <Label htmlFor="otp" className="self-start">
            Code
          </Label>
          <InputOTP id="otp" maxLength={8} value={otp} onChange={setOtp} autoFocus>
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
        </div>

        {submitError !== null ? (
          <p className="text-sm text-destructive" role="alert">
            {submitError}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void onCancel();
            }}
          >
            Cancel
          </Button>
          <Button type="submit" className="flex-1" disabled={submitting || otp.length !== 8}>
            {submitting ? 'Verifying…' : onNewAddress ? 'Confirm change' : 'Verify code'}
          </Button>
        </div>
      </form>
    </AuthShell>
  );
}
