import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { EmailChange } from './EmailChange';
import { Toaster } from '@/components/ui/sonner';
import { useSession } from '@/store/session';
import type * as ApiModule from '@/lib/api';
import type { SessionUser } from '@app/shared';

/**
 * R10.1 — EmailChange 3-step wizard. The screen reads the session store
 * directly and calls the `@/lib/api` change-email helpers, both mocked
 * here so no server is needed. We assert the happy-path step progression
 * (email → current code → new code → commit) drives `setSession` on
 * completion, and that Cancel calls `abortEmailChange`.
 */

const { startEmailChange, verifyCurrentEmailOtp, verifyNewEmailOtp, abortEmailChange } = vi.hoisted(
  () => ({
    startEmailChange: vi.fn(),
    verifyCurrentEmailOtp: vi.fn(),
    verifyNewEmailOtp: vi.fn(),
    abortEmailChange: vi.fn(),
  }),
);

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return {
    ...actual,
    startEmailChange,
    verifyCurrentEmailOtp,
    verifyNewEmailOtp,
    abortEmailChange,
  };
});

const USER: SessionUser = {
  id: 'u1',
  displayName: 'Alice',
  email: 'alice@example.com',
  needsDisplayName: false,
  avatarUrl: null,
  discordId: null,
};

function renderScreen(): void {
  const router = createMemoryRouter(
    [
      { path: '/settings/email/change', Component: EmailChange },
      { path: '/settings', element: <div>settings landing</div> },
    ],
    { initialEntries: ['/settings/email/change'] },
  );
  render(
    <>
      <RouterProvider router={router} />
      <Toaster />
    </>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useSession.setState({ status: 'authenticated', user: USER });
});

describe('EmailChange', () => {
  it('walks all three steps and commits via setSession', async () => {
    const user = userEvent.setup();
    startEmailChange.mockResolvedValue({ status: 'sent', token: 'tok-123' });
    verifyCurrentEmailOtp.mockResolvedValue({ status: 'sent' });
    verifyNewEmailOtp.mockResolvedValue({
      user: { ...USER, email: 'alice-new@example.com' },
    });
    const setSessionSpy = vi.spyOn(useSession.getState(), 'setSession');

    renderScreen();

    // Step 1 — enter new email.
    await user.type(screen.getByLabelText(/new email/i), 'alice-new@example.com');
    await user.click(screen.getByRole('button', { name: /send code/i }));
    await waitFor(() => expect(startEmailChange).toHaveBeenCalledWith('alice-new@example.com'));

    // Step 2 — code sent to the CURRENT address.
    expect(await screen.findByText(/confirm your current email/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/code/i), '11111111');
    await user.click(screen.getByRole('button', { name: /verify code/i }));
    await waitFor(() => expect(verifyCurrentEmailOtp).toHaveBeenCalledWith('tok-123', '11111111'));

    // Step 3 — code sent to the NEW address; confirm commits.
    expect(await screen.findByText(/confirm your new email/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/code/i), '22222222');
    await user.click(screen.getByRole('button', { name: /confirm change/i }));
    await waitFor(() => expect(verifyNewEmailOtp).toHaveBeenCalledWith('tok-123', '22222222'));

    expect(setSessionSpy).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'alice-new@example.com' }),
    );
    expect(await screen.findByText('settings landing')).toBeInTheDocument();
  });

  it('Cancel after start calls abortEmailChange with the pending token', async () => {
    const user = userEvent.setup();
    startEmailChange.mockResolvedValue({ status: 'sent', token: 'tok-abc' });
    abortEmailChange.mockResolvedValue({ status: 'aborted' });

    renderScreen();

    await user.type(screen.getByLabelText(/new email/i), 'alice-new@example.com');
    await user.click(screen.getByRole('button', { name: /send code/i }));
    expect(await screen.findByText(/confirm your current email/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(abortEmailChange).toHaveBeenCalledWith('tok-abc'));
    expect(await screen.findByText('settings landing')).toBeInTheDocument();
  });

  it('shows the no-email fallback for a Discord-only account', () => {
    useSession.setState({
      status: 'authenticated',
      user: { ...USER, email: null, discordId: 'snow-1' },
    });
    renderScreen();
    expect(screen.getByText(/no email address to change/i)).toBeInTheDocument();
  });
});
