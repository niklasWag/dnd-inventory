import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DeleteStashDialog } from './DeleteStashDialog';
import { Toaster } from '@/components/ui/sonner';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';

import { bootstrap } from '@/test/fixtures';
import { newUuidV7 } from '@app/shared';

/**
 * RH1.2 — id-injection helpers for direct `dispatch` sites. Fresh UUID
 * v7 per call keeps the fixture within the guard's clock-skew window
 * and hermetic per-test.
 */
function createStashIds() {
  return { newStashId: newUuidV7(), newCurrencyHoldingId: newUuidV7() };
}

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

function setup(
  stashName: string,
  itemCount: number,
): {
  stashId: string;
  onDeleted: ReturnType<typeof vi.fn>;
} {
  const { characterId } = bootstrap();
  useStore.getState().dispatch({
    type: 'create-stash',
    payload: { ownerCharacterId: characterId, name: stashName , ...createStashIds() , ...createStashIds() },
  });
  const stashId = useStore.getState().appState!.stashes.at(-1)!.id;
  const onDeleted = vi.fn();
  render(
    <>
      <DeleteStashDialog
        open
        onOpenChange={() => {}}
        stashId={stashId}
        stashName={stashName}
        itemCount={itemCount}
        onDeleted={onDeleted}
      />
      <Toaster />
    </>,
  );
  return { stashId, onDeleted };
}

describe('DeleteStashDialog (M3)', () => {
  it('renders the stash name + plural items copy', () => {
    setup('Doomed chest', 3);
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Doomed chest');
    expect(dialog).toHaveTextContent(/3 items/i);
  });

  it('renders singular "item" copy when count is 1', () => {
    setup('Singleton', 1);
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/1 item\b/);
  });

  it('renders "no items" copy when the stash is empty', () => {
    setup('Empty', 0);
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/no items/i);
  });

  it('confirm button dispatches delete-stash, toasts, and fires onDeleted', async () => {
    const user = userEvent.setup();
    const { stashId, onDeleted } = setup('Doomed chest', 0);

    const dialog = screen.getByRole('alertdialog');
    const confirm = dialog.querySelector('button:last-child') as HTMLButtonElement;
    await user.click(confirm);

    expect(useStore.getState().appState!.stashes.find((st) => st.id === stashId)).toBeUndefined();
    expect(await screen.findByText(/stash deleted/i)).toBeInTheDocument();
    expect(onDeleted).toHaveBeenCalled();
  });
});
