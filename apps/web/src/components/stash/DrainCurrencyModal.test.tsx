import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { DrainCurrencyModal } from './DrainCurrencyModal';
import { Toaster } from '@/components/ui/sonner';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';
import { bootstrap } from '@/test/fixtures';

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

/**
 * R4.2.e — DrainCurrencyModal tests. Focus on payload correctness
 * (`reason: 'gameplay-drain'` + negative delta) and Confirm gating.
 * The permission side (DM-only, Banker-active precondition) is enforced
 * by the guard layer and exercised by the R4.2.d server integration
 * tests; here we only cover the component's own logic.
 */
function setupWithPool(gp: number): { partyStashId: string } {
  const base = bootstrap();
  useStore.setState((prev) => {
    if (prev.appState === null) return prev;
    return {
      ...prev,
      appState: {
        ...prev.appState,
        currencies: prev.appState.currencies.map((c) =>
          c.stashId === base.partyStashId ? { ...c, gp } : c,
        ),
      },
    };
  });
  return { partyStashId: base.partyStashId };
}

function renderModal(open: boolean, stashId: string): void {
  render(
    <MemoryRouter>
      <DrainCurrencyModal
        stashId={stashId}
        stashLabel="Party Stash"
        open={open}
        onOpenChange={() => undefined}
      />
      <Toaster />
    </MemoryRouter>,
  );
}

describe('DrainCurrencyModal (R4.2.e)', () => {
  it('does not render when open=false', () => {
    const { partyStashId } = setupWithPool(10);
    renderModal(false, partyStashId);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders five denomination inputs when open', () => {
    const { partyStashId } = setupWithPool(10);
    renderModal(true, partyStashId);
    expect(screen.getByLabelText(/drain cp/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/drain sp/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/drain ep/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/drain gp/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/drain pp/i)).toBeInTheDocument();
  });

  it('Drain button is disabled when all amounts are zero', () => {
    const { partyStashId } = setupWithPool(10);
    renderModal(true, partyStashId);
    const drain = screen.getByRole('button', { name: /^drain$/i });
    expect(drain).toBeDisabled();
  });

  it('shows overspending warning + disables Drain when amount exceeds pool', async () => {
    const user = userEvent.setup();
    const { partyStashId } = setupWithPool(5);
    renderModal(true, partyStashId);
    const gpInput = screen.getByLabelText(/drain gp/i);
    await user.clear(gpInput);
    await user.type(gpInput, '10');
    expect(screen.getByText(/exceeds available/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^drain$/i })).toBeDisabled();
  });

  it('dispatches currency-change with reason=gameplay-drain and negative delta on Confirm', async () => {
    const user = userEvent.setup();
    const { partyStashId } = setupWithPool(10);
    renderModal(true, partyStashId);

    const gpInput = screen.getByLabelText(/drain gp/i);
    await user.clear(gpInput);
    await user.type(gpInput, '3');

    const beforeLog = useStore.getState().log.length;
    await user.click(screen.getByRole('button', { name: /^drain$/i }));
    const last = useStore.getState().log.at(-1);
    expect(useStore.getState().log.length).toBe(beforeLog + 1);
    expect(last?.type).toBe('currency-change');
    if (last?.type !== 'currency-change') throw new Error('expected currency-change');
    expect(last.payload.reason).toBe('gameplay-drain');
    expect(last.payload.delta).toEqual({
      cp: 0, sp: 0, ep: 0, gp: -3, pp: 0,
    });
    expect(last.payload.stashId).toBe(partyStashId);
  });
});
