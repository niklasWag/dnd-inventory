import { useEffect, useState, type ReactElement } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useDispatch } from '@/lib/useDispatch';
import type { CurrencyDenomination } from '@app/shared';

/**
 * R6.1 — Party Settings preset chooser for the per-party economy
 * (OUTLINE §3.5).
 *
 * Two orthogonal controls:
 *   - `<select>` — one of the five named presets or "Custom".
 *     Selecting a named preset commits both `priceModifier` and
 *     `baseCurrency` atomically. Selecting "Custom" reveals two raw
 *     fields (float modifier + baseCurrency picker) so DMs can set
 *     values outside the canonical ladder.
 *   - Save dispatches a single `update-party-economy` action covering
 *     both fields (mirrors `set-encumbrance` two-fields-one-row).
 *
 * Native `<select>` per the `EncumbranceRuleField` precedent —
 * fewer options + easier to drive under jsdom than Radix Select.
 *
 * `matchPreset` reverse-maps the current (modifier, currency) tuple
 * back to a named row; a party whose values don't match any named
 * preset is shown as "Custom" and the raw fields render pre-filled.
 */

type PresetName = 'gold' | 'silver' | 'copper' | 'electrum' | 'platinum' | 'custom';

interface Preset {
  name: Exclude<PresetName, 'custom'>;
  label: string;
  priceModifier: number;
  baseCurrency: CurrencyDenomination;
}

const PRESETS: readonly Preset[] = [
  { name: 'gold', label: 'Gold standard', priceModifier: 1.0, baseCurrency: 'gp' },
  { name: 'silver', label: 'Silver standard', priceModifier: 0.1, baseCurrency: 'sp' },
  { name: 'copper', label: 'Copper standard', priceModifier: 0.01, baseCurrency: 'cp' },
  { name: 'electrum', label: 'Electrum standard', priceModifier: 0.5, baseCurrency: 'ep' },
  { name: 'platinum', label: 'Platinum standard', priceModifier: 1.0, baseCurrency: 'pp' },
];

function matchPreset(priceModifier: number, baseCurrency: CurrencyDenomination): PresetName {
  const match = PRESETS.find(
    (p) => p.priceModifier === priceModifier && p.baseCurrency === baseCurrency,
  );
  return match?.name ?? 'custom';
}

interface EconomyPresetFieldProps {
  partyId: string;
  currentPriceModifier: number;
  currentBaseCurrency: CurrencyDenomination;
}

export function EconomyPresetField({
  partyId,
  currentPriceModifier,
  currentBaseCurrency,
}: EconomyPresetFieldProps): ReactElement {
  const dispatch = useDispatch();
  const [draftPreset, setDraftPreset] = useState<PresetName>(() =>
    matchPreset(currentPriceModifier, currentBaseCurrency),
  );
  const [customModifier, setCustomModifier] = useState<string>(String(currentPriceModifier));
  const [customBaseCurrency, setCustomBaseCurrency] =
    useState<CurrencyDenomination>(currentBaseCurrency);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Re-seed when the upstream party values change (round-trip after a
  // successful dispatch, or a broadcast from another member).
  useEffect(() => {
    setDraftPreset(matchPreset(currentPriceModifier, currentBaseCurrency));
    setCustomModifier(String(currentPriceModifier));
    setCustomBaseCurrency(currentBaseCurrency);
    setSubmitError(null);
  }, [currentPriceModifier, currentBaseCurrency]);

  // Compute the (priceModifier, baseCurrency) tuple that Save would
  // dispatch. For named presets this is the preset's tuple; for
  // "Custom" it's the raw inputs.
  function draftValues(): { priceModifier: number; baseCurrency: CurrencyDenomination } | null {
    if (draftPreset === 'custom') {
      const parsed = Number.parseFloat(customModifier);
      if (!Number.isFinite(parsed) || parsed <= 0) return null;
      return { priceModifier: parsed, baseCurrency: customBaseCurrency };
    }
    const preset = PRESETS.find((p) => p.name === draftPreset);
    if (preset === undefined) return null;
    return { priceModifier: preset.priceModifier, baseCurrency: preset.baseCurrency };
  }

  const draft = draftValues();
  const isNoOp =
    draft !== null &&
    draft.priceModifier === currentPriceModifier &&
    draft.baseCurrency === currentBaseCurrency;

  function onSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    if (draft === null) {
      setSubmitError('Price modifier must be a positive number.');
      return;
    }
    if (isNoOp) return;
    setSubmitError(null);
    void dispatch(
      {
        type: 'update-party-economy',
        payload: { partyId, ...draft },
      },
      {
        onSuccess: () =>
          toast.success(`Economy: ${String(draft.priceModifier)}\u00d7 / ${draft.baseCurrency}`),
        onRejection: (_code, message) => setSubmitError(message ?? 'Unknown error'),
      },
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate>
      <div className="space-y-2">
        <Label htmlFor="economy-preset">Economy preset</Label>
        <select
          id="economy-preset"
          value={draftPreset}
          onChange={(e) => {
            setDraftPreset(e.target.value as PresetName);
          }}
          className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          {PRESETS.map((p) => (
            <option key={p.name} value={p.name}>
              {p.label} ({String(p.priceModifier)}× / {p.baseCurrency})
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
        <p className="text-xs text-muted-foreground">
          Named presets set both fields atomically. PHB / DMG prices scale by the modifier; homebrew
          items keep their typed price.
        </p>
      </div>

      {draftPreset === 'custom' ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="economy-price-modifier">Price modifier</Label>
            <input
              id="economy-price-modifier"
              type="number"
              step="0.01"
              min={0}
              value={customModifier}
              onChange={(e) => setCustomModifier(e.target.value)}
              className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="economy-base-currency">Base currency</Label>
            <select
              id="economy-base-currency"
              value={customBaseCurrency}
              onChange={(e) => setCustomBaseCurrency(e.target.value as CurrencyDenomination)}
              className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            >
              <option value="cp">cp</option>
              <option value="sp">sp</option>
              <option value="ep">ep</option>
              <option value="gp">gp</option>
              <option value="pp">pp</option>
            </select>
          </div>
        </div>
      ) : null}

      <Button type="submit" disabled={draft === null || isNoOp}>
        Save
      </Button>

      {submitError !== null ? (
        <p className="text-sm text-destructive" role="alert">
          {submitError}
        </p>
      ) : null}
    </form>
  );
}
