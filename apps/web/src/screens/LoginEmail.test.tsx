import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { LoginEmail } from './LoginEmail';
import type * as ApiModule from '@/lib/api';

/**
 * R3.5 — email OTP login step 1. Regression: pressing Enter in the email
 * field must submit (the "Send code" button was unpressable via Enter).
 */

const { requestEmailOtp } = vi.hoisted(() => ({ requestEmailOtp: vi.fn() }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, requestEmailOtp };
});

beforeEach(() => {
  vi.clearAllMocks();
});

function renderScreen(): void {
  const router = createMemoryRouter(
    [
      { path: '/login/email', Component: LoginEmail },
      { path: '/login/email/verify', element: <div>verify step</div> },
      { path: '/login', element: <div>login landing</div> },
    ],
    { initialEntries: ['/login/email'] },
  );
  render(<RouterProvider router={router} />);
}

describe('LoginEmail', () => {
  it('submits on Enter in the email field', async () => {
    const user = userEvent.setup();
    requestEmailOtp.mockResolvedValue({ status: 'sent' });
    renderScreen();

    await user.type(screen.getByLabelText(/email/i), 'alice@example.com{Enter}');

    await waitFor(() => expect(requestEmailOtp).toHaveBeenCalledWith('alice@example.com'));
    expect(await screen.findByText('verify step')).toBeInTheDocument();
  });

  it('still submits via the Send code button click', async () => {
    const user = userEvent.setup();
    requestEmailOtp.mockResolvedValue({ status: 'sent' });
    renderScreen();

    await user.type(screen.getByLabelText(/email/i), 'bob@example.com');
    await user.click(screen.getByRole('button', { name: /send code/i }));

    await waitFor(() => expect(requestEmailOtp).toHaveBeenCalledWith('bob@example.com'));
  });
});
