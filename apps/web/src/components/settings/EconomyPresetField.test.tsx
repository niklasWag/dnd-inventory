import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { EconomyPresetField } from './EconomyPresetField';
import { Toaster } from '@/components/ui/sonner';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';
import { bootstrap } from '@/test/fixtures';

/**
 * R6.1 — EconomyPresetField component tests.
 *
 * Covers the preset dropdown, the Custom-fields path, atomic dispatch
 * on Save, and the no-op-disabled Save button.
 */

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

function renderField(): void {
  const s = useStore.getState().appState!;
  render(
    <>
      <EconomyPresetField
        partyId={s.party.id}
        currentPriceModifier={s.party.priceModifier}
        currentBaseCurrency={s.party.baseCurrency}
      />
      <Toaster />
    </>,
  );
}

describe('EconomyPresetField (R6.1)', () => {
  it('renders with the current preset selected — bootstrap defaults to Gold', () => {
    bootstrap();
    renderField();
    const select = screen.getByLabelText(/^Economy preset$/i);
    expect((select as HTMLSelectElement).value).toBe('gold');
  });

  it('lists all six preset options', () => {
    bootstrap();
    renderField();
    const select = screen.getByLabelText(/^Economy preset$/i);
    const values = Array.from(select.querySelectorAll('option')).map((o) => o.value);
    expect(values).toEqual(['gold', 'silver', 'copper', 'electrum', 'platinum', 'custom']);
  });

  it('selecting Silver standard dispatches update-party-economy with 0.1× / sp', async () => {
    const user = userEvent.setup();
    const { partyId } = bootstrap();
    const logLenBefore = useStore.getState().log.length;
    renderField();

    await user.selectOptions(screen.getByLabelText(/^Economy preset$/i), 'silver');
    await user.click(screen.getByRole('button', { name: /^Save$/i }));

    const s = useStore.getState().appState!;
    expect(s.party.priceModifier).toBe(0.1);
    expect(s.party.baseCurrency).toBe('sp');
    const entries = useStore
      .getState()
      .log.slice(logLenBefore)
      .filter((e) => e.type === 'update-party-economy');
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    if (entry.type !== 'update-party-economy') throw new Error('expected update-party-economy');
    expect(entry.payload).toMatchObject({
      partyId,
      oldPriceModifier: 1.0,
      newPriceModifier: 0.1,
      oldBaseCurrency: 'gp',
      newBaseCurrency: 'sp',
    });
  });

  it('Save button is disabled when the draft matches current (no-op guard)', () => {
    bootstrap();
    renderField();
    const btn = screen.getByRole('button', { name: /^Save$/i });
    expect(btn).toBeDisabled();
  });

  it('selecting Custom reveals raw priceModifier + baseCurrency inputs', async () => {
    const user = userEvent.setup();
    bootstrap();
    renderField();

    // Raw inputs are hidden by default (bootstrap = Gold, not custom).
    expect(screen.queryByLabelText(/^Price modifier$/i)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/^Economy preset$/i), 'custom');

    expect(screen.getByLabelText(/^Price modifier$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Base currency$/i)).toBeInTheDocument();
  });

  it('Custom modifier=2.0 baseCurrency=gp dispatches with those raw values', async () => {
    const user = userEvent.setup();
    bootstrap();
    renderField();

    await user.selectOptions(screen.getByLabelText(/^Economy preset$/i), 'custom');
    const modifier = screen.getByLabelText(/^Price modifier$/i);
    await user.clear(modifier);
    await user.type(modifier, '2');
    await user.click(screen.getByRole('button', { name: /^Save$/i }));

    const s = useStore.getState().appState!;
    expect(s.party.priceModifier).toBe(2);
    expect(s.party.baseCurrency).toBe('gp');
  });

  it('Custom with priceModifier=0 shows validation error, does not dispatch', async () => {
    const user = userEvent.setup();
    bootstrap();
    renderField();
    const logLenBefore = useStore.getState().log.length;

    await user.selectOptions(screen.getByLabelText(/^Economy preset$/i), 'custom');
    const modifier = screen.getByLabelText(/^Price modifier$/i);
    await user.clear(modifier);
    await user.type(modifier, '0');
    const btn = screen.getByRole('button', { name: /^Save$/i });
    // Button disables on invalid input.
    expect(btn).toBeDisabled();

    // Confirm no dispatch fired.
    expect(useStore.getState().log.length).toBe(logLenBefore);
  });
});
