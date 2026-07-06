import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { HomebrewForm } from './HomebrewForm';
import { Toaster } from '@/components/ui/sonner';
import { useStore, dispatchMintingAction } from '@/store';
import { wipeAll } from '@/db/wipe';
import type { ItemDefinition } from '@app/shared';

import { bootstrap, bootstrapWithHomebrew } from '@/test/fixtures';

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

function getHomebrewRow(name: string): ItemDefinition | undefined {
  return useStore
    .getState()
    .appState!.catalog.find((d) => d.source === 'homebrew' && d.name === name);
}

describe('HomebrewForm — create mode (M6)', () => {
  function renderCreate(onOpenChange: (open: boolean) => void = () => {}): void {
    render(
      <>
        <HomebrewForm open={true} onOpenChange={onOpenChange} mode="create" />
        <Toaster />
      </>,
    );
  }

  it('renders all expected fields in create mode', () => {
    bootstrap();
    renderCreate();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/category/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/weight/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/cost \(amount\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/currency/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/tags/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^create$/i })).toBeInTheDocument();
    // BUG-012 — magic-item fields are hidden by default (category
    // defaults to 'gear'). They only appear when the user picks
    // Magic item.
    expect(screen.queryByLabelText(/^rarity$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/requires attunement/i)).not.toBeInTheDocument();
  });

  it('shows validation error and does NOT dispatch when name is empty', async () => {
    const user = userEvent.setup();
    bootstrap();
    const before = useStore.getState().appState!.catalog.length;
    renderCreate();

    await user.click(screen.getByRole('button', { name: /^create$/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/name is required/i);
    expect(useStore.getState().appState!.catalog).toHaveLength(before);
  });

  it('dispatches create-homebrew with a full payload and closes the modal', async () => {
    const user = userEvent.setup();
    bootstrap();
    let openValue = true;
    renderCreate((next) => {
      openValue = next;
    });

    await user.type(screen.getByLabelText(/^name$/i), 'Glowing Mushroom');
    await user.selectOptions(screen.getByLabelText(/category/i), 'consumable');
    await user.type(screen.getByLabelText(/weight/i), '0.1');
    await user.type(screen.getByLabelText(/cost \(amount\)/i), '5');
    await user.selectOptions(screen.getByLabelText(/currency/i), 'gp');
    await user.type(screen.getByLabelText(/description/i), 'Glows softly.');
    await user.type(screen.getByLabelText(/tags/i), 'light, underdark');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    const created = getHomebrewRow('Glowing Mushroom');
    expect(created).toBeDefined();
    expect(created?.category).toBe('consumable');
    expect(created?.weight).toBe(0.1);
    expect(created?.cost).toEqual({ amount: 5, currency: 'gp' });
    expect(created?.description).toBe('Glows softly.');
    expect(created?.tags).toEqual(['light', 'underdark']);
    expect(openValue).toBe(false);
  });

  it('omits empty optional fields from the payload', async () => {
    const user = userEvent.setup();
    bootstrap();
    renderCreate();

    await user.type(screen.getByLabelText(/^name$/i), 'Minimal');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    const created = getHomebrewRow('Minimal');
    expect(created).toBeDefined();
    expect(created?.weight).toBeUndefined();
    expect(created?.cost).toBeUndefined();
    expect(created?.description).toBeUndefined();
    expect(created?.tags).toBeUndefined();
  });

  it('fires onCreated with the new definitionId', async () => {
    const user = userEvent.setup();
    bootstrap();
    let createdId: string | undefined;
    render(
      <>
        <HomebrewForm
          open={true}
          onOpenChange={() => {}}
          mode="create"
          onCreated={(id) => {
            createdId = id;
          }}
        />
        <Toaster />
      </>,
    );

    await user.type(screen.getByLabelText(/^name$/i), 'Callback');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    const created = getHomebrewRow('Callback');
    expect(createdId).toBe(created?.id);
  });

  it('shows a "Homebrew created" toast on success', async () => {
    const user = userEvent.setup();
    bootstrap();
    renderCreate();

    await user.type(screen.getByLabelText(/^name$/i), 'Toasted');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    expect(await screen.findByText(/homebrew created/i)).toBeInTheDocument();
  });
});

describe('HomebrewForm — duplicate mode (M6)', () => {
  it('pre-fills from the source definition and records duplicatedFromId', async () => {
    const user = userEvent.setup();
    const { catalog } = bootstrap();
    const torch = catalog.find((d) => d.id === 'phb-2024:torch')!;

    render(
      <>
        <HomebrewForm open={true} onOpenChange={() => {}} mode="duplicate" definition={torch} />
        <Toaster />
      </>,
    );

    // Name input pre-filled with PHB row's name.
    expect(screen.getByLabelText(/^name$/i)).toHaveValue(torch.name);

    // Submit without changes — picks up the PHB name as a homebrew clone.
    await user.click(screen.getByRole('button', { name: /duplicate/i }));

    const homebrew = useStore
      .getState()
      .appState!.catalog.find((d) => d.source === 'homebrew' && d.duplicatedFromId === torch.id);
    expect(homebrew).toBeDefined();
    expect(homebrew?.name).toBe(torch.name);
    // The original PHB row stays put.
    expect(useStore.getState().appState!.catalog.find((d) => d.id === torch.id)).toBeDefined();
  });
});

describe('HomebrewForm — edit mode (M6)', () => {
  it('pre-fills from the existing homebrew definition', () => {
    const { homebrewDefId } = bootstrapWithHomebrew({ name: 'Glowing Mushroom' });
    const def = useStore.getState().appState!.catalog.find((d) => d.id === homebrewDefId)!;

    render(
      <>
        <HomebrewForm open={true} onOpenChange={() => {}} mode="edit" definition={def} />
        <Toaster />
      </>,
    );

    expect(screen.getByLabelText(/^name$/i)).toHaveValue('Glowing Mushroom');
  });

  it('dispatches edit-homebrew on submit with changed-field-only diff', async () => {
    const user = userEvent.setup();
    const { homebrewDefId } = bootstrapWithHomebrew({ name: 'Old Name' });
    const def = useStore.getState().appState!.catalog.find((d) => d.id === homebrewDefId)!;

    render(
      <>
        <HomebrewForm open={true} onOpenChange={() => {}} mode="edit" definition={def} />
        <Toaster />
      </>,
    );

    const nameInput = screen.getByLabelText(/^name$/i);
    await user.clear(nameInput);
    await user.type(nameInput, 'New Name');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    const updated = useStore.getState().appState!.catalog.find((d) => d.id === homebrewDefId);
    expect(updated?.name).toBe('New Name');

    const lastEntry = useStore.getState().log.at(-1)!;
    expect(lastEntry.type).toBe('edit-homebrew');
    if (lastEntry.type !== 'edit-homebrew') return;
    expect(lastEntry.payload.changedFields).toEqual(['name']);
  });

  it('surfaces reducer no-op error when nothing changed', async () => {
    const user = userEvent.setup();
    const { homebrewDefId } = bootstrapWithHomebrew({ name: 'Glowing Mushroom' });
    const def = useStore.getState().appState!.catalog.find((d) => d.id === homebrewDefId)!;

    render(
      <>
        <HomebrewForm open={true} onOpenChange={() => {}} mode="edit" definition={def} />
        <Toaster />
      </>,
    );

    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no fields changed/i);
  });
});

describe('HomebrewForm — magic-item fields (BUG-012)', () => {
  function renderCreate(): void {
    render(
      <>
        <HomebrewForm open={true} onOpenChange={() => {}} mode="create" />
        <Toaster />
      </>,
    );
  }

  it('reveals rarity + requiresAttunement inputs when category switches to Magic', async () => {
    const user = userEvent.setup();
    bootstrap();
    renderCreate();

    // Hidden by default (category=gear).
    expect(screen.queryByLabelText(/^rarity$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/requires attunement/i)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/category/i), 'magic');

    expect(screen.getByLabelText(/^rarity$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/requires attunement/i)).toBeInTheDocument();
    // Prereq input is nested behind the checkbox — hidden until the
    // user checks Requires attunement.
    expect(screen.queryByLabelText(/attunement prerequisite/i)).not.toBeInTheDocument();
  });

  it('reveals the prereq input only after Requires attunement is checked', async () => {
    const user = userEvent.setup();
    bootstrap();
    renderCreate();

    await user.selectOptions(screen.getByLabelText(/category/i), 'magic');
    expect(screen.queryByLabelText(/attunement prerequisite/i)).not.toBeInTheDocument();

    await user.click(screen.getByLabelText(/requires attunement/i));
    expect(screen.getByLabelText(/attunement prerequisite/i)).toBeInTheDocument();
  });

  it('rejects submit for magic-category items when rarity is unpicked', async () => {
    const user = userEvent.setup();
    bootstrap();
    const before = useStore.getState().appState!.catalog.length;
    renderCreate();

    await user.type(screen.getByLabelText(/^name$/i), 'Wand of Bugs');
    await user.selectOptions(screen.getByLabelText(/category/i), 'magic');
    // Leave rarity at the '' sentinel.
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    expect(await screen.findByText(/rarity is required for magic items/i)).toBeInTheDocument();
    expect(useStore.getState().appState!.catalog).toHaveLength(before);
  });

  it('dispatches create-homebrew with rarity + attunement metadata', async () => {
    const user = userEvent.setup();
    bootstrap();
    renderCreate();

    await user.type(screen.getByLabelText(/^name$/i), 'Wand of Bugs');
    await user.selectOptions(screen.getByLabelText(/category/i), 'magic');
    await user.selectOptions(screen.getByLabelText(/^rarity$/i), 'uncommon');
    await user.click(screen.getByLabelText(/requires attunement/i));
    await user.type(screen.getByLabelText(/attunement prerequisite/i), 'by a wizard');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    const created = getHomebrewRow('Wand of Bugs');
    expect(created).toBeDefined();
    expect(created?.category).toBe('magic');
    expect(created?.rarity).toBe('uncommon');
    expect(created?.requiresAttunement).toBe(true);
    expect(created?.attunementPrereq).toBe('by a wizard');
  });

  it('omits attunementPrereq when Requires attunement is off', async () => {
    const user = userEvent.setup();
    bootstrap();
    renderCreate();

    await user.type(screen.getByLabelText(/^name$/i), 'Weightless Trinket');
    await user.selectOptions(screen.getByLabelText(/category/i), 'magic');
    await user.selectOptions(screen.getByLabelText(/^rarity$/i), 'common');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    const created = getHomebrewRow('Weightless Trinket');
    expect(created).toBeDefined();
    expect(created?.rarity).toBe('common');
    expect(created?.requiresAttunement).toBeUndefined();
    expect(created?.attunementPrereq).toBeUndefined();
  });

  it('leaves rarity/attunement fields absent for non-magic homebrew items', async () => {
    const user = userEvent.setup();
    bootstrap();
    renderCreate();

    await user.type(screen.getByLabelText(/^name$/i), 'Fancy Rope');
    // category stays 'gear' by default.
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    const created = getHomebrewRow('Fancy Rope');
    expect(created).toBeDefined();
    expect(created?.category).toBe('gear');
    expect(created?.rarity).toBeUndefined();
    expect(created?.requiresAttunement).toBeUndefined();
    expect(created?.attunementPrereq).toBeUndefined();
  });

  it('edit mode: unchecking Requires attunement clears the flag via the edit-homebrew patch', async () => {
    const user = userEvent.setup();

    // Bootstrap and create a magic-attunement homebrew directly via
    // the reducer so the test focuses on the edit path (avoids
    // stacking two modals in the DOM, which trips
    // testing-library pointer-events checks).
    const { partyId } = bootstrap();
    dispatchMintingAction({
      type: 'create-homebrew',
      payload: {
        name: 'Cursed Blade',
        category: 'magic',
        rarity: 'rare',
        requiresAttunement: true,
      },
    });
    void partyId;
    const created = getHomebrewRow('Cursed Blade')!;
    expect(created.requiresAttunement).toBe(true);

    // Open edit mode on that row and uncheck the flag.
    render(
      <>
        <HomebrewForm open={true} onOpenChange={() => {}} mode="edit" definition={created} />
        <Toaster />
      </>,
    );
    const checkbox = screen.getByLabelText(/requires attunement/i);
    await user.click(checkbox);
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    const updated = useStore.getState().appState!.catalog.find((d) => d.id === created.id)!;
    expect(updated.requiresAttunement).toBeUndefined();

    const last = useStore.getState().log.at(-1)!;
    expect(last.type).toBe('edit-homebrew');
    if (last.type === 'edit-homebrew') {
      expect(last.payload.changedFields).toContain('requiresAttunement');
    }
  });
});
