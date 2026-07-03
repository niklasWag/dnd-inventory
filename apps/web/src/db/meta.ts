import { db } from '@/db/schema';

/**
 * R3.5 / RH4.2 — Active-party pointer (UX hint, NOT source of truth).
 *
 * Persisted in Dexie's `meta` store (NOT `localStorage`; CLAUDE.md
 * forbids it) under the key `currentPartyId`. The pointer's role
 * shrank in RH4.2 to a boot-landing hint: which party should the
 * pre-URL landing show first on cold start?
 *
 * **Where it's used**:
 *   - `apps/web/src/store/hydrate.ts` (local-mode boot) — reads the
 *     pointer to decide which Dexie blob to hydrate from. Server-mode
 *     boot does NOT read this (URL is authoritative — PartyScopeSync
 *     handles per-route hydration).
 *   - `apps/web/src/screens/Hub.tsx` — sets the pointer when the user
 *     enters a party (so the next boot lands on the same party).
 *
 * **Where it is NOT used**:
 *   - The sync queue's flush path (RH4.2 threads partyId explicitly on
 *     enqueue instead — see `apps/web/src/sync/queue.ts`).
 *   - Screen-level partyId reads (use `useCurrentPartyId()` from
 *     `@/lib/useCurrentPartyId` — URL is authoritative).
 *   - The server-mode boot in `main.tsx` (retired in RH4.2; the URL
 *     handles per-route loading via PartyScopeSync).
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
