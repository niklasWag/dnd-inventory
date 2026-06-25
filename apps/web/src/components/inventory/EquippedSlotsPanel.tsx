import { type ReactElement, useMemo } from 'react';

import { useStore } from '@/store';
import { attunement } from '@app/rules';

interface EquippedSlotsPanelProps {
  characterId: string;
}

/**
 * R1.2 — Inventory-tab summary of the character's currently equipped /
 * attuned items + attunement slot counter (X/max).
 *
 * Reads `Character.maxAttunement` (default 3, DM-overridable via
 * `edit-character` per OUTLINE §3.3 / §8.1) and the count of items in
 * the character's Inventory stash that have `attuned: true`.
 *
 * Subscribes to the raw `appState` slice and derives the displayed
 * lists in a `useMemo`. Returning a fresh `{ equipped: T[], attuned:
 * T[] }` straight from the selector would infinite-loop the Zustand
 * subscription (shallow-compares against fresh array references).
 */
export function EquippedSlotsPanel({
  characterId,
}: EquippedSlotsPanelProps): ReactElement | null {
  const appState = useStore((s) => s.appState);

  const data = useMemo(() => {
    if (appState === null) return null;
    const character = appState.characters.find((c) => c.id === characterId);
    if (character === undefined) return null;
    const inventoryStashId = character.inventoryStashId;
    const nameByDefId = new Map(appState.catalog.map((d) => [d.id, d.name] as const));
    const equipped: { id: string; label: string }[] = [];
    const attuned: { id: string; label: string }[] = [];
    for (const row of appState.items) {
      if (row.ownerId !== inventoryStashId) continue;
      const label = row.customName ?? nameByDefId.get(row.definitionId) ?? '(unknown)';
      if (row.equipped) equipped.push({ id: row.id, label });
      if (row.attuned) attuned.push({ id: row.id, label });
    }
    return {
      equipped,
      attuned,
      maxAttunement: character.maxAttunement,
    };
  }, [appState, characterId]);

  if (data === null) return null;
  const { equipped, attuned, maxAttunement } = data;
  const attunementHasFree = attunement.hasFreeSlot(attuned.length, maxAttunement);
  const counterClass = attunementHasFree ? 'text-muted-foreground' : 'text-amber-600';

  return (
    <section
      className="grid gap-3 rounded-lg border border-border bg-card p-3 sm:grid-cols-2"
      aria-label="Equipped and attuned items"
    >
      <div>
        <div className="text-sm font-semibold">Equipped</div>
        {equipped.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing equipped.</p>
        ) : (
          <ul className="mt-1 list-disc pl-5 text-sm">
            {equipped.map((row) => (
              <li key={row.id}>{row.label}</li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-semibold">Attuned</span>
          <span className={`text-xs tabular-nums ${counterClass}`} aria-label="Attunement slots">
            {attuned.length} / {maxAttunement}
          </span>
        </div>
        {attuned.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing attuned.</p>
        ) : (
          <ul className="mt-1 list-disc pl-5 text-sm">
            {attuned.map((row) => (
              <li key={row.id}>{row.label}</li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
