/**
 * R9.0 — Accent color data (docs/r9-redesign/DESIGN_SYSTEM.md §1 "Accent").
 *
 * Two datasets consumed by the accent store (store/accent.ts):
 *
 *   1. `accentPresets` — the user-selectable brand accents. `cyan-teal` is the
 *      default (the brand's first impression before any customization).
 *   2. `classColors` — the 12 unique per-2024-PHB-class hues used by the opt-in
 *      "follow character class" setting. Six reuse an accent preset verbatim
 *      (marked ✻); all 12 stay visually distinct so switching characters
 *      re-skins the accent.
 *
 * Every entry carries a light + dark `{ primary, foreground, ring }` HSL
 * channel triplet, matching the `--primary` / `--primary-foreground` / `--ring`
 * tokens the store writes onto `:root`.
 */

export interface AccentTriplet {
  /** `--primary` / `--accent` HSL channels, e.g. `196 78% 38%`. */
  primary: string;
  /** `--primary-foreground` / `--accent-foreground` HSL channels. */
  foreground: string;
  /** `--ring` HSL channels. */
  ring: string;
}

export interface AccentColor {
  light: AccentTriplet;
  dark: AccentTriplet;
}

export interface AccentPreset extends AccentColor {
  /** Stable id persisted in Dexie meta + used in the Settings picker. */
  id: string;
  /** Human label for the Settings picker. */
  label: string;
}

/**
 * The brand default accent (cyan-teal) — the first impression before any
 * customization. Declared standalone so `DEFAULT_ACCENT_ID` + the unknown-id
 * fallback in `accentPresetFor` are statically non-undefined under
 * `noUncheckedIndexedAccess`.
 */
export const DEFAULT_ACCENT: AccentPreset = {
  id: 'cyan-teal',
  label: 'Cyan-teal',
  light: { primary: '196 78% 38%', foreground: '200 40% 98%', ring: '196 72% 42%' },
  dark: { primary: '194 70% 56%', foreground: '205 40% 10%', ring: '194 68% 56%' },
};

export const DEFAULT_ACCENT_ID = DEFAULT_ACCENT.id;

/**
 * User-selectable brand accents. The first entry is the default.
 * Values mirror the design lab's accent picker + DESIGN_SYSTEM §1.
 */
export const accentPresets: AccentPreset[] = [
  DEFAULT_ACCENT,
  {
    id: 'amber',
    label: 'Amber',
    light: { primary: '32 80% 45%', foreground: '40 40% 98%', ring: '32 80% 48%' },
    dark: { primary: '36 80% 58%', foreground: '30 40% 10%', ring: '36 80% 58%' },
  },
  {
    id: 'emerald',
    label: 'Emerald',
    light: { primary: '150 55% 32%', foreground: '40 40% 98%', ring: '150 55% 36%' },
    dark: { primary: '150 52% 52%', foreground: '150 40% 8%', ring: '150 52% 52%' },
  },
  {
    id: 'teal',
    label: 'Teal',
    light: { primary: '188 70% 33%', foreground: '40 40% 98%', ring: '188 65% 38%' },
    dark: { primary: '184 62% 52%', foreground: '200 30% 10%', ring: '184 60% 52%' },
  },
  {
    id: 'violet',
    label: 'Violet',
    light: { primary: '255 55% 48%', foreground: '40 40% 98%', ring: '250 60% 55%' },
    dark: { primary: '255 70% 68%', foreground: '260 30% 12%', ring: '255 70% 70%' },
  },
  {
    id: 'crimson',
    label: 'Crimson',
    light: { primary: '348 65% 45%', foreground: '40 40% 98%', ring: '348 65% 48%' },
    dark: { primary: '350 70% 62%', foreground: '350 30% 10%', ring: '350 70% 62%' },
  },
];

export interface ClassColor extends AccentColor {
  /** 2024 PHB class name (matched case-insensitively against Character.class). */
  class: string;
  /** Hue label for the reference grid. */
  label: string;
}

/**
 * The 12 unique per-class accents for the "follow character class" setting.
 * ✻ = identical to the same-named accent preset above.
 */
export const classColors: ClassColor[] = [
  {
    // ✻ crimson
    class: 'Barbarian',
    label: 'Crimson',
    light: { primary: '348 65% 45%', foreground: '40 40% 98%', ring: '348 65% 48%' },
    dark: { primary: '350 70% 62%', foreground: '350 30% 10%', ring: '350 70% 62%' },
  },
  {
    class: 'Bard',
    label: 'Magenta',
    light: { primary: '322 62% 46%', foreground: '320 40% 98%', ring: '322 58% 50%' },
    dark: { primary: '322 66% 66%', foreground: '320 40% 10%', ring: '322 64% 66%' },
  },
  {
    // ✻ amber
    class: 'Cleric',
    label: 'Amber',
    light: { primary: '32 80% 45%', foreground: '40 40% 98%', ring: '32 80% 48%' },
    dark: { primary: '36 80% 58%', foreground: '30 40% 10%', ring: '36 80% 58%' },
  },
  {
    class: 'Druid',
    label: 'Leaf green',
    light: { primary: '110 52% 34%', foreground: '110 40% 98%', ring: '110 50% 38%' },
    dark: { primary: '108 50% 54%', foreground: '110 45% 8%', ring: '108 48% 54%' },
  },
  {
    class: 'Fighter',
    label: 'Steel blue',
    light: { primary: '210 58% 42%', foreground: '210 40% 98%', ring: '210 56% 46%' },
    dark: { primary: '210 62% 62%', foreground: '215 40% 10%', ring: '210 60% 62%' },
  },
  {
    // ✻ teal
    class: 'Monk',
    label: 'Teal',
    light: { primary: '188 70% 33%', foreground: '40 40% 98%', ring: '188 65% 38%' },
    dark: { primary: '184 62% 52%', foreground: '200 30% 10%', ring: '184 60% 52%' },
  },
  {
    class: 'Paladin',
    label: 'Radiant gold',
    light: { primary: '46 82% 42%', foreground: '46 45% 12%', ring: '46 80% 46%' },
    dark: { primary: '48 84% 58%', foreground: '45 45% 10%', ring: '48 82% 58%' },
  },
  {
    // ✻ emerald
    class: 'Ranger',
    label: 'Emerald',
    light: { primary: '150 55% 32%', foreground: '40 40% 98%', ring: '150 55% 36%' },
    dark: { primary: '150 52% 52%', foreground: '150 40% 8%', ring: '150 52% 52%' },
  },
  {
    class: 'Rogue',
    label: 'Indigo slate',
    light: { primary: '245 42% 48%', foreground: '245 40% 98%', ring: '245 40% 52%' },
    dark: { primary: '246 52% 70%', foreground: '245 40% 10%', ring: '246 50% 70%' },
  },
  {
    class: 'Sorcerer',
    label: 'Orange-red',
    light: { primary: '18 78% 46%', foreground: '20 40% 98%', ring: '18 74% 50%' },
    dark: { primary: '20 82% 60%', foreground: '18 45% 10%', ring: '20 80% 60%' },
  },
  {
    // ✻ violet
    class: 'Warlock',
    label: 'Violet',
    light: { primary: '255 55% 48%', foreground: '40 40% 98%', ring: '250 60% 55%' },
    dark: { primary: '255 70% 68%', foreground: '260 30% 12%', ring: '255 70% 70%' },
  },
  {
    // ✻ cyan-teal (the brand default)
    class: 'Wizard',
    label: 'Cyan-teal',
    light: { primary: '196 78% 38%', foreground: '200 40% 98%', ring: '196 72% 42%' },
    dark: { primary: '194 70% 56%', foreground: '205 40% 10%', ring: '194 68% 56%' },
  },
];

/**
 * Resolve a `Character.class` string (free-form; may be homebrew) to its class
 * accent, case-insensitively. Returns `undefined` for unknown/homebrew classes
 * so the caller falls back to the user's explicit accent.
 */
export function classColorFor(className: string | null | undefined): ClassColor | undefined {
  if (className == null) return undefined;
  const needle = className.trim().toLowerCase();
  if (needle.length === 0) return undefined;
  return classColors.find((c) => c.class.toLowerCase() === needle);
}

/**
 * Resolve an accent preset id to its color. Falls back to the default accent
 * for an unknown id (e.g. a stale persisted value after a preset is renamed).
 */
export function accentPresetFor(id: string): AccentPreset {
  return accentPresets.find((p) => p.id === id) ?? DEFAULT_ACCENT;
}
