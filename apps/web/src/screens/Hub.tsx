import { useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus, Users, Link as LinkIcon } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CharacterForm, type CharacterFormOutput } from '@/components/CharacterForm';
import { listKnownPartyIds, loadAppState } from '@/db/load';
import { setCurrentPartyId } from '@/db/meta';
import { ApiError, joinParty, listParties } from '@/lib/api';
import { isServerMode } from '@/lib/serverMode';
import { getOwnCharacter } from '@/lib/ownCharacter';
import { useStore, flushPendingPersist, dispatchMintingAction } from '@/store';
import { seedCatalogIfNeeded } from '@/store/seed';
import { pullState } from '@/sync/client';
import { flush as flushSyncQueue } from '@/sync/queue';
import type { PartyListItem } from '@app/shared';

/**
 * R3.5 — Hub screen. Universal front door per OUTLINE §3.1.
 *
 * Renders existing parties (server mode → `GET /sync/parties`; local mode
 * → the single local AppState party, if any) plus three action cards:
 *
 *   - **Create solo (party-of-one)** — character form, single
 *     `create-character` dispatch.
 *   - **Create party** — same form but creates a regular party. The
 *     "do you also play a character?" toggle is post-R3.5 (the reducer
 *     today always mints a character). The "solo" vs "party" UI label is
 *     a hint only; both paths use the same reducer action. Hub badges
 *     derive solo-ness from `memberCount === 1` (OUTLINE §4 amendment).
 *   - **Join party** — hidden in R3.5 with "Coming in R4" caption.
 *
 * Login chrome is server-mode-only. In local mode the Hub looks like a
 * front door for the local-only flow and never references auth.
 */
export function Hub(): ReactElement {
  const navigate = useNavigate();
  // The currently-loaded party (if any). In local mode this is the
  // pointer the previous session left behind. In server mode it's
  // whatever the user last navigated into.
  const loadedParty = useStore(
    useShallow((s) => {
      if (s.appState === null) return null;
      return { id: s.appState.party.id, name: s.appState.party.name };
    }),
  );

  /**
   * Local-mode parties list. Built by enumerating every keyed Dexie
   * blob (`appState:<partyId>`) and reading its `party` metadata. Lazy
   * because we don't need it server-side (server mode has its own
   * source of truth via `GET /sync/parties`).
   */
  const [localParties, setLocalParties] = useState<{ id: string; name: string }[] | null>(null);

  const [serverParties, setServerParties] = useState<PartyListItem[] | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [openingPartyId, setOpeningPartyId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'create-solo' | 'create-party' | 'join' | null>(null);

  /**
   * R4.1-followup — Create-party is a 3-step flow:
   *   1. Party name input.
   *   2. "Will you also play a character?" Yes / No.
   *   3a (yes). Character form. Submit dispatches `create-character` with
   *       `partyName` set.
   *   3b (no). Submit dispatches `create-character` with `dmOnly: true`.
   *
   * Create-solo stays a single-step flow (party name auto-derived).
   * `createPartyStep` tracks where we are inside the multi-step dialog;
   * `pendingPartyName` carries the value from step 1 into steps 2 & 3.
   */
  const [createPartyStep, setCreatePartyStep] = useState<'name' | 'play' | 'character'>('name');
  const [pendingPartyName, setPendingPartyName] = useState('');

  function resetCreatePartyDialog(): void {
    setDialog(null);
    setCreatePartyStep('name');
    setPendingPartyName('');
  }

  // Enumerate local-mode parties on mount (and whenever loadedParty
  // changes — covers create-party + open-party transitions).
  useEffect(() => {
    if (isServerMode) {
      setLocalParties(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const ids = await listKnownPartyIds();
      // Best-effort read; we tolerate a malformed blob by skipping its
      // row in the list (the per-party render is purely informational).
      const rows: { id: string; name: string }[] = [];
      for (const id of ids) {
        try {
          const raw = (await loadAppState(id)) as {
            appState?: { party?: { id: string; name: string } };
          } | null;
          const party = raw?.appState?.party;
          if (party !== undefined && typeof party.name === 'string') {
            rows.push({ id, name: party.name });
          }
        } catch {
          // Skip — the per-party listing is non-critical.
        }
      }
      // Also include the currently-loaded party if it hasn't been saved
      // yet (fresh-create window before the debounce fires).
      if (loadedParty !== null && !rows.some((r) => r.id === loadedParty.id)) {
        rows.push(loadedParty);
      }
      if (!cancelled) setLocalParties(rows);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadedParty]);

  useEffect(() => {
    if (!isServerMode) {
      setServerParties(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await listParties();
        if (!cancelled) setServerParties(res.parties);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.code === 'display_name_required') {
          void navigate('/login/display-name', { replace: true });
          return;
        }
        if (err instanceof ApiError && err.code === 'unauthenticated') {
          void navigate('/login', { replace: true });
          return;
        }
        setServerError('Could not load your parties.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  /**
   * Open a server-mode party: persist the choice (so reload boots straight
   * back into it via `main.tsx`), pull its canonical AppState, hydrate
   * the store, then navigate to the user's character sheet.
   *
   * R3.5 picked `characters[0]` from the pulled AppState — fine when the
   * schema was "exactly one character per party" but wrong post-R4.1.f:
   * the pulled state contains EVERY character in the party, ordered by
   * insertion. The fix routes the actor to their OWN character via
   * `PartyMembership.characterId` (see `lib/ownCharacter.ts`). If the
   * actor has no character of their own (DM-only DM, joiner who hasn't
   * dispatched create-character yet, or post-delete recreation case),
   * route to `/party/settings` where they get the "Create your
   * character" CTA.
   */
  async function openServerParty(partyId: string): Promise<void> {
    if (openingPartyId !== null) return;
    setOpeningPartyId(partyId);
    try {
      // Flush any pending save for the currently-loaded party before
      // swapping it out — keeps the keyed-by-partyId Dexie blob in sync
      // with what the user just had on screen.
      if (useStore.getState().appState !== null) {
        await flushPendingPersist();
      }
      await setCurrentPartyId(partyId);
      const pulled = await pullState(partyId);
      useStore.getState().hydrate({ appState: pulled.state, log: pulled.state.log });
      const ownCharacterId = getOwnCharacter(pulled.state)?.id;
      if (ownCharacterId === undefined) {
        // Either a DM-only party (R4.1-followup), or the actor is a
        // joiner who hasn't created their character yet (R4.1.f), or
        // they're recreating after delete-character. All three land on
        // /party/:partyId/settings, which shows the "Create your character" CTA.
        void navigate(`/party/${partyId}/settings`);
        return;
      }
      void navigate(`/party/${partyId}/character/${ownCharacterId}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'unauthenticated') {
        void navigate('/login', { replace: true });
        return;
      }
      if (err instanceof ApiError && err.code === 'display_name_required') {
        void navigate('/login/display-name', { replace: true });
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Could not open this party.');
    } finally {
      setOpeningPartyId(null);
    }
  }

  /**
   * Local-mode: switch the in-memory store to the supplied party's
   * blob and navigate to its first character. Mirrors the server-mode
   * `openServerParty` but reads from Dexie instead of `/sync/state`.
   */
  async function openLocalParty(partyId: string): Promise<void> {
    if (openingPartyId !== null) return;
    setOpeningPartyId(partyId);
    try {
      // Flush + clear the currently-loaded party so its mutations
      // persist under the right key before we swap.
      if (useStore.getState().appState !== null) {
        await flushPendingPersist();
        if (useStore.getState().appState?.party.id !== partyId) {
          useStore.setState({ appState: null, log: [] });
        }
      }
      await setCurrentPartyId(partyId);
      // hydrateFromDexie() reads `currentPartyId` then loads the blob.
      // We bypass it here and call the loader directly to avoid a
      // module-level dependency cycle (hydrate.ts imports the store).
      const raw = await loadAppState(partyId);
      if (raw === null) {
        toast.error('Could not find that party in local storage.');
        return;
      }
      const persisted = raw as { appState: unknown; log: unknown[] };
      useStore.getState().hydrate({
        appState: persisted.appState as ReturnType<typeof useStore.getState>['appState'],
        log: persisted.log as ReturnType<typeof useStore.getState>['log'],
      });
      const id = getOwnCharacter(useStore.getState().appState)?.id;
      if (id !== undefined) {
        void navigate(`/party/${partyId}/character/${id}`);
        return;
      }
      // R4.1-followup — DM-only local party (no characters). Route to
      // the party-management screen instead of leaving the user on Hub.
      void navigate(`/party/${partyId}/settings`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open this party.');
    } finally {
      setOpeningPartyId(null);
    }
  }

  /**
   * Create a fresh party/solo. The reducer's `create-character` insists
   * on a null in-memory AppState (it's the bootstrap action that mints
   * user + party + character + stashes from scratch). So before
   * dispatching, we flush any pending save for the currently-loaded
   * party and clear the store — its per-party blob is already keyed by
   * partyId in Dexie, so it remains accessible from the Hub list.
   *
   * Once the dispatch lands, the new party's id is the active pointer;
   * we stamp it into Dexie meta so a reload boots back into this party.
   */
  async function handleCreateSubmit(
    values: CharacterFormOutput,
    partyName?: string,
  ): Promise<void> {
    // Persist the currently-loaded party (if any) under its keyed slot
    // before we wipe the in-memory state. This is the load-bearing step
    // that lets the user later open the previous party from the Hub
    // list without losing its mutations.
    if (useStore.getState().appState !== null) {
      await flushPendingPersist();
      useStore.setState({ appState: null, log: [] });
    }

    try {
      dispatchMintingAction({
        type: 'create-character',
        payload: partyName !== undefined ? { ...values, partyName } : values,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create character');
      return;
    }
    seedCatalogIfNeeded();
    const newState = useStore.getState().appState;
    if (newState === null) return;

    // Set the active-party pointer so a reload comes back here.
    await setCurrentPartyId(newState.party.id);
    // Persist the new party blob immediately rather than waiting for
    // the debounce — minimises window where a reload would lose it.
    await flushPendingPersist();
    // R4.1-followup — in server mode, also force the sync queue to
    // push the bootstrap action and re-pull canonical state BEFORE we
    // navigate. Without this, the next screen's API calls (notably
    // PartySettings → listPartyMembers) race the queue's 200ms debounce
    // and hit the server before the party row exists, surfacing as a
    // 404. In local mode `flush()` is a no-op (`enqueue` short-circuits
    // when `isServerMode` is false).
    if (isServerMode) {
      await flushSyncQueue();
    }

    // Re-read post-flush: the queue's bootstrap pull replaced the
    // optimistic state with the server-canonical state (whose
    // characterId differs from the local one — server runs its own
    // reducer with its own UUIDs). Navigating with the stale local
    // id would land on /character/<unknown-id>.
    const canonical = useStore.getState().appState;
    const id = getOwnCharacter(canonical)?.id;
    if (id !== undefined && canonical !== null) {
      void navigate(`/party/${canonical.party.id}/character/${id}`, { replace: true });
    }
  }

  /**
   * R4.1-followup — DM-only Create-party submit. Same bootstrap shape
   * as `handleCreateSubmit` but the reducer mints no character +
   * Inventory stash, just User + Party + dm membership + party-scope
   * stashes. After dispatch we route to `/party/settings` so the DM
   * lands on the party-management surface (they have no character
   * sheet to go to).
   */
  async function handleCreatePartyDmOnly(partyName: string): Promise<void> {
    if (useStore.getState().appState !== null) {
      await flushPendingPersist();
      useStore.setState({ appState: null, log: [] });
    }

    try {
      dispatchMintingAction({
        type: 'create-character',
        payload: { dmOnly: true, partyName },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create party');
      return;
    }
    seedCatalogIfNeeded();
    const newState = useStore.getState().appState;
    if (newState === null) return;

    await setCurrentPartyId(newState.party.id);
    await flushPendingPersist();
    // R4.1-followup — same pre-navigation sync flush as the with-
    // character branch. Without this, PartySettings would race the
    // queue and hit `/parties/:id/members` before the party row is
    // persisted on the server.
    if (isServerMode) {
      await flushSyncQueue();
    }

    // No character → route to party settings. The DM can manage members
    // + invite code there, or use a future "add my character" affordance
    // once the create-character-in-existing-party path lands.
    const partyIdAfterFlush = useStore.getState().appState?.party.id;
    if (partyIdAfterFlush !== undefined) {
      void navigate(`/party/${partyIdAfterFlush}/settings`, { replace: true });
    }
  }

  /**
   * R4.1.e — redeem an invite code and join. On success, refresh the
   * Hub's party list and route into the new party (same pull-then-
   * navigate path as `openServerParty`). On `already_member` we still
   * navigate — the user pasted a code for a party they're already in.
   */
  async function handleJoinSubmit(inviteCode: string): Promise<void> {
    try {
      const { partyId } = await joinParty({ inviteCode });
      // Re-fetch the parties list so the Hub stays in sync, then open
      // the new party using the existing helper.
      const res = await listParties();
      setServerParties(res.parties);
      setDialog(null);
      await openServerParty(partyId);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'invalid_invite') {
          toast.error('That invite code is invalid or expired.');
          return;
        }
        if (err.code === 'already_member') {
          toast.message('You are already a member of that party.');
          setDialog(null);
          return;
        }
      }
      toast.error(err instanceof Error ? err.message : 'Could not join party');
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 py-10">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Your parties</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose a party to open, or start something new.
        </p>
      </header>

      <ExistingParties
        localParties={localParties}
        serverParties={serverParties}
        serverError={serverError}
        openingPartyId={openingPartyId}
        onOpenServer={(id) => {
          void openServerParty(id);
        }}
        onOpenLocal={(id) => {
          void openLocalParty(id);
        }}
      />

      <section aria-label="New party">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Start something new
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <ActionCard
            icon={<UserPlus className="h-5 w-5" />}
            title="Solo"
            description="Start a party-of-one — just you and your character."
            onClick={() => setDialog('create-solo')}
          />
          <ActionCard
            icon={<Users className="h-5 w-5" />}
            title="Create party"
            description="Start a party others can join later."
            onClick={() => setDialog('create-party')}
          />
          <ActionCard
            icon={<LinkIcon className="h-5 w-5" />}
            title="Join party"
            description={
              isServerMode
                ? 'Paste an invite code from another DM.'
                : 'Available when this app runs against a hosted server.'
            }
            {...(isServerMode ? { onClick: () => setDialog('join') } : { disabled: true })}
          />
        </div>
      </section>

      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => {
          if (!o) resetCreatePartyDialog();
        }}
      >
        <DialogContent>
          {dialog === 'join' ? (
            <>
              <DialogHeader>
                <DialogTitle>Join a party</DialogTitle>
                <DialogDescription>
                  Paste the invite code your DM shared with you. You can create your character on
                  the next screen.
                </DialogDescription>
              </DialogHeader>
              <JoinPartyForm
                onSubmit={(code) => {
                  void handleJoinSubmit(code);
                }}
                onCancel={() => setDialog(null)}
              />
            </>
          ) : dialog === 'create-solo' ? (
            <>
              <DialogHeader>
                <DialogTitle>Create a solo party</DialogTitle>
                <DialogDescription>
                  Enter your character&apos;s basics. You can change everything except size and
                  species later.
                </DialogDescription>
              </DialogHeader>
              <CharacterForm
                onSubmit={(values) => {
                  void handleCreateSubmit(values);
                  setDialog(null);
                }}
                onCancel={() => setDialog(null)}
              />
            </>
          ) : dialog === 'create-party' && createPartyStep === 'name' ? (
            <>
              <DialogHeader>
                <DialogTitle>Create a party</DialogTitle>
                <DialogDescription>
                  Give your party a name. You can rename it later from Settings.
                </DialogDescription>
              </DialogHeader>
              <PartyNameForm
                initial={pendingPartyName}
                onSubmit={(name) => {
                  setPendingPartyName(name);
                  setCreatePartyStep('play');
                }}
                onCancel={() => resetCreatePartyDialog()}
              />
            </>
          ) : dialog === 'create-party' && createPartyStep === 'play' ? (
            <>
              <DialogHeader>
                <DialogTitle>Will you also play a character?</DialogTitle>
                <DialogDescription>
                  Choose &quot;Yes&quot; to create your own character in this party. Choose
                  &quot;No&quot; if you&apos;ll only run the campaign as the DM — you can still add
                  a character later.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={() => setCreatePartyStep('name')}>
                  Back
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    void handleCreatePartyDmOnly(pendingPartyName);
                    resetCreatePartyDialog();
                  }}
                >
                  No, just DM
                </Button>
                <Button onClick={() => setCreatePartyStep('character')}>
                  Yes, create my character
                </Button>
              </DialogFooter>
            </>
          ) : dialog === 'create-party' && createPartyStep === 'character' ? (
            <>
              <DialogHeader>
                <DialogTitle>Create your character</DialogTitle>
                <DialogDescription>
                  Enter your character&apos;s basics. You can change everything except size and
                  species later.
                </DialogDescription>
              </DialogHeader>
              <CharacterForm
                onSubmit={(values) => {
                  void handleCreateSubmit(values, pendingPartyName);
                  resetCreatePartyDialog();
                }}
                onCancel={() => setCreatePartyStep('play')}
              />
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * R4.1-followup — Step-1 Party name input for the Create-party wizard.
 * Cancel returns to the Hub; Next pushes the trimmed value into the
 * wizard state and advances to the "play character?" step.
 */
function PartyNameForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: string;
  onSubmit: (partyName: string) => void;
  onCancel: () => void;
}): ReactElement {
  const [name, setName] = useState(initial);
  const trimmed = name.trim();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed.length > 0) onSubmit(trimmed);
      }}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="party-name">Party name</Label>
        <Input
          id="party-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="The Misfits"
          autoComplete="off"
          autoFocus
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={trimmed.length === 0}>
          Next
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * R4.1.e — Join-party form. Single text input + Cancel/Join. Disables
 * the submit button while empty so an empty redemption attempt never
 * fires.
 */
function JoinPartyForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (inviteCode: string) => void;
  onCancel: () => void;
}): ReactElement {
  const [code, setCode] = useState('');
  const trimmed = code.trim();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (trimmed.length > 0) onSubmit(trimmed);
      }}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <Label htmlFor="invite-code">Invite code</Label>
        <Input
          id="invite-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="INV-XXXXXXXXXX"
          autoComplete="off"
          autoFocus
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={trimmed.length === 0}>
          Join
        </Button>
      </DialogFooter>
    </form>
  );
}

interface ExistingPartiesProps {
  localParties: { id: string; name: string }[] | null;
  serverParties: PartyListItem[] | null;
  serverError: string | null;
  /** Non-null while a party is being opened (server or local). */
  openingPartyId: string | null;
  /** Server-mode click — receives the party id and owns the pull+navigate. */
  onOpenServer: (partyId: string) => void;
  /**
   * Local-mode click — receives the party id. Hub orchestrates the
   * Dexie load + store hydrate + navigate.
   */
  onOpenLocal: (partyId: string) => void;
}

function ExistingParties({
  localParties,
  serverParties,
  serverError,
  openingPartyId,
  onOpenServer,
  onOpenLocal,
}: ExistingPartiesProps): ReactElement | null {
  // Server mode: render the server's parties list. Local mode: render
  // every known party from Dexie (including ones not currently loaded
  // in memory).
  if (isServerMode) {
    if (serverError !== null) {
      return (
        <section aria-label="Existing parties">
          <p className="text-sm text-destructive">{serverError}</p>
        </section>
      );
    }
    if (serverParties === null) {
      return (
        <section aria-label="Existing parties" className="text-sm text-muted-foreground">
          Loading…
        </section>
      );
    }
    if (serverParties.length === 0) return null;
    return (
      <section aria-label="Existing parties" className="space-y-2">
        {serverParties.map((p) => {
          const isOpening = openingPartyId === p.id;
          const anyOpening = openingPartyId !== null;
          return (
            <button
              type="button"
              key={p.id}
              disabled={anyOpening}
              className="flex w-full items-center justify-between rounded-md border bg-card px-4 py-3 text-left transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => onOpenServer(p.id)}
            >
              <div>
                <p className="font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">
                  {p.roles.join(' + ')} • {p.memberCount} member{p.memberCount === 1 ? '' : 's'}
                </p>
              </div>
              {isOpening ? (
                <span className="text-xs text-muted-foreground">Opening…</span>
              ) : p.lastActivityAt !== null ? (
                <span className="text-xs text-muted-foreground">
                  {new Date(p.lastActivityAt).toLocaleDateString()}
                </span>
              ) : null}
            </button>
          );
        })}
      </section>
    );
  }

  // Local mode: enumerate every known party blob from Dexie.
  if (localParties === null) {
    return (
      <section aria-label="Existing parties" className="text-sm text-muted-foreground">
        Loading…
      </section>
    );
  }
  if (localParties.length === 0) return null;
  return (
    <section aria-label="Existing parties" className="space-y-2">
      {localParties.map((p) => {
        const isOpening = openingPartyId === p.id;
        const anyOpening = openingPartyId !== null;
        return (
          <button
            type="button"
            key={p.id}
            disabled={anyOpening}
            className="flex w-full items-center justify-between rounded-md border bg-card px-4 py-3 text-left transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => onOpenLocal(p.id)}
          >
            <div>
              <p className="font-medium">{p.name}</p>
              <p className="text-xs text-muted-foreground">Local party</p>
            </div>
            {isOpening ? <span className="text-xs text-muted-foreground">Opening…</span> : null}
          </button>
        );
      })}
    </section>
  );
}

interface ActionCardProps {
  icon: ReactElement;
  title: string;
  description: string;
  onClick?: () => void;
  disabled?: boolean;
}

function ActionCard({
  icon,
  title,
  description,
  onClick,
  disabled,
}: ActionCardProps): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col gap-2 rounded-md border bg-card p-4 text-left transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </button>
  );
}
