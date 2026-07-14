import { create } from 'zustand';

import { db } from '@/db/schema';

/**
 * R9.11 — Hub layout preference.
 *
 * Which Hub presentation the user prefers: `'hero'` (the default
 * Hero/Continue medallion, HUB_FINALISTS "A") or `'list'` (the
 * List+Detail alternative, "B"). Persisted to the Dexie `meta` table
 * (per CLAUDE.md: no `localStorage`) under `hubLayout`. Kept OUT of the
 * main `useStore` reducer — it's UX chrome, not app state, so party
 * hydrate / wipe cycles must not touch it. Mirrors the theme
 * (`store/theme.ts`) + accent (`store/accent.ts`) + sidebar
 * (`store/sidebar.ts`) store pattern.
 */

export type HubLayout = 'hero' | 'list';

const HUB_LAYOUT_KEY = 'hubLayout';
const DEFAULT_HUB_LAYOUT: HubLayout = 'hero';

interface HubLayoutState {
  layout: HubLayout;
  hydrated: boolean;
  setLayout: (layout: HubLayout) => void;
  hydrate: () => Promise<void>;
}

export const useHubLayoutStore = create<HubLayoutState>((set, get) => ({
  layout: DEFAULT_HUB_LAYOUT,
  hydrated: false,

  setLayout: (layout) => {
    set({ layout });
    void db.meta.put({ key: HUB_LAYOUT_KEY, value: layout });
  },

  hydrate: async () => {
    if (get().hydrated) return;
    const row = await db.meta.get(HUB_LAYOUT_KEY);
    const stored = row?.value;
    set({ layout: stored === 'list' ? 'list' : DEFAULT_HUB_LAYOUT, hydrated: true });
  },
}));
