import { create } from 'zustand';

import { db } from '@/db/schema';

/**
 * R7.1.a — Theme system.
 *
 * User preference is one of `'light' | 'dark' | 'system'` and lives in the
 * Dexie `meta` table (per CLAUDE.md: no `localStorage`). `'system'`
 * follows the OS-level `prefers-color-scheme` media query in real time.
 *
 * The resolved theme (`'light' | 'dark'`) drives:
 *   - the class on `<html>` (so Tailwind's `.dark` variants activate);
 *   - the Sonner toaster theme (`components/ui/sonner.tsx`).
 *
 * Kept OUT of the main `useStore` reducer because it's UX chrome, not
 * app state — party hydrate / wipe cycles must not touch it.
 */

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const THEME_KEY = 'theme';
const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

interface ThemeState {
  preference: ThemePreference;
  systemTheme: ResolvedTheme;
  hydrated: boolean;
  setPreference: (preference: ThemePreference) => void;
  hydrate: () => Promise<void>;
}

function readSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'dark';
  }
  return window.matchMedia(DARK_MEDIA_QUERY).matches ? 'dark' : 'light';
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  preference: 'system',
  systemTheme: readSystemTheme(),
  hydrated: false,

  setPreference: (preference) => {
    set({ preference });
    void db.meta.put({ key: THEME_KEY, value: preference });
  },

  hydrate: async () => {
    if (get().hydrated) return;
    const row = await db.meta.get(THEME_KEY);
    const stored = row?.value;
    const preference: ThemePreference = isThemePreference(stored) ? stored : 'system';
    set({ preference, systemTheme: readSystemTheme(), hydrated: true });
  },
}));

/**
 * Resolve `'system'` down to `'light' | 'dark'` using the current
 * `systemTheme` snapshot. Pure — safe to call in a subscription
 * side-effect.
 */
export function resolveTheme(state: Pick<ThemeState, 'preference' | 'systemTheme'>): ResolvedTheme {
  if (state.preference === 'system') return state.systemTheme;
  return state.preference;
}

/**
 * Wire the browser-side side-effects: reflect the resolved theme onto
 * `<html>`, and subscribe to `prefers-color-scheme` changes so `system`
 * mode tracks the OS in real time.
 *
 * Returns a teardown fn (unused in production — the app owns the
 * subscription for its whole lifetime — but useful in tests).
 */
export function attachThemeSideEffects(): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const applyClass = (state: ThemeState): void => {
    const resolved = resolveTheme(state);
    const root = document.documentElement;
    if (resolved === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.add('light');
      root.classList.remove('dark');
    }
  };

  applyClass(useThemeStore.getState());
  const unsubscribeStore = useThemeStore.subscribe((state) => {
    applyClass(state);
  });

  const mql = typeof window.matchMedia === 'function' ? window.matchMedia(DARK_MEDIA_QUERY) : null;
  const onMediaChange = (event: MediaQueryListEvent): void => {
    useThemeStore.setState({ systemTheme: event.matches ? 'dark' : 'light' });
  };
  mql?.addEventListener('change', onMediaChange);

  return () => {
    unsubscribeStore();
    mql?.removeEventListener('change', onMediaChange);
  };
}
