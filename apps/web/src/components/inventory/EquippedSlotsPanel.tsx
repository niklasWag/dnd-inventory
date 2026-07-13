import { type ReactElement, useMemo } from 'react';
import { Sparkles, Sword } from 'lucide-react';

import { useStore } from '@/store';
import { attunement } from '@app/rules';
import { displayName as computeDisplayName } from '@/lib/identify';

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
export function EquippedSlotsPanel({ characterId }: EquippedSlotsPanelProps): ReactElement | null {
  const appState = useStore((s) => s.appState);

  const data = useMemo(() => {
    if (appState === null) return null;
    const character = appState.characters.find((c) => c.id === characterId);
    if (character === undefined) return null;
    const inventoryStashId = character.inventoryStashId;
    const defById = new Map(appState.catalog.map((d) => [d.id, d] as const));
    const equipped: { id: string; label: string }[] = [];
    const attuned: { id: string; label: string }[] = [];
    for (const row of appState.items) {
      if (row.ownerId !== inventoryStashId) continue;
      // R2.3 — route through the shared displayName helper so unidentified
      // equipped/attuned magic items render as "Unknown Magic Item" instead
      // of leaking their real name (OUTLINE §8 display invariant).
      const label = computeDisplayName(row, defById.get(row.definitionId));
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
      className="overflow-hidden rounded-xl border border-border bg-surface shadow-e1"
      aria-label="Equipped and attuned items"
    >
      <div className="border-b border-border px-4 py-3">
        <h2 className="font-display text-sm font-semibold uppercase tracking-wide">Loadout</h2>
      </div>
      <div className="space-y-4 px-4 py-3">
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Equipped
          </div>
          {equipped.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing equipped.</p>
          ) : (
            <ul className="space-y-1.5">
              {equipped.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center gap-2.5 rounded-md border border-border bg-surface-2/60 px-2.5 py-1.5"
                >
                  <span
                    aria-hidden="true"
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"
                  >
                    <Sword className="h-3.5 w-3.5" />
                  </span>
                  <span className="truncate text-sm font-medium">{row.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Attuned
            </span>
            <span className={`text-xs tabular-nums ${counterClass}`} aria-label="Attunement slots">
              {attuned.length} / {maxAttunement}
            </span>
          </div>
          {attuned.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nothing attuned.</p>
          ) : (
            <ul className="space-y-1.5">
              {attuned.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center gap-2.5 rounded-md border border-border bg-surface-2/60 px-2.5 py-1.5"
                >
                  <span
                    aria-hidden="true"
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                  </span>
                  <span className="truncate text-sm font-medium">{row.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
