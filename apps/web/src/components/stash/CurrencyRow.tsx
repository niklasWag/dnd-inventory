import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Coins } from 'lucide-react';

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
 * R9.3 — per-denomination coin-color dots (from `CharacterCombined.tsx`
 * mockup): copper / silver / electrum / gold / platinum. Literal hex is
 * intentional — these are physical coin metals, not theme tokens, so they
 * stay constant across light/dark + accent changes.
 */
const DENOM_DOT: Record<Denom, string> = {
  cp: 'bg-[#b06a3b]',
  sp: 'bg-[#a8adb4]',
  ep: 'bg-[#cdd6a0]',
  gp: 'bg-[#e2b23c]',
  pp: 'bg-[#cfd6dc]',
};

/**
 * R9.2 — Prominent currency panel (Combined design baseline). Sits
 * full-width above the item table in every stash view (Inventory,
 * Storage detail, Party Stash, Recovered Loot). Evolved from the M4
 * inline 5-coin row: a gradient hero panel with a Coins medallion + big
 * `font-display` gp total on the left, the manage actions
 * (Convert/Transfer/Split/Drain per role) on the right, and below a
 * divided 5-cell **cp · sp · ep · gp · pp** row of per-denomination
 * managers.
 *
 * Each denomination cell shows a `−`/value/`+` triplet. `−` is disabled
 * when the denomination is 0 (defense in depth — the reducer also
 * refuses to push any denomination negative). The value is click-to-edit
 * for bulk entry (`+N` / `-N` / `=N` / absolute).
 *
 * Each click is one dispatch is one log entry. Reason is auto-derived:
 * positive delta → 'deposit'; negative delta → 'withdraw'. Convert
 * dispatches its own entry with reason: 'convert'.
 *
 * R4.2.e — when `bankerContext` is supplied (Party Stash / Recovered
 * Loot), the panel conditionally hides withdrawal controls for
 * non-Banker users and swaps in Banker / DM-drain affordances per the
 * §8.1 permission matrix + R4.2.d design notes.
 *
 * (Export name kept as `CurrencyRow` — the M4 filename + every import
 * site — so the R9.2 restyle stays a pure presentation change.)
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
  // Mockup formats the gp-equivalent to at most 2 decimals (e.g. 172.21),
  // trimming trailing zeros so whole-gp totals read "150" not "150.00".
  const totalGpLabel = useMemo(
    () => totalGp.toLocaleString(undefined, { maximumFractionDigits: 2 }),
    [totalGp],
  );

  const adjust = (denom: Denom, sign: 1 | -1): void => {
    const delta = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
    delta[denom] = sign;
    void dispatch({
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
    void dispatch({
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
    <section className="overflow-hidden rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-surface shadow-e2">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="grid h-9 w-9 place-items-center rounded-full bg-primary/15 text-primary"
          >
            <Coins className="h-[18px] w-[18px]" />
          </span>
          <div>
            <h3 className="text-[10px] font-semibold uppercase tracking-widest text-primary">
              Currency
            </h3>
            <p className="font-display text-xl font-bold leading-none tabular-nums">
              {totalGpLabel}
              <span className="ml-1 text-sm font-semibold text-muted-foreground">gp</span>
            </p>
          </div>
        </div>
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

      <ul className="grid grid-cols-5 divide-x divide-border border-t border-border bg-surface/60">
        {DENOMS.map((d) => (
          <li key={d} className="flex flex-col items-center gap-1.5 px-1 py-2.5">
            <div className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className={`h-2.5 w-2.5 rounded-full ring-1 ring-inset ring-black/15 ${DENOM_DOT[d]}`}
              />
              <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                {DENOM_LABEL[d]}
              </span>
            </div>
            <CurrencyValueCell
              denom={d}
              label={DENOM_LABEL[d]}
              value={holding[d]}
              editable={showWithdrawInline && showDepositInline}
              onCommit={(deltaValue, reason) => {
                dispatchBulkEdit(d, deltaValue, reason);
              }}
            />
            {showWithdrawInline || showDepositInline ? (
              <div className="inline-flex overflow-hidden rounded-md border border-border">
                {showWithdrawInline ? (
                  <button
                    type="button"
                    disabled={holding[d] === 0}
                    aria-label={`Decrement ${DENOM_LABEL[d]}`}
                    onClick={() => {
                      adjust(d, -1);
                    }}
                    className="grid h-6 w-7 place-items-center text-muted-foreground transition hover:bg-surface-2 disabled:opacity-40"
                  >
                    −
                  </button>
                ) : null}
                {showDepositInline ? (
                  <button
                    type="button"
                    aria-label={`Increment ${DENOM_LABEL[d]}`}
                    onClick={() => {
                      adjust(d, 1);
                    }}
                    className="grid h-6 w-7 place-items-center border-l border-border text-muted-foreground transition hover:bg-surface-2"
                  >
                    +
                  </button>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <p className="sr-only tabular-nums">Total: {totalGpLabel} gp</p>

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
      <span
        aria-label={label}
        className="min-w-[2ch] text-center font-display text-lg font-bold tabular-nums leading-none"
      >
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
        className="min-w-[2ch] rounded px-1 text-center font-display text-lg font-bold tabular-nums leading-none hover:bg-muted"
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
