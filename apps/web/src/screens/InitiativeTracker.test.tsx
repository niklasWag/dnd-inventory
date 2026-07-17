import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { InitiativeTracker } from './InitiativeTracker';
import type { AppState, Character } from '@app/shared';
import { useStore } from '@/store';
import { useEncounterStore } from '@/store/encounter';

/**
 * R11 — Initiative Tracker (DM combat tool).
 *
 * DM-only, ephemeral turn-order tool. State lives in the standalone
 * `useEncounterStore` (never persisted). Tests reset both the persisted
 * store (for seeding party characters) and the encounter store between
 * cases, and query by accessible role/label (not test IDs).
 */

function makeCharacter(id: string, name: string): Character {
  return {
    id,
    name,
    partyId: 'p1',
    ownerUserId: 'me',
    species: 'Human',
    size: 'medium',
    class: 'Fighter',
    level: 1,
    abilityScores: { STR: 10 },
    maxAttunement: 3,
    inventoryStashId: `inv-${id}`,
    wishlist: [],
  };
}

function makeState(characters: Character[]): AppState {
  return {
    version: 1,
    seedVersion: 0,
    user: {
      id: 'me',
      displayName: 'Me',
      discordId: 'discord-me',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    party: {
      id: 'p1',
      name: 'The Party',
      ownerUserId: 'me',
      inviteCode: 'inv-1',
      recoveredLootStashId: 's-rl',
      bankerUserId: null,
      encumbranceRule: 'off',
      enforceEncumbrance: false,
      priceModifier: 1.0,
      baseCurrency: 'gp',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    memberships: [],
    characters,
    gameSessions: [],
    stashes: [],
    shops: [],
    catalog: [],
    items: [],
    currencies: [],
    log: [],
  };
}

function renderTracker(): void {
  render(
    <MemoryRouter initialEntries={['/party/p1/initiative']}>
      <Routes>
        <Route path="/party/:partyId/initiative" element={<InitiativeTracker />} />
        <Route path="/party/:partyId/dm" element={<div>dashboard</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The combatant rows are the <tr>s inside the "Combatants" table body. */
function combatantRows(): HTMLElement[] {
  const table = screen.getByRole('table', { name: 'Combatants' });
  const bodyRows = within(table).getAllByRole('row');
  // Drop the header row (contains column headers).
  return bodyRows.filter((r) => within(r).queryAllByRole('columnheader').length === 0);
}

describe('InitiativeTracker', () => {
  beforeEach(() => {
    useStore.setState({
      appState: makeState([makeCharacter('c1', 'Aria'), makeCharacter('c2', 'Borin')]),
      log: [],
    });
    useEncounterStore.setState({ combatants: [], pointerId: null, round: 1 });
  });

  it('shows an empty state before any combatants are added', () => {
    renderTracker();
    expect(screen.getByText(/no combatants yet/i)).toBeInTheDocument();
  });

  it('"Add party" seeds one PC row per party character', async () => {
    const user = userEvent.setup();
    renderTracker();
    await user.click(screen.getByRole('button', { name: /add party/i }));

    const rows = combatantRows();
    expect(rows).toHaveLength(2);
    // Names auto-filled from the party characters (rendered in name inputs).
    expect(screen.getByDisplayValue('Aria')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Borin')).toBeInTheDocument();
    // PC rows carry the PC badge.
    expect(screen.getAllByText('PC')).toHaveLength(2);
  });

  it('"Add monster" adds a monster row with an editable HP field', async () => {
    const user = userEvent.setup();
    renderTracker();
    await user.click(screen.getByRole('button', { name: /add monster/i }));

    expect(combatantRows()).toHaveLength(1);
    expect(screen.getByText('Monster')).toBeInTheDocument();
    // Monster rows expose an HP input; PC rows do not.
    expect(screen.getByLabelText(/hp for/i)).toBeInTheDocument();
  });

  it('rolling a single row writes an initiative value in [1,20]+mod range', async () => {
    const user = userEvent.setup();
    renderTracker();
    await user.click(screen.getByRole('button', { name: /add monster/i }));
    await user.click(screen.getByRole('button', { name: /roll initiative for/i }));

    // The one initiative input should now hold a number (no longer blank).
    const initInput = screen.getByLabelText<HTMLInputElement>('Initiative for combatant');
    const rolled = Number(initInput.value);
    expect(Number.isInteger(rolled)).toBe(true);
    expect(rolled).toBeGreaterThanOrEqual(1);
    expect(rolled).toBeLessThanOrEqual(20);
  });

  it('"Roll all" leaves a manually-entered PC initiative untouched but rolls monsters', async () => {
    const user = userEvent.setup();
    renderTracker();
    await user.click(screen.getByRole('button', { name: /add party/i }));
    await user.click(screen.getByRole('button', { name: /add monster/i }));

    // Manually set Aria's initiative to 99 (a value no d20+mod could produce).
    const ariaInit = screen.getByLabelText('Initiative for Aria');
    await user.clear(ariaInit);
    await user.type(ariaInit, '99');

    await user.click(screen.getByRole('button', { name: /roll all/i }));

    // Aria's manual value survives.
    expect(screen.getByLabelText('Initiative for Aria')).toHaveValue(99);
    // At least one other row (the monster, and Borin who had no manual value)
    // got a rolled value: a filled initiative input that is not Aria's 99.
    const allInits = screen
      .getAllByLabelText(/^initiative for/i)
      .filter((el): el is HTMLInputElement => el.tagName === 'INPUT');
    const rolled = allInits.filter((i) => i.value !== '' && i.value !== '99');
    expect(rolled.length).toBeGreaterThanOrEqual(1);
  });

  it('"End turn" advances the highlight and wraps the round at cycle end', async () => {
    const user = userEvent.setup();
    renderTracker();
    // Seed two monsters with distinct initiative directly for determinism.
    useEncounterStore.setState({
      combatants: [
        {
          id: 'm1',
          name: 'Ogre',
          kind: 'monster',
          initiative: 18,
          modifier: 0,
          rollMode: 'normal',
          hp: 30,
        },
        {
          id: 'm2',
          name: 'Kobold',
          kind: 'monster',
          initiative: 8,
          modifier: 0,
          rollMode: 'normal',
          hp: 5,
        },
      ],
      pointerId: null,
      round: 1,
    });

    // Round starts at 1. The advance button reads "Start Combat" until the
    // first turn begins, then "End turn" — query fresh each click.
    expect(screen.getByLabelText('Round')).toHaveTextContent('1');
    const advance = (): HTMLElement =>
      screen.getByRole('button', { name: /start combat|end turn/i });

    await user.click(advance()); // pointer → m1 (top), round 1
    await user.click(advance()); // pointer → m2, round 1
    await user.click(advance()); // wrap → m1, round 2
    expect(screen.getByLabelText('Round')).toHaveTextContent('2');
  });

  it('removing the current combatant advances the pointer without stranding the highlight', async () => {
    const user = userEvent.setup();
    useEncounterStore.setState({
      combatants: [
        {
          id: 'm1',
          name: 'Ogre',
          kind: 'monster',
          initiative: 18,
          modifier: 0,
          rollMode: 'normal',
          hp: 30,
        },
        {
          id: 'm2',
          name: 'Kobold',
          kind: 'monster',
          initiative: 8,
          modifier: 0,
          rollMode: 'normal',
          hp: 5,
        },
      ],
      pointerId: 'm1',
      round: 1,
    });
    renderTracker();

    await user.click(screen.getByRole('button', { name: /remove ogre/i }));

    // Ogre gone; Kobold remains and is now the active row.
    expect(screen.queryByDisplayValue('Ogre')).not.toBeInTheDocument();
    const rows = combatantRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute('aria-current', 'true');
  });

  it('hides per-row Roll + "Roll all" once the turn cycle has started', async () => {
    const user = userEvent.setup();
    renderTracker();
    await user.click(screen.getByRole('button', { name: /add monster/i }));

    // Setup phase: both Roll affordances are present.
    expect(screen.getByRole('button', { name: /roll all/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /roll initiative for/i })).toBeInTheDocument();

    // Start the cycle (the button reads "Start Combat" before any turn begins).
    await user.click(screen.getByRole('button', { name: /start combat/i }));

    // Roll affordances are now hidden.
    expect(screen.queryByRole('button', { name: /roll all/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /roll initiative for/i })).not.toBeInTheDocument();
  });

  it('"Reset" returns to round 1 and clears the pointer while keeping the roster', async () => {
    const user = userEvent.setup();
    useEncounterStore.setState({
      combatants: [
        {
          id: 'm1',
          name: 'Ogre',
          kind: 'monster',
          initiative: 18,
          modifier: 0,
          rollMode: 'normal',
          hp: 30,
        },
        {
          id: 'm2',
          name: 'Kobold',
          kind: 'monster',
          initiative: 8,
          modifier: 0,
          rollMode: 'normal',
          hp: 5,
        },
      ],
      pointerId: 'm2',
      round: 3,
    });
    renderTracker();

    expect(screen.getByLabelText('Round')).toHaveTextContent('3');
    await user.click(screen.getByRole('button', { name: /reset rounds/i }));

    // Round back to 1, no active row, but both combatants still present.
    expect(screen.getByLabelText('Round')).toHaveTextContent('1');
    expect(combatantRows()).toHaveLength(2);
    expect(screen.queryByDisplayValue('Ogre')).toBeInTheDocument();
    expect(document.querySelector('[aria-current="true"]')).toBeNull();
  });

  it('"Clear" empties the entire roster', async () => {
    const user = userEvent.setup();
    renderTracker();
    await user.click(screen.getByRole('button', { name: /add monster/i }));
    expect(combatantRows()).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /clear encounter/i }));
    expect(screen.getByText(/no combatants yet/i)).toBeInTheDocument();
  });
});
