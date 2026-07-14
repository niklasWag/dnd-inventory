import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { toast } from 'sonner';
import { useShallow } from 'zustand/react/shallow';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useStore } from '@/store';
import { useDispatch } from '@/lib/useDispatch';
import { currency } from '@app/rules';

interface SplitEvenlyModalProps {
  /** Source Party Stash id (guard rejects any other scope). */
  stashId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const DENOMS = ['cp', 'sp', 'ep', 'gp', 'pp'] as const;
type Denom = (typeof DENOMS)[number];
const DENOM_LABEL: Record<Denom, string> = { cp: 'cp', sp: 'sp', ep: 'ep', gp: 'gp', pp: 'pp' };
const ZERO: Record<Denom, number> = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };

interface EligibleRecipient {
  characterId: string;
  characterName: string;
}

/**
 * R4.2.e — "Split the pot" modal. Banker-only; launched from the Party
 * Stash `<CurrencyRow>` when `state.party.bankerUserId === user.id`.
 *
 * Renders:
 *   - A checkbox list of every active player character in the party
 *     (Banker's own character preselected; every other checked by
 *     default per the R4.2.d planning decision).
 *   - A live preview using the shared `currency.splitEvenly` helper
 *     showing per-recipient share + pool remainder. Preview updates
 *     as recipients toggle.
 *   - A Confirm button that dispatches `split-evenly` with the checked
 *     recipient ids. Empty-pool / no-selection edge cases fail-safe:
 *     the Confirm button is disabled when zero recipients are picked;
 *     empty pool still allows dispatch (emits the terminal-only entry
 *     per R4.2.d's audit intent).
 *
 * All math runs client-side; no round-trip. If the server rejects
 * (Banker was revoked in a race, recipient left the party, etc.), the
 * error surfaces via the standard dispatch → toast pipeline.
 */
export function SplitEvenlyModal({
  stashId,
  open,
  onOpenChange,
}: SplitEvenlyModalProps): ReactElement {
  const dispatch = useDispatch();

  // Pool balance drives the preview + the Total line. Uses `useShallow`
  // so the modal doesn't rerender for every unrelated store mutation.
  const pool = useStore(
    useShallow((s) => {
      const c = s.appState?.currencies.find((row) => row.stashId === stashId);
      if (c === undefined) return ZERO;
      return { cp: c.cp, sp: c.sp, ep: c.ep, gp: c.gp, pp: c.pp };
    }),
  );

  // Eligible recipients: every active player membership whose character
  // exists. Includes the Banker's own character (§8.1 allows Banker
  // self-distribution). Excludes DM-only rows (their `characterId` is
  // null when the DM has no character) and any leftAt-set memberships.
  //
  // Split into two `useShallow` primitive selectors + a `useMemo`
  // rather than one selector that builds fresh objects — otherwise
  // `useShallow` sees fresh object references every render and Zustand
  // warns "The result of getSnapshot should be cached to avoid an
  // infinite loop". Same pattern as CatalogBrowser / StashItemsTable.
  const memberships = useStore(
    useShallow((s) => (s.appState !== null ? s.appState.memberships : [])),
  );
  const characters = useStore(
    useShallow((s) => (s.appState !== null ? s.appState.characters : [])),
  );
  const eligible = useMemo<readonly EligibleRecipient[]>(() => {
    const out: EligibleRecipient[] = [];
    for (const m of memberships) {
      if (m.role !== 'player') continue;
      if (m.leftAt !== null) continue;
      if (m.characterId === null) continue;
      const ch = characters.find((c) => c.id === m.characterId);
      if (ch === undefined) continue;
      out.push({ characterId: ch.id, characterName: ch.name });
    }
    return out;
  }, [memberships, characters]);

  // Selection state: keyed by characterId. All eligible are checked by
  // default when the modal opens (matches the R4.2.d design note:
  // "default all active players' characters with the Banker's character
  // pre-selected"). Reset on open so a stale selection from a previous
  // launch doesn't leak.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    if (open) {
      setSelected(new Set(eligible.map((e) => e.characterId)));
    }
  }, [open, eligible]);

  const toggle = (characterId: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(characterId)) next.delete(characterId);
      else next.add(characterId);
      return next;
    });
  };

  // Preview via the same cascade helper the reducer + server use. When
  // no one is selected, N=0 would throw; short-circuit with a
  // placeholder preview until the user picks at least one recipient.
  const preview = useMemo((): {
    share: Record<Denom, number>;
    remainder: Record<Denom, number>;
    n: number;
  } => {
    const n = selected.size;
    if (n === 0) {
      return { share: ZERO, remainder: pool, n: 0 };
    }
    const { share, remainder } = currency.splitEvenly(pool, n);
    return { share, remainder, n };
  }, [pool, selected]);

  function handleConfirm(): void {
    if (selected.size === 0) return;
    const recipientCharacterIds = eligible
      .map((e) => e.characterId)
      .filter((id) => selected.has(id));
    void dispatch(
      {
        type: 'split-evenly',
        payload: { fromStashId: stashId, recipientCharacterIds },
      },
      {
        onSuccess: () => {
          toast.success(
            preview.n === 0
              ? 'Split logged (pool was empty).'
              : `Split across ${preview.n} recipient${preview.n === 1 ? '' : 's'}.`,
          );
          onOpenChange(false);
        },
        onRejection: (_code, message) => toast.error(message ?? 'Could not split currency.'),
      },
    );
  }

  const poolIsEmpty = DENOMS.every((d) => pool[d] === 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">Split the pot</DialogTitle>
          <DialogDescription>
            Distributes Party Stash currency evenly across the selected characters. Leftover copper
            stays in the pool.
          </DialogDescription>
        </DialogHeader>

        {eligible.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No eligible recipients (no active players with characters).
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-semibold">Recipients</Label>
              <ul className="mt-2 space-y-1">
                {eligible.map((r) => {
                  const checked = selected.has(r.characterId);
                  return (
                    <li key={r.characterId} className="flex items-center gap-2">
                      <input
                        id={`split-recipient-${r.characterId}`}
                        type="checkbox"
                        className="h-4 w-4"
                        checked={checked}
                        onChange={() => toggle(r.characterId)}
                        aria-label={`Include ${r.characterName}`}
                      />
                      <label
                        htmlFor={`split-recipient-${r.characterId}`}
                        className="cursor-pointer text-sm"
                      >
                        {r.characterName}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p className="font-semibold">Preview</p>
              {preview.n === 0 ? (
                <p className="mt-1 text-muted-foreground">Pick at least one recipient.</p>
              ) : poolIsEmpty ? (
                <p className="mt-1 text-muted-foreground">
                  Pool is empty — nothing to distribute (a terminal log entry will still be
                  recorded).
                </p>
              ) : (
                <>
                  <p className="mt-1">
                    Each recipient gets:{' '}
                    <span className="tabular-nums">{formatCurrency(preview.share)}</span>
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Party Stash retains:{' '}
                    <span className="tabular-nums">{formatCurrency(preview.remainder)}</span>
                  </p>
                </>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={selected.size === 0} onClick={handleConfirm}>
            Split evenly
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Format a Currency value as "12 gp, 3 sp, 5 cp" — trailing zeros
 * suppressed, empty result shown as "0 cp" so the preview never
 * disappears entirely when a recipient legitimately gets nothing.
 */
function formatCurrency(c: Record<Denom, number>): string {
  const parts: string[] = [];
  for (const d of ['pp', 'gp', 'ep', 'sp', 'cp'] as const) {
    if (c[d] > 0) parts.push(`${c[d]} ${DENOM_LABEL[d]}`);
  }
  return parts.length === 0 ? '0 cp' : parts.join(', ');
}
