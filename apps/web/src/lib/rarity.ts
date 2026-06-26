import type { Rarity } from '@app/shared';

/**
 * Rarity helpers shared by CatalogBrowser, ItemDetail, and the
 * StashItemsTable row (R2.1).
 *
 * Pure — no React imports. The classes returned here are Tailwind
 * utility strings; consumers concatenate them onto a `<span>` for
 * chips or onto a dot `<span>` for compact row prefixes.
 */

/**
 * Canonical display order. Lowest-tier first; useful for future
 * sort + filter UIs (R2.x catalog filter — OUTLINE §3.7 / §6 `search.ts`).
 */
export const RARITY_ORDER: readonly Rarity[] = [
  'common',
  'uncommon',
  'rare',
  'very-rare',
  'legendary',
  'artifact',
];

/**
 * Human-readable rarity label. Returns an em-dash when the rarity is
 * `null` / `undefined` so consumers can render the label unconditionally
 * without juggling falsy checks. Callers that want to hide the chip
 * entirely on absent rarity should check `r != null` themselves first.
 */
export function rarityLabel(r: Rarity | null | undefined): string {
  switch (r) {
    case 'common':
      return 'Common';
    case 'uncommon':
      return 'Uncommon';
    case 'rare':
      return 'Rare';
    case 'very-rare':
      return 'Very Rare';
    case 'legendary':
      return 'Legendary';
    case 'artifact':
      return 'Artifact';
    default:
      return '—';
  }
}

/**
 * Tailwind utility classes for a rarity chip (badge style):
 * background + foreground + ring color matched to D&D community
 * conventions (uncommon = green, rare = blue, very-rare = purple,
 * legendary = orange, artifact = red). `common` and absent rarity
 * use the muted slate palette.
 */
export function rarityClasses(r: Rarity | null | undefined): string {
  switch (r) {
    case 'common':
      return 'bg-slate-100 text-slate-800 ring-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-600';
    case 'uncommon':
      return 'bg-green-100 text-green-900 ring-green-300 dark:bg-green-950 dark:text-green-200 dark:ring-green-800';
    case 'rare':
      return 'bg-blue-100 text-blue-900 ring-blue-300 dark:bg-blue-950 dark:text-blue-200 dark:ring-blue-800';
    case 'very-rare':
      return 'bg-purple-100 text-purple-900 ring-purple-300 dark:bg-purple-950 dark:text-purple-200 dark:ring-purple-800';
    case 'legendary':
      return 'bg-orange-100 text-orange-900 ring-orange-300 dark:bg-orange-950 dark:text-orange-200 dark:ring-orange-800';
    case 'artifact':
      return 'bg-red-100 text-red-900 ring-red-300 dark:bg-red-950 dark:text-red-200 dark:ring-red-800';
    default:
      return 'bg-muted text-muted-foreground ring-border';
  }
}

/**
 * Tailwind utility classes for a compact rarity dot (background-only)
 * matching the chip palette above. Use as a 2x2-rem inline span in
 * dense row layouts where a full chip would be too noisy.
 */
export function rarityDotClass(r: Rarity | null | undefined): string {
  switch (r) {
    case 'common':
      return 'bg-slate-400';
    case 'uncommon':
      return 'bg-green-500';
    case 'rare':
      return 'bg-blue-500';
    case 'very-rare':
      return 'bg-purple-500';
    case 'legendary':
      return 'bg-orange-500';
    case 'artifact':
      return 'bg-red-500';
    default:
      return 'bg-transparent';
  }
}
