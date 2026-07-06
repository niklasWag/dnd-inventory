import type { AppState, Party, PartyMembership, TransactionLogEntry } from '../schemas';

import type { Actor, ActorRole } from './index';

/**
 * R3.4.a — derive the actor's role for the §8.1 guard layer.
 *
 * Per SECURITY §2.1: the request body NEVER supplies `actorUserId` or
 * `actorRole`. The server-side flow is:
 *   1. resolve `userId` from the session cookie,
 *   2. read the user's `PartyMembership` row for the target party,
 *   3. call this function with the `Party` row + the membership.
 *
 * Returns `'banker'` iff the user is the Party's denormalized banker
 * (per OUTLINE §3.14); otherwise the membership's `role`. The banker
 * value can ONLY come from `Party.bankerUserId === membership.userId`
 * — never from a `PartyMembership.role = 'banker'` row.
 *
 * MVP note: `party.bankerUserId` is null in MVP-validated state, so
 * this currently returns `membership.role` always. R4.2 broadens the
 * Zod schema for `Party.bankerUserId` and `PartyMembership.role`.
 */
export function deriveActorRole(party: Party, membership: PartyMembership): ActorRole {
  if (party.bankerUserId !== null && party.bankerUserId === membership.userId) {
    return 'banker';
  }
  return membership.role;
}

/**
 * RH2.1a — action-aware `actorRole` derivation shared by the web store
 * dispatch middleware and the server log builder.
 *
 * Prior to RH2.1a the per-action-type mapping lived inline in
 * `apps/web/src/store/index.ts::resolveActor` while the server used the
 * `Actor.role` produced by `deriveActorRole(party, membership)` for
 * every slice. The two sites did NOT agree — the web hard-codes `'dm'`
 * for DM-only actions like `identify` even when the actor's underlying
 * membership role is `player`, while the server relied on the guard
 * layer to reject wrong-role dispatches upstream. This function makes
 * the intent shared: given a state + slice, return the role the actor
 * is wearing for THIS specific action.
 *
 * Three role classes:
 *   - `'dm'`     — DM-only actions per §8.1 (`identify`, `kick-player`,
 *                  `appoint-banker`, `revoke-banker`, `dm-transfer`),
 *                  the bootstrap `create-character` (no banker yet),
 *                  and `seed-catalog` (system-driven per §3.7).
 *   - `'banker'` — the Banker-only `split-evenly` action per §8.1, AND
 *                  player-driven actions where the actor IS the party's
 *                  banker per §3.14 (`state.party.bankerUserId ===
 *                  state.user.id`).
 *   - `'player'` — everything else, when the actor is not the banker.
 *
 * State handling:
 *   - `state === null` is legal ONLY for the bootstrap
 *     `create-character` slice (which carries `userId` + `partyId` on
 *     its payload since the state is being minted right now).
 *     Every other slice requires a populated state and throws.
 *   - Post-bootstrap `create-character` (a joiner or DM-only DM minting
 *     their character against an existing party) is treated as
 *     player-or-banker via `state.user.id` vs `state.party.bankerUserId`.
 */
export function deriveActorRoleForSlice(
  state: AppState | null,
  slice: { type: TransactionLogEntry['type']; payload: unknown },
): ActorRole {
  switch (slice.type) {
    case 'create-character': {
      // Bootstrap: state is null, action is the initial mint. Actor is
      // by definition the party creator = DM. No banker exists yet.
      // Post-bootstrap (state !== null): a joiner or DM-only DM adding
      // their character — treat as player-or-banker.
      if (state === null) return 'dm';
      return playerOrBanker(state);
    }
    case 'join-party': {
      // The join-party server route (POST /parties/join) synthesises this
      // slice inline BEFORE the joining user is a member — so `state` is
      // unavailable there. A brand-new joiner cannot be the party's
      // banker (banker per §3.14 must reference an existing active
      // player), so `'player'` is always correct with null state.
      // When state IS available (reducer-driven leave/kick cascades
      // don't emit join-party, so this branch is only hit by the
      // server's synthesised join), the player-or-banker rule applies.
      if (state === null) return 'player';
      return playerOrBanker(state);
    }
    case 'seed-catalog':
    case 'identify':
    case 'kick-player':
    case 'appoint-banker':
    case 'revoke-banker':
    case 'dm-transfer':
      // DM-only per §8.1. The guard layer rejects non-DM dispatches
      // upstream; this branch records the DM hat the actor is wearing.
      // §3.14 forbids DM === banker, so 'dm' is always structurally
      // correct here regardless of `bankerUserId`.
      if (state === null) {
        throw new Error(`deriveActorRoleForSlice: ${slice.type} requires populated AppState`);
      }
      return 'dm';
    case 'split-evenly':
      // Banker-only per §8.1. Guards reject non-Banker actors upstream;
      // this branch records the Banker hat.
      if (state === null) {
        throw new Error(`deriveActorRoleForSlice: ${slice.type} requires populated AppState`);
      }
      return 'banker';
    default: {
      // Every remaining variant is player-driven. Actor is the banker
      // if `state.party.bankerUserId === state.user.id`, else player.
      if (state === null) {
        throw new Error(`deriveActorRoleForSlice: ${slice.type} requires populated AppState`);
      }
      return playerOrBanker(state);
    }
  }
}

function playerOrBanker(state: NonNullable<AppState>): ActorRole {
  return state.party.bankerUserId === state.user.id ? 'banker' : 'player';
}

/**
 * Solo bypass — when the party has exactly one unique active member, the
 * §8.1 permission matrix is bypassed and the sole member gets the UNION
 * of DM + Player rights per OUTLINE §8.2.
 *
 * "Active" = `leftAt === null` (not yet left). The MVP schema literally
 * encodes `leftAt: z.null()` so this is structurally true for every
 * membership today, but the function is correct for the R4 multi-member
 * future where leftAt becomes settable.
 *
 * Counts distinct `userId`s — a party creator has 2 rows (dm + player)
 * but only 1 unique user, so a solo party is still solo even with the
 * MVP-standard two memberships per user.
 */
export function isSolo(memberships: readonly PartyMembership[]): boolean {
  const active = memberships.filter((m) => m.leftAt === null);
  const userIds = new Set(active.map((m) => m.userId));
  return userIds.size === 1;
}

/**
 * True iff the actor has an active membership in the party. Defensive
 * helper for guards that need to assert party membership before any
 * other check (e.g. `view-other-character` — only meaningful for
 * actors who are members of the party in question).
 */
export function isMember(actor: Actor, memberships: readonly PartyMembership[]): boolean {
  return memberships.some(
    (m) => m.userId === actor.userId && m.partyId === actor.partyId && m.leftAt === null,
  );
}

/**
 * RH3.1 — resolves the currently-active `GameSession.id` for the party
 * held in `state`, or `null` when no session is current (the "Untagged"
 * bucket per OUTLINE §3.12).
 *
 * Called by both middleware stampers (`apps/web/src/store/index.ts`
 * `buildLogEntry` and `apps/server/src/sync/log-builder.ts`
 * `buildLogEntryServer`) to fill `TransactionLogEntry.sessionId` at
 * dispatch time. Kept here alongside `deriveActorRoleForSlice` because
 * both are shared derivation helpers that keep web + server producing
 * bit-identical log entries.
 *
 * The partial UNIQUE index on `GameSession.isCurrent` guarantees at
 * most one match — `.find()` is safe.
 *
 * `state === null` returns `null`: during the `create-character`
 * bootstrap the party doesn't exist yet, so no `GameSession` can be
 * current. The bootstrap's own log entries land as "Untagged"
 * (`sessionId: null`).
 */
export function currentGameSessionId(state: AppState | null): string | null {
  if (state === null) return null;
  return state.gameSessions.find((s) => s.isCurrent)?.id ?? null;
}

/**
 * RH3.2 — derived-predicate for the "Untagged" filter bucket
 * (OUTLINE §3.12). A log entry belongs to the "Untagged" bucket iff
 * its `sessionId` is `null`.
 *
 * Kept as a helper (not stored state on the entry) so callers that
 * consume the filter — the R5.3 history-view "Session" dropdown, the
 * R5.1 broadcast decision path if it ever needs to gate on
 * session-membership — can import a single named symbol instead of
 * re-typing `entry.sessionId === null` inline.
 */
export function isUntaggedLogEntry(entry: TransactionLogEntry): boolean {
  return entry.sessionId === null;
}

/**
 * R5.3 — history-view permission gate per OUTLINE §3.4 amendment
 * (2026-06-24), quoted in roadmap.md:3497:
 *
 * > Per-item history is visible to (a) the current owner + DM for
 * > items in a character's Inventory or Storage, and (b) every party
 * > member for items currently in Party Stash or Recovered Loot.
 *
 * Consumed by:
 *   - `apps/web/src/screens/HistoryScreen.tsx` — the party-wide
 *     filterable timeline. Applied as the final filter after the
 *     user's session / character / item / role / type filters.
 *   - `apps/web/src/components/item/ItemHistory.tsx` (R5.3.b) — the
 *     per-item history section on `ItemDetail`.
 *
 * Rules (evaluated in order — first matching branch wins):
 *
 * 0. **Solo bypass (OUTLINE §8.2).** When the party has exactly one
 *    unique active member the viewer wears both DM and player hats
 *    (§8.2 union-of-rights) — everything is visible.
 *
 * 1. **Banker widening.** Entries authored with `actorRole: 'banker'`
 *    are visible to ALL party members regardless of the item's
 *    current location. Banker actions on Party Stash / Recovered
 *    Loot are transparent by §3.14; extending that transparency to
 *    banker-authored writes on Inventory / Storage is the "banker
 *    is a fiduciary" reading of the amendment.
 *
 * 2. **Non-item entries.** Entries with no `itemInstanceId` in their
 *    payload (session start/end, edit-game-session-notes,
 *    create-character, delete-character, rename-*, currency-change,
 *    currency-transfer, create/edit/delete-homebrew, seed-catalog,
 *    join/leave-party, kick-player, appoint/revoke-banker,
 *    dm-transfer, split-evenly, set-encumbrance, edit-character,
 *    create-stash, delete-stash, rename-stash) are always visible
 *    to every party member.
 *
 *    Note: `create-stash` / `delete-stash` / `rename-stash` reference
 *    a stash, not an item. Even though a Storage stash is
 *    character-scoped, we surface these to all members because:
 *      - stash creation ⇒ player learned "X has a Storage stash", not
 *        the item contents;
 *      - stash deletion ⇒ cascade transfers to Recovered Loot which
 *        is party-visible;
 *      - stash rename ⇒ same shape as `create-stash`.
 *    OUTLINE §3.4 amendment scopes the private/public rule to
 *    item-carrying entries.
 *
 * 3. **Item entries — locate the item's CURRENT stash.**
 *    - stash.scope === 'party' | 'recovered-loot' → visible to all
 *    - stash.scope === 'character' → owner (via
 *      character.ownerUserId) + DM only
 *
 * 4. **Fallback (item not found / stash not found).** The item was
 *    consumed / deleted; we no longer know where it lived. Safe
 *    default: visible to DM only. Consumers can still show these
 *    entries to the current owner if they can reconstruct ownership
 *    from log history — that's out of scope for this helper.
 *
 * Note: this helper reads the item's CURRENT stash (roadmap
 * invariant line 3500) — the log rows themselves are immutable, but
 * ownership can change over time, and it's the "who can see this
 * NOW" question that drives the gate. If a private item moves to
 * Party Stash the party gains visibility to its whole history; if a
 * public item moves back into someone's Inventory the party loses
 * visibility.
 */
export function canSeeLogEntry(
  entry: TransactionLogEntry,
  ctx: { currentUserId: string; isDm: boolean; state: AppState },
): boolean {
  // Solo bypass (OUTLINE §8.2) — the sole active party member wears
  // BOTH the DM and player hats, and by the amendment §3.4 rule DMs
  // see everything, so short-circuit here.
  if (isSolo(ctx.state.memberships)) return true;

  // Rule 1 — banker widening.
  if (entry.actorRole === 'banker') return true;

  // Rule 3 — item entries: locate the current stash.
  const itemInstanceId = extractItemInstanceId(entry);
  if (itemInstanceId === null) {
    // Rule 2 — non-item entries: visible to all.
    return true;
  }

  const item = ctx.state.items.find((i) => i.id === itemInstanceId);
  if (item === undefined) {
    // Rule 4 — item deleted/consumed. Fallback: DM only.
    return ctx.isDm;
  }

  const stash = ctx.state.stashes.find((s) => s.id === item.ownerId);
  if (stash === undefined) {
    // Rule 4 — orphaned item (should not happen; defensive).
    return ctx.isDm;
  }

  if (stash.scope === 'party' || stash.scope === 'recovered-loot') {
    return true;
  }

  // scope === 'character' — owner + DM only.
  if (ctx.isDm) return true;
  const character = ctx.state.characters.find((c) => c.id === stash.ownerCharacterId);
  if (character === undefined) return ctx.isDm; // defensive
  return character.ownerUserId === ctx.currentUserId;
}

/**
 * R5.3 helper — returns the `itemInstanceId` referenced by a log
 * entry's payload, or `null` for entries that don't reference an
 * item. For `split` entries, returns the SOURCE instance id
 * (`sourceInstanceId`); callers that need to match the NEW row's id
 * should use {@link matchesItemInstance} instead.
 *
 * This function is the single source of truth for "which log-entry
 * variants carry an item reference" — keeping it here (rather than
 * inlined at both call sites) means adding a new item-referencing
 * variant only needs to be reflected in one place.
 */
function extractItemInstanceId(entry: TransactionLogEntry): string | null {
  switch (entry.type) {
    case 'acquire':
    case 'consume':
    case 'edit-item-instance':
    case 'transfer':
    case 'equip':
    case 'unequip':
    case 'attune':
    case 'unattune':
    case 'use-charge':
    case 'recharge':
    case 'identify':
      return entry.payload.itemInstanceId;
    case 'split':
      return entry.payload.sourceInstanceId;
    default:
      return null;
  }
}

/**
 * R5.3 helper — true iff a log entry references the given
 * `itemInstanceId` in ANY position of its payload (source AND new
 * row for `split`). Callers use this for the "per-item filter" in
 * `HistoryScreen` and inside `ItemHistory` itself.
 */
export function matchesItemInstance(entry: TransactionLogEntry, itemInstanceId: string): boolean {
  switch (entry.type) {
    case 'acquire':
    case 'consume':
    case 'edit-item-instance':
    case 'transfer':
    case 'equip':
    case 'unequip':
    case 'attune':
    case 'unattune':
    case 'use-charge':
    case 'recharge':
    case 'identify':
      return entry.payload.itemInstanceId === itemInstanceId;
    case 'split':
      return (
        entry.payload.sourceInstanceId === itemInstanceId ||
        entry.payload.newInstanceId === itemInstanceId
      );
    default:
      return false;
  }
}

/**
 * R5.3 helper — true iff a log entry references the given
 * `characterId` in its payload OR is authored by the character's
 * owner user. Callers use this for the "per-character filter" in
 * `HistoryScreen`. Returns false when the entry has no character
 * link (currency-* across party stashes with no character context,
 * seed-catalog, homebrew, session events).
 */
export function matchesCharacter(
  entry: TransactionLogEntry,
  characterId: string,
  ownerUserId: string,
): boolean {
  if (entry.actorUserId === ownerUserId) return true;
  switch (entry.type) {
    case 'equip':
    case 'unequip':
    case 'attune':
    case 'unattune':
    case 'use-charge':
    case 'recharge':
    case 'rename-character':
    case 'edit-character':
      return entry.payload.characterId === characterId;
    case 'create-character':
    case 'delete-character':
      return entry.payload.characterId === characterId;
    case 'leave-party':
    case 'join-party':
      return entry.payload.characterId === characterId;
    default:
      return false;
  }
}
