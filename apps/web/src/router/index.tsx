import { createBrowserRouter, Navigate } from 'react-router-dom';

import { RootLayout } from '@/components/Layout';
import { PartyScopeGuard } from '@/components/PartyScopeGuard';
import { PartyScopeSync } from '@/components/PartyScopeSync';
import { ProtectedRoute, PublicOnlyRoute } from '@/components/auth/ProtectedRoute';
import { CharacterSheet } from '@/screens/CharacterSheet';
import { CatalogBrowser } from '@/screens/CatalogBrowser';
import { DmDashboard, DmOnlyRoute } from '@/screens/DmDashboard';
import { EmailChange } from '@/screens/EmailChange';
import { HistoryScreen } from '@/screens/HistoryScreen';
import { HoardGenerator } from '@/screens/HoardGenerator';
import { Hub } from '@/screens/Hub';
import { IdentificationPanel } from '@/screens/IdentificationPanel';
import { ItemDetail } from '@/screens/ItemDetail';
import { LootDistributionWizard } from '@/screens/LootDistributionWizard';
import { Login } from '@/screens/Login';
import { LoginDisplayName } from '@/screens/LoginDisplayName';
import { LoginEmail } from '@/screens/LoginEmail';
import { LoginEmailVerify } from '@/screens/LoginEmailVerify';
import { PartySettings } from '@/screens/PartySettings';
import { PartyStash, RecoveredLoot } from '@/screens/SharedPools';
import { Settings } from '@/screens/Settings';
import { ShopDetail } from '@/screens/ShopDetail';
import { ShopsList } from '@/screens/ShopsList';
import { StorageDetail } from '@/screens/StorageDetail';
import { StorageOverview } from '@/screens/StorageOverview';

/**
 * RH4.1 — URL-scoped router. Every party-scoped surface now takes
 * `:partyId` in its route pattern (`/party/:partyId/*`). The auth
 * routes (`/login`, `/login/*`), the party-picker (`/hub`), and the
 * app-wide settings (`/settings`) stay unscoped.
 *
 *   /                              → redirect to /hub
 *   /login                         — Login (server mode only; local → /hub)
 *   /login/email                   — LoginEmail
 *   /login/email/verify            — LoginEmailVerify
 *   /login/display-name            — LoginDisplayName (post-OTP onboarding)
 *   /hub                           — Hub (party picker, unscoped)
 *   /settings                      — Settings (app-wide, unscoped)
 *   /party/:partyId/settings       — PartySettings                (protected)
 *   /party/:partyId/character/:id  — CharacterSheet                (protected)
 *   /party/:partyId/character/:id/stashes — StorageOverview        (protected)
 *   /party/:partyId/party-stash    — PartyStash                    (protected)
 *   /party/:partyId/recovered-loot — RecoveredLoot                 (protected)
 *   /party/:partyId/catalog        — CatalogBrowser                (protected)
 *   /party/:partyId/item/:itemInstanceId — ItemDetail             (protected)
 *   /party/:partyId/stash/:stashId — StorageDetail                (protected)
 *   /party/:partyId/dm             — DmDashboard                  (DM-only or solo)
 *
 * The `PartyScopeSync` wrapper reconciles URL `:partyId` against the
 * store's `appState.party.id` on every mount / navigation. Mismatch
 * triggers a re-hydrate (server: `pullState`; local: `loadAppState`)
 * before the child screen renders — URL is authoritative for `partyId`.
 *
 * In LOCAL MODE `<ProtectedRoute />` is a no-op (renders `<Outlet />`
 * unconditionally) and `<PublicOnlyRoute />` redirects to `/hub` — so
 * the Login chrome never surfaces.
 *
 * **RH4.3 note.** The `PartyScopeGuard` (cross-party access denial)
 * lands as a sibling wrapper AROUND `PartyScopeSync` in RH4.3 — the
 * membership check short-circuits before the sync guard bothers
 * hydrating. RH4.1 ships only `PartyScopeSync`.
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
          // App-wide settings (backup/restore, sign-out) — party-agnostic.
          { path: 'settings', Component: Settings },
          // R10.1 — dual-OTP email change. Authenticated + unscoped; the
          // screen renders its own AuthShell (no sidebar) and blocks the app
          // until the flow completes or the user cancels.
          { path: 'settings/email/change', Component: EmailChange },
          // Party-scoped subtree. Composition:
          //   PartyScopeSync — URL-vs-state reconciliation (RH4.1).
          //   PartyScopeGuard — cross-party access denial (RH4.3).
          // Guard runs INSIDE PartyScopeSync so it judges membership
          // against the reconciled state; before reconciliation it's
          // a no-op (trusts sync to succeed or fail cleanly).
          {
            path: 'party/:partyId',
            Component: PartyScopeSync,
            children: [
              {
                Component: PartyScopeGuard,
                children: [
                  { path: 'settings', Component: PartySettings },
                  { path: 'character/:id', Component: CharacterSheet },
                  // R9.5 — per-character Stashes (Storage overview) + the
                  // party-wide Party Stash / Recovered Loot are their own
                  // sidebar destinations (the old 4-tab Character Sheet is
                  // gone). These shipped in R9.5, replacing the R9.3
                  // `StashPlaceholder`.
                  {
                    path: 'character/:id/stashes',
                    Component: StorageOverview,
                  },
                  { path: 'party-stash', Component: PartyStash },
                  { path: 'recovered-loot', Component: RecoveredLoot },
                  { path: 'catalog', Component: CatalogBrowser },
                  { path: 'history', Component: HistoryScreen },
                  { path: 'item/:itemInstanceId', Component: ItemDetail },
                  { path: 'stash/:stashId', Component: StorageDetail },
                  // R6.2 — Shop routes. Detail is open to players when
                  // `shop.isOpen === true` (component-level redirect
                  // handles closed shops for non-DM viewers). List is
                  // visible to every party member; `ShopsList` filters
                  // to open shops and hides DM affordances for players.
                  { path: 'shops/:shopId', Component: ShopDetail },
                  { path: 'shops', Component: ShopsList },
                  {
                    Component: DmOnlyRoute,
                    children: [
                      { path: 'dm', Component: DmDashboard },
                      // R6.3 — Hoard generator + Loot distribution wizard.
                      // Both DM-only; wizard is reachable both via the
                      // generator's Continue button (with roll in route
                      // state) and directly (empty wizard).
                      { path: 'loot/generate', Component: HoardGenerator },
                      { path: 'loot/distribute', Component: LootDistributionWizard },
                      // R6.4 — Identification panel. DM-only.
                      { path: 'identify', Component: IdentificationPanel },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      { path: '*', element: <Navigate to="/hub" replace /> },
    ],
  },
]);
