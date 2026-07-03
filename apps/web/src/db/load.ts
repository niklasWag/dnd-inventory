import { db } from '@/db/schema';

const APP_STATE_KEY = 'appState';

function keyFor(partyId: string): string {
  return `${APP_STATE_KEY}:${partyId}`;
}

/**
 * RH5.2 — single-path loader. Reads the party's blob at
 * `appState:<partyId>` and returns its value, or `null` when nothing is
 * stored for that party. Typed `unknown` — callers (e.g. `hydrate.ts`,
 * `PartyScopeSync`) Zod-parse before use.
 *
 * Pre-RH5.2 this function accepted a nullable partyId and fell back
 * through the legacy unkeyed slot + the "first keyed blob" resolver.
 * Post-RH5.2 there are no fallbacks: the pointer resolves partyId, the
 * loader retrieves that party's blob. A missing blob is `null`; a
 * corrupted blob is surfaced up-stack via the caller's Zod parse.
 */
export async function loadAppState(partyId: string): Promise<unknown> {
  if (partyId.length === 0) {
    throw new Error('loadAppState: partyId must be non-empty');
  }
  const row = await db.meta.get(keyFor(partyId));
  return row?.value ?? null;
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
  return rows.map((r) => r.key.slice(APP_STATE_KEY.length + 1)).filter((id) => id.length > 0);
}
