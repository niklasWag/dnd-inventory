import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ItemHistory } from './ItemHistory';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';

import { bootstrap, makeEntry } from '@/test/fixtures';
import { newUuidV7 } from '@app/shared';

/**
 * RH1.2 — id-injection helpers for direct `dispatch` sites. Fresh UUID
 * v7 per call keeps the fixture within the guard's clock-skew window
 * and hermetic per-test.
 */
function acquireIds() {
  return { newItemInstanceId: newUuidV7() };
}
function createStashIds() {
  return { newStashId: newUuidV7(), newCurrencyHoldingId: newUuidV7() };
}

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

describe('ItemHistory', () => {
  it('renders the empty state when no entries match', () => {
    useStore.setState({ log: [] });
    render(<ItemHistory itemInstanceId="item-1" />);
    expect(screen.getByText(/no log entries for this item yet/i)).toBeInTheDocument();
  });

  it('renders acquire + consume + edit-item-instance entries in chronological order (with Show all events toggled)', async () => {
    const user = userEvent.setup();
    const t1 = '2026-06-23T10:00:00.000Z';
    const t2 = '2026-06-23T10:01:00.000Z';
    const t3 = '2026-06-23T10:02:00.000Z';
    useStore.setState({
      log: [
        makeEntry(
          'acquire',
          {
            stashId: 'stash-1',
            itemInstanceId: 'item-1',
            definitionId: 'phb-2024:torch',
            quantity: 3,
            source: 'catalog-add',
          },
          { timestamp: t1 },
        ),
        makeEntry(
          'consume',
          {
            stashId: 'stash-1',
            itemInstanceId: 'item-1',
            quantity: 1,
            removed: false,
          },
          { timestamp: t2 },
        ),
        makeEntry(
          'edit-item-instance',
          { itemInstanceId: 'item-1', changedFields: ['notes'] },
          { timestamp: t3 },
        ),
      ],
    });

    render(<ItemHistory itemInstanceId="item-1" />);

    // R2.3 — default filter hides edit-item-instance; only 2 rows visible.
    // The "Show all events" toggle exposes the hidden entry.
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    await user.click(screen.getByRole('checkbox', { name: /show all events/i }));

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(within(items[0]!).getByText(/acquired/i)).toBeInTheDocument();
    expect(within(items[1]!).getByText(/consumed/i)).toBeInTheDocument();
    expect(within(items[2]!).getByText(/edited notes/i)).toBeInTheDocument();
  });

  it('summarizes consume with removed=true as "Removed (consumed last N)"', () => {
    useStore.setState({
      log: [
        makeEntry('consume', {
          stashId: 'stash-1',
          itemInstanceId: 'item-1',
          quantity: 2,
          removed: true,
        }),
      ],
    });
    render(<ItemHistory itemInstanceId="item-1" />);
    expect(screen.getByText(/removed \(consumed last 2\)/i)).toBeInTheDocument();
  });

  it('summarizes edit-item-instance with both fields as "Edited customName + notes" (visible only after Show all toggle)', async () => {
    const user = userEvent.setup();
    useStore.setState({
      log: [
        makeEntry('edit-item-instance', {
          itemInstanceId: 'item-1',
          changedFields: ['customName', 'notes'],
        }),
      ],
    });
    render(<ItemHistory itemInstanceId="item-1" />);
    // Default filter hides edit-item-instance; the empty-rows placeholder shows the hidden count.
    expect(screen.queryByText(/edited customName \+ notes/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /show all events/i }));
    expect(screen.getByText(/edited customName \+ notes/i)).toBeInTheDocument();
  });

  it('filters out entries belonging to other itemInstanceIds', () => {
    useStore.setState({
      log: [
        makeEntry('acquire', {
          stashId: 'stash-1',
          itemInstanceId: 'item-1',
          definitionId: 'phb-2024:torch',
          quantity: 1,
          source: 'catalog-add',
        }),
        makeEntry('acquire', {
          stashId: 'stash-1',
          itemInstanceId: 'item-2', // different item
          definitionId: 'phb-2024:rope-hempen-50ft',
          quantity: 1,
          source: 'catalog-add',
        }),
      ],
    });

    render(<ItemHistory itemInstanceId="item-1" />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(within(items[0]!).getByText(/source: catalog-add/i)).toBeInTheDocument();
  });

  it('renders a transfer entry summary with character-prefixed stash names (M3)', () => {
    // Use the canonical bootstrap so a real character exists for the
    // character-scope source stash to reference. The destination is the
    // auto-provisioned Recovered Loot (no character prefix).
    const { characterId, recoveredLootStashId } = bootstrap();
    // Create a Storage stash via the dispatch so it carries the canonical
    // ownerCharacterId.
    useStore.getState().dispatch({
      type: 'create-stash',
      payload: {
        ownerCharacterId: characterId,
        name: 'Chest at home',
        ...createStashIds(),
        ...createStashIds(),
      },
    });
    const fromStashId = useStore.getState().appState!.stashes.at(-1)!.id;

    // Replace the auto-generated create-stash log entry with our transfer
    // fixture so the assertion targets exactly one row.
    useStore.setState({
      log: [
        makeEntry('transfer', {
          itemInstanceId: 'item-1',
          quantity: 3,
          fromStashId,
          toStashId: recoveredLootStashId,
        }),
      ],
    });

    render(<ItemHistory itemInstanceId="item-1" />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    // Character-scope source → "Thorin — Chest at home". Recovered Loot
    // is party-scope → bare "Recovered Loot" (no character prefix).
    expect(
      within(items[0]!).getByText(/Transferred ×3 from Thorin — Chest at home to Recovered Loot/i),
    ).toBeInTheDocument();
  });

  it('falls back to bare stash name when the owning character is missing', () => {
    // Edge case: character-scope stash whose ownerCharacterId doesn't
    // resolve (shouldn't happen in MVP, but the renderer is defensive).
    const fromStashId = 'stash-from';
    useStore.setState({
      appState: {
        version: 1,
        seedVersion: 0,
        user: { id: 'u', displayName: 'You', createdAt: new Date().toISOString() },
        party: {
          id: 'p',
          name: 'P',
          ownerUserId: 'u',
          inviteCode: 'INV-ABCDEF',
          recoveredLootStashId: 'stash-to',
          bankerUserId: null,
          createdAt: new Date().toISOString(),
        },
        memberships: [],
        characters: [],
        gameSessions: [],
        stashes: [
          {
            id: fromStashId,
            scope: 'character',
            name: 'Chest at home',
            ownerCharacterId: 'missing-char',
            partyId: null,
            isCarried: false,
            createdAt: new Date().toISOString(),
          },
          {
            id: 'stash-to',
            scope: 'recovered-loot',
            name: 'Recovered Loot',
            ownerCharacterId: null,
            partyId: 'p',
            isCarried: false,
            createdAt: new Date().toISOString(),
          },
        ],
        catalog: [],
        items: [],
        currencies: [],
        log: [],
      },
      log: [
        makeEntry('transfer', {
          itemInstanceId: 'item-1',
          quantity: 1,
          fromStashId,
          toStashId: 'stash-to',
        }),
      ],
    });

    render(<ItemHistory itemInstanceId="item-1" />);
    expect(
      within(screen.getAllByRole('listitem')[0]!).getByText(
        /Transferred ×1 from Chest at home to Recovered Loot/i,
      ),
    ).toBeInTheDocument();
  });

  it('falls back to a short uuid when the source stash has been deleted (M3)', () => {
    // No stashes in state — the source has been removed (delete-cascade
    // synthesizes the transfer entry, then the stash row goes away).
    // AND there's no corresponding `delete-stash` log entry either (the
    // log was wiped in this test fixture).
    useStore.setState({
      log: [
        makeEntry('transfer', {
          itemInstanceId: 'item-1',
          quantity: 2,
          fromStashId: 'abcdef12-0000-0000-0000-000000000000',
          toStashId: 'fedcba98-0000-0000-0000-000000000000',
        }),
      ],
    });

    render(<ItemHistory itemInstanceId="item-1" />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    // Both ids fall back to their first-8 prefix.
    expect(
      within(items[0]!).getByText(/Transferred ×2 from abcdef12 to fedcba98/i),
    ).toBeInTheDocument();
  });

  it('resolves a deleted source stash via the delete-stash log entry with character prefix (M3 polish)', () => {
    // The Stash row is gone, but the delete-stash log entry still
    // carries the original `name` and `ownerCharacterId`. Render as
    // "{character.name} — {name} (deleted)" so the history line is as
    // informative as a live-stash row.
    const characterId = 'c1';
    const fromStashId = 'abcdef12-0000-0000-0000-000000000000';
    const toStashId = 'fedcba98-0000-0000-0000-000000000000';
    useStore.setState({
      appState: {
        version: 1,
        seedVersion: 0,
        user: { id: 'u', displayName: 'You', createdAt: new Date().toISOString() },
        party: {
          id: 'p',
          name: 'P',
          ownerUserId: 'u',
          inviteCode: 'INV-ABCDEF',
          recoveredLootStashId: toStashId,
          bankerUserId: null,
          createdAt: new Date().toISOString(),
        },
        memberships: [],
        characters: [
          {
            id: characterId,
            partyId: 'p',
            ownerUserId: 'u',
            name: 'Thorin',
            species: 'Dwarf',
            size: 'medium',
            class: 'Fighter',
            level: 3,
            abilityScores: { STR: 16 },
            maxAttunement: 3,
            encumbranceRule: 'off',
            enforceEncumbrance: false,
            inventoryStashId: 'some-inventory-id',
          },
        ],
        gameSessions: [],
        // Note: no stash row for `fromStashId` — it's been deleted.
        // Only Recovered Loot survives.
        stashes: [
          {
            id: toStashId,
            scope: 'recovered-loot',
            name: 'Recovered Loot',
            ownerCharacterId: null,
            partyId: 'p',
            isCarried: false,
            createdAt: new Date().toISOString(),
          },
        ],
        catalog: [],
        items: [],
        currencies: [],
        log: [],
      },
      log: [
        makeEntry('transfer', {
          itemInstanceId: 'item-1',
          quantity: 1,
          fromStashId,
          toStashId,
        }),
        // The delete-stash entry that retired `fromStashId`, with the
        // owning character captured per the M3 schema amendment.
        makeEntry('delete-stash', {
          stashId: fromStashId,
          name: 'Vault of Waterdeep',
          itemCount: 1,
          currencyTotalCp: 0,
          ownerCharacterId: characterId,
        }),
      ],
    });

    render(<ItemHistory itemInstanceId="item-1" />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(
      within(items[0]!).getByText(
        /Transferred ×1 from Thorin — Vault of Waterdeep \(deleted\) to Recovered Loot/i,
      ),
    ).toBeInTheDocument();
  });

  it('omits the character prefix when an old delete-stash entry has no ownerCharacterId (back-compat)', () => {
    // Simulates a pre-amendment log entry (M3 vintage written before
    // the ownerCharacterId field was added). Still renders the bare
    // "{name} (deleted)" so existing Dexie blobs stay legible.
    const fromStashId = 'abcdef12-0000-0000-0000-000000000000';
    const toStashId = 'fedcba98-0000-0000-0000-000000000000';
    useStore.setState({
      appState: {
        version: 1,
        seedVersion: 0,
        user: { id: 'u', displayName: 'You', createdAt: new Date().toISOString() },
        party: {
          id: 'p',
          name: 'P',
          ownerUserId: 'u',
          inviteCode: 'INV-ABCDEF',
          recoveredLootStashId: toStashId,
          bankerUserId: null,
          createdAt: new Date().toISOString(),
        },
        memberships: [],
        characters: [],
        gameSessions: [],
        stashes: [
          {
            id: toStashId,
            scope: 'recovered-loot',
            name: 'Recovered Loot',
            ownerCharacterId: null,
            partyId: 'p',
            isCarried: false,
            createdAt: new Date().toISOString(),
          },
        ],
        catalog: [],
        items: [],
        currencies: [],
        log: [],
      },
      log: [
        makeEntry('transfer', {
          itemInstanceId: 'item-1',
          quantity: 1,
          fromStashId,
          toStashId,
        }),
        makeEntry('delete-stash', {
          stashId: fromStashId,
          name: 'Vault of Waterdeep',
          itemCount: 1,
          currencyTotalCp: 0,
          // ownerCharacterId intentionally absent.
        }),
      ],
    });

    render(<ItemHistory itemInstanceId="item-1" />);
    expect(
      within(screen.getAllByRole('listitem')[0]!).getByText(
        /Transferred ×1 from Vault of Waterdeep \(deleted\) to Recovered Loot/i,
      ),
    ).toBeInTheDocument();
  });

  it('surfaces a split entry on BOTH the source and the new row with perspective-aware copy (M5)', () => {
    // The same `split` log entry references both `sourceInstanceId` and
    // `newInstanceId`. The history view phrases the entry from the
    // viewing row's perspective: the source row reads "Split ×N into
    // a new row"; the new row reads "Split off from another stack
    // (×N)".
    useStore.setState({
      appState: null,
      log: [
        makeEntry('split', {
          sourceInstanceId: 'item-source',
          newInstanceId: 'item-new',
          quantity: 2,
          stashId: 's',
        }),
      ],
    });

    const { rerender } = render(<ItemHistory itemInstanceId="item-source" />);
    expect(screen.getByText(/Split ×2 into a new row/i)).toBeInTheDocument();

    rerender(<ItemHistory itemInstanceId="item-new" />);
    expect(screen.getByText(/Split off from another stack \(×2\)/i)).toBeInTheDocument();
  });

  it('R1.5 — summarizes a pack as "Packed ×N into {container} ({stash})"', () => {
    // Pack = same-stash transfer with `toContainerInstanceId` set to a
    // container row's id. The renderer needs to surface what was packed
    // and into WHICH container — the bare "from X to X" is uninformative
    // (and identical for every pack/take-out, see GitHub user report).
    const { inventoryStashId, catalog } = bootstrap();
    const backpack = catalog.find((d) => d.id === 'phb-2024:backpack')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: backpack.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    const backpackId = useStore
      .getState()
      .appState!.items.find((i) => i.definitionId === backpack.id)!.id;
    useStore.setState({
      log: [
        makeEntry('transfer', {
          itemInstanceId: 'item-torch',
          quantity: 1,
          fromStashId: inventoryStashId,
          toStashId: inventoryStashId,
          toContainerInstanceId: backpackId,
        }),
      ],
    });

    render(<ItemHistory itemInstanceId="item-torch" />);
    // The container's synthesized "#1" notes (Approach B) show up in the
    // label so two backpacks are distinguishable in the log.
    expect(screen.getByText(/Packed ×1 into Backpack \(#1\)/i)).toBeInTheDocument();
    // The stash name is also visible so the user can tell where this happened.
    expect(screen.getByText(/Thorin — Inventory/i)).toBeInTheDocument();
  });

  it('R1.5 — summarizes a take-out as "Took ×N out of container in {stash}"', () => {
    const { inventoryStashId, catalog } = bootstrap();
    const backpack = catalog.find((d) => d.id === 'phb-2024:backpack')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: backpack.id,
        quantity: 1,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    useStore.setState({
      log: [
        makeEntry('transfer', {
          itemInstanceId: 'item-torch',
          quantity: 1,
          fromStashId: inventoryStashId,
          toStashId: inventoryStashId,
          toContainerInstanceId: null,
        }),
      ],
    });

    render(<ItemHistory itemInstanceId="item-torch" />);
    expect(screen.getByText(/Took ×1 out of container/i)).toBeInTheDocument();
    expect(screen.getByText(/Thorin — Inventory/i)).toBeInTheDocument();
  });

  it('R1.5 — cross-stash transfer with orphan-drop renders as a plain cross-stash move', () => {
    // The reducer's R1.5 orphan-drop fires when a contained row is moved
    // cross-stash without the container coming along — `containerInstanceId`
    // is cleared and the log entry surfaces it via `toContainerInstanceId:
    // null`. The display intentionally renders this as a normal "from X
    // to Y" line WITHOUT a "(removed from container)" annotation: the
    // suffix made the line too long to fit on one row in the log
    // timeline, and the source/destination labels already tell the story.
    const { characterId, recoveredLootStashId } = bootstrap();
    useStore.getState().dispatch({
      type: 'create-stash',
      payload: {
        ownerCharacterId: characterId,
        name: 'Chest at home',
        ...createStashIds(),
        ...createStashIds(),
      },
    });
    const fromStashId = useStore.getState().appState!.stashes.at(-1)!.id;
    useStore.setState({
      log: [
        makeEntry('transfer', {
          itemInstanceId: 'item-torch',
          quantity: 2,
          fromStashId,
          toStashId: recoveredLootStashId,
          toContainerInstanceId: null,
        }),
      ],
    });

    render(<ItemHistory itemInstanceId="item-torch" />);
    expect(
      screen.getByText(/Transferred ×2 from Thorin — Chest at home to Recovered Loot/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/removed from container/i)).not.toBeInTheDocument();
  });

  it('R1.5 — falls back to "container" label when the parent row has been deleted', () => {
    // Defensive: the user packed something, then deleted the container
    // (via subsequent moves / consumes). The pack log entry still exists
    // and references the now-gone parent id. Render falls back to the
    // generic "container" word rather than crashing or rendering a UUID.
    const { inventoryStashId } = bootstrap();
    useStore.setState({
      log: [
        makeEntry('transfer', {
          itemInstanceId: 'item-torch',
          quantity: 1,
          fromStashId: inventoryStashId,
          toStashId: inventoryStashId,
          toContainerInstanceId: 'phantom-backpack-id',
        }),
      ],
    });

    render(<ItemHistory itemInstanceId="item-torch" />);
    expect(screen.getByText(/Packed ×1 into container/i)).toBeInTheDocument();
  });

  it('R2.3 — default filter hides use-charge / recharge; Show all toggle reveals them', async () => {
    const user = userEvent.setup();
    useStore.setState({
      log: [
        makeEntry('acquire', {
          stashId: 'stash-1',
          itemInstanceId: 'item-wand',
          definitionId: 'dmg-2024:wand-of-magic-missiles',
          quantity: 1,
          source: 'catalog-add',
        }),
        makeEntry('use-charge', {
          itemInstanceId: 'item-wand',
          characterId: 'char-1',
          amount: 1,
        }),
        makeEntry('recharge', {
          itemInstanceId: 'item-wand',
          characterId: 'char-1',
          from: 6,
          to: 7,
          trigger: 'dawn',
        }),
      ],
    });
    render(<ItemHistory itemInstanceId="item-wand" />);
    // Default: only acquire visible (1 of 3).
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText(/Show all events \(\+2\)/)).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /show all events/i }));
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(within(items[1]!).getByText(/Used ×1 charge/)).toBeInTheDocument();
    expect(within(items[2]!).getByText(/Recharged \+1 \(6 → 7, dawn\)/)).toBeInTheDocument();
  });

  it('R2.3 — identify entries are shown by default (ownership-transition filter)', () => {
    useStore.setState({
      log: [
        makeEntry('identify', {
          itemInstanceId: 'item-1',
          previousIdentified: true,
          newIdentified: false,
        }),
      ],
    });
    render(<ItemHistory itemInstanceId="item-1" />);
    expect(screen.getByText(/Marked unidentified/i)).toBeInTheDocument();
  });

  it('R2.3 — identify summary: true → false with hint reads "Marked unidentified (hint: ...)"', () => {
    useStore.setState({
      log: [
        makeEntry('identify', {
          itemInstanceId: 'item-1',
          previousIdentified: true,
          newIdentified: false,
          newHint: 'shimmers faintly',
        }),
      ],
    });
    render(<ItemHistory itemInstanceId="item-1" />);
    expect(
      screen.getByText(/Marked unidentified \(hint: "shimmers faintly"\)/),
    ).toBeInTheDocument();
  });

  it('R2.3 — identify summary: false → true reads "Identified"', () => {
    useStore.setState({
      log: [
        makeEntry('identify', {
          itemInstanceId: 'item-1',
          previousIdentified: false,
          newIdentified: true,
          previousHint: 'shimmers',
          newHint: 'shimmers',
        }),
      ],
    });
    render(<ItemHistory itemInstanceId="item-1" />);
    expect(screen.getByText(/^Identified$/)).toBeInTheDocument();
  });

  it('R2.3 — identify summary: hint-only change reads "Updated unidentified hint"', () => {
    useStore.setState({
      log: [
        makeEntry('identify', {
          itemInstanceId: 'item-1',
          previousIdentified: false,
          newIdentified: false,
          previousHint: 'glows blue',
          newHint: 'glows red',
        }),
      ],
    });
    render(<ItemHistory itemInstanceId="item-1" />);
    expect(screen.getByText(/Updated unidentified hint to "glows red"/)).toBeInTheDocument();
  });

  it('R2.3 — identify summary: cleared hint reads "Cleared unidentified hint"', () => {
    useStore.setState({
      log: [
        makeEntry('identify', {
          itemInstanceId: 'item-1',
          previousIdentified: false,
          newIdentified: false,
          previousHint: 'glows blue',
        }),
      ],
    });
    render(<ItemHistory itemInstanceId="item-1" />);
    expect(screen.getByText(/Cleared unidentified hint/i)).toBeInTheDocument();
  });
});
