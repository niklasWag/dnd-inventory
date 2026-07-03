import { useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import { Copy, RefreshCw, UserMinus, LogOut, Coins, Crown, ArrowLeft } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useCurrentPartyId } from '@/lib/useCurrentPartyId';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { RenameField } from '@/components/settings/RenameField';
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
  const partyId = useStore(useShallow((s) => (s.appState !== null ? s.appState.party.id : null)));
  const partyName = useStore(
    useShallow((s) => (s.appState !== null ? s.appState.party.name : null)),
  );
  const bankerUserId = useStore(
    useShallow((s) => (s.appState !== null ? s.appState.party.bankerUserId : null)),
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
    try {
      useStore.getState().dispatch({
        type: 'appoint-banker',
        payload: { bankerUserId: targetUserId },
      });
      toast.success('Banker appointed.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not appoint Banker.');
    } finally {
      setBusy(null);
    }
  }

  /**
   * R4.2.e — revoke the current Banker. Reducer emits a `revoke-banker`
   * entry with `reason: 'manual'`. UI-driven revocations are always
   * `'manual'`; the other enum values (`'left-party'`, `'kicked'`,
   * `'reassigned'`) are emitted from cascade paths, not this button.
   */
  function handleRevokeBanker(): void {
    setBusy('banker-revoke');
    try {
      useStore.getState().dispatch({
        type: 'revoke-banker',
        payload: { reason: 'manual' },
      });
      toast.success('Banker revoked.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not revoke Banker.');
    } finally {
      setBusy(null);
    }
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
      useStore.getState().dispatch({
        type: 'dm-transfer',
        payload: { newDmUserId: target.userId },
      });
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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not transfer DM role.');
    } finally {
      setBusy(null);
      setConfirmTransferDm(null);
    }
  }

  if (loadError !== null) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 py-10">
        <BackButton onBack={() => void navigate(-1)} />
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
    try {
      dispatchMintingAction({ type: 'create-character', payload: values });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create character');
      return;
    }
    setCreateCharacterOpen(false);
    await flushPendingPersist();
    if (isServerMode) {
      await flushSyncQueue();
    }
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
    <div className="mx-auto max-w-3xl space-y-8 py-10">
      <BackButton onBack={() => void navigate(-1)} />
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Party settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isServerMode
            ? 'Names, members, invite code, and leave-party controls.'
            : 'Rename your party and character.'}
        </p>
      </header>

      {/* Always-on rename block (R4.1-followup — moved from global
          Settings). Character rename hidden when there's no character
          (DM-only bootstrap). */}
      <section aria-label="Names" className="space-y-4 rounded-lg border border-border p-4">
        <div>
          <h2 className="font-semibold">Names</h2>
          <p className="text-sm text-muted-foreground">
            Rename your party{character !== null ? ' or character' : ''}. Changes are logged.
          </p>
        </div>
        <RenameField target="party" entityId={partyId} currentName={partyName} label="Party name" />
        {character !== null ? (
          <RenameField
            target="character"
            entityId={character.id}
            currentName={character.name}
            label="Character name"
          />
        ) : null}
      </section>

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
        <section
          aria-label="Create your character"
          className="flex items-center justify-between gap-4 rounded-lg border border-border p-4"
        >
          <div>
            <h2 className="font-semibold">Create your character</h2>
            <p className="text-sm text-muted-foreground">
              You&apos;re in this party but haven&apos;t created your character yet.
            </p>
          </div>
          <Button onClick={() => setCreateCharacterOpen(true)}>Create character</Button>
        </section>
      ) : null}

      {/* Server-only sections below. Local mode has no member list,
          no invite code, and no leave-party flow. */}
      {!isServerMode ? null : serverDataLoading ? (
        <p className="text-sm text-muted-foreground">Loading party members…</p>
      ) : (
        <>
          <section aria-label="Members" className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Members ({new Set(members!.map((m) => m.userId)).size})
            </h2>
            <ul className="space-y-2">
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
                  <li
                    key={`${m.userId}-${m.role}`}
                    className="flex items-center justify-between rounded-md border bg-card px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{m.displayName}</span>
                      <RoleBadge role={m.role} />
                      {isThisRowBanker && m.role === 'player' ? <RoleBadge role="banker" /> : null}
                      {isMe ? <span className="text-xs text-muted-foreground">(you)</span> : null}
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
                    <div className="flex items-center gap-2">
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
          </section>

          <section aria-label="Invite code" className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Invite code
            </h2>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md border bg-muted px-3 py-2 font-mono text-sm">
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
            <p className="text-xs text-muted-foreground">
              Share this code with someone you want to invite. Rotating invalidates the old code
              immediately.
            </p>
          </section>

          <section aria-label="Leave party" className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Leave party
            </h2>
            <p className="text-xs text-muted-foreground">
              Your character&apos;s items and currency will be moved to Recovered Loot. If
              you&apos;re the last member, the party will be archived.
            </p>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy === 'leave'}
              onClick={() => setConfirmLeave(true)}
            >
              <LogOut className="mr-1 h-4 w-4" />
              Leave party
            </Button>
          </section>
        </>
      )}

      <Dialog open={createCharacterOpen} onOpenChange={(o) => setCreateCharacterOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create your character</DialogTitle>
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
            <DialogTitle>Leave this party?</DialogTitle>
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
            <DialogTitle>Kick {confirmKick !== null ? confirmKick.displayName : ''}?</DialogTitle>
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
            <DialogTitle>
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
 * R4.3.e.1 — small helper for the Back button at the top of the
 * Party Settings screen. Mirrors the ItemDetail / StorageDetail
 * pattern (ghost button + ArrowLeft + short label). Uses
 * `navigate(-1)` for browser-back semantics so the user returns to
 * whichever screen linked them here (Hub / character sheet / etc.),
 * matching the M2.5 UX principle: detail routes own their own Back;
 * `RootLayout` stays minimal.
 */
function BackButton({ onBack }: { onBack: () => void }): ReactElement {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onBack}
      className="-ml-2 h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Back
    </Button>
  );
}
