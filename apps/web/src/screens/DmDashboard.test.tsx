import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';

import { DmDashboard, DmOnlyRoute } from './DmDashboard';
import type { AppState, PartyMembership } from '@app/shared';
import { useStore } from '@/store';

/**
 * R4.5 — DM Dashboard (§5.9).
 *
 * Route guard: `DmOnlyRoute` gates access on the current user having a
 * DM membership row (or being solo per §8.2 union-of-rights). Non-DM in
 * a 2+-member party gets bounced to `/hub`.
 *
 * Component: renders a grid of all party characters (name / class /
 * level / Inventory GP-equivalent), summary cards for Party Stash +
 * Recovered Loot, and a total party gold figure.
 */

function makeState(opts: {
  userId: string;
  memberships: PartyMembership[];
  characters?: AppState['characters'];
  stashes?: AppState['stashes'];
  currencies?: AppState['currencies'];
  items?: AppState['items'];
}): AppState {
  return {
    version: 1,
    seedVersion: 0,
    user: {
      id: opts.userId,
      displayName: 'Me',
      discordId: `discord-${opts.userId}`,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    party: {
      id: 'p1',
      name: 'The Party',
      ownerUserId: 'dm-user',
      inviteCode: 'inv-1',
      recoveredLootStashId: 's-rl',
      bankerUserId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    memberships: opts.memberships,
    characters: opts.characters ?? [],
    gameSessions: [],
    stashes: opts.stashes ?? [],
    catalog: [],
    items: opts.items ?? [],
    currencies: opts.currencies ?? [],
    log: [],
  };
}

function makeMembership(userId: string, role: 'dm' | 'player'): PartyMembership {
  return {
    userId,
    partyId: 'p1',
    role,
    characterId: null,
    joinedAt: '2026-01-01T00:00:00.000Z',
    leftAt: null,
  };
}

const SOLO_MEMBERSHIPS: PartyMembership[] = [
  makeMembership('me', 'dm'),
  makeMembership('me', 'player'),
];

const TWO_MEMBER_DM_MEMBERSHIPS: PartyMembership[] = [
  makeMembership('me', 'dm'),
  makeMembership('me', 'player'),
  makeMembership('other', 'player'),
];

const TWO_MEMBER_PLAYER_MEMBERSHIPS: PartyMembership[] = [
  makeMembership('dm-user', 'dm'),
  makeMembership('dm-user', 'player'),
  makeMembership('me', 'player'),
];

describe('DmOnlyRoute', () => {
  beforeEach(() => {
    useStore.setState({ appState: null, log: [] });
  });

  it('renders the outlet for a solo user (§8.2 solo bypass)', () => {
    useStore.setState({
      appState: makeState({ userId: 'me', memberships: SOLO_MEMBERSHIPS }),
      log: [],
    });
    render(
      <MemoryRouter initialEntries={['/dm']}>
        <Routes>
          <Route element={<DmOnlyRoute />}>
            <Route path="dm" element={<div>dashboard content</div>} />
          </Route>
          <Route path="hub" element={<div>hub</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('dashboard content')).toBeInTheDocument();
  });

  it('renders the outlet for a DM in a 2+-member party', () => {
    useStore.setState({
      appState: makeState({ userId: 'me', memberships: TWO_MEMBER_DM_MEMBERSHIPS }),
      log: [],
    });
    render(
      <MemoryRouter initialEntries={['/dm']}>
        <Routes>
          <Route element={<DmOnlyRoute />}>
            <Route path="dm" element={<div>dashboard content</div>} />
          </Route>
          <Route path="hub" element={<div>hub</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('dashboard content')).toBeInTheDocument();
  });

  it('redirects to /hub for a non-DM player in a 2+-member party', () => {
    useStore.setState({
      appState: makeState({ userId: 'me', memberships: TWO_MEMBER_PLAYER_MEMBERSHIPS }),
      log: [],
    });
    render(
      <MemoryRouter initialEntries={['/dm']}>
        <Routes>
          <Route element={<DmOnlyRoute />}>
            <Route path="dm" element={<div>dashboard content</div>} />
          </Route>
          <Route path="hub" element={<div>hub</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByText('dashboard content')).toBeNull();
    expect(screen.getByText('hub')).toBeInTheDocument();
  });

  it('redirects to /hub when no AppState is loaded', () => {
    render(
      <MemoryRouter initialEntries={['/dm']}>
        <Routes>
          <Route element={<DmOnlyRoute />}>
            <Route path="dm" element={<div>dashboard content</div>} />
          </Route>
          <Route path="hub" element={<div>hub</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.queryByText('dashboard content')).toBeNull();
    expect(screen.getByText('hub')).toBeInTheDocument();
  });
});

describe('DmDashboard', () => {
  beforeEach(() => {
    useStore.setState({ appState: null, log: [] });
  });

  function seedTwoCharState(): void {
    const state = makeState({
      userId: 'me',
      memberships: TWO_MEMBER_DM_MEMBERSHIPS,
      characters: [
        {
          id: 'char-me',
          partyId: 'p1',
          ownerUserId: 'me',
          name: 'Alice',
          species: 'Human',
          size: 'medium',
          class: 'Wizard',
          level: 5,
          abilityScores: { STR: 10 },
          maxAttunement: 3,
          encumbranceRule: 'off',
          enforceEncumbrance: false,
          inventoryStashId: 's-inv-me',
        },
        {
          id: 'char-other',
          partyId: 'p1',
          ownerUserId: 'other',
          name: 'Bob',
          species: 'Elf',
          size: 'medium',
          class: 'Rogue',
          level: 3,
          abilityScores: { STR: 8 },
          maxAttunement: 3,
          encumbranceRule: 'off',
          enforceEncumbrance: false,
          inventoryStashId: 's-inv-other',
        },
      ],
      stashes: [
        {
          id: 's-inv-me',
          scope: 'character',
          name: 'Inventory',
          ownerCharacterId: 'char-me',
          partyId: null,
          isCarried: true,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 's-inv-other',
          scope: 'character',
          name: 'Inventory',
          ownerCharacterId: 'char-other',
          partyId: null,
          isCarried: true,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 's-party',
          scope: 'party',
          name: 'Party Stash',
          ownerCharacterId: null,
          partyId: 'p1',
          isCarried: false,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 's-rl',
          scope: 'recovered-loot',
          name: 'Recovered Loot',
          ownerCharacterId: null,
          partyId: 'p1',
          isCarried: false,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      currencies: [
        // Alice: 15 gp equivalent = 10 gp + 5 sp (0.5 gp) + 45 cp (0.45 gp) = 10.95 gp
        // Simpler: give Alice 10 gp exact.
        { id: 'c-me', stashId: 's-inv-me', cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 },
        // Bob: 5 gp
        { id: 'c-other', stashId: 's-inv-other', cp: 0, sp: 0, ep: 0, gp: 5, pp: 0 },
        // Party Stash: 20 gp
        { id: 'c-party', stashId: 's-party', cp: 0, sp: 0, ep: 0, gp: 20, pp: 0 },
        // Recovered Loot: 3 gp
        { id: 'c-rl', stashId: 's-rl', cp: 0, sp: 0, ep: 0, gp: 3, pp: 0 },
      ],
      items: [
        // 2 items in Party Stash
        {
          id: 'i-1',
          definitionId: 'phb-2024:rope',
          ownerType: 'stash',
          ownerId: 's-party',
          containerInstanceId: null,
          quantity: 3,
          equipped: false,
          attuned: false,
          identified: true,
          currentCharges: null,
        },
        {
          id: 'i-2',
          definitionId: 'phb-2024:torch',
          ownerType: 'stash',
          ownerId: 's-party',
          containerInstanceId: null,
          quantity: 1,
          equipped: false,
          attuned: false,
          identified: true,
          currentCharges: null,
        },
        // 1 item in Recovered Loot
        {
          id: 'i-3',
          definitionId: 'phb-2024:rope',
          ownerType: 'stash',
          ownerId: 's-rl',
          containerInstanceId: null,
          quantity: 2,
          equipped: false,
          attuned: false,
          identified: true,
          currentCharges: null,
        },
      ],
    });
    useStore.setState({ appState: state, log: [] });
  }

  it('renders one row per character with name, class, level, and Inventory GP-equivalent', () => {
    seedTwoCharState();
    render(
      <MemoryRouter>
        <DmDashboard />
      </MemoryRouter>,
    );
    // Alice row
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Wizard')).toBeInTheDocument();
    // Bob row
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Rogue')).toBeInTheDocument();
    // GP-equivalent values surface as text.
    expect(screen.getByText(/10(\.0)? gp/)).toBeInTheDocument();
    expect(screen.getByText(/5(\.0)? gp/)).toBeInTheDocument();
  });

  it('renders Party Stash summary with currency + item count', () => {
    seedTwoCharState();
    render(
      <MemoryRouter>
        <DmDashboard />
      </MemoryRouter>,
    );
    const partyStashCard = screen.getByRole('region', { name: /party stash/i });
    expect(partyStashCard).toHaveTextContent(/20(\.0)? gp/);
    // 2 distinct item rows in Party Stash
    expect(partyStashCard).toHaveTextContent(/2 item/i);
  });

  it('renders Recovered Loot summary with currency + item count', () => {
    seedTwoCharState();
    render(
      <MemoryRouter>
        <DmDashboard />
      </MemoryRouter>,
    );
    const recoveredCard = screen.getByRole('region', { name: /recovered loot/i });
    expect(recoveredCard).toHaveTextContent(/3(\.0)? gp/);
    expect(recoveredCard).toHaveTextContent(/1 item/i);
  });

  it('renders total party gold summing character Inventories + pools', () => {
    seedTwoCharState();
    render(
      <MemoryRouter>
        <DmDashboard />
      </MemoryRouter>,
    );
    // 10 (Alice) + 5 (Bob) + 20 (party) + 3 (loot) = 38 gp
    const total = screen.getByRole('region', { name: /total party gold/i });
    expect(total).toHaveTextContent(/38(\.0)? gp/);
  });

  it('a character-row click navigates to /character/:id', async () => {
    seedTwoCharState();
    const { default: userEvent } = await import('@testing-library/user-event');
    render(
      <MemoryRouter initialEntries={['/dm']}>
        <Routes>
          <Route path="dm" element={<DmDashboard />} />
          <Route path="character/:id" element={<div>character sheet page</div>} />
        </Routes>
      </MemoryRouter>,
    );
    const row = screen.getByRole('button', { name: /open alice/i });
    await userEvent.click(row);
    expect(screen.getByText('character sheet page')).toBeInTheDocument();
  });

  it('renders empty grid with 0 gp totals when no characters exist yet', () => {
    useStore.setState({
      appState: makeState({
        userId: 'me',
        memberships: SOLO_MEMBERSHIPS,
        characters: [],
        stashes: [
          {
            id: 's-party',
            scope: 'party',
            name: 'Party Stash',
            ownerCharacterId: null,
            partyId: 'p1',
            isCarried: false,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 's-rl',
            scope: 'recovered-loot',
            name: 'Recovered Loot',
            ownerCharacterId: null,
            partyId: 'p1',
            isCarried: false,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        currencies: [
          { id: 'c-party', stashId: 's-party', cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
          { id: 'c-rl', stashId: 's-rl', cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
        ],
      }),
      log: [],
    });
    render(
      <MemoryRouter>
        <DmDashboard />
      </MemoryRouter>,
    );
    const total = screen.getByRole('region', { name: /total party gold/i });
    expect(total).toHaveTextContent(/0(\.0)? gp/);
    expect(screen.getByText(/no characters yet/i)).toBeInTheDocument();
  });
});
