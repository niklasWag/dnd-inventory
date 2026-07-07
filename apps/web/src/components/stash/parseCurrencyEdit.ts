/**
 * R7.4 — parser for the inline bulk currency edit input.
 *
 * The `CurrencyRow` cell for each denomination accepts one of four
 * input shapes and translates them into a signed delta the reducer's
 * `currency-change` action accepts verbatim:
 *
 *   `+N`  → deposit N of this denomination
 *   `-N`  → withdraw N of this denomination
 *   `=N`  → set this denomination to exactly N (dispatch the diff)
 *   `N`   → same as `=N` (bare integer is absolute-target)
 *   ``    → no-op (empty input on blur)
 *
 * The parser is intentionally pure: input string + current holding →
 * decision. The consumer (CurrencyRow) is responsible for calling
 * `dispatch` and clearing the input. All arithmetic operates in the
 * single denomination the caller specifies — cross-denom conversion is
 * the Convert modal's job, not this one.
 *
 * Rejects (returned as `{ kind: 'reject', ... }` with a human-readable
 * reason):
 *   - non-integer / garbage input;
 *   - negative absolute target (`=-5`, `-5` in absolute mode);
 *   - deltas that would push the denomination below zero.
 *
 * Whitespace is trimmed; internal whitespace is a reject. The parser
 * does NOT clamp to any upper bound — the schema (§4 `currencyHolding`)
 * caps only at non-negative; the reducer will re-validate.
 */

export type EditReason = 'deposit' | 'withdraw';

export type ParseCurrencyEditResult =
  | { kind: 'noop' }
  | { kind: 'commit'; deltaValue: number; reason: EditReason }
  | { kind: 'reject'; message: string };

/**
 * @param input raw string from the input field
 * @param current the current value of the denomination on the stash
 */
export function parseCurrencyEdit(input: string, current: number): ParseCurrencyEditResult {
  const trimmed = input.trim();
  if (trimmed === '') return { kind: 'noop' };

  // Prefix detection. `=` and unsigned bare integer both mean absolute.
  let mode: 'delta' | 'absolute';
  let rest: string;
  if (trimmed.startsWith('+')) {
    mode = 'delta';
    rest = trimmed.slice(1);
  } else if (trimmed.startsWith('-')) {
    // `-N` is a signed delta — dispatch a negative diff.
    mode = 'delta';
    rest = trimmed; // keep the sign; parseInt handles it
  } else if (trimmed.startsWith('=')) {
    mode = 'absolute';
    rest = trimmed.slice(1);
  } else {
    // Bare integer → absolute target (user preference; see R7.4 plan).
    mode = 'absolute';
    rest = trimmed;
  }

  // Require the payload to be a pure integer literal (no floats, no
  // trailing units, no internal whitespace). `parseInt` alone is too
  // lax (`"5x"` → 5), so match first.
  if (!/^-?\d+$/.test(rest)) {
    return { kind: 'reject', message: 'Enter a whole number' };
  }
  const value = Number.parseInt(rest, 10);
  if (!Number.isSafeInteger(value)) {
    return { kind: 'reject', message: 'Number out of range' };
  }

  let deltaValue: number;
  if (mode === 'delta') {
    deltaValue = value;
  } else {
    // absolute
    if (value < 0) {
      return { kind: 'reject', message: 'Target cannot be negative' };
    }
    deltaValue = value - current;
  }

  if (deltaValue === 0) return { kind: 'noop' };
  if (current + deltaValue < 0) {
    return { kind: 'reject', message: 'Not enough to withdraw' };
  }

  return {
    kind: 'commit',
    deltaValue,
    reason: deltaValue > 0 ? 'deposit' : 'withdraw',
  };
}
