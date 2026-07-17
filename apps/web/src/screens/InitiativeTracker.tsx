import { type ReactElement, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Dice6,
  RotateCcw,
  Skull,
  SkipForward,
  Swords,
  Trash2,
  Users,
} from 'lucide-react';

import { initiative } from '@app/rules';
import type { Character } from '@app/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DesktopOnlyNotice } from '@/components/nav/DesktopOnlyNotice';
import { useStore } from '@/store';
import { useEncounterStore, type Combatant, type RollMode } from '@/store/encounter';
import { useCurrentPartyId } from '@/lib/useCurrentPartyId';

/**
 * R11 — Initiative Tracker (DM combat tool). Surfaces under the DM
 * Command Center (`DmOnlyRoute`-gated in the router).
 *
 * A DM-only, ephemeral, non-authoritative turn-order tool. All mutable
 * encounter state lives in the standalone `useEncounterStore` (never
 * persisted, resets on reload — OUTLINE §2 amended 2026-07-17). Party
 * characters are read from the persisted store only to seed PC rows.
 *
 * Turn-order math is delegated to the pure `@app/rules` `initiative`
 * module; the row-Roll buttons go through the store's `dice`-backed
 * actions. Current-turn highlight is the accent color; rows sharing an
 * initiative value highlight together (simultaneous turns).
 */

const EMPTY_CHARACTERS: readonly Character[] = [];
const ROLL_MODES: RollMode[] = ['advantage', 'normal', 'disadvantage'];

export function InitiativeTracker(): ReactElement {
  const navigate = useNavigate();
  const partyId = useCurrentPartyId();

  const characters = useStore(useShallow((s) => s.appState?.characters ?? EMPTY_CHARACTERS));

  const { combatants, pointerId, round } = useEncounterStore(
    useShallow((s) => ({
      combatants: s.combatants,
      pointerId: s.pointerId,
      round: s.round,
    })),
  );
  const addPartyMembers = useEncounterStore((s) => s.addPartyMembers);
  const addMonster = useEncounterStore((s) => s.addMonster);
  const updateRow = useEncounterStore((s) => s.updateRow);
  const rollRow = useEncounterStore((s) => s.rollRow);
  const rollAll = useEncounterStore((s) => s.rollAll);
  const reorder = useEncounterStore((s) => s.reorder);
  const sortNow = useEncounterStore((s) => s.sortNow);
  const endTurn = useEncounterStore((s) => s.endTurn);
  const removeRow = useEncounterStore((s) => s.removeRow);
  const resetRounds = useEncounterStore((s) => s.resetRounds);
  const clear = useEncounterStore((s) => s.clear);

  // The set of ids sharing the pointer's initiative value — all highlight
  // together as a simultaneous turn.
  const activeIds = useMemo(() => {
    if (pointerId === null) return new Set<string>();
    const sorted = initiative.sortByInitiative(combatants);
    const groups = initiative.distinctInitiativeGroups(sorted);
    const group = groups.find((g) => g.some((c) => c.id === pointerId));
    return new Set(group?.map((c) => c.id) ?? []);
  }, [combatants, pointerId]);

  // The turn cycle has begun once a combatant is the active pointer. Rolling
  // is a setup-phase action, so per-row Roll + "Roll all" hide once started.
  const started = pointerId !== null;

  return (
    <DesktopOnlyNotice>
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            void navigate(`/party/${partyId}/dm`);
          }}
          className="-ml-2 h-8 gap-1.5 px-2 text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          DM Command Center
        </Button>

        <header className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-full bg-primary/15 text-primary">
            <Swords className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <p className="text-sm text-muted-foreground">Encounter</p>
            <h1 className="font-display text-2xl font-bold tracking-tight">Initiative Tracker</h1>
          </div>
          <div className="rounded-lg border border-border bg-surface px-4 py-2 text-center shadow-e1">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Round</div>
            <div className="font-display text-2xl font-bold tabular-nums" aria-label="Round">
              {round}
            </div>
          </div>
        </header>

        {/* Controls */}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => addPartyMembers(characters)}
          >
            <Users className="h-4 w-4" aria-hidden="true" />
            Add party
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={addMonster}>
            <Skull className="h-4 w-4" aria-hidden="true" />
            Add monster
          </Button>
          {started ? null : (
            <Button type="button" variant="outline" size="sm" onClick={rollAll}>
              <Dice6 className="h-4 w-4" aria-hidden="true" />
              Roll all
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" onClick={sortNow}>
            Sort
          </Button>
          <div className="ml-auto flex gap-2">
            <Button type="button" size="sm" onClick={endTurn} disabled={combatants.length === 0}>
              <SkipForward className="h-4 w-4" aria-hidden="true" />
              {started ? 'End turn' : 'Start Combat'}
            </Button>
            {started ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={resetRounds}
                aria-label="Reset rounds"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Reset
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={clear}
              disabled={combatants.length === 0}
              className="text-muted-foreground"
              aria-label="Clear encounter"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Clear
            </Button>
          </div>
        </div>

        {/* Roster */}
        <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-e1">
          <div className="border-b border-border px-4 py-3">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wide">
              Combatants
            </h2>
          </div>
          {combatants.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">
              No combatants yet. Add the party or a monster to begin.
            </p>
          ) : (
            <table className="w-full text-sm" aria-label="Combatants">
              <thead>
                <tr className="border-b border-border bg-surface-2/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Order</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Kind</th>
                  <th className="px-3 py-2 text-right font-medium">Mod</th>
                  <th className="px-3 py-2 font-medium">Roll mode</th>
                  <th className="px-3 py-2 text-right font-medium">Init</th>
                  <th className="px-3 py-2 text-right font-medium">HP</th>
                  <th className="px-3 py-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {combatants.map((c, i) => (
                  <CombatantRow
                    key={c.id}
                    combatant={c}
                    index={i}
                    total={combatants.length}
                    active={activeIds.has(c.id)}
                    started={started}
                    onUpdate={updateRow}
                    onRoll={rollRow}
                    onReorder={reorder}
                    onRemove={removeRow}
                  />
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </DesktopOnlyNotice>
  );
}

function CombatantRow({
  combatant: c,
  index,
  total,
  active,
  started,
  onUpdate,
  onRoll,
  onReorder,
  onRemove,
}: {
  combatant: Combatant;
  index: number;
  total: number;
  active: boolean;
  started: boolean;
  onUpdate: (
    id: string,
    patch: Partial<Pick<Combatant, 'name' | 'modifier' | 'rollMode' | 'hp' | 'initiative'>>,
  ) => void;
  onRoll: (id: string) => void;
  onReorder: (id: string, dir: 'up' | 'down') => void;
  onRemove: (id: string) => void;
}): ReactElement {
  const isMonster = c.kind === 'monster';
  return (
    <tr
      className={
        active
          ? 'bg-primary/10 [&>td]:bg-primary/10 [&>td:first-child]:border-l-2 [&>td:first-child]:border-primary'
          : 'hover:bg-surface-2/40'
      }
      aria-current={active ? 'true' : undefined}
    >
      <td className="px-3 py-2">
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => onReorder(c.id, 'up')}
            disabled={index === 0}
            aria-label={`Move ${c.name || 'combatant'} up`}
            className="grid h-6 w-6 place-items-center rounded text-muted-foreground transition hover:bg-surface-2 disabled:opacity-30"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onReorder(c.id, 'down')}
            disabled={index === total - 1}
            aria-label={`Move ${c.name || 'combatant'} down`}
            className="grid h-6 w-6 place-items-center rounded text-muted-foreground transition hover:bg-surface-2 disabled:opacity-30"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
      <td className="px-3 py-2">
        <Input
          aria-label={`Name for combatant ${index + 1}`}
          value={c.name}
          onChange={(e) => onUpdate(c.id, { name: e.target.value })}
          placeholder={isMonster ? 'Goblin' : 'Name'}
          className="h-8 min-w-[8rem]"
        />
      </td>
      <td className="px-3 py-2">
        <span
          className={
            'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ' +
            (isMonster ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary')
          }
        >
          {isMonster ? 'Monster' : 'PC'}
        </span>
      </td>
      <td className="px-3 py-2 text-right">
        <Input
          aria-label={`Modifier for ${c.name || 'combatant'}`}
          type="number"
          value={String(c.modifier)}
          onChange={(e) => onUpdate(c.id, { modifier: Number.parseInt(e.target.value, 10) || 0 })}
          className="h-8 w-16 text-right tabular-nums"
        />
      </td>
      <td className="px-3 py-2">
        <label className="sr-only" htmlFor={`mode-${c.id}`}>
          Roll mode for {c.name || 'combatant'}
        </label>
        <select
          id={`mode-${c.id}`}
          value={c.rollMode}
          onChange={(e) => onUpdate(c.id, { rollMode: e.target.value as RollMode })}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {ROLL_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2 text-right">
        <Input
          aria-label={`Initiative for ${c.name || 'combatant'}`}
          type="number"
          value={c.initiative === null ? '' : String(c.initiative)}
          onChange={(e) => {
            const v = e.target.value;
            onUpdate(c.id, { initiative: v === '' ? null : Number.parseInt(v, 10) || 0 });
          }}
          placeholder="—"
          className="h-8 w-16 text-right tabular-nums font-semibold"
        />
      </td>
      <td className="px-3 py-2">
        <div className="flex justify-end">
          {isMonster ? (
            <Input
              aria-label={`HP for ${c.name || 'monster'}`}
              type="number"
              value={c.hp === null ? '' : String(c.hp)}
              onChange={(e) => {
                const v = e.target.value;
                onUpdate(c.id, { hp: v === '' ? null : Number.parseInt(v, 10) || 0 });
              }}
              placeholder="—"
              className="h-8 w-16 text-right tabular-nums"
            />
          ) : (
            <span className="grid h-8 w-16 place-items-center text-xs text-muted-foreground">
              —
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-1">
          {started ? null : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onRoll(c.id)}
              aria-label={`Roll initiative for ${c.name || 'combatant'}`}
            >
              <Dice6 className="h-3.5 w-3.5" aria-hidden="true" />
              Roll
            </Button>
          )}
          <button
            type="button"
            onClick={() => onRemove(c.id)}
            aria-label={`Remove ${c.name || 'combatant'}`}
            className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}
