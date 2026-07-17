import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Download,
  LogOut,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LinkedAccounts } from '@/components/auth/LinkedAccounts';
import { ReplaceAllConfirmDialog } from '@/components/settings/ReplaceAllConfirmDialog';
import { ThemeField } from '@/components/settings/ThemeField';
import {
  AccentField,
  FollowClassField,
  HubLayoutField,
} from '@/components/settings/AppearanceFields';
import { listKnownPartyIds, loadAppState } from '@/db/load';
import { clearCurrentPartyId, getCurrentPartyId } from '@/db/meta';
import { deleteAppStateForParty } from '@/db/save';
import { wipeAll } from '@/db/wipe';
import { exportToFile, triggerDownload, type ExportSnapshot } from '@/io/export';
import { importFromText, type ImportResult } from '@/io/import';
import {
  ApiError,
  exportAccount,
  listParties,
  listSessions,
  revokeOtherSessions,
  revokeSession,
  updateDisplayName,
} from '@/lib/api';
import { isServerMode } from '@/lib/serverMode';
import { APP_VERSION } from '@/lib/version';
import { useStore } from '@/store';
import { useSession } from '@/store/session';
import { appStateSchema, transactionLogEntrySchema, type SessionSummary } from '@app/shared';

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

  // R10.4 — profile hero stats (party count). Server mode fetches the
  // parties list; local mode counts keyed Dexie blobs. Best-effort — a
  // failure just leaves the stat hidden.
  const [partyCount, setPartyCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const count = isServerMode
          ? (await listParties()).parties.length
          : (await listKnownPartyIds()).length;
        if (!cancelled) setPartyCount(count);
      } catch {
        // Leave the stat hidden on failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // R10.4 — display-name edit dialog.
  const [nameDialogOpen, setNameDialogOpen] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const nameForm = useForm<{ displayName: string }>({
    resolver: zodResolver(z.object({ displayName: z.string().trim().min(1).max(80) })),
    defaultValues: { displayName: session.user?.displayName ?? '' },
  });
  async function handleSaveName(values: { displayName: string }): Promise<void> {
    setSavingName(true);
    try {
      const res = await updateDisplayName(values.displayName);
      session.setUserPatch({ ...res.user, id: res.user.id });
      setNameDialogOpen(false);
      toast.success('Display name updated');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.code : 'Could not update name');
    } finally {
      setSavingName(false);
    }
  }

  // R10.4 — device sessions.
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  useEffect(() => {
    if (!isServerMode || session.user === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await listSessions();
        if (!cancelled) setSessions(res.sessions);
      } catch {
        if (!cancelled) setSessions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.user]);

  async function handleRevokeSession(id: string): Promise<void> {
    try {
      await revokeSession(id);
      setSessions((prev) => (prev === null ? prev : prev.filter((s) => s.id !== id)));
      toast.success('Session revoked');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.code : 'Could not revoke session');
    }
  }
  async function handleRevokeOthers(): Promise<void> {
    try {
      await revokeOtherSessions();
      setSessions((prev) => (prev === null ? prev : prev.filter((s) => s.current)));
      toast.success('Signed out other devices');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.code : 'Could not sign out other devices');
    }
  }

  // R10.4 — account-wide data export.
  async function handleExportAccount(): Promise<void> {
    try {
      const body = await exportAccount();
      triggerDownload(
        `dnd-account-export-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(body, null, 2),
      );
      toast.success('Account data exported');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.code : 'Export failed');
    }
  }

  // R10.4 — delete account (soft delete).
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  async function handleConfirmDeleteAccount(): Promise<void> {
    setDeletingAccount(true);
    try {
      await session.deleteAccount();
      setDeleteAccountOpen(false);
      toast.success('Account deleted');
      void navigate('/login', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'sole_dm_must_transfer_first') {
        const partyId = (err.body as { partyId?: string } | undefined)?.partyId;
        toast.error(
          'You are the sole DM of a party with other members. Transfer the DM role first, then delete your account.',
        );
        if (partyId !== undefined) {
          void navigate(`/party/${partyId}/settings`);
        }
      } else {
        toast.error(err instanceof ApiError ? err.code : 'Could not delete account');
      }
    } finally {
      setDeletingAccount(false);
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
        className="-ml-2 h-8 gap-1.5 px-2 text-muted-foreground"
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
              {/* R10.4 — at-a-glance profile stats. Member-since from
                  User.createdAt; party count from GET /sync/parties. */}
              <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
                {partyCount !== null ? (
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3 w-3" aria-hidden />
                    {partyCount} {partyCount === 1 ? 'party' : 'parties'}
                  </span>
                ) : null}
                {session.user.createdAt !== undefined && session.user.createdAt !== null ? (
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="h-3 w-3" aria-hidden />
                    Member since {formatMemberSince(session.user.createdAt)}
                  </span>
                ) : null}
              </div>
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
              <Row
                label="Display name"
                value={session.user.displayName}
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      nameForm.reset({ displayName: session.user?.displayName ?? '' });
                      setNameDialogOpen(true);
                    }}
                  >
                    Edit
                  </Button>
                }
              />
              {session.user.email !== undefined && session.user.email !== null ? (
                <Row
                  label="Email"
                  value={session.user.email}
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        void navigate('/settings/email/change');
                      }}
                    >
                      Change
                    </Button>
                  }
                />
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

      {/* R3.5 + R10.4 — Sessions. Device list (from /users/me/sessions):
          the current device is badged; others get a Revoke button. Logout
          + "Sign out other devices" below. Server mode only. */}
      {isServerMode && session.user !== null ? (
        <Section title="Sessions" desc="Devices signed in to your account.">
          {sessions !== null && sessions.length > 0 ? (
            <div className="-mt-1 mb-3 divide-y divide-border">
              {sessions.map((s) => (
                <Row
                  key={s.id}
                  label={s.current ? 'This device' : 'Signed-in device'}
                  sub={`Active until ${formatSessionDate(s.expires)}`}
                  action={
                    s.current ? (
                      <span className="text-xs text-emerald-600 dark:text-emerald-400">
                        Current
                      </span>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          void handleRevokeSession(s.id);
                        }}
                      >
                        Revoke
                      </Button>
                    )
                  }
                />
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                void handleLogout();
              }}
            >
              <LogOut className="h-4 w-4" />
              Logout
            </Button>
            {sessions !== null && sessions.filter((s) => !s.current).length > 0 ? (
              <Button
                variant="outline"
                onClick={() => {
                  void handleRevokeOthers();
                }}
              >
                Sign out other devices
              </Button>
            ) : null}
          </div>
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

      {/* R10.4 — account danger zone (server mode): export all my data +
          delete account (soft-delete). Distinct from the local-data wipe
          below (which is the browser-local reset, both modes). */}
      {isServerMode && session.user !== null ? (
        <Section
          title="Account danger zone"
          desc="Export a copy of everything, or permanently delete your account."
          danger
        >
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                void handleExportAccount();
              }}
            >
              <Download className="h-4 w-4" />
              Export my data
            </Button>
            <Button variant="destructive" onClick={() => setDeleteAccountOpen(true)}>
              <Trash2 className="h-4 w-4" />
              Delete account
            </Button>
          </div>
        </Section>
      ) : null}

      {/* Danger zone — local data reset (wipe). Distinct from account
          deletion above; this is the browser-local app-data reset. */}
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
            <DialogTitle className="font-display">Wipe all data?</DialogTitle>
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
            <DialogTitle className="font-display">Wipe corrupted party data?</DialogTitle>
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

      {/* R10.4 — display-name edit dialog. */}
      <Dialog open={nameDialogOpen} onOpenChange={setNameDialogOpen}>
        <DialogContent>
          <form
            onSubmit={(e) => {
              void nameForm.handleSubmit((v) => handleSaveName(v))(e);
            }}
            noValidate
          >
            <DialogHeader>
              <DialogTitle className="font-display">Edit display name</DialogTitle>
              <DialogDescription>
                This is how you appear to other members across every party.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5 py-4">
              <Label htmlFor="settings-display-name">Display name</Label>
              <Input id="settings-display-name" autoFocus {...nameForm.register('displayName')} />
              {nameForm.formState.errors.displayName ? (
                <p className="text-sm text-destructive" role="alert">
                  {nameForm.formState.errors.displayName.message}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setNameDialogOpen(false)}
                disabled={savingName}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={savingName}>
                {savingName ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* R10.4 — delete-account confirm. Soft delete: characters removed,
          solo-owned parties archived, name anonymized in shared histories,
          credentials released. Irreversible. */}
      <Dialog open={deleteAccountOpen} onOpenChange={setDeleteAccountOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Delete your account?</DialogTitle>
            <DialogDescription>
              This is permanent and cannot be undone. Your characters are removed from every party
              (their items and currency return to each party&apos;s Recovered Loot), your name is
              anonymized in shared histories, and your email is released for reuse. If you are the
              sole DM of a party with other members, transfer the DM role first.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteAccountOpen(false)}
              disabled={deletingAccount}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void handleConfirmDeleteAccount();
              }}
              disabled={deletingAccount}
            >
              {deletingAccount ? 'Deleting…' : 'Delete account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** R10.4 — "Member since {Mon YYYY}" from an ISO createdAt. */
function formatMemberSince(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

/** R10.4 — short date for a session's expiry. */
function formatSessionDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
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
