import { appStateSchema, transactionLogEntrySchema } from '@app/shared';
import { toast } from 'sonner';
import { z } from 'zod';

import { loadAppState } from '@/db/load';
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
 * RH5.2 — single-path boot hydration.
 *
 * Boot flow:
 *   1. Read `meta.currentPartyId`. If null → store stays empty; Hub
 *      renders the "Create your first party" CTA.
 *   2. Load `appState:<currentPartyId>`. If missing (pointer stale
 *      because the blob was wiped) → store stays empty; land on `/hub`.
 *   3. Zod-parse the blob. On success, hydrate. On failure (corruption,
 *      strict-schema mismatch post-RH0.1), log to console + surface a
 *      user-visible toast pointing to Settings' "Wipe corrupted party
 *      data" button. Store stays empty; the user is not silently
 *      loaded into a wrong-party state or a half-parsed blob.
 *
 * Only runs in local mode (`main.tsx` skips this in server mode — the
 * URL is authoritative there, and per-route hydration goes through
 * `PartyScopeSync`).
 *
 * Called once from `main.tsx` BEFORE the first render so route guards
 * see the loaded state.
 */
export async function hydrateFromDexie(): Promise<void> {
  const partyId = await getCurrentPartyId();
  if (partyId === null) return; // Hub CTA renders on empty boot.

  const raw = await loadAppState(partyId);
  if (raw === null) return; // Pointer stale — leave empty, land on /hub.

  const parsed = persistedBlobSchema.safeParse(raw);
  if (!parsed.success) {
    console.error('hydrate: persisted blob failed schema validation', {
      partyId,
      error: parsed.error,
    });
    toast.error('Local data for this party is corrupted. Open Settings to wipe.');
    return;
  }

  useStore.getState().hydrate({
    appState: parsed.data.appState,
    log: parsed.data.log,
  });
}
