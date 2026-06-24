import { useMemo, useState, type ReactElement } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { Button } from '@/components/ui/button';
import { useStore } from '@/store';
import { currency } from '@app/rules';
import { ConvertCurrencyModal } from './ConvertCurrencyModal';
import { CurrencyTransferModal } from './CurrencyTransferModal';

interface CurrencyRowProps {
  stashId: string;
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
 */
export function CurrencyRow({ stashId }: CurrencyRowProps): ReactElement {
  const [convertOpen, setConvertOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

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

  return (
    <section className="space-y-2 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Currency
        </h3>
        <div className="flex items-center gap-1">
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
        </div>
      </div>

      <ul className="grid grid-cols-5 gap-2">
        {DENOMS.map((d) => (
          <li key={d} className="flex flex-col items-center gap-1">
            <span className="text-xs font-medium text-muted-foreground">{DENOM_LABEL[d]}</span>
            <div className="flex items-center gap-1">
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
              <span
                aria-label={DENOM_LABEL[d]}
                className="min-w-[2ch] text-center tabular-nums text-sm"
              >
                {holding[d]}
              </span>
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
            </div>
          </li>
        ))}
      </ul>

      <p className="text-xs text-muted-foreground tabular-nums">Total: {totalGp} gp</p>

      <ConvertCurrencyModal
        stashId={stashId}
        open={convertOpen}
        onOpenChange={setConvertOpen}
      />
      <CurrencyTransferModal
        stashId={stashId}
        open={transferOpen}
        onOpenChange={setTransferOpen}
      />
    </section>
  );
}
