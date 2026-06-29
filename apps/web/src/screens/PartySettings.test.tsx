import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { PartySettings } from './PartySettings';
import { Toaster } from '@/components/ui/sonner';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';

import { bootstrap } from '@/test/fixtures';

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

/**
 * R4.1-followup — character + party rename moved here from Settings.
 * The screen also hosts members + invite code + leave-party flows in
 * server mode; those are covered by the integration tests in
 * `apps/server/src/parties/routes.test.ts`. Here we just exercise the
 * rename surfaces that local mode needs to work.
 */
function renderPartySettings(): void {
  const router = createMemoryRouter(
    [{ path: '/party/settings', Component: PartySettings }],
    { initialEntries: ['/party/settings'] },
  );
  render(
    <>
      <RouterProvider router={router} />
      <Toaster />
    </>,
  );
}

describe('PartySettings — Character & Party rename (R4.1-followup)', () => {
  it('renaming the character dispatches rename-character and surfaces the new name', async () => {
    const user = userEvent.setup();
    const { characterId } = bootstrap({
      name: 'Thorin',
      species: 'Dwarf',
      size: 'medium',
      class: 'Fighter',
      level: 1,
      str: 16,
    });

    renderPartySettings();

    const input = screen.getByLabelText(/character name/i);
    expect(input).toHaveValue('Thorin');

    await user.clear(input);
    await user.type(input, 'Thorin Stonefist');
    const charForm = input.closest('form')!;
    const saveBtn = charForm.querySelector('button[type="submit"]')!;
    await user.click(saveBtn);

    expect(useStore.getState().appState!.characters.find((c) => c.id === characterId)!.name).toBe(
      'Thorin Stonefist',
    );
    const last = useStore.getState().log.at(-1);
    expect(last?.type).toBe('rename-character');
  });

  it('renaming the party dispatches rename-party and updates the store', async () => {
    const user = userEvent.setup();
    bootstrap();
    const partyId = useStore.getState().appState!.party.id;

    renderPartySettings();

    const input = screen.getByLabelText(/party name/i);
    expect(input).toHaveValue('My Campaign');

    await user.clear(input);
    await user.type(input, 'The Misfits');
    const partyForm = input.closest('form')!;
    const saveBtn = partyForm.querySelector('button[type="submit"]')!;
    await user.click(saveBtn);

    expect(useStore.getState().appState!.party.name).toBe('The Misfits');
    const last = useStore.getState().log.at(-1);
    expect(last?.type).toBe('rename-party');
    if (last?.type === 'rename-party') {
      expect(last.payload).toEqual({
        partyId,
        oldName: 'My Campaign',
        newName: 'The Misfits',
      });
    }
  });

  it('Save button is disabled when the input matches the current name', () => {
    bootstrap();
    renderPartySettings();

    const input = screen.getByLabelText(/character name/i);
    const form = input.closest('form')!;
    const save = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    // Currently the fixture default 'Thorin' — no edit yet → disabled.
    expect(save).toBeDisabled();
  });

  it('character rename field is absent on a DM-only party (no character to rename)', () => {
    // DM-only bootstrap: dispatch directly so we end with a party + no character.
    useStore.getState().dispatch({
      type: 'create-character',
      payload: { dmOnly: true, partyName: 'DM Sandbox' },
    });

    renderPartySettings();

    // Party name field present.
    expect(screen.getByLabelText(/party name/i)).toBeInTheDocument();
    // Character name field absent.
    expect(screen.queryByLabelText(/character name/i)).not.toBeInTheDocument();
  });
});
