import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ItemPicker } from './ItemPicker';
import type { ItemDefinition } from '@app/shared';

/**
 * R9.6 — the shared ItemPicker gained an interactive rarity filter + a
 * `layout` prop (`list` default + `rail` for DM browsing). This suite covers
 * the two layouts + the rarity-lock behavior directly (the picker was
 * previously exercised only via its consumers).
 */
function def(overrides: Partial<ItemDefinition> & { id: string; name: string }): ItemDefinition {
  return {
    source: 'DMG',
    category: 'magic',
    ...overrides,
  };
}

const CATALOG: ItemDefinition[] = [
  def({ id: 'a', name: 'Common Trinket', rarity: 'common', category: 'gear', source: 'PHB' }),
  def({ id: 'b', name: 'Rare Wand', rarity: 'rare', category: 'magic', requiresAttunement: true }),
  def({
    id: 'c',
    name: 'Homebrew Blade',
    rarity: 'uncommon',
    category: 'weapon',
    source: 'homebrew',
  }),
];

describe('ItemPicker (R9.6)', () => {
  it('list layout renders rarity filter chips + all rows, and Pick fires onPick', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<ItemPicker catalog={CATALOG} onPick={onPick} onCancel={() => {}} />);

    // Interactive rarity chips present (list layout, not locked).
    expect(screen.getByRole('button', { name: /^all$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^rare$/i })).toBeInTheDocument();

    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);

    await user.click(within(list).getAllByRole('button', { name: /^pick$/i })[0]!);
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('rarity chip filters the result list', async () => {
    const user = userEvent.setup();
    render(<ItemPicker catalog={CATALOG} onPick={() => {}} onCancel={() => {}} />);

    await user.click(screen.getByRole('button', { name: /^rare$/i }));
    const list = screen.getByRole('list');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(within(list).getByText('Rare Wand')).toBeInTheDocument();
  });

  it('a locked rarityFilter hides the interactive chips and pre-filters', () => {
    render(
      <ItemPicker
        catalog={CATALOG}
        rarityFilter="uncommon"
        onPick={() => {}}
        onCancel={() => {}}
      />,
    );
    // No "All" chip when locked.
    expect(screen.queryByRole('button', { name: /^all$/i })).not.toBeInTheDocument();
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByText('Homebrew Blade')).toBeInTheDocument();
  });

  it('rail layout renders the left filter rail (rarity + category)', () => {
    render(<ItemPicker catalog={CATALOG} layout="rail" onPick={() => {}} onCancel={() => {}} />);
    // Rail headings.
    expect(screen.getByText(/^rarity$/i)).toBeInTheDocument();
    expect(screen.getByText(/^category$/i)).toBeInTheDocument();
    // Category rail lists the distinct catalog categories + All.
    expect(screen.getByRole('button', { name: /^weapon$/i })).toBeInTheDocument();
  });

  it('Cancel button fires onCancel', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<ItemPicker catalog={CATALOG} onPick={() => {}} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
