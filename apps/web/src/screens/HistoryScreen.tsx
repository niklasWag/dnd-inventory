import type { ChangeEvent, ReactElement } from 'react';
import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { RoleBadge } from '@/components/RoleBadge';
import { resolveActorLabel } from '@/lib/resolveActorLabel';
import { summarizeLogEntry } from '@/lib/summarizeLogEntry';
import { Button } from '@/components/ui/button';
import { useStore } from '@/store';
import type { AppState, TransactionLogEntry } from '@app/shared';
import {
  canSeeLogEntry,
  isUntaggedLogEntry,
  matchesCharacter,
  matchesItemInstance,
} from '@app/shared';

/**
 * R5.3.a — party-wide filterable history timeline (OUTLINE §5.8).
 *
 * Mounts at `/party/:partyId/history` inside the `PartyScopeGuard`
 * subtree, so `state.appState` is guaranteed non-null and matches the
 * URL's partyId. Renders a reverse-chronological list of every log
 * entry the current viewer is permitted to see per the §3.4 amendment
 * (see `canSeeLogEntry` in `@app/shared`).
 *
 * Filter bar (5 controls):
 *   - Session (single-select) — `All sessions` / `Untagged` / one per
 *     `state.gameSessions` row (newest first).
 *   - Character (single-select) — `All characters` / one per character.
 *   - Item (single-select) — `All items` / one per `ItemInstance`
 *     currently in state. Matches both source AND new ids on `split`.
 *   - Actor role (single-select) — `All roles` / DM / Player / Banker.
 *   - Action type (multi-select checkbox group) — defaults to the
 *     "ownership transitions" subset (matches `ItemHistory`'s
 *     DEFAULT_FILTER_TYPES). "Reset defaults" restores.
 *
 * Pagination: `PAGE_SIZE = 100` initial rows; "Load more" reveals
 * another 100. Simple + zero-dep; adequate for D&D campaign scale.
 */

const PAGE_SIZE = 100;

/** OUTLINE §3.11 ownership-transition filter — the same subset
 * `ItemHistory` shows by default. */
const OWNERSHIP_TRANSITIONS: readonly TransactionLogEntry['type'][] = [
  'acquire',
  'consume',
  'transfer',
  'split',
  'equip',
  'unequip',
  'attune',
  'unattune',
  'identify',
];

/** Every log-entry variant, grouped for the checkbox UI. Ordered by
 * "how likely a user wants to filter on this". Exhaustive over the
 * TransactionLogEntry union — TypeScript can't prove exhaustiveness
 * for an array literal, so the actionMetadata registry test suite
 * covers drift detection when a new variant is added. */
const OTHER_ACTION_TYPES: readonly TransactionLogEntry['type'][] = [
  'use-charge',
  'recharge',
  'edit-item-instance',
  'create-character',
  'delete-character',
  'rename-character',
  'edit-character',
  'set-encumbrance',
  'create-stash',
  'rename-stash',
  'delete-stash',
  'currency-change',
  'currency-transfer',
  'split-evenly',
  'create-homebrew',
  'edit-homebrew',
  'delete-homebrew',
  'seed-catalog',
  'rename-party',
  'join-party',
  'leave-party',
  'kick-player',
  'appoint-banker',
  'revoke-banker',
  'dm-transfer',
  'start-game-session',
  'end-game-session',
  'edit-game-session-notes',
];

const DEFAULT_ACTION_TYPES = new Set<TransactionLogEntry['type']>(OWNERSHIP_TRANSITIONS);
const ALL_ACTION_TYPES: readonly TransactionLogEntry['type'][] = [
  ...OWNERSHIP_TRANSITIONS,
  ...OTHER_ACTION_TYPES,
];

const EMPTY_LOG: readonly TransactionLogEntry[] = [];

export function HistoryScreen(): ReactElement {
  const { state, log } = useStore(
    useShallow((s) => ({
      state: s.appState,
      log: s.log,
    })),
  );

  // Filter state (component-local; resets per mount).
  const [sessionFilter, setSessionFilter] = useState<string>('all'); // 'all' | 'untagged' | gameSessionId
  const [characterFilter, setCharacterFilter] = useState<string>('all'); // 'all' | characterId
  const [itemFilter, setItemFilter] = useState<string>('all'); // 'all' | itemInstanceId
  const [roleFilter, setRoleFilter] = useState<string>('all'); // 'all' | 'dm' | 'player' | 'banker'
  const [actionTypes, setActionTypes] =
    useState<ReadonlySet<TransactionLogEntry['type']>>(DEFAULT_ACTION_TYPES);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const filtered = useMemo(
    () =>
      state !== null
        ? applyFilters({
            log,
            state,
            sessionFilter,
            characterFilter,
            itemFilter,
            roleFilter,
            actionTypes,
          })
        : EMPTY_LOG,
    [log, state, sessionFilter, characterFilter, itemFilter, roleFilter, actionTypes],
  );

  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const remaining = Math.max(0, filtered.length - visible.length);

  if (state === null) {
    return <p className="text-sm text-muted-foreground">No party loaded.</p>;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Party History</h1>
        <p className="text-sm text-muted-foreground">
          Showing {visible.length} of {filtered.length} entries
        </p>
      </header>

      <FilterBar
        state={state}
        sessionFilter={sessionFilter}
        setSessionFilter={(v) => {
          setSessionFilter(v);
          setVisibleCount(PAGE_SIZE);
        }}
        characterFilter={characterFilter}
        setCharacterFilter={(v) => {
          setCharacterFilter(v);
          setVisibleCount(PAGE_SIZE);
        }}
        itemFilter={itemFilter}
        setItemFilter={(v) => {
          setItemFilter(v);
          setVisibleCount(PAGE_SIZE);
        }}
        roleFilter={roleFilter}
        setRoleFilter={(v) => {
          setRoleFilter(v);
          setVisibleCount(PAGE_SIZE);
        }}
        actionTypes={actionTypes}
        setActionTypes={(v) => {
          setActionTypes(v);
          setVisibleCount(PAGE_SIZE);
        }}
      />

      {filtered.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">No entries match the current filters.</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => {
              setSessionFilter('all');
              setCharacterFilter('all');
              setItemFilter('all');
              setRoleFilter('all');
              setActionTypes(DEFAULT_ACTION_TYPES);
              setVisibleCount(PAGE_SIZE);
            }}
          >
            Reset filters
          </Button>
        </div>
      ) : (
        <>
          <ul className="space-y-1 text-sm" role="list" aria-label="History entries">
            {visible.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-baseline gap-3 border-b border-border/50 py-1.5 last:border-0"
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {new Date(e.timestamp).toLocaleString()}
                </span>
                <RoleBadge role={e.actorRole} />
                <span className="text-xs font-medium">
                  {resolveActorLabel(e.actorUserId, state)}
                </span>
                <span>{summarizeLogEntry(e, state)}</span>
              </li>
            ))}
          </ul>

          {remaining > 0 ? (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  setVisibleCount((n) => n + PAGE_SIZE);
                }}
              >
                Load more ({remaining} remaining)
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

interface FilterBarProps {
  state: AppState;
  sessionFilter: string;
  setSessionFilter: (v: string) => void;
  characterFilter: string;
  setCharacterFilter: (v: string) => void;
  itemFilter: string;
  setItemFilter: (v: string) => void;
  roleFilter: string;
  setRoleFilter: (v: string) => void;
  actionTypes: ReadonlySet<TransactionLogEntry['type']>;
  setActionTypes: (v: ReadonlySet<TransactionLogEntry['type']>) => void;
}

function FilterBar(props: FilterBarProps): ReactElement {
  const {
    state,
    sessionFilter,
    setSessionFilter,
    characterFilter,
    setCharacterFilter,
    itemFilter,
    setItemFilter,
    roleFilter,
    setRoleFilter,
    actionTypes,
    setActionTypes,
  } = props;

  const gameSessionOptions = useMemo(
    () => [...state.gameSessions].sort((a, b) => b.number - a.number),
    [state.gameSessions],
  );

  const characterOptions = useMemo(
    () => [...state.characters].sort((a, b) => a.name.localeCompare(b.name)),
    [state.characters],
  );

  const itemOptions = useMemo(
    () =>
      state.items.map((row) => {
        const def = state.catalog.find((d) => d.id === row.definitionId);
        const name = row.customName ?? def?.name ?? row.id.slice(0, 8);
        const suffix = row.notes !== undefined ? ` (${row.notes})` : '';
        return { id: row.id, label: `${name}${suffix}` };
      }),
    [state.items, state.catalog],
  );

  const toggleType = (t: TransactionLogEntry['type']) => {
    const next = new Set(actionTypes);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    setActionTypes(next);
  };

  return (
    <section aria-label="Filters" className="space-y-4 rounded-lg border p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FilterField label="Session">
          <select
            aria-label="Session filter"
            value={sessionFilter}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => {
              setSessionFilter(e.target.value);
            }}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="all">All sessions</option>
            <option value="untagged">Untagged</option>
            {gameSessionOptions.map((gs) => (
              <option key={gs.id} value={gs.id}>
                Session {gs.number} ({gs.date})
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField label="Character">
          <select
            aria-label="Character filter"
            value={characterFilter}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => {
              setCharacterFilter(e.target.value);
            }}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="all">All characters</option>
            {characterOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField label="Item">
          <select
            aria-label="Item filter"
            value={itemFilter}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => {
              setItemFilter(e.target.value);
            }}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="all">All items</option>
            {itemOptions.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
              </option>
            ))}
          </select>
        </FilterField>

        <FilterField label="Actor role">
          <select
            aria-label="Actor role filter"
            value={roleFilter}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => {
              setRoleFilter(e.target.value);
            }}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="all">All roles</option>
            <option value="dm">DM</option>
            <option value="player">Player</option>
            <option value="banker">Banker</option>
          </select>
        </FilterField>
      </div>

      <fieldset aria-label="Action types">
        <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Action types
        </legend>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
          {ALL_ACTION_TYPES.map((t) => (
            <label key={t} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={actionTypes.has(t)}
                onChange={() => {
                  toggleType(t);
                }}
                className="h-3.5 w-3.5"
              />
              <span>{t}</span>
            </label>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setActionTypes(new Set(ALL_ACTION_TYPES));
            }}
          >
            Select all
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setActionTypes(DEFAULT_ACTION_TYPES);
            }}
          >
            Reset defaults
          </Button>
        </div>
      </fieldset>
    </section>
  );
}

function FilterField({ label, children }: { label: string; children: ReactElement }): ReactElement {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

/** Pure filter pipeline; extracted so tests can hit it directly if
 * needed and to keep the component readable. Applied in this order:
 *   1. permission gate (`canSeeLogEntry`) — hides rows the viewer
 *      cannot see per §3.4 amendment.
 *   2. action-type set
 *   3. session filter (Untagged bucket / specific id / all)
 *   4. character filter (payload characterId OR actor === owner)
 *   5. item filter (matchesItemInstance covers split's dual ids)
 *   6. actor role filter
 *   7. reverse-chronological sort (newest first) */
function applyFilters(args: {
  log: readonly TransactionLogEntry[];
  state: AppState;
  sessionFilter: string;
  characterFilter: string;
  itemFilter: string;
  roleFilter: string;
  actionTypes: ReadonlySet<TransactionLogEntry['type']>;
}): TransactionLogEntry[] {
  const { log, state, sessionFilter, characterFilter, itemFilter, roleFilter, actionTypes } = args;

  const currentUserId = state.user.id;
  const isDm = state.memberships.some(
    (m) => m.userId === currentUserId && m.role === 'dm' && m.leftAt === null,
  );
  const ctx = { currentUserId, isDm, state };

  const character =
    characterFilter === 'all'
      ? null
      : (state.characters.find((c) => c.id === characterFilter) ?? null);

  const filtered = log.filter((entry) => {
    if (!canSeeLogEntry(entry, ctx)) return false;
    if (!actionTypes.has(entry.type)) return false;

    if (sessionFilter === 'untagged') {
      if (!isUntaggedLogEntry(entry)) return false;
    } else if (sessionFilter !== 'all') {
      if (entry.sessionId !== sessionFilter) return false;
    }

    if (character !== null) {
      if (!matchesCharacter(entry, character.id, character.ownerUserId)) return false;
    }

    if (itemFilter !== 'all') {
      if (!matchesItemInstance(entry, itemFilter)) return false;
    }

    if (roleFilter !== 'all') {
      if (entry.actorRole !== roleFilter) return false;
    }

    return true;
  });

  // Reverse-chronological (newest first). Log is stable-timestamped
  // by the middleware; sort keeps the list monotone even when
  // out-of-order broadcasts land.
  return filtered.sort((a, b) =>
    a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0,
  );
}
