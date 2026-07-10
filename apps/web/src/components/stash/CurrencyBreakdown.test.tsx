import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { CurrencyBreakdown } from './CurrencyBreakdown';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';

import { bootstrap } from '@/test/fixtures';

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

describe('CurrencyBreakdown (M4)', () => {
  it('renders all five denominations with their unit-letter suffixes for an all-zero holding', () => {
    const { inventoryStashId } = bootstrap();
    render(<CurrencyBreakdown stashId={inventoryStashId} />);
    // Single span string: "0c 0s 0e 0g 0p" (or similar formatting).
    // Test the visible-to-user text per-denomination.
    expect(screen.getByText(/0c/)).toBeInTheDocument();
    expect(screen.getByText(/0s/)).toBeInTheDocument();
    expect(screen.getByText(/0e/)).toBeInTheDocument();
    expect(screen.getByText(/0g/)).toBeInTheDocument();
    expect(screen.getByText(/0p/)).toBeInTheDocument();
  });

  it('reflects non-zero holdings live', () => {
    const { inventoryStashId } = bootstrap();
    void useStore.getState().dispatch({
      type: 'currency-change',
      payload: {
        stashId: inventoryStashId,
        delta: { cp: 1, sp: 2, ep: 3, gp: 25, pp: 4 },
        reason: 'deposit',
      },
    });
    render(<CurrencyBreakdown stashId={inventoryStashId} />);
    expect(screen.getByText(/1c/)).toBeInTheDocument();
    expect(screen.getByText(/2s/)).toBeInTheDocument();
    expect(screen.getByText(/3e/)).toBeInTheDocument();
    expect(screen.getByText(/25g/)).toBeInTheDocument();
    expect(screen.getByText(/4p/)).toBeInTheDocument();
  });

  it('uses tabular-nums for stable column widths across changing values', () => {
    const { inventoryStashId } = bootstrap();
    const { container } = render(<CurrencyBreakdown stashId={inventoryStashId} />);
    // tabular-nums Tailwind class compiles to font-variant-numeric: tabular-nums.
    const el = container.querySelector('.tabular-nums');
    expect(el).not.toBeNull();
  });
});
