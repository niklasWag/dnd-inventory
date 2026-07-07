import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { Button } from '@/components/ui/button';
import { useStore } from '@/store';
import { currency } from '@app/rules';
import { ConvertCurrencyModal } from './ConvertCurrencyModal';
import { CurrencyTransferModal } from './CurrencyTransferModal';
import { SplitEvenlyModal } from './SplitEvenlyModal';
import { DrainCurrencyModal } from './DrainCurrencyModal';
import { parseCurrencyEdit } from './parseCurrencyEdit';

/**
 * R4.2.e — Banker-context flags for shared-pool CurrencyRow rendering.
 * Computed by the caller (CharacterSheet) so the row itself stays a
 * dumb consumer of visibility rules. All three flags are `false` for
 * character-scope stashes (Inventory / Storage) — those rows are the
 * unaffected default.
 */
export interface BankerContext {
  /**
   * When true, this row is a shared pool with a Banker appointed AND
   * the current user IS that Banker. Show the "Split Evenly" affordance
   * (Party Stash only, per R4.2.d) and keep normal withdraw controls.
   */
  readonly userIsBanker: boolean;
  /**
   * When true, the current user is the DM AND a Banker is appointed.
   * Show the "Drain" affordance (dispatches `gameplay-drain`); HIDE the
   * inline −/+ controls for withdrawals so the DM's world-level intent
   * is explicit (§8.1 row 464). Deposits (+) stay visible for both
   * roles regardless of Banker state.
   */
  readonly userIsDmWithBankerActive: boolean;
  /**
   * When true, this shared pool is under a Banker and the current user
   * is NEITHER the Banker NOR the DM. Hide all withdrawal / transfer
   * / convert controls — the user can only look at the balance.
   */
  readonly userIsGatedFromPool: boolean;
  /**
   * True iff this row's stash is the Party Stash (as opposed to
   * Recovered Loot). Only Party Stash gets the Split Evenly button
   * per R4.2.d.
   */
  readonly isPartyStash: boolean;
}

interface CurrencyRowProps {
  stashId: string;
  /** Optional Banker context. Absent means "character-scope stash" (unaffected). */
  bankerContext?: BankerContext;
}

const DENOMS = ['cp', 'sp', 'ep', 'gp', 'pp'] as const;
type Denom = (typeof DENOMS)[number];
const DENOM_LABEL: Record<Denom, string> = { cp: 'CP', sp: 'SP', ep: 'EP', gp: 'GP', pp: 'PP' };
const ZERO_HOLDING = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } as const;

/**
 * Inline 5-coin editor row (MVP §5.2, M4). Sits above the StashItemsTable
 * in every stash view (Inventory, Storage detail, Party Stash, Recovered
 * Loot).
 *
 * Each denomination cell shows a `−`/value/`+` triplet. `−` is disabled
 * when the denomination is 0 (defense in depth — the reducer also
 * refuses to push any denomination negative). A "Convert" button opens
 * the ConvertCurrencyModal for source-denom × qty → target-denom moves.
 *
 * Each click is one dispatch is one log entry. Reason is auto-derived:
 * positive delta → 'deposit'; negative delta → 'withdraw'. Convert
 * dispatches its own entry with reason: 'convert'. Debouncing is an M4
 * follow-up if the log gets noisy in practice.
 *
 * R4.2.e — when `bankerContext` is supplied (Party Stash / Recovered
 * Loot), the row conditionally hides withdrawal controls for
 * non-Banker users and swaps in Banker / DM-drain affordances per the
 * §8.1 permission matrix + R4.2.d design notes.
 */
export function CurrencyRow({ stashId, bankerContext }: CurrencyRowProps): ReactElement {
  const [convertOpen, setConvertOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [drainOpen, setDrainOpen] = useState(false);

  const holding = useStore(
    useShallow((s) => {
      const c = s.appState?.currencies.find((row) => row.stashId === stashId);
      if (c === undefined) return ZERO_HOLDING;
      return { cp: c.cp, sp: c.sp, ep: c.ep, gp: c.gp, pp: c.pp };
    }),
  );

  const dispatch = useStore((s) => s.dispatch);

  const totalGp = useMemo(() => currency.toGpEquivalent(holding), [holding]);

  const adjust = (denom: Denom, sign: 1 | -1): void => {
    const delta = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
    delta[denom] = sign;
    dispatch({
      type: 'currency-change',
      payload: {
        stashId,
        delta,
        reason: sign === 1 ? 'deposit' : 'withdraw',
      },
    });
  };

  /**
   * R7.4 — dispatch a bulk edit produced by `parseCurrencyEdit`. Uses
   * the same `currency-change` action as the ±1 buttons; only the
   * magnitude differs. Reason is derived from delta sign.
   */
  const dispatchBulkEdit = (
    denom: Denom,
    deltaValue: number,
    reason: 'deposit' | 'withdraw',
  ): void => {
    const delta = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
    delta[denom] = deltaValue;
    dispatch({
      type: 'currency-change',
      payload: { stashId, delta, reason },
    });
  };

  // R4.2.e visibility flags. Character-scope stashes (bankerContext
  // undefined) get the full default control set. Shared pools consult
  // the flags per role.
  const showTransferConvert =
    bankerContext === undefined ||
    (!bankerContext.userIsGatedFromPool && !bankerContext.userIsDmWithBankerActive);
  const showWithdrawInline =
    bankerContext === undefined ||
    (!bankerContext.userIsGatedFromPool && !bankerContext.userIsDmWithBankerActive);
  const showDepositInline = bankerContext === undefined || !bankerContext.userIsGatedFromPool;
  const showSplitButton =
    bankerContext !== undefined && bankerContext.userIsBanker && bankerContext.isPartyStash;
  const showDrainButton = bankerContext !== undefined && bankerContext.userIsDmWithBankerActive;

  return (
    <section className="space-y-2 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Currency
        </h3>
        <div className="flex items-center gap-1">
          {showSplitButton ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setSplitOpen(true)}>
              Split evenly
            </Button>
          ) : null}
          {showDrainButton ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setDrainOpen(true)}>
              Drain
            </Button>
          ) : null}
          {showTransferConvert ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setTransferOpen(true);
                }}
              >
                Transfer
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  setConvertOpen(true);
                }}
              >
                Convert
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <ul className="grid grid-cols-5 gap-2">
        {DENOMS.map((d) => (
          <li key={d} className="flex flex-col items-center gap-1">
            <span className="text-xs font-medium text-muted-foreground">{DENOM_LABEL[d]}</span>
            <div className="flex items-center gap-1">
              {showWithdrawInline ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={holding[d] === 0}
                  aria-label={`Decrement ${DENOM_LABEL[d]}`}
                  onClick={() => {
                    adjust(d, -1);
                  }}
                >
                  −
                </Button>
              ) : null}
              <CurrencyValueCell
                denom={d}
                label={DENOM_LABEL[d]}
                value={holding[d]}
                editable={showWithdrawInline && showDepositInline}
                onCommit={(deltaValue, reason) => {
                  dispatchBulkEdit(d, deltaValue, reason);
                }}
              />
              {showDepositInline ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={`Increment ${DENOM_LABEL[d]}`}
                  onClick={() => {
                    adjust(d, 1);
                  }}
                >
                  +
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <p className="text-xs text-muted-foreground tabular-nums">Total: {totalGp} gp</p>

      <ConvertCurrencyModal stashId={stashId} open={convertOpen} onOpenChange={setConvertOpen} />
      <CurrencyTransferModal stashId={stashId} open={transferOpen} onOpenChange={setTransferOpen} />
      {showSplitButton ? (
        <SplitEvenlyModal stashId={stashId} open={splitOpen} onOpenChange={setSplitOpen} />
      ) : null}
      {showDrainButton ? (
        <DrainCurrencyModal
          stashId={stashId}
          stashLabel={bankerContext?.isPartyStash === true ? 'Party Stash' : 'Recovered Loot'}
          open={drainOpen}
          onOpenChange={setDrainOpen}
        />
      ) : null}
    </section>
  );
}

/**
 * R7.4 — click-to-edit denomination cell.
 *
 * Idle state: renders a button-styled span showing the current value.
 * Clicking flips it into a text input that accepts the syntax parsed
 * by `parseCurrencyEdit`:
 *   - `+N` / `-N` → signed delta
 *   - `=N` / bare `N` → absolute target (dispatch the diff)
 *   - empty / no-op → cancel silently
 *
 * Commit gestures: Enter or blur. Cancel gesture: Escape (reverts).
 * On a reject (parser error or would-push-negative), the input is
 * marked `aria-invalid` and stays open with the user's text so they
 * can correct it — no dispatch, no revert.
 *
 * When `editable` is false (gated-pool viewers, DM with Banker), the
 * value renders as an inert span so screen-readers and tests can still
 * find it by the denomination label.
 */
interface CurrencyValueCellProps {
  readonly denom: Denom;
  readonly label: string;
  readonly value: number;
  readonly editable: boolean;
  readonly onCommit: (deltaValue: number, reason: 'deposit' | 'withdraw') => void;
}

function CurrencyValueCell({
  denom,
  label,
  value,
  editable,
  onCommit,
}: CurrencyValueCellProps): ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(String(value));
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset the draft whenever the underlying value changes while idle —
  // keeps the cell in sync with dispatches from ±1 buttons and other
  // clients (R5.1 broadcast reconciliation).
  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  if (!editable) {
    return (
      <span aria-label={label} className="min-w-[2ch] text-center tabular-nums text-sm">
        {value}
      </span>
    );
  }

  const commit = (): void => {
    const result = parseCurrencyEdit(draft, value);
    if (result.kind === 'noop') {
      setEditing(false);
      setDraft(String(value));
      setError(null);
      return;
    }
    if (result.kind === 'reject') {
      setError(result.message);
      // Keep the field open so the user can correct their input.
      return;
    }
    onCommit(result.deltaValue, result.reason);
    setEditing(false);
    setError(null);
    // draft resyncs from the effect above once `value` updates.
  };

  const cancel = (): void => {
    setEditing(false);
    setDraft(String(value));
    setError(null);
  };

  if (!editing) {
    return (
      <button
        type="button"
        aria-label={label}
        title={`Edit ${label} — accepts +N, -N, =N, or an absolute value`}
        className="min-w-[2ch] rounded px-1 text-center tabular-nums text-sm hover:bg-muted"
        onClick={() => {
          setEditing(true);
        }}
      >
        {value}
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      aria-label={`Edit ${label}`}
      aria-invalid={error !== null}
      aria-describedby={error !== null ? `${denom}-edit-error` : undefined}
      title={error ?? undefined}
      value={draft}
      className="w-12 rounded border border-input bg-background px-1 text-center tabular-nums text-sm aria-[invalid=true]:border-destructive"
      onChange={(e) => {
        setDraft(e.currentTarget.value);
        if (error !== null) setError(null);
      }}
      onBlur={() => {
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        }
      }}
    />
  );
}
