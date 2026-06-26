import { beforeEach, describe, expect, it } from 'vitest';

import { wipeAll } from '@/db/wipe';

import { clearCurrentPartyId, getCurrentPartyId, setCurrentPartyId } from './meta';

describe('meta — currentPartyId', () => {
  beforeEach(async () => {
    await wipeAll();
  });

  it('returns null when no pointer is set', async () => {
    expect(await getCurrentPartyId()).toBeNull();
  });

  it('round-trips a partyId', async () => {
    await setCurrentPartyId('party-abc');
    expect(await getCurrentPartyId()).toBe('party-abc');
  });

  it('overwrites a previously set pointer', async () => {
    await setCurrentPartyId('party-1');
    await setCurrentPartyId('party-2');
    expect(await getCurrentPartyId()).toBe('party-2');
  });

  it('clears the pointer', async () => {
    await setCurrentPartyId('party-abc');
    await clearCurrentPartyId();
    expect(await getCurrentPartyId()).toBeNull();
  });

  it('rejects empty partyId', async () => {
    await expect(setCurrentPartyId('')).rejects.toThrow();
  });
});
