import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { Sidebar } from './Sidebar';
import type { AppState, PartyMembership } from '@app/shared';
import { useStore } from '@/store';
import { useSidebarStore } from '@/store/sidebar';

/**
 * R9.2 — Sidebar nav shell. Renders inside a party (`/party/:partyId/*`)
 * as the primary navigation: a party header (name + member count + a
 * "Hub" back link + settings gear), grouped IA (My Character / Party /
 * Reference / DM Tools / footer Settings), active-item highlight, DM-tools
 * gating, and a collapse toggle persisting to the sidebar store.
 *
 * These tests exercise structure + gating + navigation + collapse. The
 * responsive/mobile drawer is covered by the Layout integration.
 */

function makeState(overrides?: {
  memberships?: PartyMembership[];
  characterId?: string | null;
}): AppState {
  const characterId = overrides?.characterId ?? 'char-1';
  return {
    version: 1,
    seedVersion: 0,
    user: {
      id: 'u0',
      displayName: 'Tester',
      discordId: 'discord-tester',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    party: {
      id: 'p1',
      name: 'The Emberwarden',
      ownerUserId: 'u0',
      inviteCode: 'inv-test',
      recoveredLootStashId: 's-rl',
      bankerUserId: null,
      encumbranceRule: 'off',
      enforceEncumbrance: false,
      priceModifier: 1.0,
      baseCurrency: 'gp',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    memberships: overrides?.memberships ?? [
      {
        userId: 'u0',
        partyId: 'p1',
        role: 'dm',
        characterId: null,
        joinedAt: '2026-01-01T00:00:00.000Z',
        leftAt: null,
      },
      {
        userId: 'u0',
        partyId: 'p1',
        role: 'player',
        characterId,
        joinedAt: '2026-01-01T00:00:00.000Z',
        leftAt: null,
      },
    ],
    characters:
      characterId === null
        ? []
        : [
            {
              id: characterId,
              partyId: 'p1',
              ownerUserId: 'u0',
              name: 'Brynn',
              species: 'Elf',
              size: 'medium',
              class: 'Ranger',
              level: 7,
              abilityScores: { STR: 12 },
              maxAttunement: 3,
              inventoryStashId: 's-inv',
              wishlist: [],
            },
          ],
    gameSessions: [],
    stashes: [],
    shops: [],
    catalog: [],
    items: [],
    currencies: [],
    log: [],
  };
}

/** A plain-player membership set (own player row, plus a separate DM). */
function playerMemberships(): PartyMembership[] {
  return [
    {
      userId: 'u0',
      partyId: 'p1',
      role: 'player',
      characterId: 'char-1',
      joinedAt: '2026-01-01T00:00:00.000Z',
      leftAt: null,
    },
    {
      userId: 'u-dm',
      partyId: 'p1',
      role: 'dm',
      characterId: null,
      joinedAt: '2026-01-01T00:00:00.000Z',
      leftAt: null,
    },
  ];
}

function renderSidebar(url = '/party/p1/character/char-1'): void {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/party/:partyId/*" element={<Sidebar />} />
        <Route path="/hub" element={<div>hub landing</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useStore.setState({ appState: makeState(), log: [] });
  useSidebarStore.setState({ collapsed: false, hydrated: true });
});

describe('Sidebar', () => {
  it('renders the party header with name + member count', () => {
    renderSidebar();
    expect(screen.getByText('The Emberwarden')).toBeInTheDocument();
    // Two distinct users (u0 dm+player is one user) → solo; but the default
    // makeState has a single user wearing both hats → "solo".
    expect(screen.getByText(/solo/i)).toBeInTheDocument();
  });

  it('renders the grouped nav items', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: /character sheet/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /stashes/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /party stash/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /recovered loot/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /members/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^history$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /catalog/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^settings$/i })).toBeInTheDocument();
  });

  it('renders a Hub back link that navigates to /hub', async () => {
    const user = userEvent.setup();
    renderSidebar();
    const hub = screen.getByRole('link', { name: /hub/i });
    await user.click(hub);
    expect(screen.getByText('hub landing')).toBeInTheDocument();
  });

  it('does NOT render a Switch link', () => {
    renderSidebar();
    expect(screen.queryByRole('link', { name: /switch/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /switch/i })).toBeNull();
  });

  it('shows the DM Tools group for a DM/solo actor', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: /dm dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /hoard/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /loot distribution/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /identification/i })).toBeInTheDocument();
  });

  it('hides the DM Tools group for a plain player', () => {
    useStore.setState({
      appState: makeState({ memberships: playerMemberships() }),
      log: [],
    });
    renderSidebar();
    expect(screen.queryByRole('link', { name: /dm dashboard/i })).toBeNull();
  });

  it('marks the current route link as active (aria-current)', () => {
    renderSidebar('/party/p1/character/char-1');
    const link = screen.getByRole('link', { name: /character sheet/i });
    expect(link).toHaveAttribute('aria-current', 'page');
  });

  it('on the Stashes page, only Stashes is active — Character Sheet is NOT (prefix-match guard)', () => {
    // `/character/:id` is a prefix of `/character/:id/stashes`; the Character
    // Sheet link uses NavLink `end` so it only highlights on the exact path.
    renderSidebar('/party/p1/character/char-1/stashes');
    expect(screen.getByRole('link', { name: /^stashes$/i })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: /character sheet/i })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('Character Sheet link targets the own character', () => {
    renderSidebar();
    const link = screen.getByRole('link', { name: /character sheet/i });
    expect(link).toHaveAttribute('href', '/party/p1/character/char-1');
  });

  it('Character Sheet link falls back to settings when the actor has no character', () => {
    useStore.setState({
      appState: makeState({
        characterId: null,
        memberships: [
          {
            userId: 'u0',
            partyId: 'p1',
            role: 'dm',
            characterId: null,
            joinedAt: '2026-01-01T00:00:00.000Z',
            leftAt: null,
          },
        ],
      }),
      log: [],
    });
    renderSidebar('/party/p1/settings');
    const link = screen.getByRole('link', { name: /character sheet/i });
    expect(link).toHaveAttribute('href', '/party/p1/settings');
  });

  it('collapse toggle flips the sidebar store', async () => {
    const user = userEvent.setup();
    renderSidebar();
    expect(useSidebarStore.getState().collapsed).toBe(false);
    await user.click(screen.getByRole('button', { name: /collapse sidebar/i }));
    expect(useSidebarStore.getState().collapsed).toBe(true);
  });
});

describe('Sidebar — collapsed rail', () => {
  beforeEach(() => {
    useSidebarStore.setState({ collapsed: true, hydrated: true });
  });

  it('renders the icon-only nav links (still reachable by accessible name)', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: /character sheet/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /catalog/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^settings$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /hub/i })).toBeInTheDocument();
  });

  it('does NOT render group headings in the collapsed rail', () => {
    renderSidebar();
    expect(screen.queryByText('My Character')).toBeNull();
    expect(screen.queryByText('Reference')).toBeNull();
  });

  it('renders an Expand toggle that flips the store back', async () => {
    const user = userEvent.setup();
    renderSidebar();
    expect(screen.queryByRole('button', { name: /collapse sidebar/i })).toBeNull();
    await user.click(screen.getByRole('button', { name: /expand sidebar/i }));
    expect(useSidebarStore.getState().collapsed).toBe(false);
  });

  it('still targets the own character in the collapsed rail', () => {
    renderSidebar();
    expect(screen.getByRole('link', { name: /character sheet/i })).toHaveAttribute(
      'href',
      '/party/p1/character/char-1',
    );
  });
});
