import { type ReactElement, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Coins,
  PackageCheck,
  Plus,
  Split,
  Star,
  Trash2,
} from 'lucide-react';

import { newUuidV7 } from '@app/shared';
import type { ItemDefinition } from '@app/shared';
import type { hoard } from '@app/rules';

import { Button } from '@/components/ui/button';
import { DesktopOnlyNotice } from '@/components/nav/DesktopOnlyNotice';
import { Input } from '@/components/ui/input';
import { ItemPicker, RARITY_LABELS } from '@/components/catalog/ItemPicker';
import { rarityPillClass, rarityLabel } from '@/lib/rarity';
import { useStore } from '@/store';
import { useDispatch } from '@/lib/useDispatch';
import type { MutationOutcome } from '@/store/outcome';
import { useCurrentPartyId } from '@/lib/useCurrentPartyId';
import type { HoardGeneratorRouteState } from './HoardGenerator';

type Rarity = hoard.Rarity;
type GemTier = hoard.GemTier;
type HoardRoll = hoard.HoardRoll;

/**
 * R6.3 / R9.9 — Loot Distribution Wizard (`/party/:partyId/loot/distribute`).
 *
 * DM-only route. Populated from HoardGenerator's route state when
 * reached via "Continue"; opens empty when reached directly. Rows are
 * fully editable (add coin/item rows, delete, edit amounts, pick a
 * target stash). "Distribute" fans out to N `acquire` +
 * `currency-change` dispatches. Each action flows through the store's
 * session-tagging middleware (RH3.1), so entries carry the active
 * sessionId automatically.
 *
 * Design decisions (see R6.3 plan):
 *   - Per-row target radio (Party Stash / any character's Inventory) —
 *     supersedes the OUTLINE §3.10 "shared pool vs direct assign"
 *     dichotomy as a superset.
 *   - No new action variants: the wizard uses `acquire` + `currency-change`.
 *   - Session tagging: middleware-only. Wizard never sets `sessionId`.
 *   - Continue-on-failure: individual dispatch failures toast their error
 *     but the batch continues so partial distribution is possible.
 *
 * R9.9 — restyled to the shared Loot-wizard stepper shell (step indicator
 * + bordered card + footer nav, matching HoardGenerator): a 3-step guided
 * flow — (1) Review hoard: edit amounts + add/delete rows + pick items;
 * (2) Assign targets: per-row target select, gated so you cannot reach
 * Confirm while any row is unassigned; (3) Confirm: rows grouped by target
 * + Distribute. The row model, dispatch logic, and ItemPicker wiring are
 * unchanged from R6.3.
 */

const DENOMS = ['pp', 'gp', 'ep', 'sp', 'cp'] as const;
type Denom = (typeof DENOMS)[number];

const GEM_TIER_LABELS: Record<GemTier, string> = {
  '10': '10 gp',
  '50': '50 gp',
  '100': '100 gp',
  '500': '500 gp',
  '1000': '1,000 gp',
  '5000': '5,000 gp',
};

const STEPS = [
  { icon: ClipboardList, title: 'Review hoard' },
  { icon: Split, title: 'Assign targets' },
  { icon: PackageCheck, title: 'Confirm' },
] as const;

type CoinRow = {
  id: string;
  kind: 'coin';
  denom: Denom;
  amount: number;
  targetStashId: string;
};

type ItemRow = {
  id: string;
  kind: 'item';
  itemDefinitionId: string;
  itemLabel: string; // cached display name
  quantity: number;
  /** Rarity/tier hint from the generator, for the "add manual row" filter. */
  rarityHint?: Rarity;
  tierHint?: GemTier;
  targetStashId: string;
};

type Row = CoinRow | ItemRow;

interface TargetOption {
  stashId: string;
  label: string;
}

export function LootDistributionWizard(): ReactElement {
  const partyId = useCurrentPartyId();
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();

  const partyStashId = useStore(
    useShallow((s) => s.appState?.stashes.find((st) => st.scope === 'party')?.id ?? null),
  );
  const partyStashName = useStore(
    useShallow(
      (s) => s.appState?.stashes.find((st) => st.scope === 'party')?.name ?? 'Party Stash',
    ),
  );
  const characters = useStore(useShallow((s) => s.appState?.characters ?? []));
  const stashes = useStore(useShallow((s) => s.appState?.stashes ?? []));
  const catalog = useStore(useShallow((s) => s.appState?.catalog ?? []));
  const appStateLoaded = useStore((s) => s.appState !== null);

  const characterInventories = useMemo(
    () =>
      characters.map((c) => {
        const inv = stashes.find((st) => st.id === c.inventoryStashId);
        return {
          characterId: c.id,
          name: c.name,
          inventoryStashId: c.inventoryStashId,
          inventoryName: inv?.name ?? 'Inventory',
        };
      }),
    [characters, stashes],
  );

  // R10.5 — DM loot hint. Map each wishlisted catalog definitionId → the
  // names of characters who wishlisted it, so a rolled item that matches a
  // player's wish can be badged in the assign step. Free-text wishes have no
  // definitionId and are shown in the DM Command Center Wishlist Overview.
  const wishlistByDef = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of characters) {
      for (const entry of c.wishlist) {
        if (entry.kind !== 'catalog') continue;
        const names = m.get(entry.definitionId) ?? [];
        names.push(c.name);
        m.set(entry.definitionId, names);
      }
    }
    return m;
  }, [characters]);

  // Precompute the initial rows from the generator's route state (if any).
  // Must be `useState` initializer (not `useEffect`) so re-mounts don't
  // wipe user edits.
  const initialRows = useMemo<Row[]>(() => {
    const state = location.state as HoardGeneratorRouteState | null;
    if (state === null || !appStateLoaded) return [];
    return buildRowsFromRoll(state.roll, partyStashId ?? '');
  }, [location.state, appStateLoaded, partyStashId]);

  const [rows, setRows] = useState<Row[]>(initialRows);
  const [pickerOpenForRow, setPickerOpenForRow] = useState<string | null>(null);
  const [addRowKind, setAddRowKind] = useState<'coin' | 'item' | null>(null);
  const [step, setStep] = useState(0);

  if (!appStateLoaded) {
    return <Navigate to={`/party/${partyId}/hub`} replace />;
  }

  const targetOptions: TargetOption[] = [
    ...(partyStashId !== null ? [{ stashId: partyStashId, label: partyStashName }] : []),
    ...characterInventories.map((c) => ({
      stashId: c.inventoryStashId,
      label: `${c.name} — ${c.inventoryName}`,
    })),
  ];

  function updateRow(rowId: string, patch: Partial<Row>): void {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        // Preserve the discriminant.
        return { ...r, ...patch } as Row;
      }),
    );
  }

  function deleteRow(rowId: string): void {
    setRows((prev) => prev.filter((r) => r.id !== rowId));
  }

  function addCoinRow(): void {
    if (partyStashId === null) return;
    setRows((prev) => [
      ...prev,
      {
        id: newUuidV7(),
        kind: 'coin',
        denom: 'gp',
        amount: 0,
        targetStashId: partyStashId,
      },
    ]);
    setAddRowKind(null);
  }

  function addItemRow(def: ItemDefinition, forRowId: string | null): void {
    if (forRowId !== null) {
      // Filling in an item row that was placeholder (from generator's
      // rarity/tier bucket) — replace its itemDefinitionId + label.
      updateRow(forRowId, {
        itemDefinitionId: def.id,
        itemLabel: def.name,
      });
      setPickerOpenForRow(null);
      return;
    }
    if (partyStashId === null) return;
    setRows((prev) => [
      ...prev,
      {
        id: newUuidV7(),
        kind: 'item',
        itemDefinitionId: def.id,
        itemLabel: def.name,
        quantity: 1,
        targetStashId: partyStashId,
      },
    ]);
    setAddRowKind(null);
  }

  async function distribute(): Promise<void> {
    // Guard: every item row must have a definition assigned.
    const unfilledItem = rows.find(
      (r) => r.kind === 'item' && (r.itemDefinitionId === '' || r.itemDefinitionId === undefined),
    );
    if (unfilledItem !== undefined) {
      toast.error('Every item row needs a catalog item picked.');
      return;
    }
    // R8.5 — dispatch every row fire-and-forget FIRST so they ride the
    // sync queue's 200ms debounce as ONE batched POST, then await all
    // the outcome promises together. Awaiting each outcome inside the
    // loop would serialize the rows into N sequential round-trips and
    // defeat the queue's batching. Per-row `onRejection: () => {}`
    // suppresses the hook's default toast — this loop owns the labelled
    // per-row error toast below.
    const pending: { label: string; outcome: Promise<MutationOutcome> }[] = [];
    for (const row of rows) {
      if (row.kind === 'coin') {
        if (row.amount <= 0) continue; // skip empty coin rows silently
        const delta: Record<Denom, number> = { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 };
        delta[row.denom] = row.amount;
        pending.push({
          label: 'Coins',
          outcome: dispatch(
            {
              type: 'currency-change',
              payload: {
                stashId: row.targetStashId,
                delta,
                reason: 'deposit',
              },
            },
            { onRejection: () => {} },
          ),
        });
      } else {
        if (row.quantity <= 0) continue;
        pending.push({
          label: row.itemLabel,
          outcome: dispatch(
            {
              type: 'acquire',
              payload: {
                stashId: row.targetStashId,
                definitionId: row.itemDefinitionId,
                quantity: row.quantity,
                source: 'hoard',
                newItemInstanceId: newUuidV7(),
              },
            },
            { onRejection: () => {} },
          ),
        });
      }
    }

    let ok = 0;
    let failed = 0;
    const settled = await Promise.all(pending.map((p) => p.outcome));
    settled.forEach((outcome, i) => {
      if (outcome.ok) {
        ok += 1;
      } else {
        failed += 1;
        toast.error(`${pending[i]!.label}: ${outcome.message ?? 'Unknown error'}`);
      }
    });
    if (ok > 0) {
      toast.success(`Distributed ${String(ok)} row${ok === 1 ? '' : 's'}`);
    }
    if (failed === 0 && ok > 0) {
      void navigate(`/party/${partyId}/hub`);
    }
  }

  // A row is "unassigned" when its target stash is empty or no longer
  // resolves to a known target. Gate advancing past Assign targets on this.
  const unassignedCount = rows.filter(
    (r) => r.targetStashId === '' || !targetOptions.some((t) => t.stashId === r.targetStashId),
  ).length;
  const canLeaveAssign = unassignedCount === 0;

  // Group assigned rows by target for the confirm summary (step 3).
  const grouped = targetOptions
    .map((t) => ({ target: t, rows: rows.filter((r) => r.targetStashId === t.stashId) }))
    .filter((g) => g.rows.length > 0);

  const atLast = step === STEPS.length - 1;
  const nextDisabled = step === 1 && !canLeaveAssign;
  const hasRows = rows.length > 0;

  function renderRarityPill(row: ItemRow): ReactElement | null {
    if (row.rarityHint === undefined) return null;
    return (
      <span
        className={`inline-flex items-center rounded-full border bg-surface px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${rarityPillClass(
          row.rarityHint,
        )}`}
      >
        {rarityLabel(row.rarityHint)}
      </span>
    );
  }

  function rowIcon(row: Row): ReactElement {
    return (
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-surface-2 text-muted-foreground">
        {row.kind === 'coin' ? (
          <Coins className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <PackageCheck className="h-3.5 w-3.5" aria-hidden="true" />
        )}
      </span>
    );
  }

  return (
    <DesktopOnlyNotice>
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <header className="space-y-1">
          <p className="text-sm text-muted-foreground">Loot distribution</p>
          <h1 className="font-display text-2xl font-bold tracking-tight">Distribution wizard</h1>
        </header>

        {/* Step indicator (shared shell with HoardGenerator). */}
        <ol className="flex items-center gap-2">
          {STEPS.map((s, i) => {
            const done = i < step;
            const active = i === step;
            const Icon = s.icon;
            return (
              <li key={s.title} className="flex flex-1 items-center gap-2">
                <div
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
                    active
                      ? 'border-primary/50 bg-primary/5'
                      : done
                        ? 'border-border bg-surface'
                        : 'border-border bg-surface opacity-60'
                  }`}
                >
                  <span
                    className={`grid h-7 w-7 place-items-center rounded-full text-xs font-semibold ${
                      active || done
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-surface-2 text-muted-foreground'
                    }`}
                  >
                    {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                  </span>
                  <span className={`text-xs font-medium ${active ? 'text-primary' : ''}`}>
                    <Icon className="mr-1 inline h-3 w-3 align-[-1px]" aria-hidden="true" />
                    {s.title}
                  </span>
                </div>
                {i < STEPS.length - 1 ? (
                  <div className={`h-px flex-1 ${done ? 'bg-primary/40' : 'bg-border'}`} />
                ) : null}
              </li>
            );
          })}
        </ol>

        <div className="rounded-lg border border-border bg-surface p-5 shadow-e1">
          {!hasRows ? (
            <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No rows yet. Add a coin row or item row below, or roll a hoard first from the{' '}
              <button
                type="button"
                className="text-primary underline"
                onClick={() => {
                  void navigate(`/party/${partyId}/loot/generate`);
                }}
              >
                Hoard Generator
              </button>
              .
            </p>
          ) : step === 0 ? (
            /* Step 1 — review & edit amounts, pick items, add/delete rows. */
            <div className="space-y-2">
              <p className="mb-3 text-sm text-muted-foreground">
                Adjust the rolled amounts and pick catalog items before handing anything out. Coins
                emit <code>currency-change</code>; items emit <code>acquire</code>.
              </p>
              {rows.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
                >
                  {rowIcon(row)}
                  <div className="flex flex-1 items-center gap-2">
                    {row.kind === 'coin' ? (
                      <select
                        aria-label="Denomination"
                        value={row.denom}
                        onChange={(e) => updateRow(row.id, { denom: e.target.value as Denom })}
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                      >
                        {DENOMS.map((d) => (
                          <option key={d} value={d}>
                            {d.toUpperCase()}
                          </option>
                        ))}
                      </select>
                    ) : row.itemDefinitionId === '' ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setPickerOpenForRow(row.id)}
                      >
                        {row.rarityHint !== undefined
                          ? `Pick a ${RARITY_LABELS[row.rarityHint]} item`
                          : row.tierHint !== undefined
                            ? `Pick a ${GEM_TIER_LABELS[row.tierHint]} gem`
                            : 'Pick an item'}
                      </Button>
                    ) : (
                      <div className="space-y-0.5">
                        <div className="text-sm font-medium">{row.itemLabel}</div>
                        <button
                          type="button"
                          className="text-xs text-muted-foreground underline"
                          onClick={() => setPickerOpenForRow(row.id)}
                        >
                          Change
                        </button>
                      </div>
                    )}
                    {row.kind === 'item' ? renderRarityPill(row) : null}
                  </div>
                  <Input
                    type="number"
                    min={0}
                    value={row.kind === 'coin' ? row.amount : row.quantity}
                    onChange={(e) => {
                      const n = Number.parseInt(e.target.value, 10);
                      const safe = Number.isFinite(n) && n >= 0 ? n : 0;
                      if (row.kind === 'coin') {
                        updateRow(row.id, { amount: safe });
                      } else {
                        updateRow(row.id, { quantity: safe });
                      }
                    }}
                    aria-label={row.kind === 'coin' ? 'Coin amount' : 'Item quantity'}
                    className="w-24 text-right"
                  />
                  <span className="w-8 text-xs uppercase text-muted-foreground">
                    {row.kind === 'coin' ? row.denom : 'qty'}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteRow(row.id)}
                    aria-label="Delete row"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}

              <div className="flex items-center gap-2 pt-2">
                <Button type="button" variant="outline" size="sm" onClick={addCoinRow}>
                  <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                  Add coin row
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAddRowKind(addRowKind === 'item' ? null : 'item')}
                >
                  <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                  Add item row
                </Button>
              </div>
            </div>
          ) : step === 1 ? (
            /* Step 2 — assign targets. */
            <div className="space-y-2">
              <p className="mb-3 text-sm text-muted-foreground">
                Choose where each row goes. Every row needs a target.
              </p>
              {rows.map((row) => {
                const isUnassigned =
                  row.targetStashId === '' ||
                  !targetOptions.some((t) => t.stashId === row.targetStashId);
                return (
                  <div
                    key={row.id}
                    className={`flex items-center gap-3 rounded-md border px-3 py-2 ${
                      isUnassigned ? 'border-destructive/40 bg-destructive/5' : 'border-border'
                    }`}
                  >
                    {rowIcon(row)}
                    <div className="flex flex-1 items-center gap-2">
                      <span className="text-sm font-medium">
                        {row.kind === 'coin' ? row.denom.toUpperCase() : row.itemLabel}
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {row.kind === 'coin' ? `${row.amount} ${row.denom}` : `×${row.quantity}`}
                      </span>
                      {row.kind === 'item' ? renderRarityPill(row) : null}
                      {row.kind === 'item' && wishlistByDef.has(row.itemDefinitionId) ? (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                          title={`Wishlisted by ${wishlistByDef.get(row.itemDefinitionId)!.join(', ')}`}
                        >
                          <Star className="h-3 w-3" aria-hidden="true" />
                          Wished by {wishlistByDef.get(row.itemDefinitionId)!.join(', ')}
                        </span>
                      ) : null}
                    </div>
                    <select
                      aria-label="Target"
                      value={row.targetStashId}
                      onChange={(e) => updateRow(row.id, { targetStashId: e.target.value })}
                      className={`h-9 w-44 rounded-md border bg-background px-2 text-sm ${
                        isUnassigned ? 'border-destructive/50 text-destructive' : 'border-input'
                      }`}
                    >
                      <option value="">— Unassigned —</option>
                      {targetOptions.map((t) => (
                        <option key={t.stashId} value={t.stashId}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteRow(row.id)}
                      aria-label="Delete row"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
              {unassignedCount > 0 ? (
                <div className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                  {unassignedCount} row{unassignedCount === 1 ? '' : 's'} still unassigned
                </div>
              ) : null}
            </div>
          ) : (
            /* Step 3 — confirm summary, grouped by target. */
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Review the distribution. Committing hands out all {rows.length} row
                {rows.length === 1 ? '' : 's'} at once.
              </p>
              {grouped.map((g) => (
                <div key={g.target.stashId} className="rounded-md border border-border">
                  <div className="flex items-center justify-between border-b border-border bg-surface-2/60 px-3 py-2">
                    <span className="font-display text-xs font-semibold uppercase tracking-wide">
                      {g.target.label}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {g.rows.length} row{g.rows.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="divide-y divide-border">
                    {g.rows.map((row) => (
                      <div key={row.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                        {row.kind === 'coin' ? (
                          <Coins className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                        ) : (
                          <PackageCheck
                            className="h-3.5 w-3.5 text-muted-foreground"
                            aria-hidden="true"
                          />
                        )}
                        <span className="flex-1">
                          {row.kind === 'coin' ? row.denom.toUpperCase() : row.itemLabel}
                        </span>
                        {row.kind === 'item' ? renderRarityPill(row) : null}
                        <span className="tabular-nums text-muted-foreground">
                          {row.kind === 'coin' ? `${row.amount} ${row.denom}` : `×${row.quantity}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer nav (shared shell with HoardGenerator). Distribute fires
          from the last step. */}
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </Button>
          {atLast ? (
            <Button
              type="button"
              onClick={() => {
                void distribute();
              }}
              disabled={!hasRows}
            >
              <PackageCheck className="h-4 w-4" aria-hidden="true" />
              Distribute
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
              disabled={!hasRows || nextDisabled}
              title={nextDisabled ? 'Assign every row first' : undefined}
            >
              Next
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>

        {(pickerOpenForRow !== null || addRowKind === 'item') && (
          <ItemPicker
            catalog={catalog}
            rarityFilter={
              pickerOpenForRow !== null
                ? (rows.find((r) => r.id === pickerOpenForRow) as ItemRow | undefined)?.rarityHint
                : undefined
            }
            onCancel={() => {
              setPickerOpenForRow(null);
              setAddRowKind(null);
            }}
            onPick={(def) => addItemRow(def, pickerOpenForRow)}
          />
        )}
      </div>
    </DesktopOnlyNotice>
  );
}

/** Build one row per non-zero coin denom + one placeholder item row per
 *  rarity/gem-tier count. Item rows are placeholders (empty
 *  `itemDefinitionId`) until the DM picks a catalog entry. */
function buildRowsFromRoll(roll: HoardRoll, defaultTargetStashId: string): Row[] {
  const rows: Row[] = [];
  for (const d of DENOMS) {
    const amount = roll.coins[d];
    if (amount > 0) {
      rows.push({
        id: newUuidV7(),
        kind: 'coin',
        denom: d,
        amount,
        targetStashId: defaultTargetStashId,
      });
    }
  }
  for (const [rarity, count] of Object.entries(roll.magicItemsByRarity) as ReadonlyArray<
    [Rarity, number]
  >) {
    for (let i = 0; i < count; i += 1) {
      rows.push({
        id: newUuidV7(),
        kind: 'item',
        itemDefinitionId: '',
        itemLabel: `Magic item (${RARITY_LABELS[rarity]})`,
        quantity: 1,
        rarityHint: rarity,
        targetStashId: defaultTargetStashId,
      });
    }
  }
  for (const [tier, count] of Object.entries(roll.gemsByTier) as ReadonlyArray<[GemTier, number]>) {
    for (let i = 0; i < count; i += 1) {
      rows.push({
        id: newUuidV7(),
        kind: 'item',
        itemDefinitionId: '',
        itemLabel: `Gem (${GEM_TIER_LABELS[tier]})`,
        quantity: 1,
        tierHint: tier,
        targetStashId: defaultTargetStashId,
      });
    }
  }
  return rows;
}
