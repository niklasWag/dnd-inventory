/**
 * R3.4.b — snapshot writer.
 *
 * Materializes one party's AppState via `loadAppStateForParty`, wraps
 * it in the `exportEnvelope` shape (`@app/shared`), writes the JSON
 * payload to `${SNAPSHOT_DIR}/${partyId}/${ISO_TIMESTAMP}.json`, and
 * writes a sibling `.sha256` sidecar carrying the file's checksum.
 *
 * SECURITY §8: every snapshot is checksummed at write time and the
 * checksum is verified at restore time. Failure to verify is a hard
 * abort — `cli/restore.ts` refuses to apply a snapshot whose digest
 * doesn't match its sidecar.
 *
 * The writer never throws on a single-party failure; the scheduler
 * iterates parties and collects per-party errors so one broken party's
 * snapshot doesn't block the others.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { exportEnvelopeSchema, type ExportEnvelope } from '@app/shared';

import type { PrismaClient } from '../../prisma/generated/prisma/client.js';
import { loadAppStateForParty } from '../sync/state-loader.js';

/** App-package version stamped into the exportEnvelope. Pulled from
 * `apps/server/package.json` at build time would require a build step;
 * the simpler approach is a runtime constant kept in lockstep with the
 * package version manually. R3.4.b ships '0.0.0' (the package's
 * declared private-version). */
const APP_VERSION = '0.0.0';

export interface SnapshotWriteResult {
  partyId: string;
  jsonPath: string;
  sha256Path: string;
  sha256: string;
  byteSize: number;
}

/**
 * Write a snapshot for the supplied partyId. Returns the file paths +
 * checksum for downstream logging / tests; throws on filesystem errors
 * or on a state-loader failure (the scheduler's caller is expected to
 * catch + log per-party).
 *
 * `nowIso` is injected so the cron scheduler can stamp every party's
 * snapshot with the same triggering timestamp (folder grouping per
 * cron tick). Tests inject deterministic values.
 */
export async function writeSnapshot(opts: {
  prisma: PrismaClient;
  partyId: string;
  snapshotDir: string;
  nowIso: string;
}): Promise<SnapshotWriteResult> {
  const state = await loadAppStateForParty(opts.prisma, opts.partyId);
  if (state === null) {
    // The schema accepts null for pre-character-creation, but a party
    // with no character is structurally impossible (create-character
    // mints the party + character + memberships together). Treat as
    // a hard error so the operator sees it.
    throw new Error(`writeSnapshot: party ${opts.partyId} resolved to null AppState`);
  }

  const envelope: ExportEnvelope = {
    schemaVersion: 1,
    exportedAt: opts.nowIso,
    appVersion: APP_VERSION,
    seedVersion: state.seedVersion,
    payload: {
      appState: state,
      log: state.log,
    },
  };
  // Parse-on-write surfaces any schema drift as an exception before any
  // bytes hit disk.
  exportEnvelopeSchema.parse(envelope);

  const json = JSON.stringify(envelope, null, 2);
  const sha256 = createHash('sha256').update(json, 'utf8').digest('hex');

  const partyDir = join(opts.snapshotDir, opts.partyId);
  await mkdir(partyDir, { recursive: true });

  // Filename: ISO timestamp with colons sanitized to hyphens so the
  // filename is portable across filesystems (Windows in particular
  // forbids `:` in filenames). The full timestamp is preserved in
  // `envelope.exportedAt` regardless.
  const filename = `${opts.nowIso.replace(/:/g, '-')}.json`;
  const jsonPath = join(partyDir, filename);
  const sha256Path = `${jsonPath}.sha256`;

  await writeFile(jsonPath, json, 'utf8');
  // The sha256 sidecar format mirrors the standard `sha256sum` output:
  // `<digest>  <filename>` (two spaces). Easy to verify with the
  // canonical CLI tool: `sha256sum -c <file>.sha256`.
  await writeFile(sha256Path, `${sha256}  ${filename}\n`, 'utf8');

  return {
    partyId: opts.partyId,
    jsonPath,
    sha256Path,
    sha256,
    byteSize: Buffer.byteLength(json, 'utf8'),
  };
}
