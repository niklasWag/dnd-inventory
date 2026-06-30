import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RoleBadge } from './RoleBadge';

/**
 * R4.2.b — `RoleBadge` is the single rendering of an actor's role across
 * the app: party member list (`PartySettings`), per-item audit log
 * (`ItemHistory`), and (R4.2.e) the party log view. It widens the
 * previously-local `PartySettings.RoleBadge` to include `'banker'`,
 * lit up by R4.2.a's `Party.bankerUserId` schema widening.
 */
describe('RoleBadge', () => {
  it('renders "DM" for role="dm"', () => {
    render(<RoleBadge role="dm" />);
    expect(screen.getByText('DM')).toBeInTheDocument();
  });

  it('renders "Player" for role="player"', () => {
    render(<RoleBadge role="player" />);
    expect(screen.getByText('Player')).toBeInTheDocument();
  });

  it('renders "Banker" for role="banker"', () => {
    render(<RoleBadge role="banker" />);
    expect(screen.getByText('Banker')).toBeInTheDocument();
  });

  it('styles each role distinctly (className differs across variants)', () => {
    const { container: dmContainer } = render(<RoleBadge role="dm" />);
    const { container: playerContainer } = render(<RoleBadge role="player" />);
    const { container: bankerContainer } = render(<RoleBadge role="banker" />);

    const dmClass = dmContainer.querySelector('span')!.className;
    const playerClass = playerContainer.querySelector('span')!.className;
    const bankerClass = bankerContainer.querySelector('span')!.className;

    // Three distinct visual treatments — the badge is the audit-trail
    // signal for "who took this action". Identical styling would defeat
    // the purpose.
    expect(dmClass).not.toBe(playerClass);
    expect(playerClass).not.toBe(bankerClass);
    expect(dmClass).not.toBe(bankerClass);
  });
});
