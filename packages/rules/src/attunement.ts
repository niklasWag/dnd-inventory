/**
 * Attunement slot tracking (OUTLINE §3.8 + §6).
 *
 * Two pure, deterministic helpers. The reducer (R1.2 `attune` case) calls
 * `hasFreeSlot` as a precondition; the UI's attunement counter calls it
 * to color the X/max badge. `prereqDisplay` is advisory-only — never
 * enforced.
 *
 * Default `maxAttunement` is 3 per OUTLINE §3.3; DM-overridable per
 * character via `edit-character` (R1.2).
 */

/**
 * Returns true when the character has at least one free attunement slot.
 *
 * `>` and not `>=` against `maxAttunement` so DM-lowered caps that leave
 * the character *over* the new ceiling correctly report "no free slot"
 * (the reducer does NOT auto-unattune; the UI flags the over-cap state).
 */
export function hasFreeSlot(attunedCount: number, maxAttunement: number): boolean {
  return attunedCount < maxAttunement;
}

/**
 * Formats the advisory prerequisite string for the item-detail view.
 * Empty / whitespace-only / `undefined` collapses to `''` so callers can
 * conditional-render with a single truthiness check.
 */
export function prereqDisplay(prereq: string | undefined): string {
  if (prereq === undefined) return '';
  return prereq.trim();
}
