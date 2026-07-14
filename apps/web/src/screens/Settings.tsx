import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Download, LogOut, Trash2, Upload } from 'lucide-react';
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
import { ReplaceAllConfirmDialog } from '@/components/settings/ReplaceAllConfirmDialog';
import { ThemeField } from '@/components/settings/ThemeField';
import {
  AccentField,
  FollowClassField,
  HubLayoutField,
} from '@/components/settings/AppearanceFields';
import { loadAppState } from '@/db/load';
import { clearCurrentPartyId, getCurrentPartyId } from '@/db/meta';
import { deleteAppStateForParty } from '@/db/save';
import { wipeAll } from '@/db/wipe';
import { exportToFile, type ExportSnapshot } from '@/io/export';
import { importFromText, type ImportResult } from '@/io/import';
import { isServerMode } from '@/lib/serverMode';
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

  const seedVersion = appState?.seedVersion ?? 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => void navigate(-1)}
        className="-ml-2 h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </Button>

      {/* R9.11 — Profile hero (server mode; account identity banner). Local
          mode has no account, so it falls back to a plain title. */}
      {isServerMode && session.user !== null ? (
        <div className="overflow-hidden rounded-xl border border-border bg-gradient-to-br from-primary/10 to-surface p-6 shadow-e2">
          <div className="flex flex-wrap items-center gap-4">
            <div className="grid h-20 w-20 shrink-0 place-items-center rounded-full border-2 border-primary/40 bg-surface-2 font-display text-3xl font-bold text-primary ring-2 ring-surface">
              {session.user.displayName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-2xl font-bold tracking-tight">
                {session.user.displayName}
              </h1>
              {session.user.email !== undefined && session.user.email !== null ? (
                <p className="truncate text-sm text-muted-foreground">{session.user.email}</p>
              ) : null}
              <p className="mt-1 text-xs text-muted-foreground">
                App version {APP_VERSION} · seed version {seedVersion}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <header>
          <h1 className="font-display text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">
            App version {APP_VERSION} · seed version {seedVersion}
          </p>
        </header>
      )}

      {/* R3.5 — Account + Linked accounts + Session (Logout) — server mode only. */}
      {isServerMode && session.user !== null ? (
        <>
          <Section title="Account" desc="Your sign-in identity for this server.">
            <div className="-my-1 divide-y divide-border">
              <Row label="Display name" value={session.user.displayName} />
              {session.user.email !== undefined && session.user.email !== null ? (
                <Row label="Email" value={session.user.email} />
              ) : null}
              {session.user.discordId !== undefined && session.user.discordId !== null ? (
                <Row label="Discord" value={`id ${session.user.discordId}`} />
              ) : null}
            </div>
          </Section>

          <Section
            title="Login methods"
            desc="Connect Discord and email so you can sign in either way."
          >
            <LinkedAccounts />
          </Section>
        </>
      ) : null}

      {/* R7.1.a + R9.11 — Appearance cluster (theme, accent, follow-class,
          Hub layout). Global / account-scoped device prefs. */}
      <Section title="Appearance" desc="Choose how the app looks on this device.">
        <div className="space-y-4">
          <ThemeField />
          <AccentField />
          <FollowClassField />
          <HubLayoutField />
        </div>
      </Section>

      {/* R3.5 — Sessions (Logout). Below Appearance per the mockup order.
          Server mode only (local mode has no account session). */}
      {isServerMode && session.user !== null ? (
        <Section title="Sessions" desc="Sign out on this device.">
          <Button
            variant="outline"
            onClick={() => {
              void handleLogout();
            }}
          >
            <LogOut className="h-4 w-4" />
            Logout
          </Button>
        </Section>
      ) : null}

      {/* M7: Backup section */}
      <Section
        title="Backup"
        desc="Export your local data to a JSON file, or restore from a previous export. Import replaces all current data — you'll get a confirm dialog first."
      >
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
      </Section>

      {/* M7: Character & Party rename — moved to /party/settings in
          R4.1-followup. The screen lives next to members + invite code
          so all per-party settings are co-located. */}

      {/* R1.1 encumbrance rule — moved to /party/settings in BUG-011
          (party-wide house rule, not per-character; DM-edited). This
          screen is now purely global / account-scoped. */}

      {/* RH5.2 — corruption-recovery. Only surfaces when the current-
          party Dexie blob fails Zod parse (boot-time toast points the
          user here). Wipes JUST that party's slot, leaving other parties
          intact. In server mode the next `pullState` will re-hydrate
          the blob canonical-from-server; in local mode the party is
          effectively lost (JSON backup import is the recovery path). */}
      {corruptedPartyId !== null ? (
        <Section
          title="Corrupted party data"
          desc="The local blob for this party failed to load. Wipe it to reset — in server mode a fresh copy will be pulled on next visit."
          danger
        >
          <Button
            variant="destructive"
            onClick={() => setCorruptionRecoveryOpen(true)}
            data-testid="wipe-corrupted-party-btn"
          >
            <AlertTriangle className="h-4 w-4" />
            Wipe corrupted party data
          </Button>
        </Section>
      ) : null}

      {/* Danger zone — local data reset (wipe). Account deletion is not a
          feature; this is the app-data reset. */}
      <Section
        title="Danger zone"
        desc="Erase all locally stored data. This cannot be undone."
        danger
      >
        <Button variant="destructive" onClick={() => setWipeOpen(true)}>
          <Trash2 className="h-4 w-4" />
          Wipe all data
        </Button>
      </Section>

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

/**
 * R9.11 — framed settings "Section" card (ports the design-lab
 * `settings/kit` Section: titled header + body, `danger` variant for the
 * destructive zone). Mirrors the PartySettings `Section` helper.
 */
function Section({
  title,
  desc,
  danger = false,
  children,
}: {
  title: string;
  desc?: string;
  danger?: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <section
      className={`overflow-hidden rounded-lg border bg-surface shadow-e1 ${
        danger ? 'border-destructive/40' : 'border-border'
      }`}
    >
      <div className="border-b border-border px-4 py-3">
        <h2
          className={`font-display text-sm font-semibold uppercase tracking-wide ${
            danger ? 'text-destructive' : ''
          }`}
        >
          {title}
        </h2>
        {desc !== undefined ? <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p> : null}
      </div>
      <div className="px-4 py-4">{children}</div>
    </section>
  );
}

/** A label(+sub) → value → action row inside a Section. */
function Row({
  label,
  sub,
  value,
  action,
}: {
  label: ReactNode;
  sub?: ReactNode;
  value?: ReactNode;
  action?: ReactNode;
}): ReactElement {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {sub !== undefined ? <div className="text-xs text-muted-foreground">{sub}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {value !== undefined ? (
          <span className="text-sm text-muted-foreground">{value}</span>
        ) : null}
        {action}
      </div>
    </div>
  );
}
