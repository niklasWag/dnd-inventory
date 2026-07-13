import { type ReactElement } from 'react';
import { Construction } from 'lucide-react';

/**
 * R9.3 — shared placeholder for the stash-family screens that the sidebar
 * now routes to (Stashes / Party Stash / Recovered Loot) but which are not
 * built until R9.5. Keeps the nav destinations live (no dead routes / 404s)
 * with an honest "coming soon" surface. Replaced in R9.5 by the real
 * Storage overview / Party Stash / Recovered Loot screens.
 */
export function StashPlaceholder({ title }: { title: string }): ReactElement {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-surface-2 text-muted-foreground">
        <Construction className="h-6 w-6" aria-hidden="true" />
      </div>
      <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        This screen is coming in R9.5 — the stash-family redesign. For now, manage items from the
        Character Sheet.
      </p>
    </div>
  );
}
