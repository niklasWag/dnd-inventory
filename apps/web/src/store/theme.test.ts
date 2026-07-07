import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '@/db/schema';
import { wipeAll } from '@/db/wipe';

import { attachThemeSideEffects, resolveTheme, useThemeStore, type ResolvedTheme } from './theme';

/**
 * R7.1.a — theme store tests.
 *
 * Contract:
 *   - default preference is `'system'`;
 *   - `setPreference` persists to Dexie;
 *   - `hydrate` reads a stored value back;
 *   - `resolveTheme` collapses `'system'` to the current OS scheme;
 *   - `attachThemeSideEffects` toggles the `<html>` class in response
 *     to preference changes AND to `prefers-color-scheme` media flips.
 */

async function resetTheme(): Promise<void> {
  await wipeAll();
  useThemeStore.setState({ preference: 'system', systemTheme: 'light', hydrated: false });
  document.documentElement.classList.remove('dark', 'light');
}

beforeEach(async () => {
  await resetTheme();
});

describe('useThemeStore', () => {
  it('defaults to system preference', () => {
    expect(useThemeStore.getState().preference).toBe('system');
    expect(useThemeStore.getState().hydrated).toBe(false);
  });

  it('setPreference updates the store and persists to Dexie', async () => {
    useThemeStore.getState().setPreference('dark');
    expect(useThemeStore.getState().preference).toBe('dark');
    // Flush the async Dexie put (setPreference fires it without await).
    await new Promise((resolve) => setTimeout(resolve, 0));
    const row = await db.meta.get('theme');
    expect(row?.value).toBe('dark');
  });

  it('hydrate loads a previously-persisted preference', async () => {
    await db.meta.put({ key: 'theme', value: 'light' });
    await useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().preference).toBe('light');
    expect(useThemeStore.getState().hydrated).toBe(true);
  });

  it('hydrate falls back to system when Dexie holds a garbage value', async () => {
    await db.meta.put({ key: 'theme', value: 'purple' });
    await useThemeStore.getState().hydrate();
    expect(useThemeStore.getState().preference).toBe('system');
  });
});

describe('resolveTheme', () => {
  it('returns the preference verbatim when not system', () => {
    expect(resolveTheme({ preference: 'light', systemTheme: 'dark' })).toBe('light');
    expect(resolveTheme({ preference: 'dark', systemTheme: 'light' })).toBe('dark');
  });

  it('falls through to systemTheme when preference is system', () => {
    expect(resolveTheme({ preference: 'system', systemTheme: 'dark' })).toBe('dark');
    expect(resolveTheme({ preference: 'system', systemTheme: 'light' })).toBe('light');
  });
});

describe('attachThemeSideEffects', () => {
  it('applies the resolved theme as an <html> class on attach', () => {
    useThemeStore.setState({ preference: 'dark', systemTheme: 'light' });
    const detach = attachThemeSideEffects();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
    detach();
  });

  it('updates the class when preference changes', () => {
    useThemeStore.setState({ preference: 'light', systemTheme: 'light' });
    const detach = attachThemeSideEffects();
    expect(document.documentElement.classList.contains('light')).toBe(true);

    useThemeStore.getState().setPreference('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
    detach();
  });

  it('follows a matchMedia change event when preference is system', () => {
    // Custom matchMedia stub that lets us fire a `change` event on demand.
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const mqlSpy: MediaQueryList = {
      matches: false,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === 'change' && typeof listener === 'function') {
          listeners.add(listener);
        }
      },
      removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === 'change' && typeof listener === 'function') {
          listeners.delete(listener);
        }
      },
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    };
    const matchMediaSpy = vi.spyOn(window, 'matchMedia').mockReturnValue(mqlSpy);
    useThemeStore.setState({ preference: 'system', systemTheme: 'light' });
    const detach = attachThemeSideEffects();

    // Simulate OS flipping to dark mode.
    const evt = { matches: true, media: mqlSpy.media } as MediaQueryListEvent;
    listeners.forEach((listener) => listener(evt));

    expect(useThemeStore.getState().systemTheme).toBe<ResolvedTheme>('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    detach();
    matchMediaSpy.mockRestore();
  });
});
