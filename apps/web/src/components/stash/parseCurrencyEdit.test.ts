import { describe, expect, it } from 'vitest';

import { parseCurrencyEdit } from './parseCurrencyEdit';

describe('parseCurrencyEdit — deltas', () => {
  it('+N returns a positive delta with reason=deposit', () => {
    expect(parseCurrencyEdit('+300', 0)).toEqual({
      kind: 'commit',
      deltaValue: 300,
      reason: 'deposit',
    });
  });

  it('-N returns a negative delta with reason=withdraw', () => {
    expect(parseCurrencyEdit('-50', 100)).toEqual({
      kind: 'commit',
      deltaValue: -50,
      reason: 'withdraw',
    });
  });

  it('+0 is a no-op', () => {
    expect(parseCurrencyEdit('+0', 5)).toEqual({ kind: 'noop' });
  });

  it('rejects a signed delta that pushes the denomination negative', () => {
    const result = parseCurrencyEdit('-50', 10);
    expect(result.kind).toBe('reject');
  });
});

describe('parseCurrencyEdit — absolute (= and bare int)', () => {
  it('=N returns the diff needed to reach N', () => {
    expect(parseCurrencyEdit('=42', 30)).toEqual({
      kind: 'commit',
      deltaValue: 12,
      reason: 'deposit',
    });
  });

  it('=N below current returns a negative diff with reason=withdraw', () => {
    expect(parseCurrencyEdit('=10', 30)).toEqual({
      kind: 'commit',
      deltaValue: -20,
      reason: 'withdraw',
    });
  });

  it('=N when N equals current is a no-op', () => {
    expect(parseCurrencyEdit('=30', 30)).toEqual({ kind: 'noop' });
  });

  it('bare integer is treated as absolute (=N)', () => {
    expect(parseCurrencyEdit('42', 30)).toEqual({
      kind: 'commit',
      deltaValue: 12,
      reason: 'deposit',
    });
  });

  it('bare 0 is absolute-zero → withdraw everything', () => {
    expect(parseCurrencyEdit('0', 30)).toEqual({
      kind: 'commit',
      deltaValue: -30,
      reason: 'withdraw',
    });
  });

  it('rejects a negative absolute target', () => {
    expect(parseCurrencyEdit('=-5', 0).kind).toBe('reject');
  });
});

describe('parseCurrencyEdit — edge cases', () => {
  it('empty input is a no-op', () => {
    expect(parseCurrencyEdit('', 30)).toEqual({ kind: 'noop' });
  });

  it('whitespace-only input is a no-op', () => {
    expect(parseCurrencyEdit('   ', 30)).toEqual({ kind: 'noop' });
  });

  it('trims surrounding whitespace', () => {
    expect(parseCurrencyEdit('  +5  ', 0)).toEqual({
      kind: 'commit',
      deltaValue: 5,
      reason: 'deposit',
    });
  });

  it('rejects non-integer input', () => {
    expect(parseCurrencyEdit('abc', 0).kind).toBe('reject');
    expect(parseCurrencyEdit('+3.5', 0).kind).toBe('reject');
    expect(parseCurrencyEdit('5x', 0).kind).toBe('reject');
    expect(parseCurrencyEdit('+ 5', 0).kind).toBe('reject');
  });
});
