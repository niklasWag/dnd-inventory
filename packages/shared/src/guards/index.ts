import type { AppState, PartyMembership } from '../schemas';

/**
 * R3.4.a — server-authoritative §8.1 permission guard layer.
 *
 * The guard map (`map.ts`) codifies the OUTLINE §8.1 matrix as a set of
 * pure functions, one per `Action['type']`. Both the server (running
 * the reducer authoritatively in `POST /sync/actions`) and the web
 * (running it optimistically) consult the same guards, so a rejected
 * action surfaces the same shape in both worlds.
 *
 * `Actor` is the server-derived identity tuple for the request:
 *   - `userId` from the session cookie (never the request body)
 *   - `partyId` from the request URL / body, validated against
 *     `PartyMembership` membership on the server
 *   - `role` derived via `deriveActorRole(party, membership)`; the
 *     `'banker'` value comes from `Party.bankerUserId === userId`, NEVER
 *     from a `PartyMembership.role = 'banker'` row (banker is
 *     denormalized on `Party.bankerUserId` per OUTLINE §3.14).
 *
 * MVP note: the Zod `partyMembershipSchema.role` enum is `['dm', 'player']`
 * only and `party.bankerUserId` is `z.null()` — banker isn't reachable in
 * MVP-validated state. R4.2 widens both. The Actor.role union below
 * already includes `'banker'` so the guard layer is forward-compatible.
 */
export type ActorRole = 'dm' | 'player' | 'banker';

export interface Actor {
  userId: string;
  partyId: string;
  role: ActorRole;
}

/**
 * The reducer accepts a nullable AppState because pre-bootstrap
 * (`create-character` action) state is `null`. The guard layer mirrors
 * that signature so the dispatcher passes the same value to both.
 */
export type GuardState = AppState | null;

/**
 * Guard result. Stable `code` enums let the web client branch on the
 * rejection reason without parsing the human-readable message. Codes
 * are kebab-case-via-underscore and stable across versions (changing a
 * code is a breaking API change for the web sync client).
 */
export type GuardResult = { ok: true } | { ok: false; code: GuardRejectionCode; message: string };

export type GuardRejectionCode =
  // top-level
  | 'unknown_action'
  | 'state_not_initialized'
  | 'state_already_initialized'
  | 'not_a_member'
  // ownership
  | 'not_own_character'
  | 'not_own_stash'
  | 'character_must_own_self'
  | 'character_already_exists'
  // role
  | 'dm_only'
  | 'banker_membership_forbidden'
  | 'banker_required_for_claim'
  | 'dm_transfer_self'
  | 'dm_transfer_target_not_member'
  // domain
  | 'item_not_found'
  | 'stash_not_found'
  | 'character_not_found'
  | 'equip_only_in_inventory'
  | 'attune_only_in_inventory'
  | 'use_charge_only_in_inventory'
  // RH1 — client-authoritative UUID v7 ids (§4 "Entity IDs")
  /** Client-supplied id is not a valid UUID v7 (wrong shape, wrong
   * version nibble, wrong variant). Structural validation via
   * `isValidUuidV7`. */
  | 'id_malformed'
  /** Client-supplied id's embedded timestamp is outside the server's
   * tolerance window (±5 min default per `CLOCK_SKEW_TOLERANCE_MS`).
   * Rejects backdated forgeries and clock-far-future ids. */
  | 'id_clock_skew'
  /** Client-supplied id collides with an existing row. UUID v7 has 74
   * bits of random entropy per millisecond, so this is effectively
   * impossible by accident — a collision means a buggy or malicious
   * client. Prisma's unique constraint catches it at the persistor; the
   * route layer maps `P2002` to this code. */
  | 'id_already_exists';

export {
  currentGameSessionId,
  deriveActorRole,
  deriveActorRoleForSlice,
  isMember,
  isSolo,
  isUntaggedLogEntry,
} from './actor';
export { guards, checkGuard } from './map';

/** Re-export the schema types the guards take as input so server +
 * web consumers can `import { type AppState, type Actor } from '@app/shared'`
 * without dipping into `./schemas/...` paths individually. */
export type { AppState, PartyMembership };
