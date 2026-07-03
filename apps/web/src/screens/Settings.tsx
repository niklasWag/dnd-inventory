import { useEffect, useRef, useState, type ChangeEvent, type ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Download, LogOut, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LinkedAccounts } from '@/components/auth/LinkedAccounts';
import { EncumbranceRuleField } from '@/components/settings/EncumbranceRuleField';
import { ReplaceAllConfirmDialog } from '@/components/settings/ReplaceAllConfirmDialog';
import { loadAppState } from '@/db/load';
import { clearCurrentPartyId, getCurrentPartyId } from '@/db/meta';
import { deleteAppStateForParty } from '@/db/save';
import { wipeAll } from '@/db/wipe';
import { exportToFile, type ExportSnapshot } from '@/io/export';
import { importFromText, type ImportResult } from '@/io/import';
import { isServerMode } from '@/lib/serverMode';
import { getOwnCharacter } from '@/lib/ownCharacter';
import { APP_VERSION } from '@/lib/version';
import { useStore } from '@/store';
import { useSession } from '@/store/session';
import { appStateSchema, transactionLogEntrySchema } from '@app/shared';

/**
 * RH5.2 — persisted blob schema (mirrors `hydrate.ts`). Used below to
 * detect a corrupted current-party blob at mount time so the recovery
 * button can surface.
 */
const persistedBlobSchema = z.object({
  appState: z.union([appStateSchema, z.null()]),
  log: z.array(transactionLogEntrySchema),
});

/**
 * Settings (MVP §7 screen 9 — final M7 cut). Sections:
 *
 *   1. **Backup** — Export the persisted blob to a JSON file (M7);
 *      Import a file with replace-all confirm.
 *   2. **Encumbrance** — per-character rule + enforce flag (R1.1).
 *   3. **Wipe data** — kept from M0; nukes Dexie.
 *   4. **App info** — app version + seed version (M7 surfaces both
 *      for diagnostics).
 *
 * R4.1-followup — character + party rename moved to `/party/settings`
 * (party-scoped, lives next to members + invite code). This screen is
 * now purely global / account-scoped.
 */
export function Settings(): ReactElement {
  const navigate = useNavigate();
  const appState = useStore((s) => s.appState);
  const log = useStore((s) => s.log);
  const session = useSession((s) => s);

  // R3.5 — surface link-flow outcomes coming back from the server as
  // toasts, then scrub the query parameters so a refresh doesn't
  // re-fire the toast.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const linked = searchParams.get('linked');
    const linkError = searchParams.get('linkError');
    if (linked === null && linkError === null) return;
    if (linked === 'discord') toast.success('Discord linked');
    if (linkError !== null) {
      const msg =
        linkError === 'discord_already_linked'
          ? 'That Discord account is already linked elsewhere.'
          : `Linking failed: ${linkError}`;
      toast.error(msg);
    }
    const next = new URLSearchParams(searchParams);
    next.delete('linked');
    next.delete('linkError');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  async function handleLogout(): Promise<void> {
    await session.signOut();
    void navigate('/login', { replace: true });
  }

  // Wipe confirm
  const [wipeOpen, setWipeOpen] = useState(false);
  const [wiping, setWiping] = useState(false);

  // Import flow state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  // RH5.2 — corruption-recovery state. When the current-party blob in
  // Dexie fails Zod parse, surface a "Wipe corrupted party data" button
  // that clears just that keyed slot (leaving other parties intact).
  // The detection is best-effort: only checks the CURRENT party pointer;
  // other parties surface their corruption via boot-time toast when the
  // user activates them from Hub.
  const [corruptedPartyId, setCorruptedPartyId] = useState<string | null>(null);
  const [corruptionRecoveryOpen, setCorruptionRecoveryOpen] = useState(false);
  const [recovering, setRecovering] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const partyId = await getCurrentPartyId();
      if (partyId === null) return;
      const raw = await loadAppState(partyId);
      if (raw === null) return; // pointer stale — not a corruption case
      const parsed = persistedBlobSchema.safeParse(raw);
      if (!parsed.success && !cancelled) {
        setCorruptedPartyId(partyId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleConfirmCorruptionRecovery(): Promise<void> {
    if (corruptedPartyId === null) return;
    setRecovering(true);
    try {
      await deleteAppStateForParty(corruptedPartyId);
      await clearCurrentPartyId();
      useStore.setState({ appState: null, log: [] });
      setCorruptionRecoveryOpen(false);
      setCorruptedPartyId(null);
      toast.success('Corrupted party data wiped.');
      void navigate('/hub', { replace: true });
    } finally {
      setRecovering(false);
    }
  }

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

  const character = getOwnCharacter(appState);
  const seedVersion = appState?.seedVersion ?? 0;

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">
          App version {APP_VERSION} · seed version {seedVersion}
        </p>
      </header>

      {/* R3.5: Account + Linked accounts + Logout — server mode only. */}
      {isServerMode && session.user !== null ? (
        <>
          <section className="space-y-3 rounded-lg border border-border p-4">
            <div>
              <h2 className="font-semibold">Account</h2>
              <p className="text-sm text-muted-foreground">
                Your sign-in identity for this server.
              </p>
            </div>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Display name</dt>
              <dd className="font-medium">{session.user.displayName}</dd>
              {session.user.email !== undefined && session.user.email !== null ? (
                <>
                  <dt className="text-muted-foreground">Email</dt>
                  <dd className="font-medium">{session.user.email}</dd>
                </>
              ) : null}
              {session.user.discordId !== undefined && session.user.discordId !== null ? (
                <>
                  <dt className="text-muted-foreground">Discord</dt>
                  <dd className="font-medium">id {session.user.discordId}</dd>
                </>
              ) : null}
            </dl>
          </section>

          <section className="space-y-3 rounded-lg border border-border p-4">
            <div>
              <h2 className="font-semibold">Linked accounts</h2>
              <p className="text-sm text-muted-foreground">
                Connect Discord and email so you can sign in either way.
              </p>
            </div>
            <LinkedAccounts />
          </section>

          <section className="space-y-3 rounded-lg border border-border p-4">
            <div>
              <h2 className="font-semibold">Session</h2>
              <p className="text-sm text-muted-foreground">Sign out on this device.</p>
            </div>
            <Button
              variant="outline"
              onClick={() => {
                void handleLogout();
              }}
            >
              <LogOut className="h-4 w-4" />
              Logout
            </Button>
          </section>
        </>
      ) : null}

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

      {/* M7: Character & Party rename — moved to /party/settings in
          R4.1-followup. The screen lives next to members + invite code
          so all per-party settings are co-located. */}

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

      {/* RH5.2 — corruption-recovery. Only surfaces when the current-
          party Dexie blob fails Zod parse (boot-time toast points the
          user here). Wipes JUST that party's slot, leaving other parties
          intact. In server mode the next `pullState` will re-hydrate
          the blob canonical-from-server; in local mode the party is
          effectively lost (JSON backup import is the recovery path). */}
      {corruptedPartyId !== null ? (
        <section className="space-y-3 rounded-lg border border-destructive/60 bg-destructive/5 p-4">
          <div>
            <h2 className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Corrupted party data
            </h2>
            <p className="text-sm text-muted-foreground">
              The local blob for this party failed to load. Wipe it to reset — in server mode a
              fresh copy will be pulled on next visit.
            </p>
          </div>
          <Button
            variant="destructive"
            onClick={() => setCorruptionRecoveryOpen(true)}
            data-testid="wipe-corrupted-party-btn"
          >
            <Trash2 className="h-4 w-4" />
            Wipe corrupted party data
          </Button>
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

      <Dialog open={corruptionRecoveryOpen} onOpenChange={setCorruptionRecoveryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Wipe corrupted party data?</DialogTitle>
            <DialogDescription>
              This deletes the local blob for party <code>{corruptedPartyId}</code>. Other parties
              are unaffected. In server mode the party will be re-fetched from the server on next
              visit; in local mode you'll need to restore from a JSON backup.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCorruptionRecoveryOpen(false)}
              disabled={recovering}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void handleConfirmCorruptionRecovery();
              }}
              disabled={recovering}
            >
              {recovering ? 'Wiping…' : 'Wipe'}
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
