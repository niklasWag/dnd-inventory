import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CurrencyRow } from './CurrencyRow';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';

import { bootstrap } from '@/test/fixtures';

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

describe('CurrencyRow (M4)', () => {
  it('renders all five denominations with zero values from a fresh stash', () => {
    const { inventoryStashId } = bootstrap();
    render(<CurrencyRow stashId={inventoryStashId} />);
    // Each denomination cell has an accessible label.
    expect(screen.getByLabelText(/^cp$/i)).toHaveTextContent('0');
    expect(screen.getByLabelText(/^sp$/i)).toHaveTextContent('0');
    expect(screen.getByLabelText(/^ep$/i)).toHaveTextContent('0');
    expect(screen.getByLabelText(/^gp$/i)).toHaveTextContent('0');
    expect(screen.getByLabelText(/^pp$/i)).toHaveTextContent('0');
  });

  it('renders the GP-equivalent total beneath the cells', () => {
    const { inventoryStashId } = bootstrap();
    render(<CurrencyRow stashId={inventoryStashId} />);
    expect(screen.getByText(/total: 0 gp/i)).toBeInTheDocument();
  });

  it('disables the "−" button on a denomination at 0', () => {
    const { inventoryStashId } = bootstrap();
    render(<CurrencyRow stashId={inventoryStashId} />);
    const decGp = screen.getByLabelText(/decrement gp/i);
    expect(decGp).toBeDisabled();
  });

  it('dispatches currency-change with reason=deposit when "+" is clicked', async () => {
    const user = userEvent.setup();
    const { inventoryStashId } = bootstrap();
    render(<CurrencyRow stashId={inventoryStashId} />);

    await user.click(screen.getByLabelText(/increment gp/i));

    const last = useStore.getState().log.at(-1)!;
    expect(last.type).toBe('currency-change');
    if (last.type !== 'currency-change') throw new Error('expected currency-change');
    expect(last.payload.stashId).toBe(inventoryStashId);
    expect(last.payload.delta).toEqual({ cp: 0, sp: 0, ep: 0, gp: 1, pp: 0 });
    expect(last.payload.reason).toBe('deposit');

    // UI reflects the new value.
    expect(screen.getByLabelText(/^gp$/i)).toHaveTextContent('1');
    expect(screen.getByText(/total: 1 gp/i)).toBeInTheDocument();
  });

  it('dispatches currency-change with reason=withdraw when "−" is clicked from a non-zero balance', async () => {
    const user = userEvent.setup();
    const { inventoryStashId } = bootstrap();
    // Seed +1 gp directly via dispatch so the row has something to subtract.
    useStore.getState().dispatch({
      type: 'currency-change',
      payload: {
        stashId: inventoryStashId,
        delta: { cp: 0, sp: 0, ep: 0, gp: 1, pp: 0 },
        reason: 'deposit',
      },
    });

    render(<CurrencyRow stashId={inventoryStashId} />);
    await user.click(screen.getByLabelText(/decrement gp/i));

    const last = useStore.getState().log.at(-1)!;
    if (last.type !== 'currency-change') throw new Error('expected currency-change');
    expect(last.payload.delta).toEqual({ cp: 0, sp: 0, ep: 0, gp: -1, pp: 0 });
    expect(last.payload.reason).toBe('withdraw');
    expect(screen.getByLabelText(/^gp$/i)).toHaveTextContent('0');
  });

  it('handles a fractional GP-equivalent total (1 sp = 0.1 gp)', async () => {
    const user = userEvent.setup();
    const { inventoryStashId } = bootstrap();
    render(<CurrencyRow stashId={inventoryStashId} />);
    await user.click(screen.getByLabelText(/increment sp/i));
    expect(screen.getByText(/total: 0\.1 gp/i)).toBeInTheDocument();
  });

  it('opens the Convert modal when the Convert button is clicked', async () => {
    const user = userEvent.setup();
    const { inventoryStashId } = bootstrap();
    render(<CurrencyRow stashId={inventoryStashId} />);

    // Modal is closed by default — no dialog yet.
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: /convert/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
