import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { DesktopOnlyNotice } from './DesktopOnlyNotice';

/**
 * R10.2 — the guard is CSS-only: both the notice and the wrapped content
 * render into the DOM; Tailwind's `md:hidden` / `hidden md:block` pair
 * decides which is visible at runtime (jsdom has no real viewport, so both
 * are queryable here — same as the `hidden lg:block` nav shell). We assert
 * both branches render AND carry the breakpoint classes that gate them.
 */
describe('DesktopOnlyNotice', () => {
  it('renders both the notice and the wrapped children', () => {
    render(
      <DesktopOnlyNotice>
        <div>wrapped screen</div>
      </DesktopOnlyNotice>,
    );
    expect(screen.getByText(/best on a larger screen/i)).toBeInTheDocument();
    expect(screen.getByText('wrapped screen')).toBeInTheDocument();
  });

  it('gates the notice with md:hidden and the content with hidden md:block', () => {
    const { container } = render(
      <DesktopOnlyNotice>
        <div>wrapped screen</div>
      </DesktopOnlyNotice>,
    );
    const notice = screen.getByText(/best on a larger screen/i).closest('.md\\:hidden');
    expect(notice).not.toBeNull();

    const contentWrapper = container.querySelector('.hidden.md\\:block');
    expect(contentWrapper).not.toBeNull();
    expect(contentWrapper).toHaveTextContent('wrapped screen');
  });
});
