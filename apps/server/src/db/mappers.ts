/**
 * Pure bidirectional translators between the Zod source-of-truth shapes in
 * `@app/shared` and the Prisma row shapes generated under
 * `apps/server/prisma/generated`. No I/O; no PrismaClient import — these
 * are tested offline.
 *
 * Why a boundary layer at all?
 *   1. **Hyphen → underscore enums**: Prisma enum values can't contain
 *      hyphens, so 'very-rare' / 'long-rest' / 'short-rest' / 'recovered-loot'
 *      are stored as 'very_rare' / 'long_rest' / 'short_rest' / 'recovered_loot'.
 *      The Zod schemas use the kebab-case form; clients (and exports) see
 *      kebab-case; only the DB writes underscore.
 *   2. **Flatten/unflatten**: `ItemDefinition.cost` (nested `{ amount, currency }`)
 *      and `ItemDefinition.charges` (nested `{ max, rechargeRule, rechargeAmount? }`)
 *      are flattened into sibling columns for queryability.
 *   3. **`exactOptionalPropertyTypes` discipline**: Prisma's create/update
 *      inputs reject `field: undefined` for nullable columns under strict TS.
 *      We use conditional-assignment instead of object-spread to avoid
 *      emitting `undefined` keys.
 */
import type { ChargesRechargeRule, ItemDefinition, Rarity, Stash } from '@app/shared';
import { itemDefinitionSchema } from '@app/shared';

import type { Prisma } from '../../prisma/generated/prisma/client.js';
import { $Enums } from '../../prisma/generated/prisma/client.js';

/**
 * `Stash.scope` is the discriminant of the Zod discriminated union; it's
 * never re-exported as a named enum from `@app/shared`. Derive it from
 * `Stash['scope']` so a future addition to the union (e.g. 'shop' for R5)
 * forces this mapper to update in lockstep.
 */
type StashScope = Stash['scope'];

// -------- Enum translators --------

const RARITY_TO_DB: Record<Rarity, $Enums.Rarity> = {
  common: $Enums.Rarity.common,
  uncommon: $Enums.Rarity.uncommon,
  rare: $Enums.Rarity.rare,
  'very-rare': $Enums.Rarity.very_rare,
  legendary: $Enums.Rarity.legendary,
  artifact: $Enums.Rarity.artifact,
};
const RARITY_FROM_DB: Record<$Enums.Rarity, Rarity> = {
  common: 'common',
  uncommon: 'uncommon',
  rare: 'rare',
  very_rare: 'very-rare',
  legendary: 'legendary',
  artifact: 'artifact',
};

export function toDbRarity(r: Rarity): $Enums.Rarity {
  return RARITY_TO_DB[r];
}
export function fromDbRarity(r: $Enums.Rarity): Rarity {
  return RARITY_FROM_DB[r];
}

const RECHARGE_TO_DB: Record<ChargesRechargeRule, $Enums.ChargesRechargeRule> = {
  dawn: $Enums.ChargesRechargeRule.dawn,
  dusk: $Enums.ChargesRechargeRule.dusk,
  'long-rest': $Enums.ChargesRechargeRule.long_rest,
  'short-rest': $Enums.ChargesRechargeRule.short_rest,
  custom: $Enums.ChargesRechargeRule.custom,
  none: $Enums.ChargesRechargeRule.none,
};
const RECHARGE_FROM_DB: Record<$Enums.ChargesRechargeRule, ChargesRechargeRule> = {
  dawn: 'dawn',
  dusk: 'dusk',
  long_rest: 'long-rest',
  short_rest: 'short-rest',
  custom: 'custom',
  none: 'none',
};

export function toDbRechargeRule(r: ChargesRechargeRule): $Enums.ChargesRechargeRule {
  return RECHARGE_TO_DB[r];
}
export function fromDbRechargeRule(r: $Enums.ChargesRechargeRule): ChargesRechargeRule {
  return RECHARGE_FROM_DB[r];
}

const STASH_SCOPE_TO_DB: Record<StashScope, $Enums.StashScope> = {
  character: $Enums.StashScope.character,
  party: $Enums.StashScope.party,
  'recovered-loot': $Enums.StashScope.recovered_loot,
};
const STASH_SCOPE_FROM_DB: Record<$Enums.StashScope, StashScope> = {
  character: 'character',
  party: 'party',
  recovered_loot: 'recovered-loot',
};

export function toDbStashScope(s: StashScope): $Enums.StashScope {
  return STASH_SCOPE_TO_DB[s];
}
export function fromDbStashScope(s: $Enums.StashScope): StashScope {
  return STASH_SCOPE_FROM_DB[s];
}

// -------- ItemDefinition translators --------

/**
 * Map a Zod `ItemDefinition` into a Prisma create/update input. Used by the
 * boot-time seed runner to upsert PHB+DMG rows.
 *
 * Conditional assignment instead of spread: under
 * `exactOptionalPropertyTypes: true`, an `undefined` value is NOT the same
 * as an absent key, and Prisma 7 rejects `field: undefined` on nullable
 * columns. The seed loader (`packages/seeds/src/loader.ts`) uses the same
 * pattern when mapping JSON → `ItemDefinition`.
 */
export function toPrismaItemDefinition(
  def: ItemDefinition,
): Prisma.ItemDefinitionUncheckedCreateInput {
  const row: Prisma.ItemDefinitionUncheckedCreateInput = {
    id: def.id,
    name: def.name,
    source: def.source,
    category: def.category,
    tags: def.tags ?? [],
  };
  if (def.weight !== undefined) row.weight = def.weight;
  if (def.flatWeight !== undefined) row.flatWeight = def.flatWeight;
  if (def.cost !== undefined) {
    row.costAmount = def.cost.amount;
    row.costCurrency = def.cost.currency;
  }
  if (def.description !== undefined) row.description = def.description;
  if (def.rarity !== undefined && def.rarity !== null) {
    row.rarity = toDbRarity(def.rarity);
  }
  if (def.requiresAttunement !== undefined) row.requiresAttunement = def.requiresAttunement;
  if (def.attunementPrereq !== undefined) row.attunementPrereq = def.attunementPrereq;
  if (def.charges !== undefined) {
    row.chargesMax = def.charges.max;
    row.chargesRechargeRule = toDbRechargeRule(def.charges.rechargeRule);
    if (def.charges.rechargeAmount !== undefined) {
      row.chargesRechargeAmount = def.charges.rechargeAmount;
    }
  }
  if (def.duplicatedFromId !== undefined) row.duplicatedFromId = def.duplicatedFromId;
  if (def.createdBy !== undefined) row.createdBy = def.createdBy;
  if (def.partyId !== undefined) row.partyId = def.partyId;
  return row;
}

/**
 * Subset of the Prisma row shape we actually read from. Defined inline
 * (rather than importing the generator's full model type) so the function
 * accepts any object satisfying the contract — handy for tests.
 */
export interface ItemDefinitionRow {
  id: string;
  name: string;
  source: 'PHB' | 'DMG' | 'homebrew';
  category: ItemDefinition['category'];
  weight: number | null;
  flatWeight: boolean | null;
  costAmount: number | null;
  costCurrency: ItemDefinition['cost'] extends infer C
    ? C extends { currency: infer Cu }
      ? Cu | null
      : never
    : never;
  description: string | null;
  tags: string[];
  rarity: $Enums.Rarity | null;
  requiresAttunement: boolean | null;
  attunementPrereq: string | null;
  chargesMax: number | null;
  chargesRechargeRule: $Enums.ChargesRechargeRule | null;
  chargesRechargeAmount: string | null;
  duplicatedFromId: string | null;
  createdBy: string | null;
  partyId: string | null;
}

/**
 * Read a Prisma row and parse it through the Zod schema. This is the
 * "trust at the boundary" rule from CLAUDE.md: every DB row that crosses
 * the application boundary is validated against the source-of-truth Zod
 * schema. A drift between Prisma's row shape and the Zod shape surfaces
 * here as a runtime parse error instead of as a downstream silent bug.
 */
export function fromPrismaItemDefinition(row: ItemDefinitionRow): ItemDefinition {
  const def: ItemDefinition = {
    id: row.id,
    name: row.name,
    source: row.source,
    category: row.category,
  };
  if (row.weight !== null) def.weight = row.weight;
  if (row.flatWeight !== null) def.flatWeight = row.flatWeight;
  if (row.costAmount !== null && row.costCurrency !== null) {
    def.cost = { amount: row.costAmount, currency: row.costCurrency };
  }
  if (row.description !== null) def.description = row.description;
  if (row.tags.length > 0) def.tags = row.tags;
  if (row.rarity !== null) def.rarity = fromDbRarity(row.rarity);
  if (row.requiresAttunement !== null) def.requiresAttunement = row.requiresAttunement;
  if (row.attunementPrereq !== null) def.attunementPrereq = row.attunementPrereq;
  if (row.chargesMax !== null && row.chargesRechargeRule !== null) {
    const charges: NonNullable<ItemDefinition['charges']> = {
      max: row.chargesMax,
      rechargeRule: fromDbRechargeRule(row.chargesRechargeRule),
    };
    if (row.chargesRechargeAmount !== null) {
      charges.rechargeAmount = row.chargesRechargeAmount;
    }
    def.charges = charges;
  }
  if (row.duplicatedFromId !== null) def.duplicatedFromId = row.duplicatedFromId;
  if (row.createdBy !== null) def.createdBy = row.createdBy;
  if (row.partyId !== null) def.partyId = row.partyId;
  // Validate against the Zod schema — surfaces drift as a parse error.
  return itemDefinitionSchema.parse(def);
}
