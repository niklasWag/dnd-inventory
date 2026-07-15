import { type ReactElement, type ReactNode } from 'react';
import { Swords } from 'lucide-react';

/**
 * R9.12c — shared chrome-light shell for the unscoped auth screens
 * (`Login`, `LoginEmail`, `LoginEmailVerify`, `LoginDisplayName`). The
 * design-lab shipped no auth mockup, so the R9 language here is derived
 * from the token/type system + the framed-card idiom used across
 * Settings / PartySettings: a centered `surface` card with an e2
 * elevation, a `font-display` brand lockup, a `font-display` title, and
 * muted supporting copy.
 *
 * Pure presentation — the flows (OTP, Discord, display-name) live in the
 * hosting screens and pass their form/buttons as `children`.
 */
export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-12">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-xl border border-primary/40 bg-gradient-to-br from-primary/15 to-surface-2 text-primary shadow-e1">
          <Swords className="h-6 w-6" aria-hidden="true" />
        </span>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-surface p-6 shadow-e2">
        <header className="mb-5 text-center">
          <h1 className="font-display text-2xl font-bold tracking-tight">{title}</h1>
          {description !== undefined ? (
            <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </header>
        {children}
      </div>
    </div>
  );
}
