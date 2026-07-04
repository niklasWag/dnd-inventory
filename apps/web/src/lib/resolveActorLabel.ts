import type { AppState } from '@app/shared';

/**
 * R5.3 — resolve a `userId` (from a `TransactionLogEntry.actorUserId`)
 * to a human-readable label using ONLY what's already in the client
 * `AppState`.
 *
 * Resolution order:
 *   1. Current user (`state.user.id === userId`) → `state.user.displayName`.
 *   2. Party member with a character → `character.name` (via
 *      `characters.find(c => c.ownerUserId === userId)`). Player log
 *      entries are the common case; the character name is the most
 *      recognizable label to other party members.
 *   3. Fallback → short-uuid prefix `userId.slice(0, 8)`.
 *
 * The web store never hydrates OTHER users' full `User` rows (see
 * `apps/web/src/screens/PartySettings.tsx` which hits a dedicated
 * server endpoint for the member list). History is client-side over
 * `state.log`, so we resolve against the AppState we already have.
 * When the fallback triggers, the row still renders — the RoleBadge
 * carries most of the "who" signal even without a name.
 */
export function resolveActorLabel(userId: string, state: AppState): string {
  if (state.user.id === userId) return state.user.displayName;
  const character = state.characters.find((c) => c.ownerUserId === userId);
  if (character !== undefined) return character.name;
  return userId.slice(0, 8);
}
