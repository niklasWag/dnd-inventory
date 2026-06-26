/**
 * R3.4.b — snapshot retention sweeper.
 *
 * Deletes snapshot files (and their `.sha256` sidecars) whose `mtime`
 * is older than `retentionDays * 24 * 60 * 60 * 1000` ms. Walks one
 * level deep under `SNAPSHOT_DIR`, matching the writer's
 * `<dir>/<partyId>/<ISO>.json` layout.
 *
 * Empty party directories are NOT removed (no `rmdir` calls); they
 * stick around as 0-byte breadcrumbs that the next writer pass will
 * fill back in. Simpler + matches what `mkdir -p` already handles.
 *
 * Soft fail: a single missing/unreadable file doesn't abort the sweep.
 * Each error is collected into `errors[]` for the scheduler to log.
 */
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export interface RetentionSweepResult {
  deleted: string[];
  errors: { path: string; error: string }[];
}

export async function sweepSnapshots(opts: {
  snapshotDir: string;
  retentionDays: number;
  now: Date;
}): Promise<RetentionSweepResult> {
  const cutoffMs = opts.now.getTime() - opts.retentionDays * 24 * 60 * 60 * 1000;
  const result: RetentionSweepResult = { deleted: [], errors: [] };

  let partyDirs: string[];
  try {
    partyDirs = await readdir(opts.snapshotDir);
  } catch (e) {
    // Missing snapshot dir is fine — nothing to sweep. Don't try to
    // mkdir it here; the writer does that on its first run.
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return result;
    throw e;
  }

  for (const partyDir of partyDirs) {
    const fullDir = join(opts.snapshotDir, partyDir);
    let entries: string[];
    try {
      entries = await readdir(fullDir);
    } catch (e) {
      result.errors.push({ path: fullDir, error: (e as Error).message });
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(fullDir, entry);
      try {
        const s = await stat(fullPath);
        if (s.isFile() && s.mtimeMs < cutoffMs) {
          await unlink(fullPath);
          result.deleted.push(fullPath);
        }
      } catch (e) {
        result.errors.push({ path: fullPath, error: (e as Error).message });
      }
    }
  }

  return result;
}
