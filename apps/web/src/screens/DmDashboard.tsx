import { type ReactElement, useMemo, useState, useEffect } from 'react';
import { Navigate, Outlet, useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import {
  Calendar,
  ChevronRight,
  Coins,
  Gem,
  Play,
  ScrollText,
  Sparkles,
  Square,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';

import { currency } from '@app/rules';
import type { Character, CurrencyHolding, GameSession, ItemInstance, Stash } from '@app/shared';
import { newUuidV7 } from '@app/shared';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useStore } from '@/store';
import { isCurrentUserDmOrSolo } from '@/lib/currentUserRole';
import { useCanDispatch } from '@/lib/useCanDispatch';
import { useDispatch } from '@/lib/useDispatch';
import { useCurrentPartyId } from '@/lib/useCurrentPartyId';

/** Stable empty-array references for the Zustand selector fallback when
 * `appState === null`. Fresh `[]` literals would defeat `useShallow`'s
 * reference equality and infinite-loop the render (same pattern as
 * `CatalogBrowser.tsx`'s `EMPTY_CATALOG`). */
const EMPTY_CHARACTERS: readonly Character[] = [];
const EMPTY_STASHES: readonly Stash[] = [];
const EMPTY_CURRENCIES: readonly CurrencyHolding[] = [];
const EMPTY_ITEMS: readonly ItemInstance[] = [];
const EMPTY_GAME_SESSIONS: readonly GameSession[] = [];

/**
 * R4.5 — Route guard for the DM Dashboard (§5.9).
 *
 * Renders `<Outlet />` when the current user has a DM membership row OR
 * is solo (§8.2 union-of-rights). Otherwise redirects to `/hub`.
 *
 * No AppState = redirect. This route is only meaningful when a party is
 * loaded; the Hub itself is the correct landing when nothing is loaded.
 */
export function DmOnlyRoute(): ReactElement {
  const allowed = useStore(useShallow((s) => isCurrentUserDmOrSolo(s.appState)));
  if (!allowed) return <Navigate to="/hub" replace />;
  return <Outlet />;
}

/**
 * R4.5 — DM Dashboard (OUTLINE §5.9).
 *
 * At-a-glance grid of every character in the party (name + class + level
 * + Inventory GP-equivalent) with click-through to `/character/:id`, plus
 * summary cards for Party Stash + Recovered Loot (currency + distinct
 * item count) and a total party gold figure summing all character
 * Inventories + both shared pools.
 *
 * Access is gated by `DmOnlyRoute`; solo users see it too per §8.2.
 * Desktop-only per §5 form factor — on narrow viewports the character
 * table overflows horizontally rather than reflowing into cards.
 */
export function DmDashboard(): ReactElement {
  const navigate = useNavigate();
  const partyId = useCurrentPartyId();
  const { partyName, characters, stashes, currencies, items, gameSessions } = useStore(
    useShallow((s) => ({
      partyName: s.appState?.party.name ?? '',
      characters: s.appState?.characters ?? EMPTY_CHARACTERS,
      stashes: s.appState?.stashes ?? EMPTY_STASHES,
      currencies: s.appState?.currencies ?? EMPTY_CURRENCIES,
      items: s.appState?.items ?? EMPTY_ITEMS,
      gameSessions: s.appState?.gameSessions ?? EMPTY_GAME_SESSIONS,
    })),
  );

  const partyStash = stashes.find((s) => s.scope === 'party');
  const recoveredLootStash = stashes.find((s) => s.scope === 'recovered-loot');

  const partyStashHolding = partyStash
    ? currencies.find((c) => c.stashId === partyStash.id)
    : undefined;
  const recoveredLootHolding = recoveredLootStash
    ? currencies.find((c) => c.stashId === recoveredLootStash.id)
    : undefined;

  const partyStashItems = partyStash ? items.filter((i) => i.ownerId === partyStash.id) : [];
  const recoveredLootItems = recoveredLootStash
    ? items.filter((i) => i.ownerId === recoveredLootStash.id)
    : [];

  // Per-character Inventory GP-equivalent + total.
  const characterRows = useMemo(
    () =>
      characters.map((c) => {
        const holding = currencies.find((h) => h.stashId === c.inventoryStashId);
        const gp = holding !== undefined ? currency.toGpEquivalent(holding) : 0;
        return { character: c, gp };
      }),
    [characters, currencies],
  );

  const totalPartyGp = useMemo(() => {
    const perCharacter = characterRows.reduce((sum, r) => sum + r.gp, 0);
    const partyGp = partyStashHolding ? currency.toGpEquivalent(partyStashHolding) : 0;
    const recoveredGp = recoveredLootHolding ? currency.toGpEquivalent(recoveredLootHolding) : 0;
    return perCharacter + partyGp + recoveredGp;
  }, [characterRows, partyStashHolding, recoveredLootHolding]);

  const currentSession = gameSessions.find((s) => s.isCurrent) ?? null;

  // R9.9 — DM-tool launcher tiles. Each navigates to its dedicated route.
  const tools: { icon: typeof Sparkles; label: string; desc: string; to: string }[] = [
    {
      icon: Sparkles,
      label: 'Generate hoard',
      desc: 'Roll treasure by CR',
      to: `/party/${partyId}/loot/generate`,
    },
    {
      icon: Coins,
      label: 'Distribute loot',
      desc: 'Hand out coins & items',
      to: `/party/${partyId}/loot/distribute`,
    },
    {
      icon: Gem,
      label: 'Identify items',
      desc: 'Reveal unknown magic',
      to: `/party/${partyId}/identify`,
    },
    {
      icon: Users,
      label: 'Manage party',
      desc: 'Roles, banker, invites',
      to: `/party/${partyId}/settings`,
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">{partyName}</p>
        <h1 className="font-display text-2xl font-bold tracking-tight">DM Command Center</h1>
      </header>

      {/* Current-session banner. The button jumps to the Sessions region
       * below (which owns the start/end/notes lifecycle + its tests). */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-surface p-5 shadow-e2">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-full bg-primary/15 text-primary">
            <ScrollText className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widest text-primary">
              {currentSession !== null
                ? `Session ${currentSession.number} · in progress`
                : 'No active session'}
            </div>
            <div className="font-display text-xl font-bold">
              {currentSession !== null
                ? (currentSession.notes ?? `Session ${currentSession.number}`)
                : 'Start a new session'}
            </div>
          </div>
        </div>
        <a
          href="#sessions"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
        >
          <Play className="h-4 w-4" aria-hidden="true" />
          {currentSession !== null ? 'Session tools' : 'Start session'}
        </a>
      </div>

      {/* DM tool launchers */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tools.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.label}
              type="button"
              onClick={() => {
                void navigate(t.to);
              }}
              className="group flex flex-col items-start rounded-lg border border-border bg-surface p-4 text-left shadow-e1 transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-e2"
            >
              <div className="mb-2 grid h-9 w-9 place-items-center rounded-md bg-primary/10 text-primary">
                <Icon className="h-[17px] w-[17px]" aria-hidden="true" />
              </div>
              <div className="text-sm font-semibold">{t.label}</div>
              <div className="text-xs text-muted-foreground">{t.desc}</div>
            </button>
          );
        })}
      </div>

      {/* Party overview + summary side cards */}
      <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
        <section
          aria-label="Characters"
          className="overflow-hidden rounded-lg border border-border bg-surface shadow-e1"
        >
          <div className="border-b border-border px-4 py-3">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wide">
              Party at a glance
            </h2>
          </div>
          {characterRows.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">No characters yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {characterRows.map(({ character, gp }) => (
                <button
                  key={character.id}
                  type="button"
                  onClick={() => {
                    void navigate(`/party/${partyId}/character/${character.id}`);
                  }}
                  aria-label={`Open ${character.name}`}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-surface-2/60"
                >
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface-2 font-display text-xs font-bold text-muted-foreground">
                    {character.name.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{character.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {character.class} · L{character.level}
                    </div>
                  </div>
                  <span className="tabular-nums text-xs text-muted-foreground">{formatGp(gp)}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
        </section>

        <div className="space-y-3">
          <section
            aria-label="Total party gold"
            className="rounded-lg border border-border bg-surface p-4 shadow-e1"
          >
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Total party gold
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{formatGp(totalPartyGp)}</div>
          </section>
          <SummaryCard
            label="Party Stash"
            gp={partyStashHolding ? currency.toGpEquivalent(partyStashHolding) : 0}
            itemCount={partyStashItems.length}
          />
          <SummaryCard
            label="Recovered Loot"
            gp={recoveredLootHolding ? currency.toGpEquivalent(recoveredLootHolding) : 0}
            itemCount={recoveredLootItems.length}
          />
        </div>
      </div>

      <SessionsSection sessions={gameSessions} />
    </div>
  );
}

function SummaryCard({
  label,
  gp,
  itemCount,
}: {
  label: string;
  gp: number;
  itemCount: number;
}): ReactElement {
  return (
    <section
      aria-label={label}
      className="rounded-lg border border-border bg-surface p-4 text-sm shadow-e1"
    >
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="text-lg font-semibold tabular-nums">{formatGp(gp)}</span>
        <span className="text-xs text-muted-foreground">
          {itemCount} {itemCount === 1 ? 'item' : 'items'}
        </span>
      </div>
    </section>
  );
}

function formatGp(gp: number): string {
  // Preserve up to one decimal (e.g. "15.2 gp") but drop trailing .0.
  const rounded = Math.round(gp * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded} gp` : `${rounded.toFixed(1)} gp`;
}

/**
 * R5.2 — Session tools surface for the DM Dashboard (OUTLINE §3.12).
 *
 * Three affordances in one section:
 *   1. Start / End Session controls (top row). Start when no session
 *      is current; End (with AlertDialog confirmation) when one is.
 *      Both buttons short-circuit through `useCanDispatch()` so the
 *      §9 offline write-block is honored.
 *   2. Session list — reverse-chronological (newest number first) with
 *      an inline notes editor for each row. Empty state when no
 *      sessions have been started yet.
 *
 * DM-only guarding is enforced upstream by `DmOnlyRoute`; this
 * component doesn't re-check permission (defence-in-depth lives in the
 * reducer + server guard).
 */
function SessionsSection({ sessions }: { sessions: readonly GameSession[] }): ReactElement {
  const dispatch = useDispatch();
  const canDispatch = useCanDispatch();
  const [endDialogOpen, setEndDialogOpen] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const current = sessions.find((s) => s.isCurrent) ?? null;
  const sortedSessions = useMemo(
    () => [...sessions].sort((a, b) => b.number - a.number),
    [sessions],
  );

  function startSession(): void {
    setStartError(null);
    void dispatch(
      {
        type: 'start-game-session',
        payload: { newGameSessionId: newUuidV7() },
      },
      {
        onSuccess: () => toast.success('Session started'),
        onRejection: (_code, message) => setStartError(message ?? 'Unknown error'),
      },
    );
  }

  function endSession(): void {
    if (current === null) return;
    void dispatch(
      { type: 'end-game-session', payload: {} },
      {
        onSuccess: () => {
          toast.success(`Session ${current.number} ended`);
          setEndDialogOpen(false);
        },
        onRejection: (_code, message) => toast.error(message ?? 'Failed to end session'),
      },
    );
  }

  return (
    <section
      id="sessions"
      role="region"
      aria-label="Sessions"
      className="space-y-3 rounded-lg border border-border bg-surface p-4 shadow-e1"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Calendar className="h-4 w-4" aria-hidden />
          Sessions
        </div>
        {current === null ? (
          <Button
            size="sm"
            onClick={startSession}
            disabled={!canDispatch}
            aria-label="Start session"
          >
            <Play className="h-4 w-4" aria-hidden />
            Start Session
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEndDialogOpen(true);
            }}
            disabled={!canDispatch}
            aria-label={`End session ${current.number}`}
          >
            <Square className="h-4 w-4" aria-hidden />
            End Session {current.number}
          </Button>
        )}
      </div>

      {startError !== null ? (
        <p className="text-sm text-destructive" role="alert">
          {startError}
        </p>
      ) : null}

      {sortedSessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No sessions yet. Start a session to tag future events.
        </p>
      ) : (
        <ul className="space-y-3">
          {sortedSessions.map((session) => (
            <SessionRow key={session.id} session={session} />
          ))}
        </ul>
      )}

      {current !== null ? (
        <AlertDialog open={endDialogOpen} onOpenChange={setEndDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>End Session {current.number}?</AlertDialogTitle>
              <AlertDialogDescription>
                Future events will land under &ldquo;Untagged&rdquo; until you start another
                session. Existing history keeps its session tag.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={endSession}>End session</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </section>
  );
}

/**
 * R5.2 — One row per `GameSession` in the DM Dashboard's session list.
 * Renders the session's number + date + optional current-session
 * badge, plus an inline notes editor.
 *
 * Notes editor follows the `RenameField` shape: local text state,
 * `disabled` Save button on no-op writes (matches the reducer's
 * `notes unchanged` reject), toast + error surface on submit.
 */
function SessionRow({ session }: { session: GameSession }): ReactElement {
  const dispatch = useDispatch();
  const canDispatch = useCanDispatch();
  const initialNotes = session.notes ?? '';
  const [draft, setDraft] = useState(initialNotes);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Re-sync draft when the upstream `session.notes` changes (e.g. after
  // a successful save round-trips through the store). Matches the
  // `RenameField` effect pattern.
  useEffect(() => {
    setDraft(initialNotes);
    setSubmitError(null);
  }, [initialNotes]);

  const isNoOp = draft === initialNotes;
  const inputId = `session-notes-${session.id}`;

  function saveNotes(): void {
    if (isNoOp) return;
    setSubmitError(null);
    void dispatch(
      {
        type: 'edit-game-session-notes',
        payload: { gameSessionId: session.id, notes: draft },
      },
      {
        onSuccess: () => toast.success('Session notes saved'),
        onRejection: (_code, message) => setSubmitError(message ?? 'Unknown error'),
      },
    );
  }

  return (
    <li className="rounded-md border border-border/60 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Session {session.number}</span>
          <span className="text-xs text-muted-foreground">{session.date}</span>
        </div>
        {session.isCurrent ? (
          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
            Current
          </span>
        ) : null}
      </div>
      <Label htmlFor={inputId} className="sr-only">
        Session {session.number} notes
      </Label>
      <textarea
        id={inputId}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        rows={2}
        placeholder="Notes (optional)"
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        {submitError !== null ? (
          <p className="mr-auto text-xs text-destructive" role="alert">
            {submitError}
          </p>
        ) : null}
        <Button
          size="sm"
          onClick={saveNotes}
          disabled={isNoOp || !canDispatch}
          aria-label={`Save session ${session.number} notes`}
        >
          Save notes
        </Button>
      </div>
    </li>
  );
}
