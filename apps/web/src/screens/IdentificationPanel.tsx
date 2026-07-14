import { type ReactElement, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import { Eye, EyeOff } from 'lucide-react';

import type { ItemDefinition, ItemInstance } from '@app/shared';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useStore } from '@/store';
import { useDispatch } from '@/lib/useDispatch';
import { rarityPillClass, rarityLabel } from '@/lib/rarity';

/**
 * R6.4 — Identification Panel (`/party/:partyId/identify`).
 *
 * DM-only route (guarded by `DmOnlyRoute` in the router table).
 *
 * Primary view: every unidentified `ItemInstance` in the party grouped
 * by `definitionId`. Each group has:
 *   - a "Identify all N copies" button that opens `BatchIdentifyDialog`
 *     (dispatches `identify-batch` with optional shared hint), and
 *   - an expandable per-instance list where the DM can edit the hint
 *     (via single `identify` dispatch, preserving `identified: false`)
 *     or flip a single copy via a per-row Identify button.
 *
 * Secondary view (toggle: "Show identified items"): the reverse — groups
 * of identified items with a per-instance "Revoke identification" button
 * (bidirectional flip per OUTLINE §3.8 amendment 2026-06-24). The reverse
 * batch is not surfaced in the UI (a niche affordance; use single flips).
 *
 * All hint edits + identify flips use existing `identify` action semantics
 * from R2.3; the batch flow uses the new R6.4 `identify-batch` variant.
 */

interface Group {
  definitionId: string;
  def: ItemDefinition | undefined;
  instances: ItemInstance[];
}

export function IdentificationPanel(): ReactElement {
  const items = useStore(useShallow((s) => s.appState?.items ?? []));
  const catalog = useStore(useShallow((s) => s.appState?.catalog ?? []));
  const stashes = useStore(useShallow((s) => s.appState?.stashes ?? []));
  const dispatch = useDispatch();

  const [showIdentified, setShowIdentified] = useState(false);
  const [batchTarget, setBatchTarget] = useState<Group | null>(null);
  const [expandedDefIds, setExpandedDefIds] = useState<Set<string>>(new Set());

  const unidentifiedGroups = useMemo<Group[]>(
    () =>
      groupByDefinition(
        items.filter((it) => it.identified === false),
        catalog,
      ),
    [items, catalog],
  );
  const identifiedMagicGroups = useMemo<Group[]>(
    () =>
      groupByDefinition(
        items.filter((it) => {
          if (it.identified !== true) return false;
          const def = catalog.find((d) => d.id === it.definitionId);
          // Only magic-item defs have a rarity; mundane rows have no
          // "identified" toggle to expose to the DM.
          return def !== undefined && def.rarity !== undefined && def.rarity !== null;
        }),
        catalog,
      ),
    [items, catalog],
  );

  function stashNameOf(stashId: string): string {
    return stashes.find((s) => s.id === stashId)?.name ?? 'Unknown stash';
  }

  function toggleExpanded(defId: string): void {
    setExpandedDefIds((prev) => {
      const next = new Set(prev);
      if (next.has(defId)) next.delete(defId);
      else next.add(defId);
      return next;
    });
  }

  function onIdentifyOne(instance: ItemInstance, identified: boolean): void {
    const payload: { itemInstanceId: string; identified: boolean; hint?: string } = {
      itemInstanceId: instance.id,
      identified,
    };
    if (instance.hint !== undefined) payload.hint = instance.hint;
    void dispatch(
      { type: 'identify', payload },
      {
        onSuccess: () => toast.success(identified ? 'Identified' : 'Revoked identification'),
      },
    );
  }

  function onSaveHint(instance: ItemInstance, nextHint: string): void {
    const trimmed = nextHint.trim();
    const nextHintValue = trimmed === '' ? undefined : trimmed;
    if (nextHintValue === instance.hint) return;
    void dispatch(
      {
        type: 'identify',
        payload: {
          itemInstanceId: instance.id,
          identified: instance.identified,
          // `hint: undefined` is treated as "clear" by the reducer per R2.3.
          ...(nextHintValue === undefined ? { hint: undefined } : { hint: nextHintValue }),
        },
      },
      {
        onSuccess: () => toast.success('Hint saved'),
      },
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">DM tools · Identification</p>
        <h1 className="font-display text-2xl font-bold tracking-tight">Identification</h1>
        <p className="text-sm text-muted-foreground">
          Reveal magic items across the whole party. Group buttons batch-identify every copy of the
          same catalog item at once; per-instance controls let you set custom hints or flip a single
          copy.
        </p>
      </header>

      <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-e1">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 className="font-display text-sm font-semibold uppercase tracking-wide">
            Unidentified items
          </h2>
          <span className="text-xs text-muted-foreground">
            {unidentifiedGroups.length} group{unidentifiedGroups.length === 1 ? '' : 's'}
          </span>
        </div>
        {unidentifiedGroups.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            Nothing to identify — every magic item in the party is already revealed.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {unidentifiedGroups.map((g) => (
              <GroupCard
                key={g.definitionId}
                group={g}
                expanded={expandedDefIds.has(g.definitionId)}
                onToggleExpand={() => toggleExpanded(g.definitionId)}
                stashNameOf={stashNameOf}
                mode="unidentified"
                onBatchIdentify={() => setBatchTarget(g)}
                onIdentifyOne={(row) => onIdentifyOne(row, true)}
                onSaveHint={onSaveHint}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowIdentified((v) => !v)}
            aria-pressed={showIdentified}
          >
            {showIdentified ? (
              <EyeOff className="mr-1 h-4 w-4" aria-hidden="true" />
            ) : (
              <Eye className="mr-1 h-4 w-4" aria-hidden="true" />
            )}
            {showIdentified ? 'Hide' : 'Show'} identified items
          </Button>
          <span className="text-sm text-muted-foreground">
            Bidirectional flip — revoke identification on any single copy.
          </span>
        </div>
        {showIdentified ? (
          identifiedMagicGroups.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border bg-surface-2/40 p-6 text-center text-sm text-muted-foreground">
              No identified magic items in the party.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-e1">
              <div className="divide-y divide-border">
                {identifiedMagicGroups.map((g) => (
                  <GroupCard
                    key={g.definitionId}
                    group={g}
                    expanded={expandedDefIds.has(g.definitionId)}
                    onToggleExpand={() => toggleExpanded(g.definitionId)}
                    stashNameOf={stashNameOf}
                    mode="identified"
                    onIdentifyOne={(row) => onIdentifyOne(row, false)}
                    onSaveHint={onSaveHint}
                  />
                ))}
              </div>
            </div>
          )
        ) : null}
      </section>

      {batchTarget !== null && (
        <BatchIdentifyDialog
          group={batchTarget}
          onCancel={() => setBatchTarget(null)}
          onConfirm={(hint) => {
            const payload: { definitionId: string; identified: boolean; hint?: string } = {
              definitionId: batchTarget.definitionId,
              identified: true,
            };
            if (hint !== undefined) payload.hint = hint;
            void dispatch(
              { type: 'identify-batch', payload },
              {
                onSuccess: () => {
                  toast.success(
                    `Identified ${String(batchTarget.instances.length)} copies of ${
                      batchTarget.def?.name ?? 'item'
                    }`,
                  );
                  setBatchTarget(null);
                },
              },
            );
          }}
        />
      )}
    </div>
  );
}

function groupByDefinition(
  rows: ReadonlyArray<ItemInstance>,
  catalog: ReadonlyArray<ItemDefinition>,
): Group[] {
  const byDef = new Map<string, ItemInstance[]>();
  for (const row of rows) {
    const list = byDef.get(row.definitionId) ?? [];
    list.push(row);
    byDef.set(row.definitionId, list);
  }
  return Array.from(byDef.entries())
    .map(([definitionId, instances]) => ({
      definitionId,
      def: catalog.find((d) => d.id === definitionId),
      instances,
    }))
    .sort((a, b) => (a.def?.name ?? a.definitionId).localeCompare(b.def?.name ?? b.definitionId));
}

interface GroupCardProps {
  group: Group;
  expanded: boolean;
  onToggleExpand: () => void;
  stashNameOf: (stashId: string) => string;
  mode: 'unidentified' | 'identified';
  onBatchIdentify?: () => void;
  onIdentifyOne: (row: ItemInstance) => void;
  onSaveHint: (row: ItemInstance, nextHint: string) => void;
}

function GroupCard({
  group,
  expanded,
  onToggleExpand,
  stashNameOf,
  mode,
  onBatchIdentify,
  onIdentifyOne,
  onSaveHint,
}: GroupCardProps): ReactElement {
  const count = group.instances.length;
  const label = group.def?.name ?? group.definitionId;
  const rarity = group.def?.rarity ?? null;

  return (
    <div className="transition hover:bg-surface-2/50">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button
            type="button"
            onClick={onToggleExpand}
            className="min-w-0 flex-1 text-left"
            aria-expanded={expanded}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{label}</span>
              {rarity != null ? (
                <span
                  className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${rarityPillClass(rarity)}`}
                  aria-label={`Rarity: ${rarityLabel(rarity)}`}
                >
                  {rarityLabel(rarity)}
                </span>
              ) : null}
              <span className="text-xs text-muted-foreground">
                {count} cop{count === 1 ? 'y' : 'ies'}
              </span>
            </div>
          </button>
        </div>
        <div className="flex items-center gap-2">
          {mode === 'unidentified' && onBatchIdentify !== undefined ? (
            <Button type="button" size="sm" className="shadow-e1" onClick={onBatchIdentify}>
              Identify all {count}
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="ghost" onClick={onToggleExpand}>
            {expanded ? 'Collapse' : 'Expand'}
          </Button>
        </div>
      </div>
      {expanded ? (
        <ul className="divide-y divide-border border-t border-border bg-surface-2/30" role="list">
          {group.instances.map((row) => (
            <li
              key={row.id}
              className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Location:</span>{' '}
                  {stashNameOf(row.ownerId)}
                </div>
                <HintEditor
                  key={row.hint ?? ''}
                  initial={row.hint ?? ''}
                  onSave={(next) => onSaveHint(row, next)}
                />
              </div>
              <div className="flex items-center justify-end">
                <Button
                  type="button"
                  size="sm"
                  variant={mode === 'unidentified' ? 'default' : 'outline'}
                  onClick={() => onIdentifyOne(row)}
                >
                  {mode === 'unidentified' ? 'Identify' : 'Revoke'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

interface HintEditorProps {
  initial: string;
  onSave: (next: string) => void;
}

function HintEditor({ initial, onSave }: HintEditorProps): ReactElement {
  const [value, setValue] = useState(initial);
  return (
    <div className="flex items-center gap-2">
      <Label className="sr-only" htmlFor={`hint-${initial}`}>
        Hint
      </Label>
      <Input
        id={`hint-${initial}`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Hint (e.g. shimmers faintly)"
        className="max-w-sm"
      />
      {value !== initial ? (
        <Button type="button" size="sm" variant="outline" onClick={() => onSave(value)}>
          Save
        </Button>
      ) : null}
    </div>
  );
}

interface BatchIdentifyDialogProps {
  group: Group;
  onCancel: () => void;
  onConfirm: (hint: string | undefined) => void;
}

function BatchIdentifyDialog({
  group,
  onCancel,
  onConfirm,
}: BatchIdentifyDialogProps): ReactElement {
  const [hint, setHint] = useState('');
  const label = group.def?.name ?? group.definitionId;
  const count = group.instances.length;

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Identify all {count} copies</DialogTitle>
          <DialogDescription>
            Flip every copy of <span className="font-medium">{label}</span> in the party to
            identified. Leave the hint blank to keep each copy's existing hint; enter one to apply
            the same hint everywhere.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="batch-hint">Shared hint (optional)</Label>
          <Input
            id="batch-hint"
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            placeholder="e.g. radiates protection"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              const trimmed = hint.trim();
              onConfirm(trimmed === '' ? undefined : trimmed);
            }}
          >
            Identify {count}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
