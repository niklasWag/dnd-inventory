import { createBrowserRouter, Navigate } from 'react-router-dom';

import { RootLayout } from '@/components/Layout';
import { Welcome } from '@/screens/Welcome';
import { CreateCharacter } from '@/screens/CreateCharacter';
import { CharacterSheet } from '@/screens/CharacterSheet';
import { CatalogBrowser } from '@/screens/CatalogBrowser';
import { ItemDetail } from '@/screens/ItemDetail';
import { Settings } from '@/screens/Settings';

/**
 * Data router (TECH_STACK §2.6). Routes mirror the MVP screen list (§7):
 *   /                    — Welcome (or redirect to the existing character)
 *   /create-character    — CreateCharacterForm
 *   /character/:id       — CharacterSheet with tab subroutes
 *   /catalog             — CatalogBrowser (M2)
 *   /item/:itemInstanceId — ItemDetail (M2.5)
 *   /settings            — Settings
 *
 * Future MVP screens nest under existing routes:
 *   /storage/:stashId    — StorageDetail (M3)
 */
export const router = createBrowserRouter([
  {
    path: '/',
    Component: RootLayout,
    children: [
      { index: true, Component: Welcome },
      { path: 'create-character', Component: CreateCharacter },
      { path: 'character/:id', Component: CharacterSheet },
      { path: 'catalog', Component: CatalogBrowser },
      { path: 'item/:itemInstanceId', Component: ItemDetail },
      { path: 'settings', Component: Settings },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
