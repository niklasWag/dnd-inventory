/**
 * Resolve "the actor's own character" from an AppState.
 *
 * Pre-R4.1.e the schema invariant was "exactly one character" so every
 * screen could safely read `appState.characters[0]`. R4.1.f's multi-
 * member parties broke that: `loadAppStateForUser` returns every
 * character in the party (`state-loader.ts:135`), so `characters[0]`
 * is the FIRST character in insertion order — usually NOT the
 * actor's.
 *
 * The right lookup is via `PartyMembership.characterId` for the actor's
 * active `role='player'` row. If the actor is in the party but has no
 * `role='player'` membership yet (DM-only DM), or the row exists with
 * `characterId: null` (joiner pre-create-character / post-delete), the
 * helper returns `null` — that's the "needs to create their character"
 * state.
 *
 * Anchored to `state.user.id` (the locally-authenticated actor), so
 * callers can pass the whole `AppState` without threading a separate
 * actor id.
 */
import type { Character } from '@app/shared';
import type { AppState } from '@app/rules';

export function getOwnCharacter(appState: AppState): Character | null {
  if (appState === null) return null;
  const userId = appState.user.id;
  const playerRow = appState.memberships.find(
    (m) =>
      m.userId === userId && m.role === 'player' && m.leftAt === null && m.characterId !== null,
  );
  if (playerRow === undefined) return null;
  return appState.characters.find((c) => c.id === playerRow.characterId) ?? null;
}
