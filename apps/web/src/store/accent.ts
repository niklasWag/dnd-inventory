import { create } from 'zustand';

import { db } from '@/db/schema';
import { getOwnCharacter } from '@/lib/ownCharacter';
import { useStore } from '@/store';

import {
  accentPresetFor,
  classColorFor,
  DEFAULT_ACCENT_ID,
  type AccentTriplet,
} from './accentColors';
import { resolveTheme, useThemeStore } from './theme';
import type { ResolvedTheme } from './theme';

/**
 * R9.0 — Accent color system (docs/r9-redesign/DESIGN_SYSTEM.md §1 "Accent model").
 *
 * A two-level runtime model, persisted in Dexie `meta` (per CLAUDE.md: no
 * `localStorage`), mirroring the theme store's shape (store/theme.ts):
 *
 *   1. `accentId` — the user's explicit brand accent (default `cyan-teal`).
 *   2. `followClass` — opt-in. When on, the accent follows the CURRENT
 *      character's D&D class WHILE INSIDE a party; outside a party it reverts
 *      to the explicit accent.
 *
 * The resolved accent overwrites the `--primary` / `--accent` / `--ring`
 * (+ their `-foreground`s) CSS vars on `:root`. The base defaults live in
 * index.css so there's a sane accent before this store attaches.
 *
 * Kept OUT of the main `useStore` reducer because it's UX chrome, not app
 * state — party hydrate / wipe cycles must not touch it.
 */

const ACCENT_KEY = 'accent';
const FOLLOW_CLASS_KEY = 'accentFollowClass';

interface AccentState {
  accentId: string;
  followClass: boolean;
  hydrated: boolean;
  setAccent: (accentId: string) => void;
  setFollowClass: (followClass: boolean) => void;
  hydrate: () => Promise<void>;
}

export const useAccentStore = create<AccentState>((set, get) => ({
  accentId: DEFAULT_ACCENT_ID,
  followClass: false,
  hydrated: false,

  setAccent: (accentId) => {
    set({ accentId });
    void db.meta.put({ key: ACCENT_KEY, value: accentId });
  },

  setFollowClass: (followClass) => {
    set({ followClass });
    void db.meta.put({ key: FOLLOW_CLASS_KEY, value: followClass });
  },

  hydrate: async () => {
    if (get().hydrated) return;
    const [accentRow, followRow] = await Promise.all([
      db.meta.get(ACCENT_KEY),
      db.meta.get(FOLLOW_CLASS_KEY),
    ]);
    const accentId = typeof accentRow?.value === 'string' ? accentRow.value : DEFAULT_ACCENT_ID;
    const followClass = followRow?.value === true;
    set({ accentId, followClass, hydrated: true });
  },
}));

/** Inputs to `resolveAccent`, decoupled from the store shape for pure testing. */
export interface AccentContext {
  accentId: string;
  followClass: boolean;
  /** Current character's class while in a party; `null` outside any party. */
  activeClass: string | null;
}

/**
 * Resolve the active accent triplet for the given context + resolved theme.
 *
 * Follow-class wins only when it's ON, we're inside a party (`activeClass`
 * non-null), AND the class maps to a known color. Otherwise the user's
 * explicit accent preset is used (unknown-id-safe via `accentPresetFor`).
 */
export function resolveAccent(ctx: AccentContext, theme: ResolvedTheme): AccentTriplet {
  if (ctx.followClass && ctx.activeClass !== null) {
    const classColor = classColorFor(ctx.activeClass);
    if (classColor !== undefined) {
      return theme === 'dark' ? classColor.dark : classColor.light;
    }
  }
  const preset = accentPresetFor(ctx.accentId);
  return theme === 'dark' ? preset.dark : preset.light;
}

/** Write a resolved triplet onto `:root` as the accent CSS vars. */
export function applyAccentVars(triplet: AccentTriplet): void {
  const root = document.documentElement;
  root.style.setProperty('--primary', triplet.primary);
  root.style.setProperty('--accent', triplet.primary);
  root.style.setProperty('--primary-foreground', triplet.foreground);
  root.style.setProperty('--accent-foreground', triplet.foreground);
  root.style.setProperty('--ring', triplet.ring);
}

/**
 * Wire the browser-side accent side-effect: recompute + apply the accent CSS
 * vars whenever the accent prefs, the resolved theme, or the active party's own
 * character (its class) changes.
 *
 * `activeClass` is the actor's own character's class while inside a party, else
 * `null` (Hub / Settings / auth screens have `appState === null`) — which makes
 * follow-class revert to the explicit accent per the design model.
 *
 * Returns a teardown fn (unused in production — the app owns the subscription
 * for its whole lifetime — but useful in tests).
 */
export function attachAccentSideEffects(): () => void {
  if (typeof document === 'undefined') return () => undefined;

  const apply = (): void => {
    const { accentId, followClass } = useAccentStore.getState();
    const theme = resolveTheme(useThemeStore.getState());
    const appState = useStore.getState().appState;
    const activeClass = appState === null ? null : (getOwnCharacter(appState)?.class ?? null);
    applyAccentVars(resolveAccent({ accentId, followClass, activeClass }, theme));
  };

  apply();
  const unsubAccent = useAccentStore.subscribe(apply);
  const unsubTheme = useThemeStore.subscribe(apply);
  const unsubStore = useStore.subscribe(apply);

  return () => {
    unsubAccent();
    unsubTheme();
    unsubStore();
  };
}
