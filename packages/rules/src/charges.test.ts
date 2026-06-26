import { describe, expect, it } from 'vitest';

import {
  type BatchRechargeTrigger,
  type ChargeSpec,
  canUseCharge,
  eligibleForBatchRecharge,
  isSingleUse,
  rechargeTo,
  useCharge,
} from './charges';

describe('charges.useCharge', () => {
  it('decrements by 1 when called with no amount', () => {
    expect(useCharge(7)).toBe(6);
  });

  it('decrements by the provided amount', () => {
    expect(useCharge(7, 3)).toBe(4);
  });

  it('clamps at 0 when amount exceeds current', () => {
    expect(useCharge(2, 5)).toBe(0);
  });

  it('returns 0 when current is already 0', () => {
    expect(useCharge(0)).toBe(0);
  });

  it('throws on non-positive amount', () => {
    expect(() => useCharge(5, 0)).toThrow();
    expect(() => useCharge(5, -1)).toThrow();
  });
});

describe('charges.canUseCharge', () => {
  it('is true when current > 0', () => {
    expect(canUseCharge(1)).toBe(true);
    expect(canUseCharge(7)).toBe(true);
  });

  it('is false when current is 0', () => {
    expect(canUseCharge(0)).toBe(false);
  });

  it('is false when current is null', () => {
    expect(canUseCharge(null)).toBe(false);
  });
});

describe('charges.rechargeTo', () => {
  it('returns the spec max regardless of current value', () => {
    const spec: ChargeSpec = { max: 7, rechargeRule: 'dawn' };
    expect(rechargeTo(spec)).toBe(7);
  });

  it('works for staves with high max', () => {
    const spec: ChargeSpec = { max: 50, rechargeRule: 'dawn' };
    expect(rechargeTo(spec)).toBe(50);
  });
});

describe('charges.eligibleForBatchRecharge', () => {
  const trig = (t: BatchRechargeTrigger): BatchRechargeTrigger => t;
  const spec = (rule: ChargeSpec['rechargeRule']): ChargeSpec => ({ max: 7, rechargeRule: rule });

  it('matches on exact rule == trigger', () => {
    expect(eligibleForBatchRecharge(spec('dawn'), trig('dawn'))).toBe(true);
    expect(eligibleForBatchRecharge(spec('dusk'), trig('dusk'))).toBe(true);
    expect(eligibleForBatchRecharge(spec('long-rest'), trig('long-rest'))).toBe(true);
    expect(eligibleForBatchRecharge(spec('short-rest'), trig('short-rest'))).toBe(true);
  });

  it('is false when rule and trigger differ', () => {
    expect(eligibleForBatchRecharge(spec('dawn'), trig('long-rest'))).toBe(false);
    expect(eligibleForBatchRecharge(spec('long-rest'), trig('dawn'))).toBe(false);
    expect(eligibleForBatchRecharge(spec('dusk'), trig('short-rest'))).toBe(false);
  });

  it('is false for items with rechargeRule: custom (DM-only manual)', () => {
    expect(eligibleForBatchRecharge(spec('custom'), trig('dawn'))).toBe(false);
    expect(eligibleForBatchRecharge(spec('custom'), trig('long-rest'))).toBe(false);
  });

  it('is false for items with rechargeRule: none (single-use)', () => {
    expect(eligibleForBatchRecharge(spec('none'), trig('dawn'))).toBe(false);
    expect(eligibleForBatchRecharge(spec('none'), trig('long-rest'))).toBe(false);
  });
});

describe('charges.isSingleUse', () => {
  it('is true when rechargeRule is none', () => {
    expect(isSingleUse({ max: 1, rechargeRule: 'none' })).toBe(true);
  });

  it('is false for every other rule', () => {
    expect(isSingleUse({ max: 7, rechargeRule: 'dawn' })).toBe(false);
    expect(isSingleUse({ max: 7, rechargeRule: 'dusk' })).toBe(false);
    expect(isSingleUse({ max: 7, rechargeRule: 'long-rest' })).toBe(false);
    expect(isSingleUse({ max: 7, rechargeRule: 'short-rest' })).toBe(false);
    expect(isSingleUse({ max: 7, rechargeRule: 'custom' })).toBe(false);
  });
});
