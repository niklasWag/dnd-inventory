import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ThemeField } from './ThemeField';
import { useThemeStore } from '@/store/theme';
import { wipeAll } from '@/db/wipe';

beforeEach(async () => {
  await wipeAll();
  useThemeStore.setState({ preference: 'system', systemTheme: 'light', hydrated: false });
});

describe('ThemeField', () => {
  it('renders the three preference options as radios and marks the current one', () => {
    useThemeStore.setState({ preference: 'dark' });
    render(<ThemeField />);
    expect(screen.getByRole('radio', { name: /^light$/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /^dark$/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /^system$/i })).toBeInTheDocument();
  });

  it('clicking a segment updates the store', async () => {
    const user = userEvent.setup();
    render(<ThemeField />);
    await user.click(screen.getByRole('radio', { name: /^light$/i }));
    expect(useThemeStore.getState().preference).toBe('light');
  });

  it('shows a contextual hint per preference', () => {
    useThemeStore.setState({ preference: 'system' });
    const { rerender } = render(<ThemeField />);
    expect(screen.getByText(/matches your device/i)).toBeInTheDocument();

    useThemeStore.setState({ preference: 'light' });
    rerender(<ThemeField />);
    expect(screen.getByText(/always light/i)).toBeInTheDocument();

    useThemeStore.setState({ preference: 'dark' });
    rerender(<ThemeField />);
    expect(screen.getByText(/always dark/i)).toBeInTheDocument();
  });
});
