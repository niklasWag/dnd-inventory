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
  it('renders the three preference options and reflects the current value', () => {
    useThemeStore.setState({ preference: 'dark' });
    render(<ThemeField />);
    const select = screen.getByLabelText(/theme/i);
    expect(select).toHaveValue('dark');
    expect(screen.getByRole('option', { name: /system — follow os setting/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /^light$/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /^dark$/i })).toBeInTheDocument();
  });

  it('changing the select updates the store', async () => {
    const user = userEvent.setup();
    render(<ThemeField />);
    const select = screen.getByLabelText(/theme/i);
    await user.selectOptions(select, 'light');
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
