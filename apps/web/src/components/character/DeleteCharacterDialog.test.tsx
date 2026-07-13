import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { DeleteCharacterDialog } from './DeleteCharacterDialog';
import { Toaster } from '@/components/ui/sonner';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';
import { bootstrap } from '@/test/fixtures';

/**
 * R9.2 — DeleteCharacterDialog. The Character Sheet's net-new UI entry
 * for the `delete-character` action (reducer + schema already shipped
 * in R4.1.b; no UI existed until R9.2).
 *
 * Contract:
 *   - a destructive confirm dialog naming the character;
 *   - the body explains the Recovered-Loot cascade (items + currency
 *     roll into Recovered Loot; the party seat is kept);
 *   - Confirm dispatches `delete-character` for the given characterId;
 *   - on success it navigates to the party's settings screen (the
 *     "create your character" landing) and toasts;
 *   - Cancel closes without dispatching.
 */

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

/**
 * Render the dialog (open) under a memory router that also mounts a
 * settings stub so the post-delete navigation target renders. The
 * settings stub prints a sentinel so tests can assert the redirect.
 */
function renderDialog(characterId: string): void {
  const partyId = useStore.getState().appState!.party.id;
  const router = createMemoryRouter(
    [
      {
        path: '/party/:partyId/character/:id',
        element: (
          <DeleteCharacterDialog characterId={characterId} open onOpenChange={() => undefined} />
        ),
      },
      { path: '/party/:partyId/settings', element: <div>settings landing</div> },
    ],
    { initialEntries: [`/party/${partyId}/character/${characterId}`] },
  );
  render(
    <>
      <RouterProvider router={router} />
      <Toaster />
    </>,
  );
}

describe('DeleteCharacterDialog', () => {
  it('renders a destructive confirm naming the character + the cascade', () => {
    const { characterId } = bootstrap();
    renderDialog(characterId);

    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(/delete thorin/i)).toBeInTheDocument();
    // Body mentions the Recovered-Loot cascade.
    expect(within(dialog).getByText(/recovered loot/i)).toBeInTheDocument();
  });

  it('Confirm dispatches delete-character and navigates to settings', async () => {
    const user = userEvent.setup();
    const { characterId } = bootstrap();
    renderDialog(characterId);

    const beforeLen = useStore.getState().log.length;
    await user.click(screen.getByRole('button', { name: /delete character/i }));

    const newEntries = useStore.getState().log.slice(beforeLen);
    const terminal = newEntries.find((e) => e.type === 'delete-character');
    expect(terminal).toBeDefined();
    if (terminal?.type !== 'delete-character') throw new Error('expected delete-character');
    expect(terminal.payload.characterId).toBe(characterId);

    // Character removed from state.
    expect(
      useStore.getState().appState!.characters.find((c) => c.id === characterId),
    ).toBeUndefined();

    // Redirected to the settings landing.
    expect(await screen.findByText('settings landing')).toBeInTheDocument();
  });

  it('Cancel closes without dispatching', async () => {
    const user = userEvent.setup();
    const { characterId } = bootstrap();
    renderDialog(characterId);

    const beforeLen = useStore.getState().log.length;
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(useStore.getState().log.length).toBe(beforeLen);
    expect(
      useStore.getState().appState!.characters.find((c) => c.id === characterId),
    ).toBeDefined();
  });
});
