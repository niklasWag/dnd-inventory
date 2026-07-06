import { type ReactElement, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import { Trash2, Plus, Coins, Package } from 'lucide-react';

import { newUuidV7 } from '@app/shared';
import type { ItemDefinition, Rarity as ItemRarity } from '@app/shared';
import type { hoard } from '@app/rules';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useStore } from '@/store';
import { useCurrentPartyId } from '@/lib/useCurrentPartyId';
import type { HoardGeneratorRouteState } from './HoardGenerator';

type Rarity = hoard.Rarity;
type GemTier = hoard.GemTier;
type HoardRoll = hoard.HoardRoll;

/**
 * R6.3 — Loot Distribution Wizard (`/party/:partyId/loot/distribute`).
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
 */

const DENOMS = ['pp', 'gp', 'ep', 'sp', 'cp'] as const;
type Denom = (typeof DENOMS)[number];

const RARITY_LABELS: Record<Rarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  'very-rare': 'Very rare',
  legendary: 'Legendary',
};

const GEM_TIER_LABELS: Record<GemTier, string> = {
  '10': '10 gp',
  '50': '50 gp',
  '100': '100 gp',
  '500': '500 gp',
  '1000': '1,000 gp',
  '5000': '5,000 gp',
};

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
  const dispatch = useStore((s) => s.dispatch);

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

  function distribute(): void {
    // Guard: every item row must have a definition assigned.
    const unfilledItem = rows.find(
      (r) => r.kind === 'item' && (r.itemDefinitionId === '' || r.itemDefinitionId === undefined),
    );
    if (unfilledItem !== undefined) {
      toast.error('Every item row needs a catalog item picked.');
      return;
    }
    let ok = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        if (row.kind === 'coin') {
          if (row.amount <= 0) continue; // skip empty coin rows silently
          const delta: Record<Denom, number> = { pp: 0, gp: 0, ep: 0, sp: 0, cp: 0 };
          delta[row.denom] = row.amount;
          dispatch({
            type: 'currency-change',
            payload: {
              stashId: row.targetStashId,
              delta,
              reason: 'deposit',
            },
          });
        } else {
          if (row.quantity <= 0) continue;
          dispatch({
            type: 'acquire',
            payload: {
              stashId: row.targetStashId,
              definitionId: row.itemDefinitionId,
              quantity: row.quantity,
              source: 'hoard',
              newItemInstanceId: newUuidV7(),
            },
          });
        }
        ok += 1;
      } catch (err) {
        failed += 1;
        toast.error(
          `${row.kind === 'coin' ? 'Coins' : row.itemLabel}: ${
            err instanceof Error ? err.message : 'Unknown error'
          }`,
        );
      }
    }
    if (ok > 0) {
      toast.success(`Distributed ${String(ok)} row${ok === 1 ? '' : 's'}`);
    }
    if (failed === 0 && ok > 0) {
      void navigate(`/party/${partyId}/hub`);
    }
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Loot Distribution</h1>
        <p className="text-sm text-muted-foreground">
          Edit the rows below, pick a target for each, and click Distribute. Each row emits its own
          log entry — coins as <code>currency-change</code>, items as <code>acquire</code>.
        </p>
      </header>

      {rows.length === 0 ? (
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
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Kind</th>
                <th className="px-3 py-2 text-left font-medium">What</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 text-left font-medium">Target</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-border align-top">
                  <td className="px-3 py-2">
                    {row.kind === 'coin' ? (
                      <span className="inline-flex items-center gap-1">
                        <Coins className="h-4 w-4" aria-hidden="true" />
                        Coin
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <Package className="h-4 w-4" aria-hidden="true" />
                        Item
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
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
                        Pick {row.rarityHint !== undefined ? RARITY_LABELS[row.rarityHint] : ''}
                        {row.tierHint !== undefined ? GEM_TIER_LABELS[row.tierHint] : ''}…
                      </Button>
                    ) : (
                      <div className="space-y-0.5">
                        <div>{row.itemLabel}</div>
                        <button
                          type="button"
                          className="text-xs text-muted-foreground underline"
                          onClick={() => setPickerOpenForRow(row.id)}
                        >
                          Change
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
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
                      className="w-24"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      aria-label="Target"
                      value={row.targetStashId}
                      onChange={(e) => updateRow(row.id, { targetStashId: e.target.value })}
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    >
                      {targetOptions.map((t) => (
                        <option key={t.stashId} value={t.stashId}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteRow(row.id)}
                      aria-label="Delete row"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center gap-2">
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
        <div className="ml-auto">
          <Button type="button" onClick={distribute} disabled={rows.length === 0}>
            Distribute
          </Button>
        </div>
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

interface ItemPickerProps {
  catalog: ReadonlyArray<ItemDefinition>;
  rarityFilter?: Rarity | undefined;
  onCancel: () => void;
  onPick: (def: ItemDefinition) => void;
}

/**
 * Minimal inline catalog picker for the wizard. Filters by name +
 * optional rarity. Distinct from `components/stash/CatalogPicker`,
 * which auto-dispatches an `acquire` — this one just returns the
 * chosen definition to the parent.
 */
function ItemPicker({ catalog, rarityFilter, onCancel, onPick }: ItemPickerProps): ReactElement {
  const [query, setQuery] = useState('');
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog
      .filter((d) => rarityFilter === undefined || (d.rarity as ItemRarity) === rarityFilter)
      .filter((d) => q === '' || d.name.toLowerCase().includes(q))
      .slice(0, 30);
  }, [catalog, query, rarityFilter]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-lg border border-border bg-background p-4 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            Pick item {rarityFilter !== undefined ? `(${RARITY_LABELS[rarityFilter]})` : ''}
          </h3>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
        <div className="mb-3 space-y-1.5">
          <Label htmlFor="wizard-picker-search">Search</Label>
          <Input
            id="wizard-picker-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            placeholder="wand, sword…"
          />
        </div>
        <div className="max-h-80 overflow-y-auto rounded-md border border-border">
          {results.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No matching catalog items.</p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {results.map((def) => (
                <li key={def.id} className="flex items-center gap-2 p-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{def.name}</div>
                    <div className="text-xs uppercase text-muted-foreground">
                      {def.source} · {def.rarity ?? '—'}
                    </div>
                  </div>
                  <Button type="button" size="sm" onClick={() => onPick(def)}>
                    Pick
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
