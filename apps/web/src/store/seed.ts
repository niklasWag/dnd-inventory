import { loadPhbSeed, PHB_SEED_VERSION } from '@app/seeds';

import { useStore } from '@/store';

/**
 * Bootstrap-time catalog seed (MVP §9).
 *
 * Strategy:
 *   - If there's no AppState yet (fresh user, pre-character) → no-op.
 *     `createCharacter` lands `seedVersion: 0`, and the next call to this
 *     function (right after the create-character dispatch) does the seeding.
 *   - If the persisted `seedVersion` is behind the bundle's
 *     `PHB_SEED_VERSION` → dispatch `seed-catalog` to upsert PHB rows.
 *     Homebrew is left untouched (the reducer upserts by id, and PHB ids
 *     have a `phb-2024:` prefix).
 *   - Else → no-op.
 *
 * This is the single place the UI imports `@app/seeds` from. The reducer
 * stays pure (no Vite JSON imports) and `loadPhbSeed()` is called
 * synchronously here since Vite inlines the JSON at build time.
 */
export function seedCatalogIfNeeded(): void {
  const { appState, dispatch } = useStore.getState();
  if (appState === null) return;
  if (appState.seedVersion >= PHB_SEED_VERSION) return;

  dispatch({
    type: 'seed-catalog',
    payload: {
      seedVersion: PHB_SEED_VERSION,
      entries: loadPhbSeed(),
    },
  });
}
