import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AccentField, FollowClassField, HubLayoutField } from './AppearanceFields';
import { useAccentStore } from '@/store/accent';
import { useHubLayoutStore } from '@/store/hubLayout';
import { wipeAll } from '@/db/wipe';

/**
 * R9.11 — Appearance-cluster field tests. Each field is a controlled view
 * over its UX-chrome store (accent / hub-layout); verify select/toggle
 * writes flow into the store.
 */
beforeEach(async () => {
  await wipeAll();
  useAccentStore.setState({ accentId: 'cyan-teal', followClass: false, hydrated: true });
  useHubLayoutStore.setState({ layout: 'hero', hydrated: true });
});

describe('AppearanceFields (R9.11)', () => {
  it('AccentField marks the current accent selected and picks another', async () => {
    const user = userEvent.setup();
    render(<AccentField />);
    // Default cyan-teal is checked.
    expect(screen.getByRole('radio', { name: /cyan-teal/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.click(screen.getByRole('radio', { name: /amber/i }));
    expect(useAccentStore.getState().accentId).toBe('amber');
  });

  it('FollowClassField toggle flips the store flag', async () => {
    const user = userEvent.setup();
    render(<FollowClassField />);
    const toggle = screen.getByRole('switch', { name: /follow character class/i });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);
    expect(useAccentStore.getState().followClass).toBe(true);
  });

  it('HubLayoutField selecting List updates the store', async () => {
    const user = userEvent.setup();
    render(<HubLayoutField />);
    await user.selectOptions(screen.getByLabelText(/hub layout/i), 'list');
    expect(useHubLayoutStore.getState().layout).toBe('list');
  });
});
