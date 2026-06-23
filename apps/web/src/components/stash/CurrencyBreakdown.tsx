import type { ReactElement } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useStore } from '@/store';

interface CurrencyBreakdownProps {
  stashId: string;
}

const ZERO_HOLDING = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } as const;

/**
 * Compact 5-denomination display ("1c 2s 3e 25g 4p") for stash cards and
 * the StorageDetail header. Pulls the live CurrencyHolding by stashId and
 * formats it on a single line.
 *
 * Five separate values (not a single GP-equivalent) so the user can see
 * exactly what's in each pile at a glance — fast visual diff between
 * cards. The CurrencyRow inside each stash detail screen shows the same
 * five values plus a "Total: X gp" footer for the GP-equivalent read.
 *
 * `useShallow` returns a stable reference for the holding so the
 * component re-renders only when the holding actually changes (M2.5
 * lesson — fresh objects in selectors cause infinite loops).
 */
export function CurrencyBreakdown({ stashId }: CurrencyBreakdownProps): ReactElement {
  const holding = useStore(
    useShallow((s) => {
      const c = s.appState?.currencies.find((row) => row.stashId === stashId);
      if (c === undefined) return ZERO_HOLDING;
      return { cp: c.cp, sp: c.sp, ep: c.ep, gp: c.gp, pp: c.pp };
    }),
  );

  return (
    <span className="tabular-nums">
      <span>{holding.cp}c</span>
      {' '}
      <span>{holding.sp}s</span>
      {' '}
      <span>{holding.ep}e</span>
      {' '}
      <span>{holding.gp}g</span>
      {' '}
      <span>{holding.pp}p</span>
    </span>
  );
}
