import { exportEnvelopeSchema } from '@app/shared';

import type { ExportSnapshot } from './export';

/**
 * M7 import. Parses a JSON string against the v1 export envelope and
 * returns either the inner persisted-blob `snapshot` (ready to feed
 * into `wipeAll()` → `saveAppState()` → `hydrate()`) or a friendly
 * error message.
 *
 * Per `docs/SECURITY.md` §7:
 *  - Full Zod parse before any write — no partial import.
 *  - User confirms in the UI before the caller actually applies the
 *    snapshot (this module is the parse-only half; the apply step
 *    lives in Settings).
 *  - JSON has no code-execution paths (Zod `.strict()` + flat data
 *    precludes prototype injection).
 *
 * Returns a discriminated `Result` so callers don't have to wrap
 * everything in try/catch — the only thrown errors are bugs.
 */
export type ImportResult =
  | { ok: true; snapshot: ExportSnapshot; meta: ImportMeta }
  | { ok: false; error: string };

export interface ImportMeta {
  schemaVersion: number;
  exportedAt: string;
  appVersion: string;
  seedVersion: number;
  characterName: string | null;
  itemRowCount: number;
  logEntryCount: number;
}

export function importFromText(text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'File is not valid JSON.' };
  }

  const parsed = exportEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    // The Zod error is verbose; surface a friendly first-line summary.
    // Power users can still get the full report by inspecting the file
    // — we don't need to render the full tree in the UI.
    const firstIssue = parsed.error.issues[0];
    const detail =
      firstIssue !== undefined ? `${firstIssue.path.join('.')}: ${firstIssue.message}` : 'unknown';
    return { ok: false, error: `File is not a valid D&D Inventory export (${detail}).` };
  }

  // schemaVersion is `z.literal(1)` so any other version was already
  // rejected at the schema parse above. When v2 lands the envelope
  // schema will widen to `z.union([z.literal(1), z.literal(2)])` and
  // the dispatch on `schemaVersion` happens here.

  const env = parsed.data;
  const firstCharacter = env.payload.appState?.characters[0];
  const meta: ImportMeta = {
    schemaVersion: env.schemaVersion,
    exportedAt: env.exportedAt,
    appVersion: env.appVersion,
    seedVersion: env.seedVersion,
    characterName: firstCharacter?.name ?? null,
    itemRowCount: env.payload.appState?.items.length ?? 0,
    logEntryCount: env.payload.log.length,
  };

  return {
    ok: true,
    snapshot: { appState: env.payload.appState, log: env.payload.log },
    meta,
  };
}
