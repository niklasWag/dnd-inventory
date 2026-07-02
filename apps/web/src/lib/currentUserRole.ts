import type { AppState } from '@app/shared';

/**
 * R4.5 — Client-side role probe for UI gating.
 *
 * Returns true when the current user is either:
 *   - a DM in the loaded party (has an active membership row with
 *     role='dm'), OR
 *   - in a solo party (party-of-one, per §8.2 union-of-rights the sole
 *     member has DM authority).
 *
 * Returns false when `appState === null` (no party loaded) or the user
 * is a non-DM player in a 2+-member party.
 *
 * This is a **display gate**, not a security boundary — the server's
 * guard layer is authoritative per SECURITY §2.1. Use this to hide UI
 * that would only cause a rejection round-trip.
 */
export function isCurrentUserDmOrSolo(appState: AppState | null): boolean {
  if (appState === null) return false;
  const activeMemberships = appState.memberships.filter((m) => m.leftAt === null);
  const distinctUserIds = new Set(activeMemberships.map((m) => m.userId));
  if (distinctUserIds.size === 1) return true; // solo bypass
  const myRoles = new Set(
    activeMemberships.filter((m) => m.userId === appState.user.id).map((m) => m.role),
  );
  return myRoles.has('dm');
}
