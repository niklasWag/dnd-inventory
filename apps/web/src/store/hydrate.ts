import { appStateSchema, transactionLogEntrySchema } from '@app/shared';
import { z } from 'zod';

import { loadAppState, listKnownPartyIds } from '@/db/load';
import { getCurrentPartyId } from '@/db/meta';
import { useStore } from '@/store';

/**
 * Schema for the persisted blob shape (appState + log). Kept here rather
 * than in `@app/shared` because the wrapping shape is a persistence
 * detail — the canonical AppState already includes its log inline, but
 * the store keeps them as separate top-level fields so the typed log
 * union doesn't have to live inside AppState (avoids a Zod self-reference).
 */
const persistedBlobSchema = z.object({
  appState: z.union([appStateSchema, z.null()]),
  log: z.array(transactionLogEntrySchema),
});

/**
 * Boot-time hydration. Read the persisted blob, validate it against the
 * shared schemas, push it into the store. If the blob is missing or
 * malformed we leave the store at its initial empty state — better to
 * land on Welcome than to crash on stale/broken data.
 *
 * Called once from `main.tsx` BEFORE the first render so route guards
 * (Welcome → CharacterSheet redirect) see the loaded state.
 *
 * R4-followup hydration order:
 *   1. If `currentPartyId` is set in meta, try `appState:<partyId>`.
 *   2. Otherwise (or if that blob is missing/invalid), try the legacy
 *      unkeyed `appState` slot (pre-R4 single-party shape).
 *   3. If neither yields a usable blob, try the FIRST known per-party
 *      blob — gives the Hub a valid landing if the pointer was lost.
 *   4. Failing all of the above, leave the store empty.
 */
export async function hydrateFromDexie(): Promise<void> {
  const currentPartyId = await getCurrentPartyId();

  // 1. Try the active-party pointer.
  if (currentPartyId !== null) {
    const raw = await loadAppState(currentPartyId);
    if (raw !== null && tryHydrate(raw)) return;
  }

  // 2. Legacy unkeyed slot (pre-R4 / fresh-bootstrap-window).
  const legacy = await loadAppState();
  if (legacy !== null && tryHydrate(legacy)) return;

  // 3. Any other persisted party — fallback when the pointer is missing
  //    or stale (e.g. user wiped Dexie partially).
  const knownIds = await listKnownPartyIds();
  for (const id of knownIds) {
    const raw = await loadAppState(id);
    if (raw !== null && tryHydrate(raw)) return;
  }

  // 4. Nothing usable — store stays at its initial empty state.
}

function tryHydrate(raw: unknown): boolean {
  const parsed = persistedBlobSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn('hydrate: persisted blob failed schema validation; skipping.', parsed.error);
    return false;
  }
  useStore.getState().hydrate({
    appState: parsed.data.appState,
    log: parsed.data.log,
  });
  return true;
}
