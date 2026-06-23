import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CreateStashModal } from './CreateStashModal';
import { Toaster } from '@/components/ui/sonner';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';

import { bootstrap } from '@/test/fixtures';

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

function renderWith(open: boolean, characterId: string, onOpenChange = (_: boolean) => {}): void {
  render(
    <>
      <CreateStashModal open={open} onOpenChange={onOpenChange} ownerCharacterId={characterId} />
      <Toaster />
    </>,
  );
}

describe('CreateStashModal (M3)', () => {
  it('does not render when open=false', () => {
    const { characterId } = bootstrap();
    renderWith(false, characterId);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the form when open=true', () => {
    const { characterId } = bootstrap();
    renderWith(true, characterId);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
  });

  it('shows a validation error and does NOT dispatch when name is empty', async () => {
    const user = userEvent.setup();
    const { characterId } = bootstrap();
    const beforeStashes = useStore.getState().appState!.stashes.length;
    renderWith(true, characterId);

    await user.click(screen.getByRole('button', { name: /create/i }));

    // Error visible (role=alert).
    expect(screen.getByRole('alert')).toHaveTextContent(/required|empty|too short|at least/i);
    // No new stash dispatched.
    expect(useStore.getState().appState!.stashes).toHaveLength(beforeStashes);
  });

  it('shows a validation error and does NOT dispatch when name is too long (> 60 chars)', async () => {
    const user = userEvent.setup();
    const { characterId } = bootstrap();
    const beforeStashes = useStore.getState().appState!.stashes.length;
    renderWith(true, characterId);

    await user.type(screen.getByLabelText(/name/i), 'a'.repeat(61));
    await user.click(screen.getByRole('button', { name: /create/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/too long|60|at most/i);
    expect(useStore.getState().appState!.stashes).toHaveLength(beforeStashes);
  });

  it('dispatches create-stash and fires onOpenChange(false) on submit', async () => {
    const user = userEvent.setup();
    const { characterId } = bootstrap();
    let openValue = true;
    const onOpenChange = (next: boolean): void => {
      openValue = next;
    };
    renderWith(true, characterId, onOpenChange);

    await user.type(screen.getByLabelText(/name/i), 'Chest at home');
    await user.click(screen.getByRole('button', { name: /create/i }));

    const stashes = useStore.getState().appState!.stashes;
    const created = stashes.find((s) => s.name === 'Chest at home');
    expect(created).toBeDefined();
    expect(created?.scope).toBe('character');
    expect(created?.isCarried).toBe(false);
    expect(openValue).toBe(false);
  });

  it('shows a "Storage stash created" toast on success', async () => {
    const user = userEvent.setup();
    const { characterId } = bootstrap();
    renderWith(true, characterId);

    await user.type(screen.getByLabelText(/name/i), 'Vault');
    await user.click(screen.getByRole('button', { name: /create/i }));

    expect(await screen.findByText(/storage stash created/i)).toBeInTheDocument();
  });
});
