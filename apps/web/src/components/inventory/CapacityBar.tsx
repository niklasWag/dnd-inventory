import { type ReactElement } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { Progress } from '@/components/ui/progress';
import { useStore } from '@/store';
import { capacity } from '@app/rules';

interface CapacityBarProps {
  characterId: string;
}

/**
 * R1.1 — Encumbrance display for the Inventory tab (OUTLINE §3.3 + §3.6).
 *
 * Reads the character's `encumbranceRule` (`off | phb | variant`),
 * `enforceEncumbrance`, and STR, plus the `weight × quantity` sum across
 * rows in their Inventory stash. Returns `null` when `rule === 'off'`
 * (bar hidden entirely; matches the "off = no display" decision).
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
 * R1.2 will wire reducer rejections when `enforceEncumbrance === true`
 * — until then the (enforced) label is purely informational.
 */
export function CapacityBar({ characterId }: CapacityBarProps): ReactElement | null {
  const data = useStore(
    useShallow((s) => {
      if (s.appState === null) return null;
      const character = s.appState.characters.find((c) => c.id === characterId);
      if (character === undefined) return null;
      const stashId = character.inventoryStashId;
      const weightByDefId = new Map(
        s.appState.catalog.map((d) => [d.id, d.weight ?? 0] as const),
      );
      let currentWeight = 0;
      for (const item of s.appState.items) {
        if (item.ownerId !== stashId) continue;
        currentWeight += (weightByDefId.get(item.definitionId) ?? 0) * item.quantity;
      }
      return {
        str: character.abilityScores.STR,
        size: character.size,
        rule: character.encumbranceRule,
        enforce: character.enforceEncumbrance,
        currentWeight,
      };
    }),
  );

  if (data === null) return null;
  if (data.rule === 'off') return null;

  const capacityLb = capacity.carryCapacity(data.str, data.size);
  const state = capacity.encumbranceState(
    data.currentWeight,
    data.str,
    data.size,
    data.rule,
  );
  const threshold = capacity.heavyThreshold(data.str, data.size, data.rule);

  const pct =
    threshold === 0 || !isFinite(threshold)
      ? 0
      : Math.min(100, Math.round((data.currentWeight / threshold) * 100));

  const stateLabel: Record<typeof state, string> = {
    unencumbered: '',
    encumbered: ' (encumbered)',
    'heavily-encumbered':
      data.rule === 'phb' ? ' (over capacity)' : ' (heavily encumbered)',
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
  const enforceBadge = data.enforce ? ' · enforced (R1.2)' : '';

  return (
    <section
      className="space-y-2 rounded-lg border border-border bg-card p-3"
      aria-label="Encumbrance"
    >
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold">
          Encumbrance{' '}
          <span className="font-normal text-xs text-muted-foreground">
            ({sizeBadge} · {ruleBadge}{enforceBadge})
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
