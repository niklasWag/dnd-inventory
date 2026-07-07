import { type ReactElement } from 'react';

import { Label } from '@/components/ui/label';
import { useThemeStore, type ThemePreference } from '@/store/theme';

/**
 * R7.1.a — Settings row for the theme preference (Light / Dark / System).
 *
 * Native `<select>` mirroring `EncumbranceRuleField` — three options fit
 * cleanly and native selects test cleanly under jsdom (no Radix portal).
 * The store owns persistence + the `<html>` class side-effect; this
 * component is a pure controlled input.
 */
export function ThemeField(): ReactElement {
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);
  const selectId = 'theme-preference';

  return (
    <div className="space-y-2">
      <Label htmlFor={selectId}>Theme</Label>
      <select
        id={selectId}
        value={preference}
        onChange={(e) => {
          setPreference(e.target.value as ThemePreference);
        }}
        className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        <option value="system">System — follow OS setting</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
      <p className="text-xs text-muted-foreground">
        {preference === 'system'
          ? 'Matches your device’s current appearance and updates automatically.'
          : preference === 'light'
            ? 'Always light — ignores the device setting.'
            : 'Always dark — ignores the device setting.'}
      </p>
    </div>
  );
}
