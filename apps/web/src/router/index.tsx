import { createBrowserRouter, Navigate } from 'react-router-dom';

import { RootLayout } from '@/components/Layout';
import { ProtectedRoute, PublicOnlyRoute } from '@/components/auth/ProtectedRoute';
import { CharacterSheet } from '@/screens/CharacterSheet';
import { CatalogBrowser } from '@/screens/CatalogBrowser';
import { Hub } from '@/screens/Hub';
import { ItemDetail } from '@/screens/ItemDetail';
import { Login } from '@/screens/Login';
import { LoginDisplayName } from '@/screens/LoginDisplayName';
import { LoginEmail } from '@/screens/LoginEmail';
import { LoginEmailVerify } from '@/screens/LoginEmailVerify';
import { PartySettings } from '@/screens/PartySettings';
import { Settings } from '@/screens/Settings';
import { StorageDetail } from '@/screens/StorageDetail';

/**
 * R3.5 — Data router. The hub becomes the universal front door (was
 * `Welcome`), and protected routes are wrapped in `<ProtectedRoute />`.
 *
 *   /                        — redirect to /hub
 *   /login                   — Login (server mode only; local → /hub)
 *   /login/email             — LoginEmail
 *   /login/email/verify      — LoginEmailVerify
 *   /login/display-name      — LoginDisplayName (post-OTP onboarding)
 *   /hub                     — Hub (universal)
 *   /character/:id           — CharacterSheet                (protected)
 *   /catalog                 — CatalogBrowser                (protected)
 *   /item/:itemInstanceId    — ItemDetail                    (protected)
 *   /storage/:stashId        — StorageDetail                 (protected)
 *   /settings                — Settings                      (protected)
 *
 * In LOCAL MODE `<ProtectedRoute />` is a no-op (renders `<Outlet />`
 * unconditionally) and `<PublicOnlyRoute />` redirects to `/hub` — so
 * the Login chrome never surfaces.
 */
export const router = createBrowserRouter([
  {
    path: '/',
    Component: RootLayout,
    children: [
      { index: true, element: <Navigate to="/hub" replace /> },
      { path: 'hub', Component: Hub },
      {
        path: 'login',
        Component: PublicOnlyRoute,
        children: [{ index: true, Component: Login }],
      },
      {
        path: 'login/email',
        Component: PublicOnlyRoute,
        children: [{ index: true, Component: LoginEmail }],
      },
      {
        path: 'login/email/verify',
        Component: PublicOnlyRoute,
        children: [{ index: true, Component: LoginEmailVerify }],
      },
      {
        // Display-name screen is the ONE public-only route allowed for
        // the `needsDisplayName` status. Wrapper is bypassed in that
        // status (see `<PublicOnlyRoute allowNeedsDisplayName />`).
        path: 'login/display-name',
        element: <PublicOnlyRoute allowNeedsDisplayName />,
        children: [{ index: true, Component: LoginDisplayName }],
      },
      {
        Component: ProtectedRoute,
        children: [
          { path: 'character/:id', Component: CharacterSheet },
          { path: 'catalog', Component: CatalogBrowser },
          { path: 'item/:itemInstanceId', Component: ItemDetail },
          { path: 'storage/:stashId', Component: StorageDetail },
          { path: 'settings', Component: Settings },
          { path: 'party/settings', Component: PartySettings },
        ],
      },
      { path: '*', element: <Navigate to="/hub" replace /> },
    ],
  },
]);
