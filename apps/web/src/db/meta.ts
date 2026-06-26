import { db } from '@/db/schema';

/**
 * R3.5 — Active-party pointer.
 *
 * In server mode the web boots, hydrates the session, and then re-pulls
 * `AppState` for the **last active party**. We persist that pointer in
 * Dexie's `meta` store (NOT `localStorage`; CLAUDE.md forbids it) under
 * the key `currentPartyId`.
 *
 * The pointer is set after a successful bootstrap (`create-character`)
 * or a manual party selection on the Hub. It's cleared on signout.
 *
 * Reading a missing key returns `null` so callers can write
 * `const id = await getCurrentPartyId()` and branch directly.
 */
const CURRENT_PARTY_ID_KEY = 'currentPartyId';

export async function getCurrentPartyId(): Promise<string | null> {
  const row = await db.meta.get(CURRENT_PARTY_ID_KEY);
  // Defensive: only return strings. A corrupted row shape (object, number,
  // null) means we lost the pointer and should treat it as missing.
  if (row !== undefined && typeof row.value === 'string' && row.value.length > 0) {
    return row.value;
  }
  return null;
}

export async function setCurrentPartyId(partyId: string): Promise<void> {
  if (partyId.length === 0) {
    throw new Error('setCurrentPartyId: partyId must be non-empty');
  }
  await db.meta.put({ key: CURRENT_PARTY_ID_KEY, value: partyId });
}

export async function clearCurrentPartyId(): Promise<void> {
  await db.meta.delete(CURRENT_PARTY_ID_KEY);
}
