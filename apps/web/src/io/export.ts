import {
  exportEnvelopeSchema,
  type AppState as SharedAppState,
  type ExportEnvelope,
  type TransactionLogEntry,
} from '@app/shared';

import { APP_VERSION } from '@/lib/version';

/**
 * M7 export. The public surface is intentionally small:
 *
 *   - `buildExportEnvelope(snapshot, opts?)` — pure: wraps the
 *     persisted blob in the v1 envelope shape (see
 *     `exportEnvelopeSchema`). Validates the output against Zod so a
 *     malformed in-memory snapshot can never escape to disk.
 *   - `buildExportFilename(snapshot, opts?)` — pure: slugified
 *     `dnd-inv-<charname>-<YYYY-MM-DD>.json`.
 *   - `serializeExport(envelope)` — `JSON.stringify` with 2-space indent.
 *   - `triggerDownload(filename, text)` — DOM side-effect: creates a
 *     Blob, attaches a hidden `<a download>`, clicks, revokes. Exported
 *     so Settings can call it; tests inject a fake via `exportToFile`.
 *   - `exportToFile(snapshot, opts?)` — composes the above; returns
 *     the filename for caller logging / toasts. Accepts an optional
 *     `download` callback so tests don't need a real DOM.
 *
 * The envelope shape is the v1 contract (see
 * `packages/shared/src/schemas/exportEnvelope.ts`):
 * `{ schemaVersion: 1, exportedAt, appVersion, seedVersion, payload }`.
 * The `payload` is exactly the in-memory persisted blob shape so the
 * round-trip is bit-for-bit lossless (the MVP DoD line in
 * `docs/roadmap.md`).
 */

export interface ExportSnapshot {
  appState: SharedAppState | null;
  log: TransactionLogEntry[];
}

interface BuildOpts {
  /** Override for tests; defaults to `new Date()`. */
  now?: Date;
  /** Override for tests; defaults to the build-time `APP_VERSION`. */
  appVersion?: string;
}

export function buildExportEnvelope(
  snapshot: ExportSnapshot,
  opts: BuildOpts = {},
): ExportEnvelope {
  const envelope: ExportEnvelope = {
    schemaVersion: 1,
    exportedAt: (opts.now ?? new Date()).toISOString(),
    appVersion: opts.appVersion ?? APP_VERSION,
    seedVersion: snapshot.appState?.seedVersion ?? 0,
    payload: { appState: snapshot.appState, log: snapshot.log },
  };
  // Defense in depth: validate before serializing. If the in-memory
  // snapshot is malformed (somehow), surface a Zod error here rather
  // than write garbage to disk.
  return exportEnvelopeSchema.parse(envelope);
}

export function serializeExport(envelope: ExportEnvelope): string {
  return JSON.stringify(envelope, null, 2);
}

/**
 * Slugify a string for use in a filename: lowercase, collapse runs of
 * non-`[a-z0-9]` to a single `-`, trim leading/trailing `-`, cap at 40
 * chars. Empty result falls back to `'character'` so a name like `"???"`
 * still produces a legal filename.
 */
function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug.length > 0 ? slug : 'character';
}

export function buildExportFilename(
  snapshot: ExportSnapshot,
  opts: BuildOpts = {},
): string {
  const date = (opts.now ?? new Date()).toISOString().slice(0, 10);
  const firstCharacter = snapshot.appState?.characters[0];
  const stem =
    firstCharacter !== undefined ? slugify(firstCharacter.name) : 'empty';
  return `dnd-inv-${stem}-${date}.json`;
}

/**
 * Browser-side download trigger. Creates a Blob from `text`, attaches a
 * hidden `<a download>` to the document, clicks it, and revokes the
 * object URL on the next tick. No-op in non-browser environments
 * (the function still runs but does nothing useful — Settings only
 * calls it from a click handler).
 */
export function triggerDownload(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  // Some browsers require the anchor to be in the document for the
  // click to take effect. Removing it immediately after keeps the DOM
  // clean.
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revoke so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

interface ExportToFileOpts extends BuildOpts {
  /** Inject a fake downloader in tests. Defaults to `triggerDownload`. */
  download?: (filename: string, text: string) => void;
}

/**
 * Compose: build envelope → serialize → trigger download. Returns the
 * filename so the caller can show it in a toast. Throws on Zod failure
 * (in-memory snapshot was malformed — caller should surface the error).
 */
export function exportToFile(
  snapshot: ExportSnapshot,
  opts: ExportToFileOpts = {},
): string {
  const envelope = buildExportEnvelope(snapshot, opts);
  const text = serializeExport(envelope);
  const filename = buildExportFilename(snapshot, opts);
  (opts.download ?? triggerDownload)(filename, text);
  return filename;
}
