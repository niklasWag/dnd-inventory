import { create } from 'zustand';

import { db } from '@/db/schema';

/**
 * R9.2 — Sidebar collapse preference.
 *
 * Whether the desktop nav sidebar is collapsed to an icon-only rail.
 * Persisted to the Dexie `meta` table (per CLAUDE.md: no `localStorage`)
 * under `sidebarCollapsed`. Kept OUT of the main `useStore` reducer —
 * it's UX chrome, not app state, so party hydrate / wipe cycles must not
 * touch it. Mirrors the theme (`store/theme.ts`) + accent
 * (`store/accent.ts`) store pattern.
 */

const SIDEBAR_COLLAPSED_KEY = 'sidebarCollapsed';

interface SidebarState {
  collapsed: boolean;
  hydrated: boolean;
  setCollapsed: (collapsed: boolean) => void;
  toggle: () => void;
  hydrate: () => Promise<void>;
}

export const useSidebarStore = create<SidebarState>((set, get) => ({
  collapsed: false,
  hydrated: false,

  setCollapsed: (collapsed) => {
    set({ collapsed });
    void db.meta.put({ key: SIDEBAR_COLLAPSED_KEY, value: collapsed });
  },

  toggle: () => {
    const next = !get().collapsed;
    set({ collapsed: next });
    void db.meta.put({ key: SIDEBAR_COLLAPSED_KEY, value: next });
  },

  hydrate: async () => {
    if (get().hydrated) return;
    const row = await db.meta.get(SIDEBAR_COLLAPSED_KEY);
    const stored = row?.value;
    set({ collapsed: stored === true, hydrated: true });
  },
}));
