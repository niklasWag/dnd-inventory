import { describe, expect, it } from 'vitest';

import * as attunement from './attunement';

/**
 * D&D 5e (2024) attunement (OUTLINE §3.8 + §6).
 *
 * Two pure helpers:
 *   - `hasFreeSlot(attunedCount, maxAttunement)` — boolean gate used by the
 *     reducer's `attune` invariant and the UI's "X/max" badge color.
 *   - `prereqDisplay(prereq?)` — formats the advisory prerequisite string
 *     for the item-detail view. Display-only; never enforced.
 *
 * Default cap is 3 per OUTLINE §3.3 + `characterSchema.maxAttunement`; the
 * DM can raise or lower it per character.
 */

describe('rules.attunement.hasFreeSlot (R1.2)', () => {
  it('returns true when attunedCount < maxAttunement', () => {
    expect(attunement.hasFreeSlot(0, 3)).toBe(true);
    expect(attunement.hasFreeSlot(2, 3)).toBe(true);
  });

  it('returns false when attunedCount === maxAttunement (cap met)', () => {
    expect(attunement.hasFreeSlot(3, 3)).toBe(false);
  });

  it('returns false when attunedCount > maxAttunement (over cap — DM lowered the cap)', () => {
    // The DM may lower the cap below current attunements; the rule reports
    // "no free slot" so the UI flags the over-cap state without unattuning.
    expect(attunement.hasFreeSlot(5, 3)).toBe(false);
  });

  it('respects DM-raised caps', () => {
    expect(attunement.hasFreeSlot(3, 5)).toBe(true);
    expect(attunement.hasFreeSlot(5, 5)).toBe(false);
  });

  it('handles a maxAttunement of 0 (no attunement allowed)', () => {
    expect(attunement.hasFreeSlot(0, 0)).toBe(false);
  });
});

describe('rules.attunement.prereqDisplay (R1.2)', () => {
  it('returns empty string for undefined / empty prereq', () => {
    expect(attunement.prereqDisplay(undefined)).toBe('');
    expect(attunement.prereqDisplay('')).toBe('');
    expect(attunement.prereqDisplay('   ')).toBe('');
  });

  it('returns the trimmed prereq string verbatim (advisory)', () => {
    expect(attunement.prereqDisplay('Druid, Cleric')).toBe('Druid, Cleric');
    expect(attunement.prereqDisplay('  Wizard ')).toBe('Wizard');
  });
});
