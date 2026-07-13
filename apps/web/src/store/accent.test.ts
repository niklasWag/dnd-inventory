import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/schema';
import { wipeAll } from '@/db/wipe';

import { accentPresetFor, classColorFor, DEFAULT_ACCENT_ID } from './accentColors';
import { resolveAccent, useAccentStore } from './accent';

/**
 * R9.0 — accent store tests.
 *
 * Contract:
 *   - default accent id is the brand default (`cyan-teal`), followClass off;
 *   - `setAccent` / `setFollowClass` persist to Dexie meta;
 *   - `hydrate` reads stored values back + tolerates garbage;
 *   - `resolveAccent` picks the right triplet given preference + follow-class +
 *     in-party class context + resolved theme:
 *       · follow off  → user's explicit accent preset;
 *       · follow on, in party with known class → that class's color;
 *       · follow on, in party with homebrew/unknown class → falls back to preset;
 *       · follow on, OUTSIDE a party (activeClass null) → falls back to preset.
 */

async function resetAccent(): Promise<void> {
  await wipeAll();
  useAccentStore.setState({ accentId: DEFAULT_ACCENT_ID, followClass: false, hydrated: false });
}

beforeEach(async () => {
  await resetAccent();
});

describe('useAccentStore', () => {
  it('defaults to the brand accent with follow-class off', () => {
    expect(useAccentStore.getState().accentId).toBe('cyan-teal');
    expect(useAccentStore.getState().followClass).toBe(false);
    expect(useAccentStore.getState().hydrated).toBe(false);
  });

  it('setAccent updates the store and persists to Dexie', async () => {
    useAccentStore.getState().setAccent('amber');
    expect(useAccentStore.getState().accentId).toBe('amber');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const row = await db.meta.get('accent');
    expect(row?.value).toBe('amber');
  });

  it('setFollowClass updates the store and persists to Dexie', async () => {
    useAccentStore.getState().setFollowClass(true);
    expect(useAccentStore.getState().followClass).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const row = await db.meta.get('accentFollowClass');
    expect(row?.value).toBe(true);
  });

  it('hydrate loads previously-persisted values', async () => {
    await db.meta.put({ key: 'accent', value: 'emerald' });
    await db.meta.put({ key: 'accentFollowClass', value: true });
    await useAccentStore.getState().hydrate();
    expect(useAccentStore.getState().accentId).toBe('emerald');
    expect(useAccentStore.getState().followClass).toBe(true);
    expect(useAccentStore.getState().hydrated).toBe(true);
  });

  it('hydrate falls back to defaults on garbage values', async () => {
    await db.meta.put({ key: 'accent', value: 42 });
    await db.meta.put({ key: 'accentFollowClass', value: 'yes' });
    await useAccentStore.getState().hydrate();
    expect(useAccentStore.getState().accentId).toBe(DEFAULT_ACCENT_ID);
    expect(useAccentStore.getState().followClass).toBe(false);
  });
});

describe('resolveAccent', () => {
  it('returns the explicit preset when follow-class is off', () => {
    const preset = accentPresetFor('amber');
    expect(
      resolveAccent({ accentId: 'amber', followClass: false, activeClass: 'Wizard' }, 'light'),
    ).toEqual(preset.light);
    expect(
      resolveAccent({ accentId: 'amber', followClass: false, activeClass: 'Wizard' }, 'dark'),
    ).toEqual(preset.dark);
  });

  it('returns the class color when follow-class is on and inside a party', () => {
    const cleric = classColorFor('Cleric')!;
    expect(
      resolveAccent({ accentId: 'cyan-teal', followClass: true, activeClass: 'Cleric' }, 'light'),
    ).toEqual(cleric.light);
    expect(
      resolveAccent({ accentId: 'cyan-teal', followClass: true, activeClass: 'Cleric' }, 'dark'),
    ).toEqual(cleric.dark);
  });

  it('matches class names case-insensitively', () => {
    const rogue = classColorFor('Rogue')!;
    expect(
      resolveAccent({ accentId: 'cyan-teal', followClass: true, activeClass: 'rogue' }, 'light'),
    ).toEqual(rogue.light);
  });

  it('falls back to the explicit preset for a homebrew/unknown class', () => {
    const preset = accentPresetFor('emerald');
    expect(
      resolveAccent({ accentId: 'emerald', followClass: true, activeClass: 'Artificer' }, 'light'),
    ).toEqual(preset.light);
  });

  it('falls back to the explicit preset outside a party (activeClass null)', () => {
    const preset = accentPresetFor('amber');
    expect(
      resolveAccent({ accentId: 'amber', followClass: true, activeClass: null }, 'dark'),
    ).toEqual(preset.dark);
  });
});
