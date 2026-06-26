import { useRef, useState, type ChangeEvent, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RenameField } from '@/components/settings/RenameField';
import { EncumbranceRuleField } from '@/components/settings/EncumbranceRuleField';
import { ReplaceAllConfirmDialog } from '@/components/settings/ReplaceAllConfirmDialog';
import { wipeAll } from '@/db/wipe';
import { exportToFile, type ExportSnapshot } from '@/io/export';
import { importFromText, type ImportResult } from '@/io/import';
import { APP_VERSION } from '@/lib/version';
import { useStore } from '@/store';

/**
 * Settings (MVP §7 screen 9 — final M7 cut). Sections:
 *
 *   1. **Backup** — Export the persisted blob to a JSON file (M7);
 *      Import a file with replace-all confirm.
 *   2. **Character & Party** — rename the sole character + party
 *      (M7 reducer actions: `rename-character`, `rename-party`).
 *   3. **Wipe data** — kept from M0; nukes Dexie.
 *   4. **App info** — app version + seed version (M7 surfaces both
 *      for diagnostics).
 *
 * Rename sections are hidden pre-bootstrap (Welcome handles that flow);
 * Export still works pre-bootstrap (you get an "empty" envelope).
 */
export function Settings(): ReactElement {
  const navigate = useNavigate();
  const appState = useStore((s) => s.appState);
  const log = useStore((s) => s.log);

  // Wipe confirm
  const [wipeOpen, setWipeOpen] = useState(false);
  const [wiping, setWiping] = useState(false);

  // Import flow state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  async function handleConfirmWipe(): Promise<void> {
    setWiping(true);
    try {
      await wipeAll();
      // Also clear in-memory store so the redirect to Welcome sees an
      // empty state without waiting for a reload.
      useStore.getState().hydrate({ appState: null, log: [] });
      setWipeOpen(false);
      void navigate('/', { replace: true });
    } finally {
      setWiping(false);
    }
  }

  function handleExport(): void {
    try {
      const snapshot: ExportSnapshot = { appState, log };
      const filename = exportToFile(snapshot);
      toast.success(`Exported ${filename}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    }
  }

  function handleImportClick(): void {
    // Reset the input so picking the same filename twice in a row still
    // fires onChange.
    if (fileInputRef.current !== null) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  }

  async function handleFileChosen(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (file === undefined) return;
    try {
      const text = await file.text();
      const result = importFromText(text);
      setImportResult(result);
      if (result.ok) {
        setImportDialogOpen(true);
      } else {
        toast.error(result.error);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to read file');
    }
  }

  const character = appState?.characters[0] ?? null;
  const party = appState?.party ?? null;
  const seedVersion = appState?.seedVersion ?? 0;

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          App version {APP_VERSION} · seed version {seedVersion}
        </p>
      </header>

      {/* M7: Backup section */}
      <section className="space-y-3 rounded-lg border border-border p-4">
        <div>
          <h2 className="font-semibold">Backup</h2>
          <p className="text-sm text-muted-foreground">
            Export your local data to a JSON file, or restore from a previous export. Import will
            replace all current data — you'll get a confirm dialog first.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport}>
            <Download className="h-4 w-4" />
            Export JSON
          </Button>
          <Button variant="outline" onClick={handleImportClick}>
            <Upload className="h-4 w-4" />
            Import JSON
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              void handleFileChosen(e);
            }}
            aria-label="Import backup file"
          />
        </div>
      </section>

      {/* M7: Character & Party rename. Hidden pre-bootstrap (Welcome
          owns the create flow; nothing to rename yet). */}
      {character !== null && party !== null ? (
        <section className="space-y-4 rounded-lg border border-border p-4">
          <div>
            <h2 className="font-semibold">Character & Party</h2>
            <p className="text-sm text-muted-foreground">
              Rename your character or party. Changes are logged.
            </p>
          </div>
          <RenameField
            target="character"
            entityId={character.id}
            currentName={character.name}
            label="Character name"
          />
          <RenameField
            target="party"
            entityId={party.id}
            currentName={party.name}
            label="Party name"
          />
        </section>
      ) : null}

      {/* R1.1: per-character encumbrance rule selector. Same pre-
          bootstrap gate as the rename section — nothing to configure
          until a character exists. */}
      {character !== null ? (
        <section className="space-y-4 rounded-lg border border-border p-4">
          <div>
            <h2 className="font-semibold">Encumbrance</h2>
            <p className="text-sm text-muted-foreground">
              Pick how the Inventory tab handles carrying capacity.
            </p>
          </div>
          <EncumbranceRuleField
            characterId={character.id}
            currentRule={character.encumbranceRule}
            currentEnforce={character.enforceEncumbrance}
          />
        </section>
      ) : null}

      <section className="space-y-3 rounded-lg border border-border p-4">
        <div>
          <h2 className="font-semibold">Wipe data</h2>
          <p className="text-sm text-muted-foreground">
            Erase all locally stored data. This cannot be undone.
          </p>
        </div>
        <Button variant="destructive" onClick={() => setWipeOpen(true)}>
          <Trash2 className="h-4 w-4" />
          Wipe all data
        </Button>
      </section>

      <Dialog open={wipeOpen} onOpenChange={setWipeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Wipe all data?</DialogTitle>
            <DialogDescription>
              This will permanently erase your local app state. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setWipeOpen(false)} disabled={wiping}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void handleConfirmWipe();
              }}
              disabled={wiping}
            >
              {wiping ? 'Wiping…' : 'Wipe'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReplaceAllConfirmDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        result={importResult}
      />
    </div>
  );
}
