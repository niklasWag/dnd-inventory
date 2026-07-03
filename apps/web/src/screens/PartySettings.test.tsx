import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { PartySettings } from './PartySettings';
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
function createCharacterDmOnlyIds() {
  return {
    newUserId: newUuidV7(),
    newPartyId: newUuidV7(),
    newPartyStashId: newUuidV7(),
    newRecoveredLootStashId: newUuidV7(),
    newPartyStashCurrencyId: newUuidV7(),
    newRecoveredLootCurrencyId: newUuidV7(),
  };
}

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
  const partyId = useStore.getState().appState?.party.id ?? 'test-party';
  const router = createMemoryRouter(
    [{ path: '/party/:partyId/settings', Component: PartySettings }],
    { initialEntries: [`/party/${partyId}/settings`] },
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
      payload: { dmOnly: true, partyName: 'DM Sandbox', ...createCharacterDmOnlyIds() },
    });

    renderPartySettings();

    // Party name field present.
    expect(screen.getByLabelText(/party name/i)).toBeInTheDocument();
    // Character name field absent.
    expect(screen.queryByLabelText(/character name/i)).not.toBeInTheDocument();
  });
});

// -------------------------------------------------------------------- //
// R4.1.f: Create your character CTA
// -------------------------------------------------------------------- //

describe('PartySettings — Create your character CTA (R4.1.f)', () => {
  it('renders the CTA button when the actor is in a party but has no character, and the form is hidden until clicked', async () => {
    const user = userEvent.setup();
    // DM-only bootstrap leaves the actor in a party without a character.
    useStore.getState().dispatch({
      type: 'create-character',
      payload: { dmOnly: true, partyName: 'DM Sandbox', ...createCharacterDmOnlyIds() },
    });

    renderPartySettings();

    // The CTA section heading and button are visible.
    expect(screen.getByRole('heading', { name: /create your character/i })).toBeInTheDocument();
    const ctaButton = screen.getByRole('button', { name: /^create character$/i });
    expect(ctaButton).toBeInTheDocument();

    // But the form fields are NOT initially rendered — the dialog is closed.
    expect(screen.queryByLabelText(/^name$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^species$/i)).not.toBeInTheDocument();

    // Click the CTA to open the dialog → form fields appear.
    await user.click(ctaButton);
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^species$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^size$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^class$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^level$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^str$/i)).toBeInTheDocument();
  });

  it('submitting the CTA dialog dispatches create-character and adds the character to the existing party', async () => {
    const user = userEvent.setup();
    useStore.getState().dispatch({
      type: 'create-character',
      payload: { dmOnly: true, partyName: 'DM Sandbox', ...createCharacterDmOnlyIds() },
    });
    const partyIdBefore = useStore.getState().appState!.party.id;
    expect(useStore.getState().appState!.characters).toHaveLength(0);

    renderPartySettings();

    // Open the dialog first.
    await user.click(screen.getByRole('button', { name: /^create character$/i }));

    await user.type(screen.getByLabelText(/^name$/i), 'DM Char');
    await user.type(screen.getByLabelText(/^species$/i), 'Human');
    await user.type(screen.getByLabelText(/^class$/i), 'Bard');
    // Size already defaults to medium per the CharacterForm; level + str
    // have type=number defaults. Override level + str to known values.
    const levelInput = screen.getByLabelText(/^level$/i);
    await user.clear(levelInput);
    await user.type(levelInput, '1');
    const strInput = screen.getByLabelText(/^str$/i);
    await user.clear(strInput);
    await user.type(strInput, '12');

    // Submit via the form's submit button (the CharacterForm's "Create
    // character" button — there are two matches now: the CTA button
    // outside and the form submit inside. Both have the same label, so
    // grab the one inside the form via the dialog's content.)
    const formSubmit = screen
      .getAllByRole('button', { name: /^create character$/i })
      .find((btn) => btn.getAttribute('type') === 'submit');
    expect(formSubmit).toBeDefined();
    await user.click(formSubmit!);

    // The new character is in state.
    const s = useStore.getState().appState!;
    expect(s.party.id).toBe(partyIdBefore); // Same party, not a new one.
    expect(s.characters).toHaveLength(1);
    expect(s.characters[0]!.name).toBe('DM Char');
    expect(s.characters[0]!.species).toBe('Human');
    expect(s.characters[0]!.class).toBe('Bard');

    // The log carries a create-character entry from the post-bootstrap branch.
    const lastEntry = useStore.getState().log.at(-1);
    expect(lastEntry?.type).toBe('create-character');
    if (lastEntry?.type === 'create-character') {
      expect(lastEntry.payload.characterId).toBeDefined();
      expect(lastEntry.payload.inventoryStashId).toBeDefined();
    }
  });

  it('the CTA section is hidden once the actor has a character', () => {
    // Normal bootstrap creates a character. Then the CTA must NOT appear.
    bootstrap();

    renderPartySettings();

    expect(
      screen.queryByRole('heading', { name: /create your character/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the CTA for a joiner (player 2) when player 1's character is in the loaded state but theirs isn't", () => {
    // Simulate the post-join state for user 2: party already contains
    // user 1's character; user 2 has an active player membership row
    // but their `characterId` is null because they haven't dispatched
    // create-character yet. The CTA must appear because the actor
    // owns no character — NOT because `characters[0]` happens to be
    // undefined (it isn't — it's player 1's).
    bootstrap(); // mints user 1 + their character.
    useStore.setState((s) => {
      if (s.appState === null) return s;
      const player1UserId = s.appState.user.id;
      // Build a fresh "user 2" id and swap state.user.id to it so the
      // store-derived `myUserId` reads as user 2.
      const player2UserId = 'user-2-test';
      return {
        ...s,
        appState: {
          ...s.appState,
          user: { ...s.appState.user, id: player2UserId, displayName: 'Player Two' },
          memberships: [
            // Keep player 1's dm + player rows.
            ...s.appState.memberships.map((m) => (m.userId === player1UserId ? m : m)),
            // Add player 2's player row with characterId: null.
            {
              userId: player2UserId,
              partyId: s.appState.party.id,
              role: 'player',
              characterId: null,
              joinedAt: new Date().toISOString(),
              leftAt: null,
            },
          ],
          // characters[] keeps player 1's character only — player 2 has
          // not created theirs yet.
        },
      };
    });

    renderPartySettings();

    // The CTA must be visible because the actor (player 2) has no
    // character of their own, even though characters[0] exists (it's
    // player 1's).
    expect(screen.getByRole('heading', { name: /create your character/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^create character$/i })).toBeInTheDocument();
  });
});
