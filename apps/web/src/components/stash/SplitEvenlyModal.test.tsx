import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { SplitEvenlyModal } from './SplitEvenlyModal';
import { Toaster } from '@/components/ui/sonner';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';
import { bootstrap } from '@/test/fixtures';

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

/**
 * R4.2.e — SplitEvenlyModal tests.
 *
 * The dispatch pipeline is already covered by the reducer + guard +
 * server integration tests in `packages/rules`, `packages/shared`, and
 * `apps/server`. These tests focus on the component's own logic:
 *   - Recipient selection state + preview computation.
 *   - Correct dispatch payload shape.
 *   - Confirm button gating (no selection + overspending).
 */

interface SetupResult {
  partyStashId: string;
  ownCharId: string;
  ownInvId: string;
  bankerUserId: string;
  bankerCharId: string;
  bankerInvId: string;
}

/**
 * Two-member party where the current user IS the Banker. Both members
 * have characters (so both are eligible recipients).
 */
function setupTwoMemberBankerParty(poolGp: number): SetupResult {
  const base = bootstrap();
  const ownCharId = base.characterId;
  const ownInvId = base.inventoryStashId;
  const bankerUserId = useStore.getState().appState!.user.id;
  // We're the Banker after the graft below. Extra state: add a second
  // player + their character + Inventory + zeroed CurrencyHolding, then
  // set party.bankerUserId to our own userId so the modal thinks we're
  // the Banker.
  const otherPlayerUserId = 'player-other';
  const otherCharId = 'char-other';
  const otherInvId = 'inv-other';
  useStore.setState((prev) => {
    if (prev.appState === null) return prev;
    return {
      ...prev,
      appState: {
        ...prev.appState,
        // Banker is us; other player has their own character.
        party: { ...prev.appState.party, bankerUserId },
        memberships: [
          ...prev.appState.memberships,
          {
            userId: otherPlayerUserId,
            partyId: prev.appState.party.id,
            role: 'player',
            characterId: otherCharId,
            joinedAt: new Date().toISOString(),
            leftAt: null,
          },
        ],
        characters: [
          ...prev.appState.characters,
          {
            id: otherCharId,
            partyId: prev.appState.party.id,
            ownerUserId: otherPlayerUserId,
            name: 'Other Player Char',
            species: 'Human',
            size: 'medium',
            class: 'Rogue',
            level: 1,
            abilityScores: { STR: 10 },
            maxAttunement: 3,
            encumbranceRule: 'off',
            enforceEncumbrance: false,
            priceModifier: 1.0,
            baseCurrency: 'gp',
            inventoryStashId: otherInvId,
          },
        ],
        stashes: [
          ...prev.appState.stashes,
          {
            id: otherInvId,
            scope: 'character',
            name: 'Inventory',
            ownerCharacterId: otherCharId,
            partyId: null,
            isCarried: true,
            createdAt: new Date().toISOString(),
          },
        ],
        currencies: [
          ...prev.appState.currencies.map((c) =>
            c.stashId === base.partyStashId ? { ...c, gp: poolGp } : c,
          ),
          { id: `hold-${otherInvId}`, stashId: otherInvId, cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
        ],
      },
    };
  });
  // The "banker" fixture: since bootstrap() makes us the DM+player, and
  // the OUTLINE §3.14 rule says DM cannot be Banker, we swap roles for
  // the test — set our membership rows to player-only so the derived
  // Banker role can attach. This is a UI-focused test; the server-side
  // invariant is covered by the R4.2.a integration test.
  useStore.setState((prev) => {
    if (prev.appState === null) return prev;
    return {
      ...prev,
      appState: {
        ...prev.appState,
        memberships: prev.appState.memberships.map((m) =>
          m.userId === bankerUserId && m.role === 'dm'
            ? { ...m, leftAt: new Date().toISOString() }
            : m,
        ),
      },
    };
  });
  return {
    partyStashId: base.partyStashId,
    ownCharId,
    ownInvId,
    bankerUserId,
    bankerCharId: otherCharId,
    bankerInvId: otherInvId,
  };
}

function renderModal(open: boolean, stashId: string): void {
  render(
    <MemoryRouter>
      <SplitEvenlyModal stashId={stashId} open={open} onOpenChange={() => undefined} />
      <Toaster />
    </MemoryRouter>,
  );
}

describe('SplitEvenlyModal (R4.2.e)', () => {
  it('does not render when open=false', () => {
    const { partyStashId } = setupTwoMemberBankerParty(0);
    renderModal(false, partyStashId);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lists every active player character as a recipient', () => {
    const { partyStashId } = setupTwoMemberBankerParty(0);
    renderModal(true, partyStashId);
    expect(screen.getByLabelText(/include thorin/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/include other player char/i)).toBeInTheDocument();
  });

  it('previews a 100gp / 2 split as 50 gp each with 0 remainder', () => {
    const { partyStashId } = setupTwoMemberBankerParty(100);
    renderModal(true, partyStashId);
    expect(screen.getByText(/each recipient gets/i)).toHaveTextContent(/50 gp/);
    expect(screen.getByText(/party stash retains/i)).toHaveTextContent(/0 cp/);
  });

  it('previews a 100gp / 3 cascade as 33 gp 3 sp 3 cp with 1 cp remainder', () => {
    const { partyStashId } = setupTwoMemberBankerParty(100);
    // Graft a third player with character so we have 3 eligible recipients.
    useStore.setState((prev) => {
      if (prev.appState === null) return prev;
      return {
        ...prev,
        appState: {
          ...prev.appState,
          memberships: [
            ...prev.appState.memberships,
            {
              userId: 'player-c',
              partyId: prev.appState.party.id,
              role: 'player',
              characterId: 'char-c',
              joinedAt: new Date().toISOString(),
              leftAt: null,
            },
          ],
          characters: [
            ...prev.appState.characters,
            {
              id: 'char-c',
              partyId: prev.appState.party.id,
              ownerUserId: 'player-c',
              name: 'C-Char',
              species: 'Human',
              size: 'medium',
              class: 'Cleric',
              level: 1,
              abilityScores: { STR: 10 },
              maxAttunement: 3,
              encumbranceRule: 'off',
              enforceEncumbrance: false,
              priceModifier: 1.0,
              baseCurrency: 'gp',
              inventoryStashId: 'inv-c',
            },
          ],
          stashes: [
            ...prev.appState.stashes,
            {
              id: 'inv-c',
              scope: 'character',
              name: 'Inventory',
              ownerCharacterId: 'char-c',
              partyId: null,
              isCarried: true,
              createdAt: new Date().toISOString(),
            },
          ],
          currencies: [
            ...prev.appState.currencies,
            { id: 'hold-inv-c', stashId: 'inv-c', cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
          ],
        },
      };
    });
    renderModal(true, partyStashId);
    // All three eligible are pre-selected; preview reflects the 100gp/3 cascade.
    expect(screen.getByText(/each recipient gets/i)).toHaveTextContent(/33 gp, 3 sp, 3 cp/);
    expect(screen.getByText(/party stash retains/i)).toHaveTextContent(/1 cp/);
  });

  it('shows the empty-pool copy when pool balance is zero', () => {
    const { partyStashId } = setupTwoMemberBankerParty(0);
    renderModal(true, partyStashId);
    expect(screen.getByText(/pool is empty/i)).toBeInTheDocument();
  });

  it('disables Confirm when no recipients are selected', async () => {
    const user = userEvent.setup();
    const { partyStashId } = setupTwoMemberBankerParty(100);
    renderModal(true, partyStashId);
    // Uncheck all.
    for (const cb of screen.getAllByRole('checkbox')) {
      await user.click(cb);
    }
    const confirm = screen.getByRole('button', { name: /^split evenly$/i });
    expect(confirm).toBeDisabled();
  });

  it('dispatches split-evenly with the checked recipients on Confirm', async () => {
    const user = userEvent.setup();
    const { partyStashId, ownCharId, bankerCharId } = setupTwoMemberBankerParty(100);
    renderModal(true, partyStashId);

    const beforeLog = useStore.getState().log.length;
    const confirm = screen.getByRole('button', { name: /^split evenly$/i });
    await user.click(confirm);

    const newEntries = useStore.getState().log.slice(beforeLog);
    // 1 terminal + 2 currency-transfer entries.
    expect(newEntries).toHaveLength(3);
    const terminal = newEntries[0]!;
    expect(terminal.type).toBe('split-evenly');
    if (terminal.type !== 'split-evenly') throw new Error('expected split-evenly');
    expect(new Set(terminal.payload.recipientCharacterIds)).toEqual(
      new Set([ownCharId, bankerCharId]),
    );
    expect(terminal.payload.sharePerRecipient).toEqual({
      cp: 0,
      sp: 0,
      ep: 0,
      gp: 50,
      pp: 0,
    });
  });
});
