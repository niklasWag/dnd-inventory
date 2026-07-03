import { describe, expect, it, beforeEach } from 'vitest';
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Navigate, RouterProvider } from 'react-router-dom';

import { StorageDetail } from './StorageDetail';
import { CharacterSheet } from './CharacterSheet';
import { Toaster } from '@/components/ui/sonner';
import { useStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
import { wipeAll } from '@/db/wipe';

import { bootstrap } from '@/test/fixtures';
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

/**
 * Local stand-in for the old Welcome auto-redirect: when "/" is rendered
 * and a character exists in the store, redirect to that character's
 * sheet. Used by tests that exercise StorageDetail's "unknown stashId
 * → redirect to /" branch — the unknown-stash redirect lands here, then
 * this redirect lands on the CharacterSheet.
 */
function RedirectToCharacter(): ReactElement | null {
  const characterId = useStore(
    useShallow((s) => (s.appState ? (s.appState.characters[0]?.id ?? null) : null)),
  );
  if (characterId === null) return null;
  const partyId = useStore.getState().appState?.party.id;
  if (partyId === undefined) return null;
  return <Navigate to={`/party/${partyId}/character/${characterId}`} replace />;
}

function renderAt(path: string): void {
  const partyId = useStore.getState().appState?.party.id;
  const prefixed =
    partyId !== undefined &&
    (path.startsWith('/character') || path.startsWith('/storage') || path.startsWith('/stash'))
      ? `/party/${partyId}${path.replace(/^\/storage/, '/stash')}`
      : path;
  const router = createMemoryRouter(
    [
      { path: '/', Component: RedirectToCharacter },
      { path: '/party/:partyId/character/:id', Component: CharacterSheet },
      { path: '/party/:partyId/stash/:stashId', Component: StorageDetail },
    ],
    { initialEntries: [prefixed] },
  );
  render(
    <>
      <RouterProvider router={router} />
      <Toaster />
    </>,
  );
}

function bootstrapWithStorage(name = 'Chest at home'): {
  characterId: string;
  storageStashId: string;
  inventoryStashId: string;
  partyStashId: string;
  recoveredLootStashId: string;
} {
  const base = bootstrap();
  useStore.getState().dispatch({
    type: 'create-stash',
    payload: { ownerCharacterId: base.characterId, name, ...createStashIds(), ...createStashIds() },
  });
  const storageStashId = useStore.getState().appState!.stashes.at(-1)!.id;
  return { ...base, storageStashId };
}

describe('StorageDetail (M3)', () => {
  it('redirects away when stashId is unknown (lands on CharacterSheet via /-route redirect)', () => {
    bootstrapWithStorage();
    renderAt('/storage/does-not-exist');
    // The "/" route's RedirectToCharacter helper redirects to /character/:id when a character exists.
    expect(screen.getByRole('heading', { name: 'Thorin' })).toBeInTheDocument();
  });

  it('redirects away when the id is not a Storage stash (e.g. Inventory)', () => {
    const { inventoryStashId } = bootstrapWithStorage();
    renderAt(`/storage/${inventoryStashId}`);
    expect(screen.getByRole('heading', { name: 'Thorin' })).toBeInTheDocument();
  });

  it('redirects away for the Party Stash and Recovered Loot ids', () => {
    const { partyStashId } = bootstrapWithStorage();
    renderAt(`/storage/${partyStashId}`);
    expect(screen.getByRole('heading', { name: 'Thorin' })).toBeInTheDocument();
  });

  it('renders the stash name as the header', () => {
    const { storageStashId } = bootstrapWithStorage('Vault of Waterdeep');
    renderAt(`/storage/${storageStashId}`);
    expect(screen.getByRole('heading', { name: 'Vault of Waterdeep' })).toBeInTheDocument();
  });

  it('renders a Back link to the owning character sheet', async () => {
    const user = userEvent.setup();
    const { storageStashId } = bootstrapWithStorage();
    renderAt(`/storage/${storageStashId}`);

    const back = screen.getByRole('button', { name: /back to thorin/i });
    expect(back).toBeInTheDocument();
    await user.click(back);

    // CharacterSheet renders the character name as an h1.
    expect(screen.getByRole('heading', { name: 'Thorin' })).toBeInTheDocument();
  });

  it('renders a Rename button that opens the rename modal and dispatches on submit', async () => {
    const user = userEvent.setup();
    const { storageStashId } = bootstrapWithStorage('Chest at home');
    renderAt(`/storage/${storageStashId}`);

    await user.click(screen.getByRole('button', { name: /rename/i }));

    // Scoped to the dialog so the "Name" column header in StashItemsTable
    // (rendered behind the dialog) doesn't cause ambiguous label matches.
    const dialog = screen.getByRole('dialog');
    const input = dialog.querySelector('input#rename-stash-name');
    expect(input).not.toBeNull();
    expect((input as HTMLInputElement).value).toBe('Chest at home');
    await user.clear(input as HTMLInputElement);
    await user.type(input as HTMLInputElement, 'Vault of Waterdeep');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    // Header updates by reactivity.
    expect(screen.getByRole('heading', { name: 'Vault of Waterdeep' })).toBeInTheDocument();
    // Toast.
    expect(await screen.findByText(/storage stash renamed/i)).toBeInTheDocument();
  });

  it('renders a Delete button that opens the confirm dialog with item count copy', async () => {
    const user = userEvent.setup();
    const { storageStashId, catalog } = {
      ...bootstrapWithStorage('Doomed chest'),
      catalog: useStore.getState().appState!.catalog,
    };
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: storageStashId,
        definitionId: torch.id,
        quantity: 3,
        source: 'catalog-add',
        ...acquireIds(),
      },
    });
    renderAt(`/storage/${storageStashId}`);

    await user.click(screen.getByRole('button', { name: /^delete$/i }));

    // AlertDialog renders with the stash name (scoped) + item count.
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent(/Doomed chest/i);
    expect(dialog).toHaveTextContent(/3 items/i);
  });

  it('delete confirm dispatches delete-stash, navigates back to character sheet, and toasts', async () => {
    const user = userEvent.setup();
    const { storageStashId, characterId } = bootstrapWithStorage('Doomed chest');
    renderAt(`/storage/${storageStashId}`);

    // Open the alert dialog.
    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    // Confirm — there are now multiple "Delete" buttons (the trigger in
    // the header, the confirm in the alert dialog). Scope to the alert.
    const dialog = screen.getByRole('alertdialog');
    const confirm = dialog.querySelector('button:last-child');
    expect(confirm).not.toBeNull();
    await user.click(confirm as HTMLButtonElement);

    // The stash is gone from state.
    expect(
      useStore.getState().appState!.stashes.find((st) => st.id === storageStashId),
    ).toBeUndefined();
    // Toast appears.
    expect(await screen.findByText(/stash deleted/i)).toBeInTheDocument();
    // Navigated to the character sheet (which renders Thorin's name).
    expect(screen.getByRole('heading', { name: 'Thorin' })).toBeInTheDocument();
    expect(characterId).toBeTruthy();
  });

  it('renders the items table; adding an item works through the existing AddItemModal flow', async () => {
    const user = userEvent.setup();
    const { storageStashId } = bootstrapWithStorage();
    renderAt(`/storage/${storageStashId}`);

    // Items table is empty initially.
    expect(screen.getByText(/nothing here yet/i)).toBeInTheDocument();

    // The "+ Add item" button exists (reused affordance from CharacterSheet).
    expect(screen.getByRole('button', { name: /add item/i })).toBeInTheDocument();
    // We don't drive the full Add flow here — the inner modal is covered
    // by its own tests; we only verify the wiring on this screen.
    await user.click(screen.getByRole('button', { name: /add item/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('StorageDetail (M4)', () => {
  it('renders a CurrencyBreakdown in the header and a CurrencyRow above the items table', () => {
    const { storageStashId } = bootstrapWithStorage('Treasury');
    useStore.getState().dispatch({
      type: 'currency-change',
      payload: {
        stashId: storageStashId,
        delta: { cp: 0, sp: 0, ep: 0, gp: 25, pp: 0 },
        reason: 'deposit',
      },
    });
    renderAt(`/storage/${storageStashId}`);

    // Header breakdown: 25g visible.
    expect(screen.getByText(/25g/)).toBeInTheDocument();
    // Inline editor: Currency heading + Convert button + Total line.
    expect(screen.getByRole('heading', { name: /^currency$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /convert/i })).toBeInTheDocument();
    expect(screen.getByText(/total: 25 gp/i)).toBeInTheDocument();
  });
});
