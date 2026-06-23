import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RenameStashModal } from './RenameStashModal';
import { Toaster } from '@/components/ui/sonner';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';

import { bootstrap } from '@/test/fixtures';

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

function setup(initialName: string): { stashId: string; rerender: () => void } {
  const { characterId } = bootstrap();
  useStore.getState().dispatch({
    type: 'create-stash',
    payload: { ownerCharacterId: characterId, name: initialName },
  });
  const stashId = useStore.getState().appState!.stashes.at(-1)!.id;
  const view = render(
    <>
      <RenameStashModal
        open
        onOpenChange={() => {}}
        stashId={stashId}
        currentName={initialName}
      />
      <Toaster />
    </>,
  );
  return { stashId, rerender: () => view.rerender(<></>) };
}

describe('RenameStashModal (M3)', () => {
  it('pre-fills the input with the current name', () => {
    setup('Chest at home');
    const input = screen.getByRole('dialog').querySelector('input#rename-stash-name');
    expect((input as HTMLInputElement).value).toBe('Chest at home');
  });

  it('shows a validation error on empty newName', async () => {
    const user = userEvent.setup();
    setup('Vault');
    const input = screen.getByRole('dialog').querySelector('input#rename-stash-name')!;
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/required|empty|at least/i);
  });

  it('shows a validation error on names longer than 60 characters', async () => {
    const user = userEvent.setup();
    setup('Vault');
    const input = screen.getByRole('dialog').querySelector('input#rename-stash-name')!;
    await user.clear(input);
    await user.type(input, 'a'.repeat(61));
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/too long|60|at most/i);
  });

  it('dispatches rename-stash and toasts on successful submit', async () => {
    const user = userEvent.setup();
    const { stashId } = setup('Before');
    const input = screen.getByRole('dialog').querySelector('input#rename-stash-name')!;
    await user.clear(input);
    await user.type(input, 'After');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    const stash = useStore.getState().appState!.stashes.find((st) => st.id === stashId);
    expect(stash?.name).toBe('After');
    expect(await screen.findByText(/storage stash renamed/i)).toBeInTheDocument();
  });

  it('treats a same-name submit as a no-op (closes without dispatching)', async () => {
    const user = userEvent.setup();
    const { stashId } = setup('Vault');
    const beforeLogLen = useStore.getState().log.length;
    const input = screen.getByRole('dialog').querySelector('input#rename-stash-name')!;
    // Re-type the same name; submission should NOT throw nor add a log entry.
    await user.clear(input);
    await user.type(input, 'Vault');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(useStore.getState().log).toHaveLength(beforeLogLen);
    expect(useStore.getState().appState!.stashes.find((st) => st.id === stashId)?.name).toBe(
      'Vault',
    );
  });
});
