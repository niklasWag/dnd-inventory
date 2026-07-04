import type { AppState } from '@app/shared';

/**
 * R5.3 — resolve a `userId` (from a `TransactionLogEntry.actorUserId`)
 * to a human-readable label using ONLY what's already in the client
 * `AppState`.
 *
 * Resolution order (BUG-010 — uniform for every actor):
 *   1. Party member with a character → `character.name`. Character
 *      name is the most recognisable label at the D&D table and it's
 *      the ONE piece of identity every player has on every party
 *      member (via `state.characters`). This applies to the current
 *      user too — showing your own display name here while showing
 *      other players' character names was inconsistent.
 *   2. Current user (fallback) → `state.user.displayName`. Kicks in
 *      before a character has been created (fresh party join /
 *      DM-only bootstrap) — otherwise resolution 1 catches it.
 *   3. Fallback → short-uuid prefix `userId.slice(0, 8)`. Fires for
 *      DM-only bootstrap entries or other-user actors without a
 *      character bound.
 *
 * The web store never hydrates OTHER users' full `User` rows (see
 * `apps/web/src/screens/PartySettings.tsx` which hits a dedicated
 * server endpoint for the member list). History is client-side over
 * `state.log`, so we resolve against the AppState we already have.
 * When the fallback triggers, the row still renders — the RoleBadge
 * carries most of the "who" signal even without a name.
 */
export function resolveActorLabel(userId: string, state: AppState): string {
  const character = state.characters.find((c) => c.ownerUserId === userId);
  if (character !== undefined) return character.name;
  if (state.user.id === userId) return state.user.displayName;
  return userId.slice(0, 8);
}
