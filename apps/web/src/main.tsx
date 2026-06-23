import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@/App';
import { hydrateFromDexie } from '@/store/hydrate';
import { seedCatalogIfNeeded } from '@/store/seed';
import '@/index.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found');
}

// Boot: load persisted state first, then seed the catalog if the bundled
// PHB version is ahead of the persisted one, then mount. Awaiting here
// keeps the Welcome → CharacterSheet redirect from flashing on returning
// users.
async function boot(): Promise<void> {
  await hydrateFromDexie();
  seedCatalogIfNeeded();
  createRoot(rootEl!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
