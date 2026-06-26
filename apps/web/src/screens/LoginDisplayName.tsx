import { useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, setDisplayName as setDisplayNameRequest } from '@/lib/api';
import { useSession } from '@/store/session';

/**
 * R3.5 — Post-OTP onboarding for email-only users. Required because
 * `User.needsDisplayName === true` causes every `/sync/*` endpoint to
 * return 409 until this screen posts to `/auth/email/set-display-name`.
 *
 * Idempotent on the server — calling with the user's existing name
 * is a no-op 200, so a user who somehow lands here after the flag
 * already flipped doesn't see an error.
 */
const schema = z.object({
  displayName: z.string().trim().min(1, 'Display name is required').max(80),
});
type FormValues = z.input<typeof schema>;
type FormOutput = z.output<typeof schema>;

export function LoginDisplayName(): ReactElement {
  const navigate = useNavigate();
  const session = useSession((s) => s);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, FormOutput>({
    resolver: zodResolver(schema),
    defaultValues: { displayName: session.user?.displayName ?? '' },
  });

  async function onSubmit(values: FormOutput): Promise<void> {
    if (session.user === null) {
      setSubmitError('Session expired — sign in again.');
      void navigate('/login', { replace: true });
      return;
    }
    setSubmitError(null);
    try {
      const res = await setDisplayNameRequest(values.displayName);
      session.setUserPatch({ ...res.user, id: res.user.id });
      void navigate('/hub', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'invalid_display_name') {
          setSubmitError('Pick a name between 1 and 80 characters.');
          return;
        }
        if (err.code === 'unauthenticated') {
          void navigate('/login', { replace: true });
          return;
        }
        setSubmitError(err.code);
        return;
      }
      setSubmitError('Could not save. Check your connection and try again.');
      toast.error('Network error');
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6 py-16">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Pick a display name</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This is what other party members will see in the audit log. You can change it later in
          Settings.
        </p>
      </header>

      <form
        onSubmit={(e) => {
          void handleSubmit(onSubmit)(e);
        }}
        className="space-y-4"
        noValidate
      >
        <div className="space-y-1.5">
          <Label htmlFor="displayName">Display name</Label>
          <Input id="displayName" autoFocus maxLength={80} {...register('displayName')} />
          {errors.displayName !== undefined ? (
            <p className="text-sm text-destructive" role="alert">
              {errors.displayName.message}
            </p>
          ) : null}
        </div>

        {submitError !== null ? (
          <p className="text-sm text-destructive" role="alert">
            {submitError}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Continue'}
        </Button>
      </form>
    </div>
  );
}
