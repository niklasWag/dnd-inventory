import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/schema';
import { wipeAll } from '@/db/wipe';

import { useHubLayoutStore } from './hubLayout';

/**
 * R9.11 — hub-layout preference store tests. Mirrors the sidebar/theme/
 * accent store contract: a UX-chrome preference persisted to Dexie `meta`
 * (NOT localStorage), kept out of the main reducer.
 *
 * Contract:
 *   - defaults to `'hero'`, not yet hydrated;
 *   - `setLayout` persists to Dexie meta key `hubLayout`;
 *   - `hydrate` reads the stored value back + tolerates garbage.
 */

async function reset(): Promise<void> {
  await wipeAll();
  useHubLayoutStore.setState({ layout: 'hero', hydrated: false });
}

beforeEach(async () => {
  await reset();
});

describe('useHubLayoutStore', () => {
  it('defaults to hero, not hydrated', () => {
    expect(useHubLayoutStore.getState().layout).toBe('hero');
    expect(useHubLayoutStore.getState().hydrated).toBe(false);
  });

  it('setLayout updates the store and persists to Dexie', async () => {
    useHubLayoutStore.getState().setLayout('list');
    expect(useHubLayoutStore.getState().layout).toBe('list');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const row = await db.meta.get('hubLayout');
    expect(row?.value).toBe('list');
  });

  it('hydrate loads a previously-persisted value', async () => {
    await db.meta.put({ key: 'hubLayout', value: 'list' });
    await useHubLayoutStore.getState().hydrate();
    expect(useHubLayoutStore.getState().layout).toBe('list');
    expect(useHubLayoutStore.getState().hydrated).toBe(true);
  });

  it('hydrate falls back to hero on a garbage value', async () => {
    await db.meta.put({ key: 'hubLayout', value: 'nonsense' });
    await useHubLayoutStore.getState().hydrate();
    expect(useHubLayoutStore.getState().layout).toBe('hero');
    expect(useHubLayoutStore.getState().hydrated).toBe(true);
  });
});
