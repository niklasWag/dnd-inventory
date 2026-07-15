import { type ReactElement } from 'react';

import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useThemeStore, type ThemePreference } from '@/store/theme';

/**
 * R7.1.a / R9.11 — Settings row for the theme preference.
 *
 * R9.11 — restyled from a native `<select>` to the mockup's segmented
 * button group (Light / Dark / System). Rendered as a `radiogroup` of
 * three buttons; the store owns persistence + the `<html>` class
 * side-effect, so this stays a pure controlled input.
 */
const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

export function ThemeField(): ReactElement {
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <Label>Theme</Label>
        <p className="text-xs text-muted-foreground">
          {preference === 'system'
            ? 'Matches your device’s current appearance and updates automatically.'
            : preference === 'light'
              ? 'Always light — ignores the device setting.'
              : 'Always dark — ignores the device setting.'}
        </p>
      </div>
      <div
        role="radiogroup"
        aria-label="Theme"
        className="inline-flex shrink-0 overflow-hidden rounded-md border border-border"
      >
        {OPTIONS.map((o) => {
          const selected = preference === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setPreference(o.value)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition',
                selected
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-surface-2',
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
