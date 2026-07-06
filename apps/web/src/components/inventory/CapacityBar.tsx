import { type ReactElement } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { Progress } from '@/components/ui/progress';
import { useStore } from '@/store';
import { capacity, weight as weightRules } from '@app/rules';

interface CapacityBarProps {
  characterId: string;
}

/**
 * R1.1 — Encumbrance display for the Inventory tab (OUTLINE §3.3 + §3.6).
 *
 * Reads the party-wide `encumbranceRule` (`off | phb | variant`) and
 * `enforceEncumbrance` from `AppState.party`, plus the character's STR
 * and the `weight × quantity` sum across rows in their Inventory stash.
 * Returns `null` when `rule === 'off'` (bar hidden entirely; matches
 * the "off = no display" decision).
 *
 * BUG-011 (2026-07-06) — rule + enforce flag are party-wide (moved
 * from Character to Party); STR + size stay per-character.
 *
 * The selector aggregates `currentWeight` to a primitive number so the
 * returned shape is all primitives — returning a fresh `rows: T[]`
 * would shallow-compare false every selector call and infinite-loop
 * inside the Zustand subscription.
 *
 * Color states:
 *   - unencumbered      → neutral
 *   - encumbered        → amber (variant rule only — phb collapses to a
 *                          single over-cap band)
 *   - heavily-encumbered→ destructive red
 *
 * Bar fill caps at 100% once weight reaches the rule's `heavyThreshold`
 * (`STR × 15` under phb; `STR × 10` under variant). The lb count keeps
 * growing past the cap so the user sees exactly how far over they are.
 *
 * R1.4 wires reducer rejections when `enforceEncumbrance === true` —
 * the (enforced) badge below now reflects live behavior, not a stub.
 */
export function CapacityBar({ characterId }: CapacityBarProps): ReactElement | null {
  const data = useStore(
    useShallow((s) => {
      if (s.appState === null) return null;
      const character = s.appState.characters.find((c) => c.id === characterId);
      if (character === undefined) return null;
      const stashId = character.inventoryStashId;
      // R1.3: switch to the container-aware aggregator so Bag of Holding
      // etc. (`ItemDefinition.flatWeight === true`) correctly absorbs
      // their contents per OUTLINE §3.6. Flat rows (no container nesting)
      // get the same answer as the R1.1 `totalWeight` function would.
      const defsById = new Map(
        s.appState.catalog.map(
          (d) =>
            [
              d.id,
              // Spread `flatWeight` only when defined; the rule helper's
              // parameter type uses `flatWeight?: boolean` (under
              // exactOptionalPropertyTypes, `undefined` ≠ "absent").
              d.flatWeight === undefined
                ? { weight: d.weight ?? 0 }
                : { weight: d.weight ?? 0, flatWeight: d.flatWeight },
            ] as const,
        ),
      );
      const inventoryRows = s.appState.items.filter((i) => i.ownerId === stashId);
      const currentWeight = weightRules.containerAwareWeight(inventoryRows, defsById);
      return {
        str: character.abilityScores.STR,
        size: character.size,
        rule: s.appState.party.encumbranceRule,
        enforce: s.appState.party.enforceEncumbrance,
        currentWeight,
      };
    }),
  );

  if (data === null) return null;
  if (data.rule === 'off') return null;

  const capacityLb = capacity.carryCapacity(data.str, data.size);
  const state = capacity.encumbranceState(data.currentWeight, data.str, data.size, data.rule);
  const threshold = capacity.heavyThreshold(data.str, data.size, data.rule);

  const pct =
    threshold === 0 || !isFinite(threshold)
      ? 0
      : Math.min(100, Math.round((data.currentWeight / threshold) * 100));

  const stateLabel: Record<typeof state, string> = {
    unencumbered: '',
    encumbered: ' (encumbered)',
    'heavily-encumbered': data.rule === 'phb' ? ' (over capacity)' : ' (heavily encumbered)',
  };
  const textClass: Record<typeof state, string> = {
    unencumbered: 'text-muted-foreground',
    encumbered: 'text-amber-600',
    'heavily-encumbered': 'text-destructive',
  };
  // shadcn Progress uses an inner Indicator div — target it with the
  // arbitrary descendant selector to recolor the fill per state.
  const barClass: Record<typeof state, string> = {
    unencumbered: '',
    encumbered: '[&>div]:bg-amber-500',
    'heavily-encumbered': '[&>div]:bg-destructive',
  };

  const ruleBadge = data.rule === 'phb' ? 'PHB' : 'Variant';
  const sizeBadge = data.size.charAt(0).toUpperCase() + data.size.slice(1);
  const enforceBadge = data.enforce ? ' · enforced' : '';

  return (
    <section
      className="space-y-2 rounded-lg border border-border bg-card p-3"
      aria-label="Encumbrance"
    >
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold">
          Encumbrance{' '}
          <span className="font-normal text-xs text-muted-foreground">
            ({sizeBadge} · {ruleBadge}
            {enforceBadge})
          </span>
        </span>
        <span className={textClass[state]}>
          {data.currentWeight} / {capacityLb} lb{stateLabel[state]}
        </span>
      </div>
      <Progress value={pct} className={barClass[state]} />
    </section>
  );
}
