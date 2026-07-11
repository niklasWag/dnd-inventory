import { loadDmgSeed, loadPhbSeed, SEED_VERSION } from '@app/seeds';

import { useStore } from '@/store';

/**
 * Bootstrap-time catalog seed (MVP §9 + R2.1).
 *
 * Strategy:
 *   - The `seed-catalog` action is LOCAL-ONLY: it populates the client's
 *     in-memory `appState.catalog` so the UI has items to show
 *     immediately after `create-character` (before the bootstrap
 *     `/sync/state` round-trip completes). In server mode the sync
 *     queue filters `seed-catalog` out before pushing, so the server's
 *     bootstrap batch stays pure-`create-character` per
 *     `apps/server/src/sync/routes.ts:244`. The canonical catalog still
 *     comes from the server (PHB+DMG rows are written by
 *     `apps/server/src/db/seed-runner.ts` at boot and returned by every
 *     `/sync/state` response).
 *   - If there's no AppState yet (fresh user, pre-character) → no-op.
 *     `createCharacter` lands `seedVersion: 0`, and the next call to this
 *     function (right after the create-character dispatch) does the
 *     seeding.
 *   - If the persisted `seedVersion` is behind the bundle's
 *     `SEED_VERSION` → dispatch `seed-catalog` to upsert the combined
 *     PHB + DMG entry list. Homebrew is left untouched (the reducer
 *     upserts by id, and PHB / DMG ids carry stable prefixes that don't
 *     collide with homebrew ids).
 *   - Else → no-op.
 *
 * This is the single place the UI imports `@app/seeds` from. The reducer
 * stays pure (no Vite JSON imports) and the seed loaders are called
 * synchronously here since Vite inlines the JSON at build time.
 */
export function seedCatalogIfNeeded(): void {
  const { appState, dispatch } = useStore.getState();
  if (appState === null) return;
  if (appState.seedVersion >= SEED_VERSION) return;

  void dispatch({
    type: 'seed-catalog',
    payload: {
      seedVersion: SEED_VERSION,
      entries: [...loadPhbSeed(), ...loadDmgSeed()],
    },
  });
}
