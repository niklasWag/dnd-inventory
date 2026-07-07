import { type ReactElement, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dices } from 'lucide-react';

import { hoard } from '@app/rules';

type CrBand = hoard.CrBand;
type HoardRoll = hoard.HoardRoll;
type Rarity = hoard.Rarity;
type GemTier = hoard.GemTier;

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useCurrentPartyId } from '@/lib/useCurrentPartyId';

/**
 * R6.3 — Hoard Generator screen (`/party/:partyId/loot/generate`).
 *
 * DM-only route (guarded by `DmOnlyRoute` in the router table).
 *
 * Inputs: CR band + include-homebrew toggle. Output: a roll preview
 * (coins + magic-item rarity counts + gem/art tier counts). "Reroll"
 * regenerates; "Continue → distribute" navigates to the wizard with
 * the roll blob in route state, so the wizard can prefill rows.
 *
 * Nothing dispatches from this screen. Rolls are throwaway — nothing
 * hits the audit log until the wizard's Distribute button.
 */

const CR_BANDS: ReadonlyArray<{ value: CrBand; label: string }> = [
  { value: '0-4', label: 'Levels 1–4 (CR 0–4)' },
  { value: '5-10', label: 'Levels 5–10 (CR 5–10)' },
  { value: '11-16', label: 'Levels 11–16 (CR 11–16)' },
  { value: '17+', label: 'Levels 17+ (CR 17+)' },
];

const RARITIES: ReadonlyArray<{ key: Rarity; label: string }> = [
  { key: 'common', label: 'Common' },
  { key: 'uncommon', label: 'Uncommon' },
  { key: 'rare', label: 'Rare' },
  { key: 'very-rare', label: 'Very rare' },
  { key: 'legendary', label: 'Legendary' },
];

const GEM_TIERS: ReadonlyArray<{ key: GemTier; label: string }> = [
  { key: '10', label: '10 gp' },
  { key: '50', label: '50 gp' },
  { key: '100', label: '100 gp' },
  { key: '500', label: '500 gp' },
  { key: '1000', label: '1,000 gp' },
  { key: '5000', label: '5,000 gp' },
];

export interface HoardGeneratorRouteState {
  roll: HoardRoll;
  band: CrBand;
  includeHomebrew: boolean;
}

export function HoardGenerator(): ReactElement {
  const partyId = useCurrentPartyId();
  const navigate = useNavigate();

  const [band, setBand] = useState<CrBand>('5-10');
  const [includeHomebrew, setIncludeHomebrew] = useState(true);
  const [roll, setRoll] = useState<HoardRoll>(() => hoard.rollHoard(band));

  const reroll = useCallback((nextBand: CrBand): void => {
    setRoll(hoard.rollHoard(nextBand));
  }, []);

  function onBandChange(next: CrBand): void {
    setBand(next);
    reroll(next);
  }

  function onContinue(): void {
    const state: HoardGeneratorRouteState = { roll, band, includeHomebrew };
    void navigate(`/party/${partyId}/loot/distribute`, { state });
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Hoard Generator</h1>
        <p className="text-sm text-muted-foreground">
          Roll a treasure hoard using the DMG 2024 tables. The generator suggests coin totals plus
          rarity buckets for magic items and gems; you pick specific items in the next step.
        </p>
      </header>

      <section className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="hoard-band">CR band</Label>
          <select
            id="hoard-band"
            value={band}
            onChange={(e) => onBandChange(e.target.value as CrBand)}
            className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            {CR_BANDS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeHomebrew}
              onChange={(e) => setIncludeHomebrew(e.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            Include homebrew items in picker
          </label>
        </div>
        <div className="flex items-end justify-end">
          <Button type="button" variant="outline" onClick={() => reroll(band)}>
            <Dices className="mr-1 h-4 w-4" aria-hidden="true" />
            Reroll
          </Button>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border p-4">
          <h2 className="mb-2 text-lg font-semibold">Coins</h2>
          <table className="w-full text-sm tabular-nums">
            <tbody>
              {(['pp', 'gp', 'ep', 'sp', 'cp'] as const).map((denom) => (
                <tr key={denom} className="border-t border-border first:border-0">
                  <td className="py-1 uppercase text-muted-foreground">{denom}</td>
                  <td className="py-1 text-right">{roll.coins[denom].toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-border p-4">
          <h2 className="mb-2 text-lg font-semibold">Magic items</h2>
          <table className="w-full text-sm tabular-nums">
            <tbody>
              {RARITIES.map((r) => (
                <tr key={r.key} className="border-t border-border first:border-0">
                  <td className="py-1 text-muted-foreground">{r.label}</td>
                  <td className="py-1 text-right">{roll.magicItemsByRarity[r.key]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-border p-4">
          <h2 className="mb-2 text-lg font-semibold">Gems &amp; art</h2>
          <table className="w-full text-sm tabular-nums">
            <tbody>
              {GEM_TIERS.map((t) => (
                <tr key={t.key} className="border-t border-border first:border-0">
                  <td className="py-1 text-muted-foreground">{t.label}</td>
                  <td className="py-1 text-right">{roll.gemsByTier[t.key]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex items-center justify-end gap-2">
        <Button type="button" onClick={onContinue}>
          Continue → distribute
        </Button>
      </div>
    </div>
  );
}
