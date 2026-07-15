import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import { Coins, Copy, Crown, LogOut, RefreshCw, Shield, UserMinus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useCurrentPartyId } from '@/lib/useCurrentPartyId';
import { useDispatch } from '@/lib/useDispatch';
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
import { EconomyPresetField } from '@/components/settings/EconomyPresetField';
import { CharacterForm, type CharacterFormOutput } from '@/components/CharacterForm';
import { RoleBadge } from '@/components/RoleBadge';
import { ApiError, kickPlayerApi, leavePartyApi, listPartyMembers, rotateInvite } from '@/lib/api';
import { isServerMode } from '@/lib/serverMode';
import { getOwnCharacter } from '@/lib/ownCharacter';
import { useStore, flushPendingPersist, dispatchMintingAction } from '@/store';
import { flush as flushSyncQueue } from '@/sync/queue';
import type { PartyMemberItem } from '@app/shared';

/**
 * R4.1.e — Party Settings screen (§5.15).
 *
 * Sections (top to bottom):
 *   - Party name + Character name rename (R4.1-followup: moved from
 *     global Settings into the per-party screen because both are
 *     party-scoped). Character rename hidden when the active party has
 *     no character (DM-only bootstrap).
 *   - Members list with role badges (DM / Player). One row per
 *     `(userId, role)` tuple; the DM-player solo creator surfaces as
 *     two rows by design (matches OUTLINE §4 composite-key invariant).
 *   - Invite code: display current + Copy + DM-only Rotate button.
 *   - DM-only kick action per non-DM member row.
 *   - Leave-party CTA at the bottom (any active member). Surfaces
 *     "Archived" confirmation when the leaver is the sole member.
 *
 * The server-only sections (members / invite / kick / leave) only
 * render in server mode — local mode users see just the rename
 * surfaces, which is everything per-party-scoped they can edit
 * without a multi-member party + invite-code infrastructure.
 */
export function PartySettings(): ReactElement {
  const navigate = useNavigate();
  const urlPartyId = useCurrentPartyId();
  const dispatch = useDispatch();
  const partyId = useStore(useShallow((s) => (s.appState !== null ? s.appState.party.id : null)));
  const partyName = useStore(
    useShallow((s) => (s.appState !== null ? s.appState.party.name : null)),
  );
  const bankerUserId = useStore(
    useShallow((s) => (s.appState !== null ? s.appState.party.bankerUserId : null)),
  );
  const encumbranceRule = useStore(
    useShallow((s) => (s.appState !== null ? s.appState.party.encumbranceRule : null)),
  );
  const enforceEncumbrance = useStore(
    useShallow((s) => (s.appState !== null ? s.appState.party.enforceEncumbrance : null)),
  );
  const priceModifier = useStore(
    useShallow((s) => (s.appState !== null ? s.appState.party.priceModifier : null)),
  );
  const baseCurrency = useStore(
    useShallow((s) => (s.appState !== null ? s.appState.party.baseCurrency : null)),
  );
  // BUG-011 — DM check that works in local mode (before the server-side
  // `members` list resolves). Reads the actor's active memberships to
  // decide whether the encumbrance section renders as an editor or a
  // read-only summary. In server mode this matches the server-authored
  // members list once it resolves.
  const iAmDmFromLocalMemberships = useStore(
    useShallow((s) => {
      if (s.appState === null) return false;
      const myId = s.appState.user.id;
      return s.appState.memberships.some(
        (m) => m.userId === myId && m.role === 'dm' && m.leftAt === null,
      );
    }),
  );
  const character = useStore(useShallow((s) => getOwnCharacter(s.appState)));
  const myUserId = useStore(useShallow((s) => (s.appState !== null ? s.appState.user.id : null)));

  const [members, setMembers] = useState<PartyMemberItem[] | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmKick, setConfirmKick] = useState<PartyMemberItem | null>(null);
  const [confirmTransferDm, setConfirmTransferDm] = useState<PartyMemberItem | null>(null);
  const [createCharacterOpen, setCreateCharacterOpen] = useState(false);

  // Load members + invite code on mount (server mode only).
  useEffect(() => {
    if (partyId === null || !isServerMode) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await listPartyMembers(partyId);
        if (!cancelled) {
          setMembers(res.members);
          setInviteCode(res.inviteCode);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.code === 'unauthenticated') {
          void navigate('/login', { replace: true });
          return;
        }
        // R4.1-followup — if the server says the party doesn't exist
        // (404 party_not_found) it means we're holding a stale active-
        // party pointer (e.g. the party was created pre-sync-queue-fix
        // and never persisted server-side, or the user is signed in as
        // a different account that doesn't own this id). Send the user
        // back to the Hub with a clear message instead of stranding
        // them on a broken settings screen.
        if (err instanceof ApiError && (err.code === 'party_not_found' || err.status === 404)) {
          toast.error('That party no longer exists on the server.');
          void navigate('/hub', { replace: true });
          return;
        }
        setLoadError(err instanceof Error ? err.message : 'Could not load party members.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [partyId, navigate]);

  if (partyId === null || partyName === null || myUserId === null) {
    return (
      <div className="mx-auto max-w-3xl py-10">
        <p className="text-sm text-muted-foreground">No party selected.</p>
      </div>
    );
  }

  const myRoles = new Set(members?.filter((m) => m.userId === myUserId).map((m) => m.role));
  const iAmDm = myRoles.has('dm');

  async function copyInvite(): Promise<void> {
    if (inviteCode === null) return;
    try {
      await navigator.clipboard.writeText(inviteCode);
      toast.success('Invite code copied.');
    } catch {
      toast.error('Could not copy — copy it manually.');
    }
  }

  async function handleRotate(): Promise<void> {
    if (partyId === null) return;
    setBusy('rotate');
    try {
      const res = await rotateInvite(partyId);
      setInviteCode(res.inviteCode);
      toast.success('New invite code generated.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not rotate invite code.');
    } finally {
      setBusy(null);
    }
  }

  async function handleKick(target: PartyMemberItem): Promise<void> {
    if (partyId === null) return;
    setBusy(`kick-${target.userId}`);
    try {
      await kickPlayerApi(partyId, { kickedUserId: target.userId });
      setMembers((prev) => (prev !== null ? prev.filter((m) => m.userId !== target.userId) : prev));
      toast.success(`${target.displayName} was removed from the party.`);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'cannot_kick_dm') {
        toast.error('Cannot kick the DM. Transfer DM first.');
      } else {
        toast.error(err instanceof Error ? err.message : 'Could not kick player.');
      }
    } finally {
      setBusy(null);
      setConfirmKick(null);
    }
  }

  async function handleLeave(): Promise<void> {
    if (partyId === null) return;
    setBusy('leave');
    try {
      const res = await leavePartyApi(partyId);
      if (res.archived) {
        toast.success('Party archived. Your data is preserved.');
      } else {
        toast.success('You left the party.');
      }
      void navigate('/hub', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'sole_dm_must_transfer_first') {
        toast.error('Transfer DM first — you are the only DM.');
      } else {
        toast.error(err instanceof Error ? err.message : 'Could not leave party.');
      }
      setBusy(null);
      setConfirmLeave(false);
    }
  }

  /**
   * R4.2.e — appoint the supplied player as Banker. Dispatches
   * `appoint-banker`; the reducer (§3.14) enforces the invariants
   * (DM-only, target must be an active player, memberCount ≥ 2, no
   * existing Banker). Errors surface as toasts.
   */
  function handleAppointBanker(targetUserId: string): void {
    setBusy(`banker-${targetUserId}`);
    void dispatch(
      {
        type: 'appoint-banker',
        payload: { bankerUserId: targetUserId },
      },
      {
        onSuccess: () => toast.success('Banker appointed.'),
        onRejection: (_code, message) => toast.error(message ?? 'Could not appoint Banker.'),
      },
    ).finally(() => {
      setBusy(null);
    });
  }

  /**
   * R4.2.e — revoke the current Banker. Reducer emits a `revoke-banker`
   * entry with `reason: 'manual'`. UI-driven revocations are always
   * `'manual'`; the other enum values (`'left-party'`, `'kicked'`,
   * `'reassigned'`) are emitted from cascade paths, not this button.
   */
  function handleRevokeBanker(): void {
    setBusy('banker-revoke');
    void dispatch(
      {
        type: 'revoke-banker',
        payload: { reason: 'manual' },
      },
      {
        onSuccess: () => toast.success('Banker revoked.'),
        onRejection: (_code, message) => toast.error(message ?? 'Could not revoke Banker.'),
      },
    ).finally(() => {
      setBusy(null);
    });
  }

  /**
   * R4.3.e — transfer the DM role to another active player. Dispatches
   * `dm-transfer`; the reducer (R4.3.a) enforces §3.14 invariants
   * (DM-only, target is active player, no self-transfer) + swaps
   * memberships + auto-clears Banker if the incoming DM was the Banker.
   * Errors surface as toasts. On success, refresh the local members
   * list from the server so the DM/player badges reflect the swap.
   */
  async function handleTransferDm(target: PartyMemberItem): Promise<void> {
    if (partyId === null) return;
    setBusy(`transfer-dm-${target.userId}`);
    try {
      const outcome = await dispatch({
        type: 'dm-transfer',
        payload: { newDmUserId: target.userId },
      });
      if (!outcome.ok) {
        toast.error(outcome.message ?? 'Could not transfer DM role.');
        return;
      }
      // Refresh the member list from the server so role badges + DM
      // affordances update after the swap. In local-mode the store's
      // reactive read is enough; in server-mode we re-fetch to align
      // with the authoritative list.
      if (isServerMode) {
        try {
          const res = await listPartyMembers(partyId);
          setMembers(res.members);
        } catch {
          // Non-fatal; user can refresh manually. The dispatch already
          // succeeded server-side (or the sync queue will retry).
        }
      }
      toast.success(`DM role transferred to ${target.displayName}.`);
    } finally {
      setBusy(null);
      setConfirmTransferDm(null);
    }
  }

  if (loadError !== null) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 py-10">
        <p className="text-sm text-destructive">{loadError}</p>
      </div>
    );
  }

  /**
   * R4.1.f — Submit handler for the "Create your character" CTA. Covers
   * three flows that all land at the same end state:
   *   1. Joiner who used POST /parties/join (their player row exists
   *      with characterId: null).
   *   2. DM-only DM adding their character later (no player row).
   *   3. User recreating after `delete-character` cleared their pointer.
   *
   * Pattern mirrors Hub's `handleCreateSubmit`: dispatch, flush, re-read
   * (so the server-canonical character id replaces the client's
   * optimistic id), navigate.
   */
  async function handleCreateCharacterSubmit(values: CharacterFormOutput): Promise<void> {
    // R8.5 — capture the outcome promise but DO NOT await it before the
    // flush: in server mode the outcome only resolves once the sync
    // queue POSTs, and `flushSyncQueue()` is what drives that POST.
    // Awaiting first would gate the flush on an outcome that needs the
    // flush. Fire the dispatch (enqueues), flush to land the POST, THEN
    // read the settled outcome to branch success/rejection.
    const outcomePromise = dispatchMintingAction({ type: 'create-character', payload: values });
    await flushPendingPersist();
    if (isServerMode) {
      await flushSyncQueue();
    }
    const outcome = await outcomePromise;
    if (!outcome.ok) {
      toast.error(outcome.message ?? 'Could not create character');
      return;
    }
    setCreateCharacterOpen(false);
    const canonical = useStore.getState().appState;
    const id = getOwnCharacter(canonical)?.id;
    if (id !== undefined) {
      void navigate(`/party/${urlPartyId}/character/${id}`, { replace: true });
    }
  }

  // Server-mode loading: members + invite code are async-fetched. We
  // still render the rename surfaces synchronously below; the
  // server-only block toggles between "Loading…" and the full UI.
  const serverDataLoading = isServerMode && (members === null || inviteCode === null);

  return (
    <div className="mx-auto max-w-3xl space-y-4 py-10">
      <header className="space-y-1">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Shield className="h-3.5 w-3.5" aria-hidden="true" /> Party settings
        </div>
        <h1 className="font-display text-2xl font-bold tracking-tight">{partyName}</h1>
        <p className="text-sm text-muted-foreground">
          {isServerMode
            ? 'Members, invite code, house rules, and leave-party controls.'
            : 'Rename your party and character; set house rules & economy.'}
        </p>
      </header>

      {/* Server-only Members + Invite sections, rendered FIRST (members-
          first IA per CHARTER). Local mode has no member list / invite. */}
      {isServerMode && !serverDataLoading ? (
        <>
          <Section
            title={`Members (${new Set(members!.map((m) => m.userId)).size})`}
            ariaLabel="Members"
            desc="Appoint a Banker, remove a player, or transfer the DM role."
          >
            <ul className="-my-1 divide-y divide-border">
              {members!.map((m) => {
                const isMe = m.userId === myUserId;
                const isKickable = iAmDm && !isMe && m.role !== 'dm';
                const kickBusy = busy === `kick-${m.userId}`;
                // R4.2.e — Banker CTAs. Only meaningful when the party
                // has 2+ unique members (solo skips the Banker concept
                // per OUTLINE §8.2). DM controls appoint/revoke; the
                // DM's own player row cannot become Banker (§3.14).
                const uniqueMemberCount = new Set(members!.map((mm) => mm.userId)).size;
                const isSolo = uniqueMemberCount < 2;
                const isThisRowBanker = bankerUserId !== null && m.userId === bankerUserId;
                const canBeAppointed =
                  iAmDm && !isSolo && !isMe && m.role === 'player' && bankerUserId === null;
                const canBeRevoked = iAmDm && !isSolo && !isMe && isThisRowBanker;
                const bankerBusy = busy?.startsWith('banker-') === true;
                // R4.3.e — Transfer DM CTA. DM-only, target is an
                // active non-DM player (§3.14 + §8.3). One row per
                // (userId, role); the target's player row is where
                // the button lives (transferring hands over the dm
                // role while leaving the player row untouched).
                const canBeTransferredTo = iAmDm && !isSolo && !isMe && m.role === 'player';
                const transferDmBusy = busy === `transfer-dm-${m.userId}`;
                return (
                  <li key={`${m.userId}-${m.role}`} className="flex items-center gap-3 py-2.5">
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                      {m.displayName.charAt(0)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-sm font-medium">
                        {m.displayName}
                        {isMe ? (
                          <span className="text-[11px] font-normal text-muted-foreground">
                            (you)
                          </span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <RoleBadge role={m.role} />
                        {isThisRowBanker && m.role === 'player' ? (
                          <RoleBadge role="banker" />
                        ) : null}
                        {m.characterName !== null && m.characterId !== null ? (
                          <button
                            type="button"
                            onClick={() =>
                              void navigate(`/party/${urlPartyId}/character/${m.characterId!}`)
                            }
                            className="text-xs text-muted-foreground underline-offset-2 hover:underline focus-visible:underline"
                            aria-label={`Open ${m.characterName}'s character sheet`}
                          >
                            — {m.characterName}
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {canBeAppointed ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={bankerBusy}
                          onClick={() => handleAppointBanker(m.userId)}
                        >
                          <Coins className="mr-1 h-4 w-4" />
                          Make Banker
                        </Button>
                      ) : null}
                      {canBeRevoked ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={bankerBusy}
                          onClick={handleRevokeBanker}
                        >
                          <Coins className="mr-1 h-4 w-4" />
                          Revoke Banker
                        </Button>
                      ) : null}
                      {canBeTransferredTo ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={transferDmBusy || busy !== null}
                          onClick={() => setConfirmTransferDm(m)}
                        >
                          <Crown className="mr-1 h-4 w-4" />
                          Transfer DM
                        </Button>
                      ) : null}
                      {isKickable ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={kickBusy || busy !== null}
                          onClick={() => setConfirmKick(m)}
                        >
                          <UserMinus className="mr-1 h-4 w-4" />
                          Kick
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
            {new Set(members!.map((m) => m.userId)).size >= 2 ? (
              <p className="mt-2 text-[11px] text-muted-foreground">
                The DM cannot be appointed Banker. Removing a player moves their items and currency
                to Recovered Loot.
              </p>
            ) : null}
          </Section>

          <Section
            title="Invite code"
            ariaLabel="Invite code"
            desc="Share to let players join. Rotating invalidates the old code."
          >
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-sm tracking-wider">
                {inviteCode}
              </code>
              <Button variant="outline" size="sm" onClick={() => void copyInvite()}>
                <Copy className="mr-1 h-4 w-4" />
                Copy
              </Button>
              {iAmDm ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy === 'rotate'}
                  onClick={() => void handleRotate()}
                >
                  <RefreshCw className="mr-1 h-4 w-4" />
                  Rotate
                </Button>
              ) : null}
            </div>
          </Section>
        </>
      ) : null}

      {/* Always-on rename block (R4.1-followup — moved from global
          Settings). Character rename hidden when there's no character
          (DM-only bootstrap). */}
      <Section
        title="Names"
        ariaLabel="Names"
        desc={`Rename your party${character !== null ? ' or character' : ''}. Changes are logged.`}
      >
        <div className="space-y-4">
          <RenameField
            target="party"
            entityId={partyId}
            currentName={partyName}
            label="Party name"
          />
          {character !== null ? (
            <RenameField
              target="character"
              entityId={character.id}
              currentName={character.name}
              label="Character name"
            />
          ) : null}
        </div>
      </Section>

      {/* BUG-011 (2026-07-06) — Party-wide encumbrance house rule
          (OUTLINE §3.3 + §3.6). Moved here from global /settings.
          DM edits; non-DMs see a read-only summary. Applies to every
          character's CapacityBar in the party. */}
      {encumbranceRule !== null && enforceEncumbrance !== null ? (
        <Section
          title="House rules"
          ariaLabel="Encumbrance"
          desc="Pick how every Inventory in this party handles carrying capacity."
        >
          {iAmDmFromLocalMemberships ? (
            <EncumbranceRuleField
              partyId={partyId}
              currentRule={encumbranceRule}
              currentEnforce={enforceEncumbrance}
            />
          ) : (
            <p className="text-sm">
              Current rule:{' '}
              <span className="font-medium">
                {encumbranceRule === 'off'
                  ? 'Off (no capacity limits)'
                  : encumbranceRule === 'phb'
                    ? 'PHB default'
                    : 'Variant'}
              </span>
              {encumbranceRule !== 'off' && enforceEncumbrance ? (
                <span className="text-muted-foreground"> · enforced</span>
              ) : null}
              . The DM sets this for the whole party.
            </p>
          )}
        </Section>
      ) : null}

      {/* R6.1 — Per-party economy controls (OUTLINE §3.5). DM edits;
          non-DMs see a read-only summary. Applies to Catalog Browser
          prices (via `pricing.ts`) and — post R6.2 — purchase/sale. */}
      {priceModifier !== null && baseCurrency !== null ? (
        <Section
          title="Economy"
          ariaLabel="Economy"
          desc="Set the campaign's currency standard. Scales PHB / DMG prices; homebrew keeps its typed cost."
        >
          {iAmDmFromLocalMemberships ? (
            <EconomyPresetField
              partyId={partyId}
              currentPriceModifier={priceModifier}
              currentBaseCurrency={baseCurrency}
            />
          ) : (
            <p className="text-sm">
              Current economy:{' '}
              <span className="font-medium">
                {String(priceModifier)}× / {baseCurrency}
              </span>
              . The DM sets this for the whole party.
            </p>
          )}
        </Section>
      ) : null}

      {/* R4.1.f — "Create your character" CTA. Visible whenever the
          actor is in a party but has no character yet. Three use cases
          land here:
            - Joiner who just used POST /parties/join (membership row
              exists with characterId: null).
            - DM-only DM who bootstrapped without a character.
            - User recreating after `delete-character`.
          All three dispatch the same `create-character` action against
          the existing state; the reducer's R4.1.f post-bootstrap branch
          picks the right path. The form lives in a modal dialog so the
          CTA stays compact on the settings page. */}
      {character === null && partyId !== null ? (
        <Section
          title="Create your character"
          ariaLabel="Create your character"
          desc="You're in this party but haven't created your character yet."
        >
          <Button onClick={() => setCreateCharacterOpen(true)}>Create character</Button>
        </Section>
      ) : null}

      {/* Server-only loading + Danger zone (Leave party). Local mode has
          no leave-party flow. */}
      {isServerMode && serverDataLoading ? (
        <p className="text-sm text-muted-foreground">Loading party members…</p>
      ) : isServerMode ? (
        <Section
          title="Danger zone"
          ariaLabel="Leave party"
          desc="Your character's items and currency move to Recovered Loot; if you're the last member, the party is archived."
          danger
        >
          <Button
            variant="destructive"
            size="sm"
            disabled={busy === 'leave'}
            onClick={() => setConfirmLeave(true)}
          >
            <LogOut className="mr-1 h-4 w-4" />
            Leave party
          </Button>
        </Section>
      ) : null}

      <Dialog open={createCharacterOpen} onOpenChange={(o) => setCreateCharacterOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Create your character</DialogTitle>
            <DialogDescription>
              Enter your character&apos;s details. They&apos;ll get their own Inventory and currency
              in this party.
            </DialogDescription>
          </DialogHeader>
          <CharacterForm
            onSubmit={handleCreateCharacterSubmit}
            onCancel={() => setCreateCharacterOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={confirmLeave} onOpenChange={(o) => !o && setConfirmLeave(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Leave this party?</DialogTitle>
            <DialogDescription>
              Your character&apos;s items and currency will be moved to Recovered Loot. This cannot
              be undone (but the party log will still record everything).
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmLeave(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy === 'leave'}
              onClick={() => void handleLeave()}
            >
              Yes, leave party
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmKick !== null} onOpenChange={(o) => !o && setConfirmKick(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">
              Kick {confirmKick !== null ? confirmKick.displayName : ''}?
            </DialogTitle>
            <DialogDescription>
              Their character&apos;s items and currency will be moved to Recovered Loot. This cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmKick(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy?.startsWith('kick-')}
              onClick={() => {
                if (confirmKick !== null) void handleKick(confirmKick);
              }}
            >
              Yes, kick
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmTransferDm !== null}
        onOpenChange={(o) => !o && setConfirmTransferDm(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">
              Transfer DM to {confirmTransferDm !== null ? confirmTransferDm.displayName : ''}?
            </DialogTitle>
            <DialogDescription>
              You will become a regular player.{' '}
              {confirmTransferDm !== null ? confirmTransferDm.displayName : 'They'} will take over
              DM responsibilities. If they are the current Banker, the Banker role will be cleared
              automatically.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmTransferDm(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy?.startsWith('transfer-dm-')}
              onClick={() => {
                if (confirmTransferDm !== null) void handleTransferDm(confirmTransferDm);
              }}
            >
              Yes, transfer DM
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * R9.10 — framed settings "Section" card (ports the design-lab
 * `settings/kit` Section: a titled header + body, `danger` variant for
 * the destructive zone). The title renders as `<h2>` + carries the
 * section's `aria-label` on the `<section>` so the existing
 * heading/region queries keep resolving.
 */
function Section({
  title,
  desc,
  ariaLabel,
  danger = false,
  children,
}: {
  title: string;
  desc?: string;
  ariaLabel?: string;
  danger?: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <section
      aria-label={ariaLabel ?? title}
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
