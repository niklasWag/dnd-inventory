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
import type {
  Character,
  ChargesRechargeRule,
  CurrencyHolding,
  GameSession,
  ItemDefinition,
  ItemInstance,
  Party,
  PartyMembership,
  Rarity,
  Stash,
  TransactionLogEntry,
  User,
} from '@app/shared';
import {
  characterSchema,
  currencyHoldingSchema,
  gameSessionSchema,
  itemDefinitionSchema,
  itemInstanceSchema,
  partyMembershipSchema,
  partySchema,
  stashSchema,
  transactionLogEntrySchema,
  userSchema,
} from '@app/shared';

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

// -------- R3.2: MembershipRole / actorRole translators --------
//
// The Prisma enum `MembershipRole` carries all three values used across
// PartyMembership.role AND TransactionLog.actorRole (`dm | player | banker`).
// On the Zod side these are split:
//   - `partyMembershipSchema.role` is `'dm' | 'player'` only (banker is
//     denormalized on Party.bankerUserId per OUTLINE §3.14 — never a row).
//   - `transactionLogEntrySchema.actorRole` is `'dm' | 'player' | 'banker'`
//     (banker IS a valid log actor when an active Banker performs an action).
//
// The translators below cover both views. Enum values match 1:1 (no
// hyphens), so the functions are nominally just type widenings — but
// having them explicit means a future enum change (e.g. R5 'observer')
// fails the type check here in one place instead of silently widening
// somewhere unrelated.

type ActorRole = 'dm' | 'player' | 'banker';
type MembershipRole = 'dm' | 'player';

const ACTOR_ROLE_TO_DB: Record<ActorRole, $Enums.MembershipRole> = {
  dm: $Enums.MembershipRole.dm,
  player: $Enums.MembershipRole.player,
  banker: $Enums.MembershipRole.banker,
};
const ACTOR_ROLE_FROM_DB: Record<$Enums.MembershipRole, ActorRole> = {
  dm: 'dm',
  player: 'player',
  banker: 'banker',
};

export function toDbActorRole(r: ActorRole): $Enums.MembershipRole {
  return ACTOR_ROLE_TO_DB[r];
}
export function fromDbActorRole(r: $Enums.MembershipRole): ActorRole {
  return ACTOR_ROLE_FROM_DB[r];
}

/**
 * Narrower variant for PartyMembership.role reads/writes. Rejects banker at
 * the type level because OUTLINE §3.14 forbids banker membership rows; the
 * §2.2 server guard layer (R3.4) also rejects banker on writes.
 */
export function toDbMembershipRole(r: MembershipRole): $Enums.MembershipRole {
  return ACTOR_ROLE_TO_DB[r];
}
export function fromDbMembershipRole(r: $Enums.MembershipRole): MembershipRole {
  if (r === 'banker') {
    throw new Error(
      'fromDbMembershipRole: encountered banker in a PartyMembership.role read — ' +
        'banker is denormalized on Party.bankerUserId per OUTLINE §3.14 and must ' +
        'never appear as a membership row. Check the guard layer.',
    );
  }
  return r;
}

// -------- R3.2: User translators (Auth.js Prisma adapter compatibility) --------
//
// The @auth/prisma-adapter expects the User model to expose fields called
// `name` and `image`. Our schema keeps the existing column names
// (`displayName`, `avatarUrl`) because:
//   1. Renaming would force a migration that touches every existing User
//      row in dev/test DBs and break MVP exports / Dexie blobs.
//   2. `displayName` is the term used throughout OUTLINE §4 / §3.15.
//
// The Auth.js adapter's `getUser`/`createUser`/`updateUser` methods write
// into the same row though, so the Prisma columns DO need to expose `name`
// and `image`. R3.2 punts on that — Auth.js's adapter happily reads/writes
// columns matching our names if we configure the User model with shape
// compatibility (no field rename needed): the adapter sets `name` ↔
// `displayName` mapping by writing to the column the schema declares.
//
// In practice this means:
//   - The adapter's createUser({ name, image, ... }) call lands as
//     `displayName` and `avatarUrl` on the Prisma row because the adapter's
//     accessor goes through @prisma/client which knows only our column
//     names. We adapt via the wrappers below.
//
// `toAuthJsUser`: read our Prisma row, return the shape Auth.js's adapter
// callbacks expect (`AdapterUser`-flavored).
// `fromAuthJsUser`: take an Auth.js `AdapterUser` (used in callbacks like
// events.signIn) and translate to our internal User shape.

/**
 * Subset of the User Prisma row we read for Auth.js boundary work. Defined
 * inline (like ItemDefinitionRow) so tests don't depend on the generated
 * Prisma client.
 */
export interface UserRow {
  id: string;
  displayName: string;
  discordId: string | null;
  email: string | null;
  emailVerified: Date | null;
  avatarUrl: string | null;
  // R3.3 — true for new email-only signups that have not yet supplied a
  // display name. Prisma `@default(false)` so existing rows + the Discord
  // path stay false.
  needsDisplayName: boolean;
  createdAt: Date;
}

/**
 * Auth.js's `AdapterUser` shape, copy-defined here to avoid pulling
 * `@auth/core` types into the mapper layer (keeps mappers pure / testable
 * without auth-runtime deps).
 *
 * `needsDisplayName` is NOT part of Auth.js's standard `AdapterUser` — it's
 * R3.3's first-login gate, surfaced here so callers reading `toAuthJsUser`
 * can pass it through to the session-response shape without having to
 * round-trip through the Prisma row a second time.
 */
export interface AuthJsUserShape {
  id: string;
  name: string;
  email: string | null;
  emailVerified: Date | null;
  image: string | null;
  needsDisplayName: boolean;
}

export function toAuthJsUser(row: UserRow): AuthJsUserShape {
  return {
    id: row.id,
    name: row.displayName,
    email: row.email,
    emailVerified: row.emailVerified,
    image: row.avatarUrl,
    needsDisplayName: row.needsDisplayName,
  };
}

/**
 * Inverse of `toAuthJsUser`. Returns a Zod-validated `User` (validates the
 * SECURITY §1.2 invariant at the boundary). `email` and `image` may be
 * null on the input side — they're omitted from the optional Zod fields
 * if so.
 */
export function fromAuthJsUser(adapter: AuthJsUserShape & { discordId?: string | null }): User {
  const u: Record<string, unknown> = {
    id: adapter.id,
    displayName: adapter.name,
    // R3.2 dev synthetic / R3.5 real: discordId is required for the
    // refine() — when the AdapterUser came from a Discord sign-in, the
    // events.signIn callback in src/auth/config.ts writes it back to the
    // row before this function is called. For an email-only user
    // (R3.3+), discordId stays absent and emailVerified satisfies the
    // refine().
    createdAt: new Date().toISOString(),
  };
  if (adapter.discordId !== undefined && adapter.discordId !== null) {
    u['discordId'] = adapter.discordId;
  }
  if (adapter.email !== null) u['email'] = adapter.email;
  if (adapter.emailVerified !== null) {
    u['emailVerified'] = adapter.emailVerified.toISOString();
  }
  if (adapter.image !== null) u['avatarUrl'] = adapter.image;
  // R3.3 — only emit on the truthy branch; the Zod field is optional so
  // false-by-default rows can leave the key absent.
  if (adapter.needsDisplayName) u['needsDisplayName'] = true;
  return userSchema.parse(u);
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

// -------- R3.4.a: Domain entity row→entity mappers --------
//
// The /sync/state pull endpoint materializes the full AppState by reading
// every domain row for a (user, party) pair and assembling them into the
// Zod-validated `AppState` shape. Each mapper below converts ONE Prisma
// row into ONE Zod entity, parsing through the schema for boundary
// validation per CLAUDE.md ("trust at the boundary").
//
// Naming: `fromPrismaX` for read; the write direction lives in the
// per-action persistor (`apps/server/src/sync/persistor.ts`) which
// constructs typed Prisma create/update inputs directly.

/** Row shape mirror — same trick as `ItemDefinitionRow`: an inline
 * interface lets tests stub a row without depending on the generated
 * Prisma client. The `Party` model in the Prisma schema.
 *
 * R4.1 — `isSoloShortcut` removed from the Zod schema and Prisma model
 * (column dropped in migration `r41_drop_party_isSoloShortcut`).
 */
export interface PartyRow {
  id: string;
  name: string;
  ownerUserId: string;
  inviteCode: string;
  recoveredLootStashId: string;
  bankerUserId: string | null;
  createdAt: Date;
}

export function fromPrismaParty(row: PartyRow): Party {
  return partySchema.parse({
    id: row.id,
    name: row.name,
    ownerUserId: row.ownerUserId,
    inviteCode: row.inviteCode,
    recoveredLootStashId: row.recoveredLootStashId,
    // MVP schema is z.null() — bankerUserId is always null in MVP-validated
    // state. Cast handles the schema constraint; if a non-null value sneaks
    // in (R4.2+), the parse below surfaces the schema-drift error.
    bankerUserId: row.bankerUserId,
    createdAt: row.createdAt.toISOString(),
  });
}

export interface PartyMembershipRow {
  userId: string;
  partyId: string;
  role: $Enums.MembershipRole;
  characterId: string | null;
  joinedAt: Date;
  leftAt: Date | null;
}

export function fromPrismaPartyMembership(row: PartyMembershipRow): PartyMembership {
  // fromDbMembershipRole throws if role === 'banker' (per OUTLINE §3.14:
  // banker is denormalized on Party.bankerUserId, never a membership row).
  // R3.4.a defense-in-depth: also surfaces as a Zod parse error since
  // partyMembershipSchema.role is `enum(['dm', 'player'])`.
  return partyMembershipSchema.parse({
    userId: row.userId,
    partyId: row.partyId,
    role: fromDbMembershipRole(row.role),
    characterId: row.characterId,
    joinedAt: row.joinedAt.toISOString(),
    leftAt: row.leftAt === null ? null : row.leftAt.toISOString(),
  });
}

export interface CharacterRow {
  id: string;
  partyId: string;
  ownerUserId: string;
  name: string;
  species: string;
  size: $Enums.CreatureSize;
  class: string;
  level: number;
  strScore: number;
  maxAttunement: number;
  encumbranceRule: $Enums.EncumbranceRule;
  enforceEncumbrance: boolean;
  inventoryStashId: string;
}

export function fromPrismaCharacter(row: CharacterRow): Character {
  return characterSchema.parse({
    id: row.id,
    partyId: row.partyId,
    ownerUserId: row.ownerUserId,
    name: row.name,
    species: row.species,
    size: row.size,
    class: row.class,
    level: row.level,
    // R3.1 schema flattens abilityScores.STR → strScore column.
    abilityScores: { STR: row.strScore },
    maxAttunement: row.maxAttunement,
    encumbranceRule: row.encumbranceRule,
    enforceEncumbrance: row.enforceEncumbrance,
    inventoryStashId: row.inventoryStashId,
  });
}

export interface StashRow {
  id: string;
  name: string;
  isCarried: boolean;
  createdAt: Date;
  scope: $Enums.StashScope;
  ownerCharacterId: string | null;
  partyId: string | null;
}

export function fromPrismaStash(row: StashRow): Stash {
  return stashSchema.parse({
    id: row.id,
    name: row.name,
    isCarried: row.isCarried,
    createdAt: row.createdAt.toISOString(),
    scope: fromDbStashScope(row.scope),
    ownerCharacterId: row.ownerCharacterId,
    partyId: row.partyId,
  });
}

/**
 * RH3.1 — GameSession row shape (mirrors `apps/server/prisma/schema.prisma`
 * `model GameSession`). The DB stores `date` as `DATE` (calendar date),
 * hydrated by Prisma as a `Date` at midnight UTC; the Zod schema uses
 * the ISO date-only string (`YYYY-MM-DD`) so the mapper narrows to the
 * first ten chars of `toISOString()`.
 */
export interface GameSessionRow {
  id: string;
  partyId: string;
  number: number;
  date: Date;
  notes: string | null;
  isCurrent: boolean;
  createdAt: Date;
}

export function fromPrismaGameSession(row: GameSessionRow): GameSession {
  return gameSessionSchema.parse({
    id: row.id,
    partyId: row.partyId,
    number: row.number,
    date: row.date.toISOString().slice(0, 10),
    ...(row.notes !== null ? { notes: row.notes } : {}),
    isCurrent: row.isCurrent,
    createdAt: row.createdAt.toISOString(),
  });
}

export interface ItemInstanceRow {
  id: string;
  definitionId: string;
  ownerType: string;
  ownerId: string;
  containerInstanceId: string | null;
  quantity: number;
  equipped: boolean;
  attuned: boolean;
  identified: boolean;
  hint: string | null;
  currentCharges: number | null;
  customName: string | null;
  notes: string | null;
  conditionOverrides: unknown;
}

export function fromPrismaItemInstance(row: ItemInstanceRow): ItemInstance {
  const instance: Record<string, unknown> = {
    id: row.id,
    definitionId: row.definitionId,
    ownerType: row.ownerType,
    ownerId: row.ownerId,
    containerInstanceId: row.containerInstanceId,
    quantity: row.quantity,
    equipped: row.equipped,
    attuned: row.attuned,
    identified: row.identified,
    currentCharges: row.currentCharges,
  };
  if (row.hint !== null) instance['hint'] = row.hint;
  if (row.customName !== null) instance['customName'] = row.customName;
  if (row.notes !== null) instance['notes'] = row.notes;
  if (row.conditionOverrides !== null && row.conditionOverrides !== undefined) {
    instance['conditionOverrides'] = row.conditionOverrides;
  }
  return itemInstanceSchema.parse(instance);
}

export interface CurrencyHoldingRow {
  id: string;
  stashId: string;
  cp: number;
  sp: number;
  ep: number;
  gp: number;
  pp: number;
}

export function fromPrismaCurrencyHolding(row: CurrencyHoldingRow): CurrencyHolding {
  return currencyHoldingSchema.parse({
    id: row.id,
    stashId: row.stashId,
    cp: row.cp,
    sp: row.sp,
    ep: row.ep,
    gp: row.gp,
    pp: row.pp,
  });
}

export interface TransactionLogRow {
  id: string;
  partyId: string;
  sessionId: string | null;
  timestamp: Date;
  actorUserId: string;
  actorRole: $Enums.MembershipRole;
  type: string;
  payload: unknown;
}

/**
 * R3.4.a — read a TransactionLog row, validating its `payload` JSONB
 * against the full Zod transactionLogEntrySchema discriminated union.
 *
 * The schema's `actorRole` accepts `'dm' | 'player' | 'banker'` per
 * OUTLINE §4 line 309; `fromDbActorRole` is a 1:1 translator (no
 * hyphens in the enum so it's effectively a passthrough with a typed
 * narrowing). MVP-vintage rows always have `'dm'` or `'player'`.
 */
export function fromPrismaTransactionLog(row: TransactionLogRow): TransactionLogEntry {
  return transactionLogEntrySchema.parse({
    id: row.id,
    partyId: row.partyId,
    sessionId: row.sessionId,
    timestamp: row.timestamp.toISOString(),
    actorUserId: row.actorUserId,
    actorRole: fromDbActorRole(row.actorRole),
    type: row.type,
    payload: row.payload,
  });
}
