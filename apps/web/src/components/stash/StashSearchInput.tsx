import { type ReactElement } from 'react';

import { Input } from '@/components/ui/input';

/**
 * R7.5 — search input mounted above a `<StashItemsTable>`.
 *
 * Stateless: the parent owns the `query` string. Uses the same fuzzy
 * multi-field syntax as the Catalog Browser input (see
 * `packages/rules/src/search.ts` — supports subsequence, word-boundary,
 * and exact substring across `name`, `description`, and `tags`).
 *
 * Placeholder hints at both a plain match (`torch`) and a
 * subsequence-friendly one (`lgsw` → longsword) so users discover the
 * fuzzy behaviour without needing documentation.
 */
interface StashSearchInputProps {
  readonly value: string;
  readonly onChange: (next: string) => void;
  /**
   * Accessible label. Defaults to `Search`. Set explicitly when
   * multiple `<StashSearchInput>` mount on the same screen (e.g. the
   * three tabs on Character Sheet) so screen-reader users can tell
   * them apart.
   */
  readonly label?: string;
  /** Optional id-prefix for the input; useful when disambiguating labels. */
  readonly idPrefix?: string;
}

export function StashSearchInput({
  value,
  onChange,
  label = 'Search',
  idPrefix = 'stash-search',
}: StashSearchInputProps): ReactElement {
  const inputId = `${idPrefix}-input`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <Input
        id={inputId}
        placeholder="rope, longsword, torch, lgsw…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      />
    </div>
  );
}
