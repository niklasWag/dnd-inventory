/**
 * R6.3 — Hoard / treasure generation (OUTLINE §3.5 + §6, DMG 2024 tables).
 *
 * Design decisions (R6.3 plan):
 *   - Buckets, not items: `rollHoard` returns coin totals + counts by
 *     magic-item rarity + counts by gem/art tier. The Loot Distribution
 *     Wizard picks concrete catalog items in the UI.
 *   - Injectable rng for deterministic tests. Default: `Math.random`.
 *   - Only `rollHoard` ships in v1. Per-monster individual-treasure is
 *     out of scope (see R6.3 Notes).
 *
 * The table values are drawn from DMG 2024 CR-band hoard tables. Exact
 * per-die spreads are simplified into integer ranges scaled by `rng`
 * (uniform in [0,1)); this is close enough for a private-use tool and
 * keeps the implementation testable + snapshotable.
 */

export type CrBand = '0-4' | '5-10' | '11-16' | '17+';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'very-rare' | 'legendary';
export type GemTier = '10' | '50' | '100' | '500' | '1000' | '5000';

export interface CoinRoll {
  cp: number;
  sp: number;
  ep: number;
  gp: number;
  pp: number;
}

export interface HoardRoll {
  coins: CoinRoll;
  magicItemsByRarity: Record<Rarity, number>;
  gemsByTier: Record<GemTier, number>;
}

/** Uniform integer in [min, max] (inclusive) using rng ∈ [0,1). */
function randInt(rng: () => number, min: number, max: number): number {
  if (max < min) return min;
  const span = max - min + 1;
  return min + Math.floor(rng() * span);
}

/**
 * Roll N counts across a weighted set of buckets. Each rng draw picks
 * one bucket by cumulative weight. Buckets absent from `weights` map
 * to 0.
 */
function rollBuckets<K extends string>(
  rng: () => number,
  n: number,
  weights: ReadonlyArray<readonly [K, number]>,
): Record<K, number> {
  const out = Object.fromEntries(weights.map(([k]) => [k, 0])) as Record<K, number>;
  const total = weights.reduce((s, [, w]) => s + w, 0);
  if (total <= 0 || n <= 0) return out;
  for (let i = 0; i < n; i += 1) {
    let x = rng() * total;
    for (const [k, w] of weights) {
      x -= w;
      if (x < 0) {
        out[k] += 1;
        break;
      }
    }
  }
  return out;
}

/**
 * Per-band coin table. Values are approximate midpoints of the DMG
 * 2024 hoard-coin ranges; each rng draw ranges 0.5× → 1.5× the base.
 * Denomination is the coin type that dominates the tier's hoard.
 */
interface CoinTable {
  cp: [number, number]; // min, max
  sp: [number, number];
  ep: [number, number];
  gp: [number, number];
  pp: [number, number];
}

const COIN_TABLES: Record<CrBand, CoinTable> = {
  '0-4': {
    cp: [200, 800],
    sp: [200, 600],
    ep: [0, 0],
    gp: [10, 40],
    pp: [0, 0],
  },
  '5-10': {
    cp: [0, 0],
    sp: [400, 1200],
    ep: [0, 0],
    gp: [200, 600],
    pp: [10, 40],
  },
  '11-16': {
    cp: [0, 0],
    sp: [0, 0],
    ep: [0, 0],
    gp: [800, 2400],
    pp: [80, 240],
  },
  '17+': {
    cp: [0, 0],
    sp: [0, 0],
    ep: [0, 0],
    gp: [2000, 6000],
    pp: [400, 1200],
  },
};

/**
 * Per-band magic-item roll: `count` items rolled, each of which lands
 * in a rarity bucket according to `weights`. Lower bands never roll
 * legendary; higher bands push weight upward.
 */
interface MagicTable {
  count: [number, number];
  weights: ReadonlyArray<readonly [Rarity, number]>;
}

const MAGIC_TABLES: Record<CrBand, MagicTable> = {
  '0-4': {
    count: [0, 3],
    weights: [
      ['common', 70],
      ['uncommon', 30],
      ['rare', 0],
      ['very-rare', 0],
      ['legendary', 0],
    ],
  },
  '5-10': {
    count: [1, 5],
    weights: [
      ['common', 30],
      ['uncommon', 50],
      ['rare', 20],
      ['very-rare', 0],
      ['legendary', 0],
    ],
  },
  '11-16': {
    count: [2, 6],
    weights: [
      ['common', 10],
      ['uncommon', 30],
      ['rare', 40],
      ['very-rare', 20],
      ['legendary', 0],
    ],
  },
  '17+': {
    count: [3, 8],
    weights: [
      ['common', 0],
      ['uncommon', 10],
      ['rare', 30],
      ['very-rare', 40],
      ['legendary', 20],
    ],
  },
};

/** Per-band gem/art roll. Structure mirrors MAGIC_TABLES. */
interface GemTable {
  count: [number, number];
  weights: ReadonlyArray<readonly [GemTier, number]>;
}

const GEM_TABLES: Record<CrBand, GemTable> = {
  '0-4': {
    count: [0, 4],
    weights: [
      ['10', 70],
      ['50', 30],
      ['100', 0],
      ['500', 0],
      ['1000', 0],
      ['5000', 0],
    ],
  },
  '5-10': {
    count: [0, 6],
    weights: [
      ['10', 20],
      ['50', 50],
      ['100', 30],
      ['500', 0],
      ['1000', 0],
      ['5000', 0],
    ],
  },
  '11-16': {
    count: [1, 8],
    weights: [
      ['10', 0],
      ['50', 10],
      ['100', 40],
      ['500', 35],
      ['1000', 15],
      ['5000', 0],
    ],
  },
  '17+': {
    count: [2, 10],
    weights: [
      ['10', 0],
      ['50', 0],
      ['100', 10],
      ['500', 30],
      ['1000', 40],
      ['5000', 20],
    ],
  },
};

function rollCoins(rng: () => number, band: CrBand): CoinRoll {
  const t = COIN_TABLES[band];
  return {
    cp: randInt(rng, t.cp[0], t.cp[1]),
    sp: randInt(rng, t.sp[0], t.sp[1]),
    ep: randInt(rng, t.ep[0], t.ep[1]),
    gp: randInt(rng, t.gp[0], t.gp[1]),
    pp: randInt(rng, t.pp[0], t.pp[1]),
  };
}

function rollMagic(rng: () => number, band: CrBand): Record<Rarity, number> {
  const t = MAGIC_TABLES[band];
  const n = randInt(rng, t.count[0], t.count[1]);
  return rollBuckets(rng, n, t.weights);
}

function rollGems(rng: () => number, band: CrBand): Record<GemTier, number> {
  const t = GEM_TABLES[band];
  const n = randInt(rng, t.count[0], t.count[1]);
  return rollBuckets(rng, n, t.weights);
}

/**
 * Roll a full hoard: coins + magic-item rarity counts + gem/art tier counts.
 *
 * @param band  CR band (level tier) of the encountering party.
 * @param rng   Optional injectable [0,1) uniform generator. Defaults to
 *              `Math.random` so production calls need no argument; tests
 *              inject a deterministic generator.
 */
export function rollHoard(band: CrBand, rng: () => number = Math.random): HoardRoll {
  return {
    coins: rollCoins(rng, band),
    magicItemsByRarity: rollMagic(rng, band),
    gemsByTier: rollGems(rng, band),
  };
}
