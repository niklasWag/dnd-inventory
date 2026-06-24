import { useState, type ReactElement } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { saveAppState } from '@/db/save';
import { wipeAll } from '@/db/wipe';
import { flushPendingPersist, useStore } from '@/store';
import type { ImportMeta, ImportResult } from '@/io/import';

interface ReplaceAllConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The parsed result returned by `importFromText`. */
  result: ImportResult | null;
  /** Fired after a successful import so the parent can navigate / refresh. */
  onImported?: () => void;
}

/**
 * M7 replace-all confirm dialog (per `docs/SECURITY.md` §7 + OUTLINE
 * §3.13). Shows a summary of the imported file (character name, item
 * count, log size) so the user knows what they're about to overwrite,
 * then on confirm:
 *
 *   1. `flushPendingPersist()` — ensure any in-flight debounced write
 *      to the current state lands first (irrelevant in the wipe path
 *      below, but cheap insurance).
 *   2. `wipeAll()` — clear Dexie. Without this the saver's next debounce
 *      could race the import.
 *   3. `saveAppState({ appState, log })` — persist the imported blob
 *      synchronously. Future hydrate-on-reload sees this directly.
 *   4. `useStore.hydrate({ appState, log })` — update in-memory state so
 *      the rest of the app re-renders against the imported snapshot
 *      immediately, without waiting for a page reload.
 *   5. Toast + close + invoke `onImported`.
 *
 * If the result is a failure or `null`, the dialog renders nothing
 * (parent should not open it in those states, but defensive).
 */
export function ReplaceAllConfirmDialog({
  open,
  onOpenChange,
  result,
  onImported,
}: ReplaceAllConfirmDialogProps): ReactElement | null {
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (result === null || !result.ok) {
    return null;
  }

  async function applyImport(): Promise<void> {
    if (result === null || !result.ok) return;
    setBusy(true);
    setSubmitError(null);
    try {
      await flushPendingPersist();
      await wipeAll();
      await saveAppState({ appState: result.snapshot.appState, log: result.snapshot.log });
      useStore.getState().hydrate({
        appState: result.snapshot.appState,
        log: result.snapshot.log,
      });
      toast.success('Backup restored');
      onOpenChange(false);
      onImported?.();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Replace all current data?</AlertDialogTitle>
          <AlertDialogDescription>
            This will erase everything you have stored locally and restore the
            imported backup. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ImportSummary meta={result.meta} />

        {submitError !== null ? (
          <p className="text-sm text-destructive" role="alert">
            {submitError}
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void applyImport();
            }}
            disabled={busy}
          >
            {busy ? 'Restoring…' : 'Replace'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ImportSummary({ meta }: { meta: ImportMeta }): ReactElement {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-muted-foreground">Character</dt>
      <dd>{meta.characterName ?? '(none — empty backup)'}</dd>
      <dt className="text-muted-foreground">Items</dt>
      <dd>{meta.itemRowCount}</dd>
      <dt className="text-muted-foreground">Log entries</dt>
      <dd>{meta.logEntryCount}</dd>
      <dt className="text-muted-foreground">Exported</dt>
      <dd>{meta.exportedAt}</dd>
      <dt className="text-muted-foreground">App version</dt>
      <dd>{meta.appVersion}</dd>
    </dl>
  );
}
