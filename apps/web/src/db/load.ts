import { db } from '@/db/schema';

const APP_STATE_KEY = 'appState';

function keyFor(partyId?: string | null): string {
  if (partyId === undefined || partyId === null || partyId.length === 0) {
    return APP_STATE_KEY;
  }
  return `${APP_STATE_KEY}:${partyId}`;
}

/**
 * Load the persisted AppState blob. Returns `null` if nothing has been
 * persisted yet (first launch / post-wipe). Typed `unknown` — callers
 * (the store, in M1) parse it with the AppState Zod schema before using it.
 *
 * R4-followup — accepts an optional `partyId` to load a specific party's
 * blob. When omitted, falls back to:
 *   1. The legacy unkeyed slot (`'appState'`) for back-compat with pre-R4
 *      single-party persisters + the existing test suite.
 *   2. If the unkeyed slot is empty, the FIRST keyed party blob found.
 *      Lets tests that bootstrap + immediately `loadAppState()` work
 *      without explicitly knowing the minted partyId.
 */
export async function loadAppState(partyId?: string | null): Promise<unknown> {
  if (partyId !== undefined && partyId !== null && partyId.length > 0) {
    const row = await db.meta.get(keyFor(partyId));
    return row?.value ?? null;
  }
  // No explicit partyId: try legacy slot first.
  const legacy = await db.meta.get(APP_STATE_KEY);
  if (legacy !== undefined) return legacy.value;
  // Fallback: return the first keyed blob. This is what tests call into
  // after a bootstrap-then-loadAppState() pattern; the saver writes to
  // the keyed slot because it knows the partyId from state.party.id.
  const anyKeyed = await db.meta
    .filter((r) => typeof r.key === 'string' && r.key.startsWith(`${APP_STATE_KEY}:`))
    .first();
  return anyKeyed?.value ?? null;
}

/**
 * R4-followup — enumerate every persisted party blob.
 *
 * Returns the party ids stored under `appState:<partyId>` keys, in
 * arbitrary order. Used by the Hub in local mode to render the party
 * list, and by export flows to iterate over every known party.
 */
export async function listKnownPartyIds(): Promise<string[]> {
  const rows = await db.meta
    .filter((r) => typeof r.key === 'string' && r.key.startsWith(`${APP_STATE_KEY}:`))
    .toArray();
  return rows
    .map((r) => r.key.slice(APP_STATE_KEY.length + 1))
    .filter((id) => id.length > 0);
}
