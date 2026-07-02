import { z } from 'zod';

import { appStateSchema } from './appState';
import { transactionLogEntrySchema } from './transactionLog';

/**
 * M7 export envelope (per `docs/SECURITY.md` §7 + `docs/MVP.md` §5.13).
 *
 * The wrapper carries enough metadata to let a future v2 format reject
 * v1 files (or vice versa) with a friendly error instead of a Zod
 * cascade. The actual round-tripped state lives in `payload`, whose
 * shape is intentionally identical to the in-memory persisted blob
 * (`apps/web/src/store/hydrate.ts:persistedBlobSchema`) — that's what
 * makes the round-trip lossless per the MVP DoD.
 *
 * Fields:
 *  - `schemaVersion`: bump when the envelope shape changes
 *    incompatibly. v2 readers reject v1 (and vice versa) at the
 *    envelope parse step, before they ever look at `payload`.
 *  - `exportedAt`: ISO timestamp; informational. Not strict-validated
 *    (legitimate exports could come from clocks of varying accuracy).
 *  - `appVersion`: string from the app's `package.json`. Useful for
 *    diagnosing reports about old exports.
 *  - `seedVersion`: copied from the AppState for at-a-glance
 *    catalog-vintage info in the file (and so future re-seeders can
 *    decide whether to upsert).
 *  - `payload`: the persisted blob shape; `appState` may be `null` for
 *    pre-character-creation exports (the MVP wipe-then-export edge case).
 */
export const exportEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    exportedAt: z.string(),
    appVersion: z.string(),
    seedVersion: z.number().int().nonnegative(),
    payload: z
      .object({
        appState: z.union([appStateSchema, z.null()]),
        log: z.array(transactionLogEntrySchema),
      })
      .strict(),
  })
  .strict();

export type ExportEnvelope = z.infer<typeof exportEnvelopeSchema>;
