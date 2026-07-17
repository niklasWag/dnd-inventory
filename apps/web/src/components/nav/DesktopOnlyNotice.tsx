import { type ReactElement, type ReactNode } from 'react';
import { MonitorSmartphone } from 'lucide-react';

/**
 * R10.2 — min-width guard for the DM tools that don't reflow below 768px
 * (Hoard Generator, Loot Distribution Wizard, Shop Manage). OUTLINE §5
 * decided a "use a larger screen" notice over full mobile reflow for these
 * desktop-priority surfaces (the DM Dashboard + Party Settings reflow fine
 * and are NOT wrapped).
 *
 * CSS-only: both the notice and the wrapped screen render; Tailwind's
 * `md:hidden` / `hidden md:block` pair shows the correct one at the current
 * viewport and flips at the 768px (`md`) breakpoint with no JS media query
 * (no hydration flash, no new hook). Mirrors the `hidden lg:block` gate the
 * nav shell already uses in `Layout.tsx`.
 */
export function DesktopOnlyNotice({ children }: { children: ReactNode }): ReactElement {
  return (
    <>
      <div className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center px-4 py-12 md:hidden">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-xl border border-primary/40 bg-gradient-to-br from-primary/15 to-surface-2 text-primary shadow-e1">
            <MonitorSmartphone className="h-6 w-6" aria-hidden="true" />
          </span>
        </div>
        <div className="overflow-hidden rounded-xl border border-border bg-surface p-6 text-center shadow-e2">
          <h1 className="font-display text-2xl font-bold tracking-tight">
            Best on a larger screen
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            This DM tool needs more room than a phone. Open it on a tablet or desktop (at least
            768px wide).
          </p>
        </div>
      </div>
      <div className="hidden md:block">{children}</div>
    </>
  );
}
