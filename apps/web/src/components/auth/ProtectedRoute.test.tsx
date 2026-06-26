import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TEST_SERVER_ORIGIN } from '../../test/msw';
import type {
  ProtectedRoute as ProtectedRouteType,
  PublicOnlyRoute as PublicOnlyRouteType,
} from './ProtectedRoute';
import type { useSession as useSessionType } from '@/store/session';

/**
 * `ProtectedRoute` reads `isServerMode` once at module load via the
 * `@/lib/serverMode` singleton. Tests dynamically re-import after
 * stubbing `VITE_SERVER_URL` so both modes get a real exercise.
 */

async function loadProtected(serverMode: boolean): Promise<{
  ProtectedRoute: typeof ProtectedRouteType;
  PublicOnlyRoute: typeof PublicOnlyRouteType;
  useSession: typeof useSessionType;
}> {
  vi.stubEnv('VITE_SERVER_URL', serverMode ? TEST_SERVER_ORIGIN : '');
  vi.resetModules();
  const mod = await import('./ProtectedRoute.js');
  const session = await import('@/store/session');
  return {
    ProtectedRoute: mod.ProtectedRoute,
    PublicOnlyRoute: mod.PublicOnlyRoute,
    useSession: session.useSession,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('ProtectedRoute — local mode', () => {
  it('renders the outlet without checking session status', async () => {
    const { ProtectedRoute } = await loadProtected(false);
    render(
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="protected" element={<div>protected content</div>} />
          </Route>
          <Route path="login" element={<div>login</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('protected content')).toBeInTheDocument();
  });
});

describe('ProtectedRoute — server mode', () => {
  beforeEach(() => {
    // Reset session state between tests.
  });

  it('redirects to /login when anonymous', async () => {
    const { ProtectedRoute, useSession } = await loadProtected(true);
    useSession.setState({ status: 'anonymous', user: null });
    render(
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="protected" element={<div>protected content</div>} />
          </Route>
          <Route path="login" element={<div>login screen</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
    expect(screen.getByText('login screen')).toBeInTheDocument();
  });

  it('redirects to /login/display-name on needsDisplayName', async () => {
    const { ProtectedRoute, useSession } = await loadProtected(true);
    useSession.setState({
      status: 'needsDisplayName',
      user: {
        id: 'u1',
        displayName: '',
        email: null,
        avatarUrl: null,
        discordId: null,
        needsDisplayName: true,
      },
    });
    render(
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="protected" element={<div>protected content</div>} />
          </Route>
          <Route path="login/display-name" element={<div>name screen</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('name screen')).toBeInTheDocument();
  });

  it('renders the outlet when authenticated', async () => {
    const { ProtectedRoute, useSession } = await loadProtected(true);
    useSession.setState({
      status: 'authenticated',
      user: {
        id: 'u1',
        displayName: 'Alice',
        email: null,
        avatarUrl: null,
        discordId: null,
        needsDisplayName: false,
      },
    });
    render(
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="protected" element={<div>protected content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('protected content')).toBeInTheDocument();
  });

  it('shows a loading state during initial hydration', async () => {
    const { ProtectedRoute, useSession } = await loadProtected(true);
    useSession.setState({ status: 'loading', user: null });
    render(
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="protected" element={<div>protected content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});

describe('PublicOnlyRoute — local mode', () => {
  it('redirects /login to /hub (no login UI in local mode)', async () => {
    const { PublicOnlyRoute } = await loadProtected(false);
    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="login" element={<PublicOnlyRoute />}>
            <Route index element={<div>login content</div>} />
          </Route>
          <Route path="hub" element={<div>hub</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByText('login content')).not.toBeInTheDocument();
    expect(screen.getByText('hub')).toBeInTheDocument();
  });
});

describe('PublicOnlyRoute — server mode', () => {
  it('lets anonymous users see the login screen', async () => {
    const { PublicOnlyRoute, useSession } = await loadProtected(true);
    useSession.setState({ status: 'anonymous', user: null });
    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="login" element={<PublicOnlyRoute />}>
            <Route index element={<div>login content</div>} />
          </Route>
          <Route path="hub" element={<div>hub</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('login content')).toBeInTheDocument();
  });

  it('redirects authenticated users away from /login', async () => {
    const { PublicOnlyRoute, useSession } = await loadProtected(true);
    useSession.setState({
      status: 'authenticated',
      user: {
        id: 'u1',
        displayName: 'A',
        email: null,
        avatarUrl: null,
        discordId: null,
        needsDisplayName: false,
      },
    });
    render(
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="login" element={<PublicOnlyRoute />}>
            <Route index element={<div>login content</div>} />
          </Route>
          <Route path="hub" element={<div>hub</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('hub')).toBeInTheDocument();
  });
});
