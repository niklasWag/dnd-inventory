import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, act } from '@testing-library/react';

import { useDispatch } from './useDispatch';
import { useStore } from '@/store';
import type { MutationOutcome } from '@/store/outcome';
import type { Action } from '@/store/types';

// Default mode is local (no VITE_SERVER_URL) — the interim "Queued…"
// toast is server-mode only, so local-mode tests exercise the pure
// outcome-routing branch without an interim toast.
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(() => 'loading-id'),
    dismiss: vi.fn(),
  },
}));

import { toast } from 'sonner';

/**
 * Drives `useDispatch` from a component and exposes the returned
 * dispatcher on `window` so the test can invoke it and await the
 * outcome. Simpler than `renderHook` for a hook that returns a callback.
 */
let captured: ReturnType<typeof useDispatch> | null = null;
function Probe(): ReactElement {
  captured = useDispatch();
  return <span data-testid="probe">ready</span>;
}

const noopAction = { type: 'edit-item-instance', payload: {} } as unknown as Action;

function stubDispatchOutcome(outcome: MutationOutcome): void {
  useStore.setState({
    dispatch: vi.fn(() => Promise.resolve(outcome)),
  } as unknown as Partial<ReturnType<typeof useStore.getState>>);
}

beforeEach(() => {
  captured = null;
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.loading).mockClear();
  vi.mocked(toast.dismiss).mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('R8.5 — useDispatch', () => {
  it('runs onSuccess only on { ok: true } and passes the applied entries', async () => {
    stubDispatchOutcome({ ok: true, applied: [] });
    render(<Probe />);
    const onSuccess = vi.fn();

    await act(async () => {
      await captured!(noopAction, { onSuccess });
    });

    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('does NOT run onSuccess on { ok: false }', async () => {
    stubDispatchOutcome({ ok: false, code: 'dm_only', message: 'DM only.' });
    render(<Probe />);
    const onSuccess = vi.fn();

    await act(async () => {
      await captured!(noopAction, { onSuccess });
    });

    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('routes a rejection to onRejection when provided', async () => {
    stubDispatchOutcome({ ok: false, code: 'banker_required_for_claim', message: 'Nope.' });
    render(<Probe />);
    const onRejection = vi.fn();

    await act(async () => {
      await captured!(noopAction, { onRejection });
    });

    expect(onRejection).toHaveBeenCalledWith('banker_required_for_claim', 'Nope.');
    // Custom consumer takes over — no default toast.
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('falls back to the default rejection toast when no onRejection is given', async () => {
    stubDispatchOutcome({ ok: false, code: 'dm_only', message: 'DM only.' });
    render(<Probe />);

    await act(async () => {
      await captured!(noopAction);
    });

    expect(toast.error).toHaveBeenCalledWith('Action rejected: dm_only', {
      description: 'DM only.',
    });
  });

  it('resolves the MutationOutcome to the caller for further branching', async () => {
    stubDispatchOutcome({ ok: true, applied: [] });
    render(<Probe />);

    let result: MutationOutcome | undefined;
    await act(async () => {
      result = await captured!(noopAction);
    });

    expect(result).toEqual({ ok: true, applied: [] });
  });
});
