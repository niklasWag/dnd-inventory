import { type ReactElement } from 'react';

import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useAccentStore } from '@/store/accent';
import { accentPresets } from '@/store/accentColors';
import { useHubLayoutStore } from '@/store/hubLayout';

/**
 * R9.11 — the Appearance-cluster fields beyond Theme (which stays its own
 * `ThemeField`): accent picker, opt-in follow-class toggle, and the
 * Hub-layout preference.
 *
 * Each reads/writes its dedicated UX-chrome store (kept out of the main
 * reducer per the theme/accent/sidebar pattern). The accent store's
 * side-effect (`attachAccentSideEffects`) recomputes the `--primary` vars
 * whenever these change, so the swatches take effect live.
 */

/** Accent brand-color picker — swatch buttons from the R9.0 presets. */
export function AccentField(): ReactElement {
  const accentId = useAccentStore((s) => s.accentId);
  const setAccent = useAccentStore((s) => s.setAccent);

  return (
    <div className="space-y-2">
      <Label>Accent color</Label>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Accent color">
        {accentPresets.map((preset) => {
          const selected = preset.id === accentId;
          return (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={preset.label}
              title={preset.label}
              onClick={() => setAccent(preset.id)}
              className={cn(
                'h-8 w-8 rounded-full ring-offset-2 ring-offset-background transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                selected ? 'ring-2 ring-ring' : 'ring-1 ring-inset ring-border hover:scale-105',
              )}
              style={{ backgroundColor: `hsl(${preset.light.primary})` }}
            />
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Your brand accent. Used unless “follow character class” is on and you’re in a party.
      </p>
    </div>
  );
}

/** Opt-in "accent follows the current character's class" toggle. */
export function FollowClassField(): ReactElement {
  const followClass = useAccentStore((s) => s.followClass);
  const setFollowClass = useAccentStore((s) => s.setFollowClass);

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <Label htmlFor="accent-follow-class">Follow character class</Label>
        <p className="text-xs text-muted-foreground">
          While in a party, tint the accent to your character’s class color. Outside a party your
          chosen accent is used.
        </p>
      </div>
      <button
        id="accent-follow-class"
        type="button"
        role="switch"
        aria-checked={followClass}
        aria-label="Follow character class"
        onClick={() => setFollowClass(!followClass)}
        className={cn(
          'relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition',
          followClass ? 'bg-primary' : 'bg-surface-2 ring-1 ring-inset ring-border',
        )}
      >
        <span
          className={cn(
            'inline-block h-5 w-5 transform rounded-full bg-surface shadow-e1 transition',
            followClass ? 'translate-x-5' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}

/** Hub-layout preference — Hero (default) vs List + Detail. */
export function HubLayoutField(): ReactElement {
  const layout = useHubLayoutStore((s) => s.layout);
  const setLayout = useHubLayoutStore((s) => s.setLayout);
  const selectId = 'hub-layout-preference';

  return (
    <div className="space-y-2">
      <Label htmlFor={selectId}>Hub layout</Label>
      <select
        id={selectId}
        value={layout}
        onChange={(e) => setLayout(e.target.value === 'list' ? 'list' : 'hero')}
        className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        <option value="hero">Hero — big “continue” medallion</option>
        <option value="list">List + detail — party list with a detail pane</option>
      </select>
      <p className="text-xs text-muted-foreground">
        {layout === 'hero'
          ? 'A prominent hero with your most-recent party front and center.'
          : 'A scannable list of every party beside a detail pane.'}
      </p>
    </div>
  );
}
