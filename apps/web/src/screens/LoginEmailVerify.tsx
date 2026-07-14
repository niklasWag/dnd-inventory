import { useState, type ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Label } from '@/components/ui/label';
import { AuthShell } from '@/components/auth/AuthShell';
import { ApiError, verifyEmailOtp } from '@/lib/api';
import { useSession } from '@/store/session';

/**
 * R3.5 — Step 2 of email OTP login. Reads `email` from query, asks the
 * user for the 8-digit OTP via shadcn `input-otp` (R3.3 carryforward
 * — `maxLength={8}` matches SECURITY §1.2), and posts to
 * `POST /auth/email/verify-otp`.
 *
 * On 200 we patch the session store and route to `/login/display-name`
 * if `needsDisplayName` is true, else `/hub`.
 */
export function LoginEmailVerify(): ReactElement {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const email = params.get('email') ?? '';
  const setSession = useSession((s) => s.setSession);

  const [otp, setOtp] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function onSubmit(): Promise<void> {
    if (otp.length !== 8) {
      setSubmitError('Enter all 8 digits.');
      return;
    }
    if (email.length === 0) {
      setSubmitError('Email missing — restart from the previous step.');
      return;
    }
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await verifyEmailOtp(email, otp);
      setSession(res.user);
      if (res.user.needsDisplayName) {
        void navigate('/login/display-name', { replace: true });
      } else {
        void navigate('/hub', { replace: true });
      }
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'invalid_code') {
          setSubmitError('Wrong or expired code. Check your email or request a new one.');
        } else if (err.code === 'rate_limited') {
          setSubmitError(`Too many attempts. Try again after ${err.retryAfter ?? ''}.`);
        } else {
          setSubmitError(err.code);
        }
        return;
      }
      setSubmitError('Could not verify. Check your connection and try again.');
      toast.error('Network error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Enter your code"
      description={
        <>
          We sent an 8-digit code to <span className="font-medium text-foreground">{email}</span>.
          It&apos;s valid for 15 minutes.
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
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
              void navigate('/login/email');
            }}
          >
            Back
          </Button>
          <Button type="submit" className="flex-1" disabled={submitting || otp.length !== 8}>
            {submitting ? 'Verifying…' : 'Verify code'}
          </Button>
        </div>
      </form>
    </AuthShell>
  );
}
