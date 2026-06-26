import { describe, expect, it } from 'vitest';

import {
  BATCH_TRIGGER_ORDER,
  batchTriggerLabel,
  formatChargesLong,
  formatChargesShort,
  rechargeRuleLabel,
} from './charges';

describe('lib/charges helpers', () => {
  describe('rechargeRuleLabel', () => {
    it('formats each canonical rule', () => {
      expect(rechargeRuleLabel('dawn')).toBe('Recharges at dawn');
      expect(rechargeRuleLabel('dusk')).toBe('Recharges at dusk');
      expect(rechargeRuleLabel('long-rest')).toBe('Recharges on a long rest');
      expect(rechargeRuleLabel('short-rest')).toBe('Recharges on a short rest');
      expect(rechargeRuleLabel('custom')).toBe('DM-recharged');
      expect(rechargeRuleLabel('none')).toBe('Single use');
    });
  });

  describe('batchTriggerLabel', () => {
    it('formats each batch trigger', () => {
      expect(batchTriggerLabel('short-rest')).toBe('Short Rest');
      expect(batchTriggerLabel('long-rest')).toBe('Long Rest');
      expect(batchTriggerLabel('dawn')).toBe('Dawn');
      expect(batchTriggerLabel('dusk')).toBe('Dusk');
    });
  });

  describe('BATCH_TRIGGER_ORDER', () => {
    it('lists the four time-based triggers in the dropdown order', () => {
      expect(BATCH_TRIGGER_ORDER).toEqual(['short-rest', 'long-rest', 'dawn', 'dusk']);
    });
  });

  describe('formatChargesShort', () => {
    it('renders current/max when both present', () => {
      expect(formatChargesShort(3, 7)).toBe('3/7');
      expect(formatChargesShort(0, 7)).toBe('0/7');
    });

    it('renders an em-dash for current=null', () => {
      expect(formatChargesShort(null, 7)).toBe('—/7');
    });
  });

  describe('formatChargesLong', () => {
    it('includes formula when rechargeAmount is set', () => {
      expect(
        formatChargesLong(3, { max: 7, rechargeRule: 'dawn', rechargeAmount: '1d6+1' }),
      ).toBe('3 / 7 charges — Recharges at dawn (1d6+1)');
    });

    it('omits formula when rechargeAmount is undefined', () => {
      expect(formatChargesLong(10, { max: 10, rechargeRule: 'dawn' })).toBe(
        '10 / 10 charges — Recharges at dawn',
      );
    });

    it('renders "Single use" for none-rule items', () => {
      expect(formatChargesLong(1, { max: 1, rechargeRule: 'none' })).toBe(
        '1 / 1 charges — Single use',
      );
    });

    it('uses em-dash when current is null', () => {
      expect(formatChargesLong(null, { max: 7, rechargeRule: 'dawn' })).toBe(
        '— / 7 charges — Recharges at dawn',
      );
    });
  });
});
