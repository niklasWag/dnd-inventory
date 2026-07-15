import { beforeEach, describe, expect, it } from 'vitest';

import { db } from '@/db/schema';
import { wipeAll } from '@/db/wipe';

import { useSidebarStore } from './sidebar';

/**
 * R9.2 — sidebar collapse store tests. Mirrors the theme/accent store
 * contract: a UX-chrome preference persisted to Dexie `meta` (NOT
 * localStorage), kept out of the main reducer.
 *
 * Contract:
 *   - defaults to expanded (collapsed === false), not yet hydrated;
 *   - `setCollapsed` / `toggle` persist to Dexie meta key `sidebarCollapsed`;
 *   - `hydrate` reads the stored boolean back + tolerates garbage.
 */

async function reset(): Promise<void> {
  await wipeAll();
  useSidebarStore.setState({ collapsed: false, hydrated: false });
}

beforeEach(async () => {
  await reset();
});

describe('useSidebarStore', () => {
  it('defaults to expanded, not hydrated', () => {
    expect(useSidebarStore.getState().collapsed).toBe(false);
    expect(useSidebarStore.getState().hydrated).toBe(false);
  });

  it('setCollapsed updates the store and persists to Dexie', async () => {
    useSidebarStore.getState().setCollapsed(true);
    expect(useSidebarStore.getState().collapsed).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const row = await db.meta.get('sidebarCollapsed');
    expect(row?.value).toBe(true);
  });

  it('toggle flips the collapsed flag and persists', async () => {
    useSidebarStore.getState().toggle();
    expect(useSidebarStore.getState().collapsed).toBe(true);
    useSidebarStore.getState().toggle();
    expect(useSidebarStore.getState().collapsed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const row = await db.meta.get('sidebarCollapsed');
    expect(row?.value).toBe(false);
  });

  it('hydrate loads a previously-persisted value', async () => {
    await db.meta.put({ key: 'sidebarCollapsed', value: true });
    await useSidebarStore.getState().hydrate();
    expect(useSidebarStore.getState().collapsed).toBe(true);
    expect(useSidebarStore.getState().hydrated).toBe(true);
  });

  it('hydrate falls back to expanded on a garbage value', async () => {
    await db.meta.put({ key: 'sidebarCollapsed', value: 'yes' });
    await useSidebarStore.getState().hydrate();
    expect(useSidebarStore.getState().collapsed).toBe(false);
    expect(useSidebarStore.getState().hydrated).toBe(true);
  });
});
