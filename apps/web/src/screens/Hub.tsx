import { useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  Clock,
  Coins,
  Crown,
  Link as LinkIcon,
  Package,
  Play,
  UserPlus,
  Users,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import { z } from 'zod';

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
import { useSession } from '@/store/session';
import { useHubLayoutStore } from '@/store/hubLayout';
import { seedCatalogIfNeeded } from '@/store/seed';
import { pullState } from '@/sync/client';
import { flush as flushSyncQueue } from '@/sync/queue';
import { appStateSchema, transactionLogEntrySchema, type PartyListItem } from '@app/shared';
import { currency } from '@app/rules';

/**
 * A party the Hub can list + open, normalized across server + local mode.
 * Server rows carry role/member/activity metadata; local rows carry only
 * id + name. R10.3 — both modes now also carry per-party glance stats
 * (`itemCount` = total item quantity across all the party's stashes;
 * `totalCp` = integer copper-equivalent of all stash currency). Server
 * mode gets them from `GET /sync/parties`; local mode computes them from
 * the keyed Dexie AppState blob. Optional to cover the pre-load window.
 */
interface HubParty {
  id: string;
  name: string;
  /** server mode only */
  roles?: readonly string[];
  memberCount?: number;
  lastActivityAt?: string | null;
  /** R10.3 — both modes once loaded */
  itemCount?: number;
  totalCp?: number;
}

/**
 * R10.3 — per-party glance stats (total item quantity + gp-equivalent).
 * The wire / Dexie blob carries integer `totalCp`; we divide to gp for
 * display (SECURITY §3.2 — CP-integer only). Rendered as its own icon row
 * under the party subtitle. Module-level so both `PartyChooser` (hero) and
 * `PartyListDetail` can use it without prop-threading. Returns null until
 * the stats have loaded.
 */
function partyStats(p: HubParty): ReactElement | null {
  if (p.itemCount === undefined || p.totalCp === undefined) return null;
  const gp = (p.totalCp / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
  return (
    <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
      <span className="inline-flex items-center gap-1">
        <Package className="h-3 w-3" aria-hidden="true" />
        {p.itemCount} items
      </span>
      <span className="inline-flex items-center gap-1">
        <Coins className="h-3 w-3" aria-hidden="true" />
        {gp} gp
      </span>
    </div>
  );
}

/**
 * RH5.2 — Zod schema for the persisted blob shape, mirroring
 * `hydrate.ts`. Used by `openLocalParty` below to fail-fast on a
 * corrupted party blob rather than casting `unknown` and hydrating the
 * store with garbage.
 */
const persistedBlobSchema = z.object({
  appState: z.union([appStateSchema, z.null()]),
  log: z.array(transactionLogEntrySchema),
});

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
  const sessionUser = useSession((s) => s.user);
  const hubLayout = useHubLayoutStore((s) => s.layout);
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
  const [localParties, setLocalParties] = useState<
    { id: string; name: string; itemCount: number; totalCp: number }[] | null
  >(null);

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
      const rows: { id: string; name: string; itemCount: number; totalCp: number }[] = [];
      for (const id of ids) {
        try {
          const raw = (await loadAppState(id)) as {
            appState?: {
              party?: { id: string; name: string };
              items?: { quantity: number }[];
              currencies?: { cp: number; sp: number; ep: number; gp: number; pp: number }[];
            };
          } | null;
          const party = raw?.appState?.party;
          if (party !== undefined && typeof party.name === 'string') {
            // R10.3 — glance stats over the whole local party. A local blob
            // holds exactly one party's state, so every item/currency row
            // belongs to it (no cross-party filter needed).
            const items = raw?.appState?.items ?? [];
            const currencies = raw?.appState?.currencies ?? [];
            const itemCount = items.reduce((n, i) => n + i.quantity, 0);
            const totalCp = currencies.reduce((n, c) => n + currency.toCopper(c), 0);
            rows.push({ id, name: party.name, itemCount, totalCp });
          }
        } catch {
          // Skip — the per-party listing is non-critical.
        }
      }
      // Also include the currently-loaded party if it hasn't been saved
      // yet (fresh-create window before the debounce fires).
      if (loadedParty !== null && !rows.some((r) => r.id === loadedParty.id)) {
        rows.push({ id: loadedParty.id, name: loadedParty.name, itemCount: 0, totalCp: 0 });
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
      // RH5.2 — Zod-parse the raw blob before hydrating. A corrupted
      // party blob (schema mismatch post-RH0.1's .strict()) surfaces
      // as a user-visible error rather than crashing the store with
      // an invalid shape.
      const parsed = persistedBlobSchema.safeParse(raw);
      if (!parsed.success) {
        console.error('openLocalParty: persisted blob failed schema validation', {
          partyId,
          error: parsed.error,
        });
        toast.error("This party's local data is corrupted.");
        return;
      }
      useStore.getState().hydrate({
        appState: parsed.data.appState,
        log: parsed.data.log,
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
      void dispatchMintingAction({
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
      void dispatchMintingAction({
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

  // Normalized party list + loading/error flags across both modes.
  const parties: HubParty[] | null = isServerMode
    ? serverParties === null
      ? null
      : serverParties.map((p) => ({
          id: p.id,
          name: p.name,
          roles: p.roles,
          memberCount: p.memberCount,
          lastActivityAt: p.lastActivityAt,
          itemCount: p.itemCount,
          totalCp: p.totalCp,
        }))
    : localParties;
  const partiesLoading = parties === null;
  const openParty = isServerMode
    ? (id: string) => void openServerParty(id)
    : (id: string) => void openLocalParty(id);

  return (
    <div className="mx-auto max-w-4xl space-y-8 px-4 py-10">
      {/* R9.11 — Hero medallion + welcome (server mode has an account
          identity; local mode gets a plain heading). Medallion → Settings. */}
      {sessionUser !== null ? (
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={() => void navigate('/settings')}
            aria-label="Account settings"
            className="group relative outline-none"
          >
            <span className="absolute -inset-1 rounded-full bg-primary/20 opacity-0 blur transition group-hover:opacity-100" />
            <span className="relative grid h-20 w-20 place-items-center rounded-full border-2 border-primary/40 bg-gradient-to-br from-primary/15 to-surface-2 shadow-e2 ring-2 ring-surface transition group-hover:border-primary/70">
              <span className="font-display text-3xl font-bold text-primary">
                {sessionUser.displayName.charAt(0).toUpperCase()}
              </span>
            </span>
          </button>
          <div className="text-center">
            <p className="text-sm text-muted-foreground">Welcome back, {sessionUser.displayName}</p>
            <h1 className="font-display text-3xl font-bold tracking-tight">Ready to play?</h1>
          </div>
        </div>
      ) : (
        <header>
          <h1 className="font-display text-3xl font-bold tracking-tight">Your parties</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose a party to open, or start something new.
          </p>
        </header>
      )}

      <PartyChooser
        layout={hubLayout}
        parties={parties}
        loading={partiesLoading}
        serverError={serverError}
        openingPartyId={openingPartyId}
        onOpen={openParty}
        onNew={() => setDialog('create-party')}
        onSolo={() => setDialog('create-solo')}
        onJoin={isServerMode ? () => setDialog('join') : null}
      />

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
                <DialogTitle className="font-display">Join a party</DialogTitle>
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
                <DialogTitle className="font-display">Create a solo party</DialogTitle>
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
                <DialogTitle className="font-display">Create a party</DialogTitle>
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
                <DialogTitle className="font-display">Will you also play a character?</DialogTitle>
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
                <DialogTitle className="font-display">Create your character</DialogTitle>
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

interface PartyChooserProps {
  layout: 'hero' | 'list';
  parties: HubParty[] | null;
  loading: boolean;
  serverError: string | null;
  openingPartyId: string | null;
  onOpen: (partyId: string) => void;
  onNew: () => void;
  onSolo: () => void;
  /** null in local mode (join is server-only). */
  onJoin: (() => void) | null;
}

/**
 * R9.11 — the Hub party chooser. Two layouts driven by the `hubLayout`
 * preference (Settings → Appearance):
 *   - `hero` (default) — a big "Continue" card for the most-recently-active
 *     party + a grid of the others (HubHeroNoPip mockup).
 *   - `list` — a master party list beside a detail pane (HubListDetail).
 * The "start something new" actions (Solo / Create party / Join) always
 * render below, and are the whole surface when there are no parties yet.
 */
function PartyChooser({
  layout,
  parties,
  loading,
  serverError,
  openingPartyId,
  onOpen,
  onNew,
  onSolo,
  onJoin,
}: PartyChooserProps): ReactElement {
  const anyOpening = openingPartyId !== null;

  // Most-recently-active first (server: by lastActivityAt; local: input order).
  const sorted = [...(parties ?? [])].sort((a, b) => {
    const at = a.lastActivityAt ?? '';
    const bt = b.lastActivityAt ?? '';
    return at < bt ? 1 : at > bt ? -1 : 0;
  });

  function partySubtitle(p: HubParty): string {
    const bits: string[] = [];
    if (p.roles !== undefined) bits.push(p.roles.join(' + '));
    if (p.memberCount !== undefined) {
      bits.push(p.memberCount === 1 ? 'Solo' : `${p.memberCount} members`);
    } else {
      bits.push('Local party');
    }
    if (p.lastActivityAt != null) bits.push(new Date(p.lastActivityAt).toLocaleDateString());
    return bits.join(' · ');
  }

  const newActions = (
    <div className="flex flex-wrap justify-center gap-3">
      <Button type="button" variant="outline" onClick={onSolo}>
        <UserPlus className="h-4 w-4" />
        Solo
      </Button>
      <Button type="button" variant="outline" onClick={onNew}>
        <Users className="h-4 w-4" />
        Create party
      </Button>
      <Button
        type="button"
        variant="outline"
        {...(onJoin !== null ? { onClick: onJoin } : { disabled: true })}
        title={onJoin === null ? 'Available when running against a hosted server.' : undefined}
      >
        <LinkIcon className="h-4 w-4" />
        Join party
      </Button>
    </div>
  );

  if (serverError !== null) {
    return (
      <section aria-label="Existing parties" className="space-y-6">
        <p className="text-sm text-destructive">{serverError}</p>
        {newActions}
      </section>
    );
  }

  if (loading) {
    return (
      <section aria-label="Existing parties" className="space-y-6">
        <p className="text-sm text-muted-foreground">Loading…</p>
        {newActions}
      </section>
    );
  }

  // Empty state — no parties yet. The "start new" actions are the whole
  // surface (matches the original Hub's create-first-party CTA).
  if (sorted.length === 0) {
    return (
      <section aria-label="New party" className="space-y-4">
        <div className="rounded-xl border border-dashed border-border bg-surface-2/40 p-10 text-center text-sm text-muted-foreground">
          No parties yet. Start a solo run or create a party others can join.
        </div>
        {newActions}
      </section>
    );
  }

  if (layout === 'list') {
    return (
      <PartyListDetail
        parties={sorted}
        openingPartyId={openingPartyId}
        onOpen={onOpen}
        partySubtitle={partySubtitle}
        newActions={newActions}
      />
    );
  }

  // Hero layout (default). First party = "Continue"; the rest are a grid.
  const [recent, ...others] = sorted;
  return (
    <section aria-label="Existing parties" className="space-y-8">
      <div className="overflow-hidden rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-surface p-6 shadow-e2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-primary">
          <Clock className="h-3 w-3" aria-hidden="true" />
          Continue
        </div>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-display text-2xl font-bold tracking-tight">{recent!.name}</h2>
            <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
              {recent!.roles?.includes('dm') ? (
                <span className="inline-flex items-center gap-1 text-primary">
                  <Crown className="h-3 w-3" aria-hidden="true" /> DM
                </span>
              ) : null}
              {partySubtitle(recent!)}
            </p>
            {partyStats(recent!)}
          </div>
          <Button
            type="button"
            disabled={anyOpening}
            onClick={() => onOpen(recent!.id)}
            className="gap-2"
          >
            <Play className="h-4 w-4" aria-hidden="true" />
            {openingPartyId === recent!.id ? 'Opening…' : 'Enter party'}
          </Button>
        </div>
      </div>

      {others.length > 0 ? (
        <div className="space-y-2">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Your other parties
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {others.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={anyOpening}
                onClick={() => onOpen(p.id)}
                aria-label={`Open ${p.name}`}
                className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface-2 font-display text-xs font-bold text-muted-foreground">
                  {p.name.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {openingPartyId === p.id ? 'Opening…' : partySubtitle(p)}
                  </div>
                  {partyStats(p)}
                </div>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {newActions}
    </section>
  );
}

/** List + detail layout for the Hub (HubListDetail mockup). */
function PartyListDetail({
  parties,
  openingPartyId,
  onOpen,
  partySubtitle,
  newActions,
}: {
  parties: HubParty[];
  openingPartyId: string | null;
  onOpen: (partyId: string) => void;
  partySubtitle: (p: HubParty) => string;
  newActions: ReactElement;
}): ReactElement {
  const [selectedId, setSelectedId] = useState(parties[0]!.id);
  const anyOpening = openingPartyId !== null;
  const selected = parties.find((p) => p.id === selectedId) ?? parties[0]!;

  return (
    <section aria-label="Existing parties" className="space-y-4">
      <div className="grid gap-6 md:grid-cols-[18rem_1fr]">
        <div className="space-y-2">
          {parties.map((p) => {
            const active = p.id === selected.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedId(p.id)}
                aria-label={`Select ${p.name}`}
                aria-pressed={active}
                className={
                  'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition ' +
                  (active
                    ? 'border-primary/50 bg-primary/5'
                    : 'border-border bg-surface hover:bg-surface-2')
                }
              >
                <div
                  className={
                    'grid h-9 w-9 shrink-0 place-items-center rounded-md font-display text-sm font-bold ' +
                    (active ? 'bg-primary/15 text-primary' : 'bg-surface-2 text-muted-foreground')
                  }
                >
                  {p.name.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {partySubtitle(p)}
                  </div>
                </div>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </button>
            );
          })}
        </div>

        <div className="rounded-lg border border-border bg-surface p-6 shadow-e1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {selected.roles?.includes('dm') ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                  <Crown className="h-3 w-3" aria-hidden="true" /> DM
                </span>
              ) : null}
              <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">
                {selected.name}
              </h2>
              <p className="text-sm text-muted-foreground">{partySubtitle(selected)}</p>
              {partyStats(selected)}
            </div>
            <Button
              type="button"
              disabled={anyOpening}
              onClick={() => onOpen(selected.id)}
              className="gap-2"
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              {openingPartyId === selected.id ? 'Opening…' : 'Enter'}
            </Button>
          </div>
        </div>
      </div>

      {newActions}
    </section>
  );
}
