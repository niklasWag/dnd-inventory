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
