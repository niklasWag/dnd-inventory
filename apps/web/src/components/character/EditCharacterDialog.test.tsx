import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { EditCharacterDialog } from './EditCharacterDialog';
import { Toaster } from '@/components/ui/sonner';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';
import { bootstrap } from '@/test/fixtures';
import { newUuidV7 } from '@app/shared';
import type { PartyMembership } from '@app/shared';

/**
 * R6.0 — EditCharacterDialog component tests.
 *
 * Covers the per-field permission matrix (§8.1), Level/STR/maxAttunement
 * numeric bounds, no-op silent close (no reducer rejection), multi-field
 * single-dispatch, and the over-cap confirm AlertDialog path.
 */

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

/**
 * Add a second (non-DM) player membership to the bootstrapped party.
 * The bootstrap fixture creates a solo party (one user, dm+player rows
 * for the same userId); mutating memberships lets us flip the party
 * into a multi-member configuration without going through
 * create-character on a second user.
 */
function widenToMultiMemberParty(otherUserId: string): void {
  const state = useStore.getState().appState;
  if (state === null) throw new Error('bootstrap must run first');
  const secondPlayer: PartyMembership = {
    userId: otherUserId,
    partyId: state.party.id,
    role: 'player',
    characterId: null,
    joinedAt: '2026-01-01T00:00:00.000Z',
    leftAt: null,
  };
  useStore.setState({
    appState: {
      ...state,
      memberships: [...state.memberships, secondPlayer],
    },
  });
}

/**
 * Rewrite the character's owner to another user id. Combined with
 * `widenToMultiMemberParty` this puts the caller in the "non-owner
 * viewer" role. Used to test the DM-editing-someone-else's-character
 * path without a second create-character dispatch.
 */
function reassignCharacterOwner(characterId: string, newOwnerId: string): void {
  const state = useStore.getState().appState;
  if (state === null) throw new Error('bootstrap must run first');
  useStore.setState({
    appState: {
      ...state,
      characters: state.characters.map((c) =>
        c.id === characterId ? { ...c, ownerUserId: newOwnerId } : c,
      ),
    },
  });
}

/**
 * Convert the actor from "DM + player" (bootstrap default) to
 * "player only". Combined with `widenToMultiMemberParty` this puts
 * the actor in the "non-DM player owner" role for §8.1 tests.
 */
function stripActorDmMembership(): void {
  const state = useStore.getState().appState;
  if (state === null) throw new Error('bootstrap must run first');
  const myId = state.user.id;
  useStore.setState({
    appState: {
      ...state,
      memberships: state.memberships.filter((m) => !(m.userId === myId && m.role === 'dm')),
    },
  });
}

function renderDialog(characterId: string): void {
  render(
    <>
      <EditCharacterDialog characterId={characterId} open={true} onOpenChange={() => {}} />
      <Toaster />
    </>,
  );
}

describe('EditCharacterDialog (R6.0)', () => {
  it('solo actor: every field is editable', () => {
    const { characterId } = bootstrap();
    renderDialog(characterId);

    expect(screen.getByLabelText(/^Species$/i)).toBeEnabled();
    expect(screen.getByLabelText(/^Class$/i)).toBeEnabled();
    expect(screen.getByLabelText(/^Level$/i)).toBeEnabled();
    expect(screen.getByLabelText(/^STR$/i)).toBeEnabled();
    expect(screen.getByLabelText(/^Max attunement$/i)).toBeEnabled();
  });

  it('non-DM owner: species/class/level/str editable; maxAttunement disabled', () => {
    const { characterId } = bootstrap();
    // Multi-member party, actor is owner but not DM.
    widenToMultiMemberParty('other-user');
    stripActorDmMembership();
    renderDialog(characterId);

    expect(screen.getByLabelText(/^Species$/i)).toBeEnabled();
    expect(screen.getByLabelText(/^Class$/i)).toBeEnabled();
    expect(screen.getByLabelText(/^Level$/i)).toBeEnabled();
    expect(screen.getByLabelText(/^STR$/i)).toBeEnabled();
    expect(screen.getByLabelText(/^Max attunement$/i)).toBeDisabled();
    // Value is still shown.
    expect(screen.getByLabelText(/^Max attunement$/i)).toHaveValue(3);
  });

  it("DM editing another player's character: every field is editable", () => {
    const { characterId } = bootstrap();
    widenToMultiMemberParty('other-user');
    // Bootstrap actor stays DM; character re-owned to the other user.
    reassignCharacterOwner(characterId, 'other-user');
    renderDialog(characterId);

    expect(screen.getByLabelText(/^Species$/i)).toBeEnabled();
    expect(screen.getByLabelText(/^Max attunement$/i)).toBeEnabled();
  });

  it('Level input has HTML min=1 max=20 bounds', () => {
    const { characterId } = bootstrap();
    renderDialog(characterId);

    const level = screen.getByLabelText(/^Level$/i);
    expect(level).toHaveAttribute('min', '1');
    expect(level).toHaveAttribute('max', '20');
  });

  it('STR input has HTML min=1 max=30 bounds', () => {
    const { characterId } = bootstrap();
    renderDialog(characterId);

    const str = screen.getByLabelText(/^STR$/i);
    expect(str).toHaveAttribute('min', '1');
    expect(str).toHaveAttribute('max', '30');
  });

  it('maxAttunement=0 is accepted and dispatched', async () => {
    const user = userEvent.setup();
    const { characterId } = bootstrap();
    renderDialog(characterId);

    const input = screen.getByLabelText(/^Max attunement$/i);
    await user.clear(input);
    await user.type(input, '0');
    await user.click(screen.getByRole('button', { name: /^Save$/i }));

    const character = useStore.getState().appState!.characters.find((c) => c.id === characterId);
    expect(character?.maxAttunement).toBe(0);
  });

  it('multi-field edit dispatches ONE edit-character with both keys in patch', async () => {
    const user = userEvent.setup();
    const { characterId } = bootstrap();
    const logLenBefore = useStore.getState().log.length;
    renderDialog(characterId);

    const level = screen.getByLabelText(/^Level$/i);
    await user.clear(level);
    await user.type(level, '5');
    const str = screen.getByLabelText(/^STR$/i);
    await user.clear(str);
    await user.type(str, '14');
    await user.click(screen.getByRole('button', { name: /^Save$/i }));

    const editEntries = useStore
      .getState()
      .log.slice(logLenBefore)
      .filter((e) => e.type === 'edit-character');
    expect(editEntries).toHaveLength(1);
    const entry = editEntries[0]!;
    if (entry.type !== 'edit-character') throw new Error('expected edit-character');
    expect(new Set(entry.payload.changedFields)).toEqual(new Set(['level', 'str']));

    const character = useStore.getState().appState!.characters.find((c) => c.id === characterId)!;
    expect(character.level).toBe(5);
    expect(character.abilityScores.STR).toBe(14);
  });

  it('no-op submit closes silently: no dispatch, no reducer rejection', async () => {
    const user = userEvent.setup();
    const { characterId } = bootstrap();
    const logLenBefore = useStore.getState().log.length;

    let openState = true;
    const onOpenChange = (next: boolean): void => {
      openState = next;
    };
    const { rerender } = render(
      <>
        <EditCharacterDialog
          characterId={characterId}
          open={openState}
          onOpenChange={onOpenChange}
        />
        <Toaster />
      </>,
    );

    await user.click(screen.getByRole('button', { name: /^Save$/i }));
    rerender(
      <>
        <EditCharacterDialog
          characterId={characterId}
          open={openState}
          onOpenChange={onOpenChange}
        />
        <Toaster />
      </>,
    );

    expect(openState).toBe(false);
    expect(useStore.getState().log.length).toBe(logLenBefore);
  });

  it('lowering maxAttunement below attuned count opens the over-cap AlertDialog; Confirm dispatches', async () => {
    const user = userEvent.setup();
    const { characterId, inventoryStashId, catalog } = bootstrap();
    // Acquire + attune 3 magic items so the current attuned count is 3.
    const magic = catalog.find((d) => d.id === 'dmg-2024:cloak-of-protection')!;
    for (let i = 0; i < 3; i += 1) {
      useStore.getState().dispatch({
        type: 'acquire',
        payload: {
          stashId: inventoryStashId,
          definitionId: magic.id,
          quantity: 1,
          source: 'catalog-add',
          notes: `slot-${i}`,
          newItemInstanceId: newUuidV7(),
        },
      });
    }
    const itemIds = useStore
      .getState()
      .appState!.items.filter((i) => i.ownerId === inventoryStashId)
      .map((i) => i.id);
    for (const id of itemIds) {
      useStore
        .getState()
        .dispatch({ type: 'attune', payload: { characterId, itemInstanceId: id } });
    }
    renderDialog(characterId);

    const input = screen.getByLabelText(/^Max attunement$/i);
    await user.clear(input);
    await user.type(input, '2');
    await user.click(screen.getByRole('button', { name: /^Save$/i }));

    // Over-cap confirm appears; nothing dispatched yet.
    const alert = await screen.findByRole('alertdialog');
    expect(alert).toHaveTextContent(/over cap/i);
    expect(within(alert).getByText(/attuned to 3 items/i)).toBeInTheDocument();
    expect(
      useStore.getState().appState!.characters.find((c) => c.id === characterId)!.maxAttunement,
    ).toBe(3);

    await user.click(within(alert).getByRole('button', { name: /reduce anyway/i }));

    // Reduction lands; existing attunements survive.
    const character = useStore.getState().appState!.characters.find((c) => c.id === characterId)!;
    expect(character.maxAttunement).toBe(2);
    const stillAttuned = useStore
      .getState()
      .appState!.items.filter((i) => i.ownerId === inventoryStashId && i.attuned).length;
    expect(stillAttuned).toBe(3);
  });

  it('lowering maxAttunement to a value AT OR ABOVE attuned count commits silently (no confirm)', async () => {
    const user = userEvent.setup();
    const { characterId, inventoryStashId, catalog } = bootstrap();
    const magic = catalog.find((d) => d.id === 'dmg-2024:cloak-of-protection')!;
    // Attune 2 items; then attempt to lower max 3→2. That's not
    // strictly below attunedCount (2 == 2) so no confirm.
    for (let i = 0; i < 2; i += 1) {
      useStore.getState().dispatch({
        type: 'acquire',
        payload: {
          stashId: inventoryStashId,
          definitionId: magic.id,
          quantity: 1,
          source: 'catalog-add',
          notes: `slot-${i}`,
          newItemInstanceId: newUuidV7(),
        },
      });
    }
    const itemIds = useStore
      .getState()
      .appState!.items.filter((i) => i.ownerId === inventoryStashId)
      .map((i) => i.id);
    for (const id of itemIds) {
      useStore
        .getState()
        .dispatch({ type: 'attune', payload: { characterId, itemInstanceId: id } });
    }
    renderDialog(characterId);

    const input = screen.getByLabelText(/^Max attunement$/i);
    await user.clear(input);
    await user.type(input, '2');
    await user.click(screen.getByRole('button', { name: /^Save$/i }));

    // No AlertDialog opened; the dispatch was direct.
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(
      useStore.getState().appState!.characters.find((c) => c.id === characterId)!.maxAttunement,
    ).toBe(2);
  });

  it('cancelling the over-cap AlertDialog does NOT dispatch', async () => {
    const user = userEvent.setup();
    const { characterId, inventoryStashId, catalog } = bootstrap();
    const magic = catalog.find((d) => d.id === 'dmg-2024:cloak-of-protection')!;
    for (let i = 0; i < 3; i += 1) {
      useStore.getState().dispatch({
        type: 'acquire',
        payload: {
          stashId: inventoryStashId,
          definitionId: magic.id,
          quantity: 1,
          source: 'catalog-add',
          notes: `slot-${i}`,
          newItemInstanceId: newUuidV7(),
        },
      });
    }
    const itemIds = useStore
      .getState()
      .appState!.items.filter((i) => i.ownerId === inventoryStashId)
      .map((i) => i.id);
    for (const id of itemIds) {
      useStore
        .getState()
        .dispatch({ type: 'attune', payload: { characterId, itemInstanceId: id } });
    }
    renderDialog(characterId);

    const input = screen.getByLabelText(/^Max attunement$/i);
    await user.clear(input);
    await user.type(input, '2');
    await user.click(screen.getByRole('button', { name: /^Save$/i }));

    const alert = await screen.findByRole('alertdialog');
    await user.click(within(alert).getByRole('button', { name: /^Cancel$/i }));

    // maxAttunement unchanged.
    expect(
      useStore.getState().appState!.characters.find((c) => c.id === characterId)!.maxAttunement,
    ).toBe(3);
  });

  it('DM raises maxAttunement 3→5: subsequent attune fills a slot cleanly (no cap-override needed)', async () => {
    // Roadmap Test-1: the mechanism that lights up when the cap grows.
    // Attune 3 magic items (fills the default cap). Then raise cap to
    // 5 via the dialog. Dispatch a fresh attune on a 4th item — it
    // should succeed WITHOUT the cap-override branch (which would
    // require `overrideCap: true`). Proves the dialog's raise-cap
    // path is functionally connected to the slot-check.
    const user = userEvent.setup();
    const { characterId, inventoryStashId, catalog } = bootstrap();
    const magic = catalog.find((d) => d.id === 'dmg-2024:cloak-of-protection')!;
    for (let i = 0; i < 4; i += 1) {
      useStore.getState().dispatch({
        type: 'acquire',
        payload: {
          stashId: inventoryStashId,
          definitionId: magic.id,
          quantity: 1,
          source: 'catalog-add',
          notes: `slot-${i}`,
          newItemInstanceId: newUuidV7(),
        },
      });
    }
    const itemIds = useStore
      .getState()
      .appState!.items.filter((i) => i.ownerId === inventoryStashId)
      .map((i) => i.id);
    // Fill the default 3-slot cap.
    for (let i = 0; i < 3; i += 1) {
      useStore
        .getState()
        .dispatch({ type: 'attune', payload: { characterId, itemInstanceId: itemIds[i]! } });
    }
    renderDialog(characterId);

    // Raise cap 3 → 5.
    const input = screen.getByLabelText(/^Max attunement$/i);
    await user.clear(input);
    await user.type(input, '5');
    await user.click(screen.getByRole('button', { name: /^Save$/i }));

    expect(
      useStore.getState().appState!.characters.find((c) => c.id === characterId)!.maxAttunement,
    ).toBe(5);

    // A fresh attune on the 4th item now fits within the raised cap.
    // If cap were still 3, this would throw "no free attunement slot".
    useStore
      .getState()
      .dispatch({ type: 'attune', payload: { characterId, itemInstanceId: itemIds[3]! } });
    const fourthRow = useStore.getState().appState!.items.find((i) => i.id === itemIds[3])!;
    expect(fourthRow.attuned).toBe(true);
    // The attune log entry does NOT carry overrideCap (clean slot
    // check, not a bypass).
    const lastAttune = useStore
      .getState()
      .log.filter((e) => e.type === 'attune')
      .slice(-1)[0]!;
    if (lastAttune.type !== 'attune') throw new Error('expected attune');
    expect(lastAttune.payload.overrideCap).toBeUndefined();
  });
});
