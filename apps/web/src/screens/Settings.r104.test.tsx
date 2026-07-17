import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { Toaster } from '@/components/ui/sonner';
import { useSession } from '@/store/session';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';
import type * as ApiModule from '@/lib/api';
import type { SessionUser } from '@app/shared';

/**
 * R10.4 — server-mode Settings account features. Kept in its own file
 * (separate from Settings.test.tsx) because it forces server mode via a
 * hoisted `vi.mock('@/lib/serverMode')` + mocks the account api helpers;
 * hoisting those into the local-mode file would flip its mode.
 *
 * Covers: profile-hero stats, display-name edit dialog, device sessions
 * list + revoke, account export download, delete-account confirm + the
 * sole-DM error path.
 */

const {
  updateDisplayName,
  listSessions,
  revokeSession,
  revokeOtherSessions,
  exportAccount,
  deleteAccount,
  listParties,
} = vi.hoisted(() => ({
  updateDisplayName: vi.fn(),
  listSessions: vi.fn(),
  revokeSession: vi.fn(),
  revokeOtherSessions: vi.fn(),
  exportAccount: vi.fn(),
  deleteAccount: vi.fn(),
  listParties: vi.fn(),
}));

vi.mock('@/lib/serverMode', () => ({
  isServerMode: true,
  SERVER_URL: 'http://localhost:3000',
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return {
    ...actual,
    updateDisplayName,
    listSessions,
    revokeSession,
    revokeOtherSessions,
    exportAccount,
    deleteAccount,
    listParties,
    // Avoid real network from LinkedAccounts' getAuthMethods probe.
    getAuthMethods: vi.fn().mockResolvedValue({ discord: false, email: true }),
  };
});

// Import AFTER the mocks so the module picks up `isServerMode: true`.
const { Settings } = await import('./Settings');

const USER: SessionUser = {
  id: 'u1',
  displayName: 'Alice',
  email: 'alice@example.com',
  needsDisplayName: false,
  avatarUrl: null,
  discordId: null,
  createdAt: '2026-01-15T00:00:00.000Z',
};

beforeEach(async () => {
  vi.clearAllMocks();
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
  useSession.setState({ status: 'authenticated', user: { ...USER } });
  listParties.mockResolvedValue({ parties: [{ id: 'p1' }, { id: 'p2' }] });
  listSessions.mockResolvedValue({
    sessions: [
      {
        id: 's-current',
        createdAt: '2026-07-01T00:00:00.000Z',
        expires: '2026-08-01T00:00:00.000Z',
        current: true,
      },
      {
        id: 's-other',
        createdAt: '2026-06-01T00:00:00.000Z',
        expires: '2026-07-01T00:00:00.000Z',
        current: false,
      },
    ],
  });
});

function renderSettings(): void {
  const router = createMemoryRouter(
    [
      { path: '/', element: null },
      { path: '/settings', Component: Settings },
      { path: '/login', element: <div>login</div> },
      { path: '/party/:partyId/settings', element: <div>party settings</div> },
    ],
    { initialEntries: ['/settings'] },
  );
  render(
    <>
      <RouterProvider router={router} />
      <Toaster />
    </>,
  );
}

describe('Settings R10.4 — profile hero stats', () => {
  it('renders member-since and party count', async () => {
    renderSettings();
    expect(await screen.findByText(/2 parties/i)).toBeInTheDocument();
    expect(screen.getByText(/Member since/i)).toBeInTheDocument();
  });
});

describe('Settings R10.4 — display name edit', () => {
  it('opens the dialog, saves, and patches the session', async () => {
    const user = userEvent.setup();
    updateDisplayName.mockResolvedValue({ user: { ...USER, displayName: 'Alice II' } });
    const patchSpy = vi.spyOn(useSession.getState(), 'setUserPatch');
    renderSettings();

    // The Account section's Display name row has an Edit button.
    await user.click(screen.getAllByRole('button', { name: /^edit$/i })[0]!);
    // Dialog opens with the display-name input.
    const input = await screen.findByRole('textbox');
    await user.clear(input);
    await user.type(input, 'Alice II');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(updateDisplayName).toHaveBeenCalledWith('Alice II'));
    expect(patchSpy).toHaveBeenCalledWith(expect.objectContaining({ displayName: 'Alice II' }));
  });
});

describe('Settings R10.4 — device sessions', () => {
  it('lists sessions, flags the current one, and revokes another', async () => {
    const user = userEvent.setup();
    revokeSession.mockResolvedValue({ revoked: 1 });
    renderSettings();

    // Current device badge + a Revoke button for the other session.
    expect(await screen.findByText(/^Current$/)).toBeInTheDocument();
    const revokeBtn = screen.getByRole('button', { name: /^revoke$/i });
    await user.click(revokeBtn);

    await waitFor(() => expect(revokeSession).toHaveBeenCalledWith('s-other'));
    // The revoked row disappears.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^revoke$/i })).not.toBeInTheDocument(),
    );
  });

  it('signs out other devices', async () => {
    const user = userEvent.setup();
    revokeOtherSessions.mockResolvedValue({ revoked: 1 });
    renderSettings();

    const btn = await screen.findByRole('button', { name: /sign out other devices/i });
    await user.click(btn);
    await waitFor(() => expect(revokeOtherSessions).toHaveBeenCalledTimes(1));
  });
});

describe('Settings R10.4 — account export', () => {
  it('downloads the account export', async () => {
    const user = userEvent.setup();
    exportAccount.mockResolvedValue({ schemaVersion: 1, exportedAt: 'x', parties: [] });
    const createObjectURL = vi.fn(() => 'blob:fake');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    renderSettings();

    await user.click(await screen.findByRole('button', { name: /export my data/i }));
    await waitFor(() => expect(exportAccount).toHaveBeenCalledTimes(1));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });
});

describe('Settings R10.4 — delete account', () => {
  it('confirms and deletes, then redirects to /login', async () => {
    const user = userEvent.setup();
    deleteAccount.mockResolvedValue({ deleted: true });
    renderSettings();

    await user.click(await screen.findByRole('button', { name: /delete account/i }));
    // Confirm dialog.
    expect(await screen.findByText(/delete your account\?/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^delete account$/i }));

    await waitFor(() => expect(deleteAccount).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('login')).toBeInTheDocument();
  });

  it('surfaces sole_dm_must_transfer_first and navigates to the party settings', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('@/lib/api');
    deleteAccount.mockRejectedValue(
      new ApiError({
        code: 'sole_dm_must_transfer_first',
        status: 422,
        message: 'sole dm',
        body: { error: 'sole_dm_must_transfer_first', partyId: 'p1' },
      }),
    );
    renderSettings();

    await user.click(await screen.findByRole('button', { name: /delete account/i }));
    await user.click(screen.getByRole('button', { name: /^delete account$/i }));

    await waitFor(() => expect(deleteAccount).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('party settings')).toBeInTheDocument();
  });
});
