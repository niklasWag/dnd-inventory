import type { ReactElement } from 'react';

/**
 * R4.2.b — shared role badge for the §8.1 actor-role triad. Used by the
 * party member list (`PartySettings`) and per-item audit log
 * (`ItemHistory`); will also be used by the R4.2.e party log view.
 *
 * Lives outside `components/ui/` because that folder is shadcn-managed
 * (CLAUDE.md: "do not hand-edit"). Each role gets a distinct token-based
 * Tailwind treatment so the badge serves as the audit-trail signal at a
 * glance — identical styling across roles would defeat the purpose. The
 * banker variant uses the theme's `accent` slot (warm/secondary-emphasis)
 * to read as "privileged, but not DM".
 *
 * Per OUTLINE §3.14, `'banker'` is derived from
 * `Party.bankerUserId === actorUserId`, never from a membership row.
 * `deriveActorRole` (`@app/shared/guards/actor.ts`) is the canonical
 * resolver; this component only renders the result.
 */
export function RoleBadge({ role }: { role: 'dm' | 'player' | 'banker' }): ReactElement {
  const { label, styles } = ROLE_PRESETS[role];
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${styles}`}>{label}</span>;
}

const ROLE_PRESETS: Record<'dm' | 'player' | 'banker', { label: string; styles: string }> = {
  dm: { label: 'DM', styles: 'bg-primary/10 text-primary' },
  player: { label: 'Player', styles: 'bg-secondary text-secondary-foreground' },
  banker: { label: 'Banker', styles: 'bg-accent text-accent-foreground' },
};
