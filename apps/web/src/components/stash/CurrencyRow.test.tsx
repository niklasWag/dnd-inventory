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

  it('opens the Transfer modal when the Transfer button is clicked (M5.5)', async () => {
    const user = userEvent.setup();
    const { inventoryStashId } = bootstrap();
    render(<CurrencyRow stashId={inventoryStashId} />);

    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: /^transfer$/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/transfer currency/i)).toBeInTheDocument();
  });
});

// -------------------- R4.2.e — banker context visibility --------------------

describe('CurrencyRow — bankerContext visibility (R4.2.e)', () => {
  it('when userIsBanker + isPartyStash, shows Split evenly + keeps Transfer/Convert', () => {
    const { partyStashId } = bootstrap();
    render(
      <CurrencyRow
        stashId={partyStashId}
        bankerContext={{
          userIsBanker: true,
          userIsDmWithBankerActive: false,
          userIsGatedFromPool: false,
          isPartyStash: true,
        }}
      />,
    );
    expect(screen.getByRole('button', { name: /^split evenly$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^transfer$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^convert$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^drain$/i })).not.toBeInTheDocument();
  });

  it('when userIsBanker but isPartyStash=false (Recovered Loot), no Split evenly button', () => {
    const { recoveredLootStashId } = bootstrap();
    render(
      <CurrencyRow
        stashId={recoveredLootStashId}
        bankerContext={{
          userIsBanker: true,
          userIsDmWithBankerActive: false,
          userIsGatedFromPool: false,
          isPartyStash: false,
        }}
      />,
    );
    expect(screen.queryByRole('button', { name: /^split evenly$/i })).not.toBeInTheDocument();
  });

  it('when userIsDmWithBankerActive, shows Drain + hides withdraw −, Transfer, Convert', () => {
    const { partyStashId } = bootstrap();
    render(
      <CurrencyRow
        stashId={partyStashId}
        bankerContext={{
          userIsBanker: false,
          userIsDmWithBankerActive: true,
          userIsGatedFromPool: false,
          isPartyStash: true,
        }}
      />,
    );
    expect(screen.getByRole('button', { name: /^drain$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^transfer$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^convert$/i })).not.toBeInTheDocument();
    // Withdraw (−) is hidden but Deposit (+) stays visible for the DM.
    expect(screen.queryByLabelText(/decrement gp/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/increment gp/i)).toBeInTheDocument();
  });

  it('when userIsGatedFromPool, hides withdraw, deposit, transfer, convert, split, drain', () => {
    const { partyStashId } = bootstrap();
    render(
      <CurrencyRow
        stashId={partyStashId}
        bankerContext={{
          userIsBanker: false,
          userIsDmWithBankerActive: false,
          userIsGatedFromPool: true,
          isPartyStash: true,
        }}
      />,
    );
    expect(screen.queryByRole('button', { name: /^split evenly$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^drain$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^transfer$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^convert$/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/decrement gp/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/increment gp/i)).not.toBeInTheDocument();
    // Balance itself still shown (read-only view).
    expect(screen.getByLabelText(/^gp$/i)).toBeInTheDocument();
  });

  it('when bankerContext is undefined (Inventory), renders the full default control set', () => {
    const { inventoryStashId } = bootstrap();
    render(<CurrencyRow stashId={inventoryStashId} />);
    expect(screen.getByRole('button', { name: /^transfer$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^convert$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^split evenly$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^drain$/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/increment gp/i)).toBeInTheDocument();
  });
});

// -------------------- R7.4 — bulk currency edit --------------------

describe('CurrencyRow — bulk edit (R7.4)', () => {
  it('typing +300 into the sp cell + Enter dispatches a single currency-change with delta.sp=+300', async () => {
    const user = userEvent.setup();
    const { inventoryStashId } = bootstrap();
    render(<CurrencyRow stashId={inventoryStashId} />);

    const beforeLen = useStore.getState().log.length;

    // Click the value to open the editor.
    await user.click(screen.getByRole('button', { name: /^sp$/i }));
    const input = screen.getByRole('textbox', { name: /edit sp/i });
    await user.clear(input);
    await user.type(input, '+300');
    await user.keyboard('{Enter}');

    const log = useStore.getState().log;
    expect(log.length).toBe(beforeLen + 1);
    const last = log.at(-1)!;
    if (last.type !== 'currency-change') throw new Error('expected currency-change');
    expect(last.payload.stashId).toBe(inventoryStashId);
    expect(last.payload.delta).toEqual({ cp: 0, sp: 300, ep: 0, gp: 0, pp: 0 });
    expect(last.payload.reason).toBe('deposit');
    expect(screen.getByRole('button', { name: /^sp$/i })).toHaveTextContent('300');
  });

  it('typing -50 into a cell with insufficient funds blocks the dispatch and keeps the input open', async () => {
    const user = userEvent.setup();
    const { inventoryStashId } = bootstrap();
    render(<CurrencyRow stashId={inventoryStashId} />);

    const beforeLen = useStore.getState().log.length;
    await user.click(screen.getByRole('button', { name: /^sp$/i }));
    const input = screen.getByRole('textbox', { name: /edit sp/i });
    await user.clear(input);
    await user.type(input, '-50');
    await user.keyboard('{Enter}');

    // No dispatch.
    expect(useStore.getState().log.length).toBe(beforeLen);
    // Input still visible + marked invalid.
    const stillOpen = screen.getByRole('textbox', { name: /edit sp/i });
    expect(stillOpen).toHaveAttribute('aria-invalid', 'true');
  });

  it('typing =42 into a cell holding 30 dispatches a delta of +12', async () => {
    const user = userEvent.setup();
    const { inventoryStashId } = bootstrap();
    // Seed the sp cell to 30 first.
    useStore.getState().dispatch({
      type: 'currency-change',
      payload: {
        stashId: inventoryStashId,
        delta: { cp: 0, sp: 30, ep: 0, gp: 0, pp: 0 },
        reason: 'deposit',
      },
    });
    render(<CurrencyRow stashId={inventoryStashId} />);

    const beforeLen = useStore.getState().log.length;
    await user.click(screen.getByRole('button', { name: /^sp$/i }));
    const input = screen.getByRole('textbox', { name: /edit sp/i });
    await user.clear(input);
    await user.type(input, '=42');
    await user.keyboard('{Enter}');

    expect(useStore.getState().log.length).toBe(beforeLen + 1);
    const last = useStore.getState().log.at(-1)!;
    if (last.type !== 'currency-change') throw new Error('expected currency-change');
    expect(last.payload.delta).toEqual({ cp: 0, sp: 12, ep: 0, gp: 0, pp: 0 });
    expect(last.payload.reason).toBe('deposit');
    expect(screen.getByRole('button', { name: /^sp$/i })).toHaveTextContent('42');
  });

  it('Escape cancels an in-flight edit without dispatching', async () => {
    const user = userEvent.setup();
    const { inventoryStashId } = bootstrap();
    render(<CurrencyRow stashId={inventoryStashId} />);
    const beforeLen = useStore.getState().log.length;
    await user.click(screen.getByRole('button', { name: /^gp$/i }));
    const input = screen.getByRole('textbox', { name: /edit gp/i });
    await user.clear(input);
    await user.type(input, '+9999');
    await user.keyboard('{Escape}');

    expect(useStore.getState().log.length).toBe(beforeLen);
    // Input is gone, value cell shows the pre-edit value.
    expect(screen.queryByRole('textbox', { name: /edit gp/i })).toBeNull();
    expect(screen.getByRole('button', { name: /^gp$/i })).toHaveTextContent('0');
  });

  it('a gated-pool viewer sees the value as an inert span, not editable', () => {
    const { partyStashId } = bootstrap();
    render(
      <CurrencyRow
        stashId={partyStashId}
        bankerContext={{
          userIsBanker: false,
          userIsDmWithBankerActive: false,
          userIsGatedFromPool: true,
          isPartyStash: true,
        }}
      />,
    );
    // Not a button — a plain labelled span.
    expect(screen.queryByRole('button', { name: /^gp$/i })).toBeNull();
    expect(screen.getByLabelText(/^gp$/i)).toBeInTheDocument();
  });
});
