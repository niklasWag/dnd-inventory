import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthShell } from '@/components/auth/AuthShell';
import { ApiError, requestEmailOtp } from '@/lib/api';

/**
 * R3.5 — Step 1 of email OTP login. Collects an email, calls
 * `POST /auth/email/request-otp`, then navigates to the verify screen
 * with the email passed via query so the verify screen can populate
 * the OTP submission body.
 *
 * 429 → countdown using the server's `retryAfter` ISO timestamp.
 * 503 → "Email login is not available."
 */
const schema = z.object({
  email: z.string().trim().email('Enter a valid email'),
});
type FormValues = z.input<typeof schema>;
type FormOutput = z.output<typeof schema>;

export function LoginEmail(): ReactElement {
  const navigate = useNavigate();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  });

  async function onSubmit(values: FormOutput): Promise<void> {
    setSubmitError(null);
    try {
      await requestEmailOtp(values.email);
      void navigate(`/login/email/verify?email=${encodeURIComponent(values.email)}`);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'rate_limited') {
          const retry = err.retryAfter ?? '';
          setSubmitError(`Too many attempts. Try again after ${retry}.`);
          return;
        }
        if (err.code === 'email_auth_disabled') {
          setSubmitError('Email login is not available on this server.');
          return;
        }
        setSubmitError(err.code);
        return;
      }
      setSubmitError('Could not send the code. Check your connection and try again.');
      toast.error('Network error');
    }
  }

  return (
    <AuthShell
      title="Sign in with email"
      description="We'll send you a one-time 8-digit code. No password required."
    >
      <form
        onSubmit={(e) => {
          void handleSubmit(onSubmit)(e);
        }}
        className="space-y-4"
        noValidate
      >
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" autoFocus {...register('email')} />
          {errors.email !== undefined ? (
            <p className="text-sm text-destructive" role="alert">
              {errors.email.message}
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
              void navigate('/login');
            }}
          >
            Back
          </Button>
          <Button type="submit" className="flex-1" disabled={isSubmitting}>
            {isSubmitting ? 'Sending…' : 'Send code'}
          </Button>
        </div>
      </form>
    </AuthShell>
  );
}
