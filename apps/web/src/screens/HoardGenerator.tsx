import { type ReactElement, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Coins,
  Dices,
  Gem,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';

import { hoard } from '@app/rules';

type CrBand = hoard.CrBand;
type HoardRoll = hoard.HoardRoll;
type Rarity = hoard.Rarity;
type GemTier = hoard.GemTier;

import { Button } from '@/components/ui/button';
import { DesktopOnlyNotice } from '@/components/nav/DesktopOnlyNotice';
import { Label } from '@/components/ui/label';
import { useCurrentPartyId } from '@/lib/useCurrentPartyId';

/**
 * R6.3 / R9.9 — Hoard Generator screen (`/party/:partyId/loot/generate`).
 *
 * DM-only route (guarded by `DmOnlyRoute` in the router table). R9.9 —
 * restyled to the `HoardGenStepper` mockup: a 3-step flow (Parameters →
 * Review roll → Hand off) sharing the Loot-wizard stepper shell (step
 * indicator + bordered card + footer nav).
 *
 * Inputs: CR band + include-homebrew toggle. Output: a roll preview
 * (coins + magic-item rarity counts + gem/art tier counts). "Reroll"
 * regenerates; "Continue → distribute" navigates to the wizard with the
 * roll blob in route state, so the wizard can prefill rows.
 *
 * Nothing dispatches from this screen. Rolls are throwaway — nothing hits
 * the audit log until the wizard's Distribute button.
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

const DENOM_ORDER = ['pp', 'gp', 'ep', 'sp', 'cp'] as const;

const STEPS = [
  { icon: SlidersHorizontal, title: 'Parameters' },
  { icon: ClipboardList, title: 'Review roll' },
  { icon: ArrowRight, title: 'Hand off' },
] as const;

export interface HoardGeneratorRouteState {
  roll: HoardRoll;
  band: CrBand;
  includeHomebrew: boolean;
}

export function HoardGenerator(): ReactElement {
  const partyId = useCurrentPartyId();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
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

  const totalCoins = DENOM_ORDER.reduce((n, d) => n + roll.coins[d], 0);
  const totalItems = RARITIES.reduce((n, r) => n + roll.magicItemsByRarity[r.key], 0);
  const totalGems = GEM_TIERS.reduce((n, t) => n + roll.gemsByTier[t.key], 0);
  const atLast = step === STEPS.length - 1;

  return (
    <DesktopOnlyNotice>
      <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
        <header className="space-y-1">
          <p className="text-sm text-muted-foreground">DM tools · Hoard Generator</p>
          <h1 className="font-display text-2xl font-bold tracking-tight">Roll a treasure hoard</h1>
        </header>

        {/* Step indicator (shared shell with LootDistributionWizard). */}
        <ol className="flex items-center gap-2">
          {STEPS.map((s, i) => {
            const done = i < step;
            const active = i === step;
            const Icon = s.icon;
            return (
              <li key={s.title} className="flex flex-1 items-center gap-2">
                <div
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
                    active
                      ? 'border-primary/50 bg-primary/5'
                      : done
                        ? 'border-border bg-surface'
                        : 'border-border bg-surface opacity-60'
                  }`}
                >
                  <span
                    className={`grid h-7 w-7 place-items-center rounded-full text-xs font-semibold ${
                      active || done
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-surface-2 text-muted-foreground'
                    }`}
                  >
                    {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                  </span>
                  <span className={`text-xs font-medium ${active ? 'text-primary' : ''}`}>
                    <Icon className="mr-1 inline h-3 w-3 align-[-1px]" aria-hidden="true" />
                    {s.title}
                  </span>
                </div>
                {i < STEPS.length - 1 ? (
                  <div className={`h-px flex-1 ${done ? 'bg-primary/40' : 'bg-border'}`} />
                ) : null}
              </li>
            );
          })}
        </ol>

        <div className="rounded-lg border border-border bg-surface p-5 shadow-e1">
          {/* Step 1 — parameters */}
          {step === 0 ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Pick the challenge-rating band. DMG 2024 tables.
              </p>
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
              <label className="flex cursor-pointer items-center justify-between rounded-md border border-border px-3 py-2.5 text-sm">
                <span>Include homebrew items in magic-item picker</span>
                <input
                  type="checkbox"
                  checked={includeHomebrew}
                  onChange={(e) => setIncludeHomebrew(e.target.checked)}
                  className="h-4 w-4 rounded border-input"
                />
              </label>
            </div>
          ) : null}

          {/* Step 2 — review roll */}
          {step === 1 ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  {CR_BANDS.find((b) => b.value === band)?.label}
                  {includeHomebrew ? ' · homebrew on' : ''}
                </p>
                <Button type="button" variant="outline" size="sm" onClick={() => reroll(band)}>
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  Reroll
                </Button>
              </div>

              {/* Coins */}
              <div className="overflow-hidden rounded-md border border-border">
                <div className="flex items-center gap-2 border-b border-border bg-surface-2/60 px-3 py-2">
                  <Coins className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Coins
                  </h2>
                </div>
                <div className="grid grid-cols-5 divide-x divide-border">
                  {DENOM_ORDER.map((d) => (
                    <div key={d} className="px-2 py-2.5 text-center">
                      <div className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                        {d}
                      </div>
                      <div className="font-display text-base font-bold tabular-nums">
                        {roll.coins[d].toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="overflow-hidden rounded-md border border-border">
                  <div className="flex items-center justify-between border-b border-border bg-surface-2/60 px-3 py-2">
                    <h2 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> Magic
                      items
                    </h2>
                    <span className="text-[11px] text-muted-foreground">{totalItems}</span>
                  </div>
                  <ul className="divide-y divide-border">
                    {RARITIES.map((r) => (
                      <li
                        key={r.key}
                        className="flex items-center justify-between px-3 py-1.5 text-sm"
                      >
                        <span className="text-muted-foreground">{r.label}</span>
                        <span className="font-semibold tabular-nums">
                          {roll.magicItemsByRarity[r.key]}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="overflow-hidden rounded-md border border-border">
                  <div className="flex items-center justify-between border-b border-border bg-surface-2/60 px-3 py-2">
                    <h2 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      <Gem className="h-3.5 w-3.5 text-primary" aria-hidden="true" /> Gems &amp; art
                    </h2>
                    <span className="text-[11px] text-muted-foreground">{totalGems}</span>
                  </div>
                  <ul className="divide-y divide-border">
                    {GEM_TIERS.map((t) => (
                      <li
                        key={t.key}
                        className="flex items-center justify-between px-3 py-1.5 text-sm"
                      >
                        <span className="text-muted-foreground">{t.label}</span>
                        <span className="font-semibold tabular-nums">{roll.gemsByTier[t.key]}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ) : null}

          {/* Step 3 — hand off */}
          {step === 2 ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                This roll will prefill the Distribution wizard. Nothing is added to any stash until
                you distribute there.
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-md border border-border px-3 py-3 text-center">
                  <div className="font-display text-xl font-bold tabular-nums">
                    {totalCoins.toLocaleString()}
                  </div>
                  <div className="text-[11px] text-muted-foreground">coins</div>
                </div>
                <div className="rounded-md border border-border px-3 py-3 text-center">
                  <div className="font-display text-xl font-bold tabular-nums">{totalItems}</div>
                  <div className="text-[11px] text-muted-foreground">magic items</div>
                </div>
                <div className="rounded-md border border-border px-3 py-3 text-center">
                  <div className="font-display text-xl font-bold tabular-nums">{totalGems}</div>
                  <div className="text-[11px] text-muted-foreground">gems &amp; art</div>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer nav (shared shell with LootDistributionWizard). */}
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Back
          </Button>
          {atLast ? (
            <Button type="button" onClick={onContinue}>
              <Dices className="h-4 w-4" aria-hidden="true" />
              Continue → distribute
            </Button>
          ) : (
            <Button type="button" onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>
              {step === 0 ? 'Roll' : 'Next'}
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
    </DesktopOnlyNotice>
  );
}
