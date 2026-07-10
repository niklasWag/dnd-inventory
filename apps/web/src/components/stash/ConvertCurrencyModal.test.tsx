import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ConvertCurrencyModal } from './ConvertCurrencyModal';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';

import { bootstrap } from '@/test/fixtures';

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

/**
 * Seed `gp` into a stash so the convert tests have something to source
 * from. Uses the live dispatch path (M4 verified).
 */
function seedGp(stashId: string, amount: number): void {
  void useStore.getState().dispatch({
    type: 'currency-change',
    payload: {
      stashId,
      delta: { cp: 0, sp: 0, ep: 0, gp: amount, pp: 0 },
      reason: 'deposit',
    },
  });
}

describe('ConvertCurrencyModal (M4)', () => {
  it('does not render when closed', () => {
    const { inventoryStashId } = bootstrap();
    render(<ConvertCurrencyModal stashId={inventoryStashId} open={false} onOpenChange={vi.fn()} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the convert form when open', () => {
    const { inventoryStashId } = bootstrap();
    render(<ConvertCurrencyModal stashId={inventoryStashId} open={true} onOpenChange={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/quantity/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/source/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/target/i)).toBeInTheDocument();
  });

  it('previews the converted amount when source/qty/target are set', async () => {
    const user = userEvent.setup();
    const { inventoryStashId } = bootstrap();
    seedGp(inventoryStashId, 1);
    render(<ConvertCurrencyModal stashId={inventoryStashId} open={true} onOpenChange={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText(/source/i), 'gp');
    await user.selectOptions(screen.getByLabelText(/target/i), 'sp');
    const qty = screen.getByLabelText(/quantity/i);
    await user.clear(qty);
    await user.type(qty, '1');

    // 1 gp → 10 sp.
    await waitFor(() => {
      expect(screen.getByText(/1 gp = 10 sp/i)).toBeInTheDocument();
    });
  });

  it('disables submit when source has insufficient quantity', async () => {
    const user = userEvent.setup();
    const { inventoryStashId } = bootstrap();
    // Only 1 gp in the stash — try to convert 2 gp.
    seedGp(inventoryStashId, 1);
    render(<ConvertCurrencyModal stashId={inventoryStashId} open={true} onOpenChange={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText(/source/i), 'gp');
    await user.selectOptions(screen.getByLabelText(/target/i), 'sp');
    const qty = screen.getByLabelText(/quantity/i);
    await user.clear(qty);
    await user.type(qty, '2');

    const submit = screen.getByRole('button', { name: /^convert$/i });
    await waitFor(() => {
      expect(submit).toBeDisabled();
    });
  });

  it('disables submit on a lossy conversion (1 sp → gp)', async () => {
    const user = userEvent.setup();
    const { inventoryStashId } = bootstrap();
    void useStore.getState().dispatch({
      type: 'currency-change',
      payload: {
        stashId: inventoryStashId,
        delta: { cp: 0, sp: 1, ep: 0, gp: 0, pp: 0 },
        reason: 'deposit',
      },
    });
    render(<ConvertCurrencyModal stashId={inventoryStashId} open={true} onOpenChange={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText(/source/i), 'sp');
    await user.selectOptions(screen.getByLabelText(/target/i), 'gp');
    const qty = screen.getByLabelText(/quantity/i);
    await user.clear(qty);
    await user.type(qty, '1');

    const submit = screen.getByRole('button', { name: /^convert$/i });
    await waitFor(() => {
      expect(submit).toBeDisabled();
    });
  });

  it('disables submit when source equals target', async () => {
    const user = userEvent.setup();
    const { inventoryStashId } = bootstrap();
    seedGp(inventoryStashId, 1);
    render(<ConvertCurrencyModal stashId={inventoryStashId} open={true} onOpenChange={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText(/source/i), 'gp');
    await user.selectOptions(screen.getByLabelText(/target/i), 'gp');
    const qty = screen.getByLabelText(/quantity/i);
    await user.clear(qty);
    await user.type(qty, '1');

    const submit = screen.getByRole('button', { name: /^convert$/i });
    await waitFor(() => {
      expect(submit).toBeDisabled();
    });
  });

  it('dispatches a single currency-change with reason=convert on submit', async () => {
    const user = userEvent.setup();
    const { inventoryStashId } = bootstrap();
    seedGp(inventoryStashId, 1);
    const onOpenChange = vi.fn();
    render(
      <ConvertCurrencyModal stashId={inventoryStashId} open={true} onOpenChange={onOpenChange} />,
    );
    const beforeLen = useStore.getState().log.length;

    await user.selectOptions(screen.getByLabelText(/source/i), 'gp');
    await user.selectOptions(screen.getByLabelText(/target/i), 'sp');
    const qty = screen.getByLabelText(/quantity/i);
    await user.clear(qty);
    await user.type(qty, '1');
    await user.click(screen.getByRole('button', { name: /^convert$/i }));

    await waitFor(() => {
      expect(useStore.getState().log.length).toBe(beforeLen + 1);
    });
    const last = useStore.getState().log.at(-1)!;
    if (last.type !== 'currency-change') throw new Error('expected currency-change');
    expect(last.payload.delta).toEqual({ cp: 0, sp: 10, ep: 0, gp: -1, pp: 0 });
    expect(last.payload.reason).toBe('convert');

    // Modal closed after successful submit.
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('rejects qty <= 0 (Zod boundary)', async () => {
    const user = userEvent.setup();
    const { inventoryStashId } = bootstrap();
    seedGp(inventoryStashId, 5);
    render(<ConvertCurrencyModal stashId={inventoryStashId} open={true} onOpenChange={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText(/source/i), 'gp');
    await user.selectOptions(screen.getByLabelText(/target/i), 'sp');
    const qty = screen.getByLabelText(/quantity/i);
    await user.clear(qty);
    await user.type(qty, '0');

    const submit = screen.getByRole('button', { name: /^convert$/i });
    await waitFor(() => {
      expect(submit).toBeDisabled();
    });
  });
});
