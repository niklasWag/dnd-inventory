import { z } from 'zod';

import { encumbranceRuleSchema } from './character';

/**
 * TransactionLog — MVP captures a strict SUBSET of the OUTLINE §4 full
 * union. Every action that mutates state appends one entry; the discriminant
 * `type` maps 1:1 to reducer actions (CLAUDE.md store invariant).
 *
 * Adding a new mutation in a later milestone means BOTH adding a reducer
 * case AND extending this union with the new variant.
 *
 * `actorRole` is derived at write time. The full enum is
 * `'dm' | 'player' | 'banker'` per OUTLINE §4 line 309. In MVP party-of-one
 * a single user wears both `dm` and `player` hats (banker doesn't apply
 * until a party has 2+ members per OUTLINE §3.14). `banker` was added in
 * R3.2 ahead of R3.4's authoritative reducer so the enum and the Prisma
 * `MembershipRole` move together in a single migration; R3.4 lands the
 * §2.2 guard layer that actually writes banker rows.
 *
 * `sessionId` was `z.null()` from MVP through RH2. RH3 widens it to
 * `string().uuid() | null` when the `GameSession` entity lands (OUTLINE
 * §3.12 + §4). Existing log rows keep `null`; future rows carry the
 * active `GameSession.id` when the party has a session current, or
 * `null` for the "Untagged" bucket (§3.12).
 */

const baseLogFields = {
  id: z.string().min(1),
  partyId: z.string().min(1),
  sessionId: z.string().uuid().nullable(),
  timestamp: z.string().datetime(),
  actorUserId: z.string().min(1),
  actorRole: z.enum(['dm', 'player', 'banker']),
};

/**
 * `create-character` — bootstrap action that mints the initial AppState.
 *
 * R4.1-followup — when the Hub's Create-party flow runs the "I don't
 * want to play a character" branch, the action mints only `User` +
 * `Party` + ONE `role='dm'` `PartyMembership` + party-scope stashes
 * (Party Stash + Recovered Loot). The log payload reflects this by
 * making `characterId`, `name`, and `inventoryStashId` optional; the
 * explicit `dmOnly: true` flag tells log readers to expect the
 * narrower shape. Legacy log entries (pre-R4.1-followup) carry none
 * of `dmOnly` — they parse the same way under the optional schema.
 */
const createCharacterEntry = z.object({
  ...baseLogFields,
  type: z.literal('create-character'),
  payload: z.object({
    userId: z.string().min(1),
    partyId: z.string().min(1),
    partyStashId: z.string().min(1),
    recoveredLootStashId: z.string().min(1),
    // The Character + Inventory fields are absent on DM-only bootstraps.
    characterId: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    inventoryStashId: z.string().min(1).optional(),
    dmOnly: z.boolean().optional(),
  }),
});

/**
 * `acquire` — an item lands in a stash. Auto-stack is reducer-internal:
 * if the row existed already, `itemInstanceId` is the existing row's id;
 * if it was just created, it's the new id. The payload mirrors OUTLINE §4
 * (`source` covers the full enum so future milestones — shops, hoards,
 * duplicate-to-edit — extend the reducer without touching the schema).
 */
const acquireEntry = z.object({
  ...baseLogFields,
  type: z.literal('acquire'),
  payload: z.object({
    stashId: z.string().min(1),
    itemInstanceId: z.string().min(1),
    definitionId: z.string().min(1),
    quantity: z.number().int().positive(),
    // OUTLINE §4 enum. `'catalog-add'` was added in M2.5 for the "user picked
    // an item from the Catalog Browser" path (M2 had no clean fit and used
    // `'custom-create'` — that semantic now belongs to M6 homebrew creation).
    // `'custom-create'` is retained for back-compat with M2-vintage persisted
    // log entries so existing Dexie blobs still rehydrate.
    source: z.enum(['hoard', 'purchase', 'custom-create', 'duplicate', 'catalog-add']),
  }),
});

/**
 * `consume` — an item row's quantity goes down. `removed` is the reducer-
 * derived flag that telegraphs "this take dropped the row to 0 and it was
 * removed from the stash" — useful for log readers / future undo so they
 * don't need to replay the whole AppState to know the row is gone.
 */
const consumeEntry = z.object({
  ...baseLogFields,
  type: z.literal('consume'),
  payload: z.object({
    stashId: z.string().min(1),
    itemInstanceId: z.string().min(1),
    quantity: z.number().int().positive(),
    removed: z.boolean(),
  }),
});

/**
 * `seed-catalog` — bulk catalog upsert from the bundled PHB seed (MVP §9).
 * Fires on first launch (everything in `addedDefinitionIds`) and on any
 * subsequent boot where the persisted `seedVersion` is behind the bundle
 * (`updatedDefinitionIds` picks up changed PHB rows; homebrew is left alone).
 *
 * One entry per boot keeps the log compact — we'd rather record "the
 * catalog moved to version N" than spam a `create-homebrew`-shaped row
 * for every PHB item.
 */
const seedCatalogEntry = z.object({
  ...baseLogFields,
  type: z.literal('seed-catalog'),
  payload: z.object({
    seedVersion: z.number().int().nonnegative(),
    addedDefinitionIds: z.array(z.string().min(1)),
    updatedDefinitionIds: z.array(z.string().min(1)),
  }),
});

/**
 * `edit-item-instance` — generic per-instance editor for fields that don't
 * have their own dedicated TxType (OUTLINE §4). Only `changedFields` is
 * logged; the full new value lives on the instance itself.
 *
 * R1.2 widens the enum from `customName | notes` (M2.5) to also include
 * `equipped` and `attuned`. The dedicated `equip`/`unequip`/`attune`/
 * `unattune` TxTypes (below) cover the explicit reducer actions; this
 * widened enum exists for the future Item Detail screen edit path that
 * mass-edits a row at once. R2.2 widens further to include
 * `currentCharges`. R2.3 widens with `identified` and `hint` so the
 * generic editor surface mirrors the OUTLINE §4 line 320 enum; in
 * practice the reducer routes `identified` / `hint` writes through the
 * dedicated `identify` action and rejects them via `edit-item-instance`
 * (the schema accepts the field names so future contributors can't
 * silently drift the surface).
 *
 * `.min(1)` enforces the "no-op edit" reject rule at the schema boundary
 * (the reducer is the primary defense; this is belt-and-braces).
 */
const editItemInstanceEntry = z.object({
  ...baseLogFields,
  type: z.literal('edit-item-instance'),
  payload: z.object({
    itemInstanceId: z.string().min(1),
    changedFields: z
      .array(
        z.enum([
          'customName',
          'notes',
          'equipped',
          'attuned',
          'currentCharges',
          'identified',
          'hint',
        ]),
      )
      .min(1),
  }),
});

/**
 * `transfer` — an item row (or a slice of one) moves from one stash to
 * another. The reducer is the source of truth for which row's id is
 * preserved (M3: items keep their `itemInstanceId` when they move to
 * Recovered Loot as part of a `delete-stash` cascade; M5 will define
 * the move/split UX).
 *
 * M3 emits these synthetically as part of `delete-stash`. M5 user-
 * initiated transfers will dispatch this directly.
 *
 * R1.5 — `toContainerInstanceId` is optional + nullable to express three
 * intents per OUTLINE §3.4 / §3.6:
 *   - `undefined` (or absent): "transfer did not change container parent"
 *     — every pre-R1.5 log entry has this shape and stays valid.
 *   - `null`: explicit take-out — the moved row's `containerInstanceId`
 *     is cleared to `null` (re-emerges at top level of the destination
 *     stash).
 *   - `string`: pack-into — the moved row's `containerInstanceId` is set
 *     to the supplied id (one-level-deep, same-stash-only in v1).
 */
const transferEntry = z.object({
  ...baseLogFields,
  type: z.literal('transfer'),
  payload: z.object({
    itemInstanceId: z.string().min(1),
    quantity: z.number().int().positive(),
    fromStashId: z.string().min(1),
    toStashId: z.string().min(1),
    toContainerInstanceId: z.string().min(1).nullable().optional(),
  }),
});

/**
 * `split` — break a stack into two rows that stay in the same stash. M5
 * adds this as a first-class user-initiated action (the alternative was a
 * `transfer` sub-mode; the 1:1 action ↔ log-type pattern won out per the
 * M5 plan).
 *
 * Validation lives in the reducer + `packages/rules/inventory.ts`:
 * `1 \u2264 quantity < source.quantity`. Both ids appear on the payload so
 * the per-item history view surfaces the entry on BOTH the source row's
 * filter and the new row's filter.
 *
 * `notes` and `customName` carry over from source to new row (M5 plan
 * decision); the auto-stack key `(definitionId, notes ?? "")` therefore
 * still collapses the two rows on a later `acquire` against the same
 * stash + key — which is fine, that's the whole point of splitting
 * (the user splits in order to *change* one of those fields).
 */
const splitEntry = z.object({
  ...baseLogFields,
  type: z.literal('split'),
  payload: z.object({
    sourceInstanceId: z.string().min(1),
    newInstanceId: z.string().min(1),
    quantity: z.number().int().positive(),
    stashId: z.string().min(1),
  }),
});

/**
 * `create-stash` — a new stash row + its `CurrencyHolding` are added to
 * state. M3 only dispatches the `scope: 'character'` variant (Storage
 * stashes — non-carried, character-owned). The schema enum keeps the
 * full set so future milestones can synthesize log entries for the
 * already-auto-provisioned Inventory / Party Stash / Recovered Loot
 * stashes if needed (M1 currently rolls them into the `create-character`
 * entry instead — no separate `create-stash` entries are emitted there).
 */
const createStashEntry = z.object({
  ...baseLogFields,
  type: z.literal('create-stash'),
  payload: z.object({
    stashId: z.string().min(1),
    scope: z.enum(['character', 'party', 'recovered-loot']),
    name: z.string().min(1),
    ownerCharacterId: z.string().min(1).optional(),
  }),
});

/**
 * `rename-stash` — name update only; id + scope + createdAt are stable.
 * M3 only allows renaming Storage stashes (character-scope + non-carried).
 * The reducer rejects rename of Inventory / Party Stash / Recovered Loot.
 */
const renameStashEntry = z.object({
  ...baseLogFields,
  type: z.literal('rename-stash'),
  payload: z.object({
    stashId: z.string().min(1),
    oldName: z.string().min(1),
    newName: z.string().min(1),
  }),
});

/**
 * `delete-stash` — snapshot recorded at the moment of deletion. Items are
 * moved to Recovered Loot first (each as its own `transfer` entry), then
 * currency is rolled into Recovered Loot's holding (one `currency-change`
 * entry with reason `'stash-deleted'` when the deleted stash held any),
 * then the stash row + its `CurrencyHolding` row are removed and this
 * entry is appended. The snapshot lets future log readers explain where
 * everything went without replaying the full AppState.
 *
 * `itemCount` is the SUM of quantities, not the row count (matches the
 * Storage tab card UI: "4 items" means 4 things, not 1 stack of 4).
 *
 * `currencyTotalCp` is the CP-equivalent of the deleted stash's holding
 * at delete time (always 0 in M3 because currency editing arrives in M4;
 * inline placeholder formula `cp + sp*10 + ep*50 + gp*100 + pp*1000` in
 * the reducer — M4 extracts this to `packages/rules`).
 */
const deleteStashEntry = z.object({
  ...baseLogFields,
  type: z.literal('delete-stash'),
  payload: z.object({
    stashId: z.string().min(1),
    name: z.string().min(1),
    itemCount: z.number().int().nonnegative(),
    currencyTotalCp: z.number().int().nonnegative(),
    // Owning character at the moment of deletion. Present iff the
    // deleted stash was character-scope (Storage). Absent for the
    // protected party-scope / recovered-loot stashes (which `delete-stash`
    // refuses anyway in M3, but the field stays optional so the schema
    // doesn't have to fork by scope). M3-vintage log entries written
    // before this field was added still validate (additive change).
    ownerCharacterId: z.string().min(1).optional(),
  }),
});

/**
 * Signed 5-denomination delta. Shared between the `currency-change` log
 * entry, the reducer action payload, and the `packages/rules/currency`
 * math functions so all three speak the same shape.
 *
 * Values may be negative (withdraw / source side of a convert) or
 * positive (deposit / target side). The reducer is responsible for
 * refusing dispatches that would push any denomination on the target
 * `CurrencyHolding` below zero (which `currencyHoldingSchema` already
 * forbids via `.nonnegative()`).
 */
export const currencyDeltaSchema = z.object({
  cp: z.number().int(),
  sp: z.number().int(),
  ep: z.number().int(),
  gp: z.number().int(),
  pp: z.number().int(),
});

export type CurrencyDelta = z.infer<typeof currencyDeltaSchema>;

/**
 * `currency-change` — additive denomination delta on a single stash's
 * `CurrencyHolding`. The reason tag is for log readability; the OUTLINE §4
 * enum lists `deposit | withdraw | split-evenly | gameplay-drain |
 * convert | stash-deleted | character-deleted`. M3 introduced
 * `'stash-deleted'` (the delete-cascade synthetic entry); M4 dispatches
 * `'deposit' | 'withdraw' | 'convert'` from the inline currency editor +
 * Convert modal. R4.1.b adds `'character-deleted'` for the `delete-
 * character` cascade synthetic entry against Recovered Loot. R4.2 will
 * extend with `'split-evenly' | 'gameplay-drain'` for multi-member
 * parties.
 */
const currencyChangeEntry = z.object({
  ...baseLogFields,
  type: z.literal('currency-change'),
  payload: z.object({
    stashId: z.string().min(1),
    delta: currencyDeltaSchema,
    reason: z
      .enum([
        'deposit',
        'withdraw',
        'split-evenly',
        'gameplay-drain',
        'convert',
        'stash-deleted',
        'character-deleted',
      ])
      .optional(),
  }),
});

/**
 * `currency-transfer` — atomic paired debit/credit logged as a single
 * entry (OUTLINE §4). Replaces two separate `currency-change` entries
 * in stash-to-stash transfer scenarios.
 *
 * MVP M5.5 uses this for: a player moving currency between any of
 * their four stashes (Inventory, Storage, Party Stash, Recovered Loot).
 * In solo (party-of-one) the user owns all four, so the rule is simply
 * "any source \u2260 target with non-negative result". R4 adds:
 *   - player pushing currency to another player's Inventory directly,
 *   - Banker distributing from Party Stash / Recovered Loot to a
 *     specific player's stash.
 *
 * The `delta` is the *positive* amount moving from `fromStashId` to
 * `toStashId`; the reducer applies `currency.subtract` to the source
 * and `currency.add` to the destination. Treating delta as signed-zero-
 * net at the schema layer would force callers to spell out two
 * mirror-image deltas, which is exactly the duplication this TxType
 * exists to eliminate.
 */
const currencyTransferEntry = z.object({
  ...baseLogFields,
  type: z.literal('currency-transfer'),
  payload: z.object({
    fromStashId: z.string().min(1),
    toStashId: z.string().min(1),
    delta: currencyDeltaSchema,
  }),
});

/**
 * `create-homebrew` — a user-authored `ItemDefinition` is added to the
 * catalog (M6). The reducer mints the `definitionId` and stamps
 * `source: 'homebrew'`, `partyId`, `createdBy`. `name` is captured on
 * the log entry so future readers don't have to lookup the (possibly
 * later-renamed) definition just to render history.
 *
 * The `duplicatedFromId` lineage — set when the homebrew was created
 * via the Catalog Browser's Duplicate flow against a PHB row — lives
 * on the `ItemDefinition` row, not on the log entry; replay readers
 * can join from `definitionId` if they care.
 */
const createHomebrewEntry = z.object({
  ...baseLogFields,
  type: z.literal('create-homebrew'),
  payload: z.object({
    definitionId: z.string().min(1),
    name: z.string().min(1),
  }),
});

/**
 * `edit-homebrew` — generic per-definition editor for the user-editable
 * subset of `ItemDefinition` (M6: `name`, `category`, `weight`, `cost`,
 * `description`, `tags`). Mirrors `edit-item-instance`: only the field
 * names are logged; full new values live on the definition row.
 *
 * OUTLINE §4 declares `changedFields: string[]` (no closed enum) because
 * the editable surface widens as R1+ activate more fields (`rarity`,
 * `requiresAttunement`, `charges`, etc). MVP keeps the schema open so
 * future milestones don't need a schema migration. `.min(1)` enforces
 * no-op-edit rejection at the boundary.
 *
 * Reducer rejects edits to PHB rows (immutable per OUTLINE §3.7) so an
 * `edit-homebrew` entry only ever references a homebrew `definitionId`.
 */
const editHomebrewEntry = z.object({
  ...baseLogFields,
  type: z.literal('edit-homebrew'),
  payload: z.object({
    definitionId: z.string().min(1),
    changedFields: z.array(z.string().min(1)).min(1),
  }),
});

/**
 * `delete-homebrew` — a homebrew `ItemDefinition` is removed from the
 * catalog. The reducer refuses the delete when any `ItemInstance` still
 * references the definition (delete policy chosen for M6: reject, not
 * cascade — see roadmap M6 Notes). `name` is the snapshot at delete time
 * so log readers can render history after the row is gone.
 */
const deleteHomebrewEntry = z.object({
  ...baseLogFields,
  type: z.literal('delete-homebrew'),
  payload: z.object({
    definitionId: z.string().min(1),
    name: z.string().min(1),
  }),
});

/**
 * `rename-character` — name update on an existing Character row.
 * id / ownerUserId / partyId / abilityScores / level / inventoryStashId
 * are stable. Mirrors `rename-stash`: reducer trims newName, rejects
 * empty, rejects same-name (no-op), captures `oldName` from the row
 * before applying. M7. Per OUTLINE §4 line 311.
 */
const renameCharacterEntry = z.object({
  ...baseLogFields,
  type: z.literal('rename-character'),
  payload: z.object({
    characterId: z.string().min(1),
    oldName: z.string().min(1),
    newName: z.string().min(1),
  }),
});

/**
 * `rename-party` — name update on the Party row. Same guards as
 * `rename-character` / `rename-stash`. In MVP party-of-one this is
 * always the sole party; R4 widens to DM-only in multi-member parties
 * per OUTLINE §8.1. M7. Per OUTLINE §4 line 316.
 */
const renamePartyEntry = z.object({
  ...baseLogFields,
  type: z.literal('rename-party'),
  payload: z.object({
    partyId: z.string().min(1),
    oldName: z.string().min(1),
    newName: z.string().min(1),
  }),
});

/**
 * `set-encumbrance` — per-character encumbrance configuration
 * (OUTLINE §3.3 + §3.6). R1.1 widens `Character.encumbranceRule` from
 * the MVP literal `'off'` to `'off' | 'phb' | 'variant'`, and adds the
 * orthogonal `enforceEncumbrance` boolean. This single entry records
 * any change to EITHER field (or both at once) so a "switch to variant
 * + turn on enforcement" flip stays one dispatch / one log row per the
 * CLAUDE.md "every mutation logs once" invariant.
 *
 * Reducer guards: unknown characterId rejects; no-op rejects when both
 * `newRule === oldRule` AND `newEnforce === oldEnforce`. In MVP
 * party-of-one this is owner-only (player); R4 makes it DM-only in 2+-
 * member parties per OUTLINE §8.1.
 */
const setEncumbranceEntry = z.object({
  ...baseLogFields,
  type: z.literal('set-encumbrance'),
  payload: z.object({
    characterId: z.string().min(1),
    oldRule: encumbranceRuleSchema,
    newRule: encumbranceRuleSchema,
    oldEnforce: z.boolean(),
    newEnforce: z.boolean(),
  }),
});

/**
 * `equip` / `unequip` — set / clear the `equipped` flag on an item that
 * lives in a character's Inventory stash (OUTLINE §3.4 + §4 line 304).
 * The reducer enforces:
 *   - the item is in a `scope=character, isCarried=true` stash,
 *   - the stash's `ownerCharacterId === characterId`,
 *   - the new state is actually different (no-op rejects).
 *
 * `slot?` is reserved for R2.x equip-slot tracking (mainhand / offhand /
 * armor / shield). R1.2 ships the flag without a slot model — the field
 * is optional and unused by the reducer for now. Per OUTLINE §4 line 304.
 */
const equipEntry = z.object({
  ...baseLogFields,
  type: z.literal('equip'),
  payload: z.object({
    itemInstanceId: z.string().min(1),
    characterId: z.string().min(1),
    slot: z.string().min(1).optional(),
  }),
});

const unequipEntry = z.object({
  ...baseLogFields,
  type: z.literal('unequip'),
  payload: z.object({
    itemInstanceId: z.string().min(1),
    characterId: z.string().min(1),
    slot: z.string().min(1).optional(),
  }),
});

/**
 * `attune` / `unattune` — set / clear the `attuned` flag on an item that
 * lives in a character's Inventory stash (OUTLINE §3.4 + §4 line 303).
 * The reducer enforces:
 *   - the item is in a `scope=character, isCarried=true` stash,
 *   - the stash's `ownerCharacterId === characterId`,
 *   - `attune` only fires when `attunement.hasFreeSlot(currentlyAttuned,
 *     character.maxAttunement) === true`,
 *   - the new state is actually different (no-op rejects).
 */
const attuneEntry = z.object({
  ...baseLogFields,
  type: z.literal('attune'),
  payload: z.object({
    itemInstanceId: z.string().min(1),
    characterId: z.string().min(1),
    // R4.3.d — preserved on the log entry for audit trail per OUTLINE
    // §3.8 "cap-override still logs". Optional; absent for normal
    // attune, `true` for DM cap-override.
    overrideCap: z.boolean().optional(),
  }),
});

const unattuneEntry = z.object({
  ...baseLogFields,
  type: z.literal('unattune'),
  payload: z.object({
    itemInstanceId: z.string().min(1),
    characterId: z.string().min(1),
  }),
});

/**
 * `use-charge` — a row in someone's Inventory consumed one or more
 * charges (OUTLINE §3.8 + §4 line 319). Reducer guards:
 *   - the item is in a `scope=character, isCarried=true` stash,
 *   - the stash's `ownerCharacterId === characterId`,
 *   - the definition has a `charges` block,
 *   - `(currentCharges ?? 0) - amount \u2265 0`.
 *
 * When the spent row's definition has `rechargeRule: 'none'` AND the
 * new `currentCharges` lands at 0, the reducer emits a synthetic
 * `consume` entry alongside this one — single-use items (potions,
 * scrolls, necklace beads) auto-consume. A stack of 5 potions logs one
 * `use-charge` + one `consume(qty=1)`; the remaining 4 rows reset to
 * `currentCharges: def.charges.max`.
 *
 * Per OUTLINE §3.11 this is hidden from the per-item history default
 * "ownership-transition" filter; the "Show all events" toggle exposes
 * it.
 */
const useChargeEntry = z.object({
  ...baseLogFields,
  type: z.literal('use-charge'),
  payload: z.object({
    itemInstanceId: z.string().min(1),
    characterId: z.string().min(1),
    amount: z.number().int().positive(),
  }),
});

/**
 * `recharge` — a row's `currentCharges` was set back to (or toward)
 * `def.charges.max` (OUTLINE §3.8 + §4 line 318). The MVP rules engine
 * always recharges fully; partial-recharge formula evaluation is
 * deferred to R6.
 *
 * `from` and `to` capture before/after for log readability without
 * forcing a join against the post-mutation `ItemInstance`.
 *
 * `trigger` describes WHAT FIRED the recharge:
 *   - `'dawn' | 'dusk' | 'long-rest' | 'short-rest'` — Character Sheet
 *     batch dispatch. The reducer fans out one entry PER recharged
 *     item (keeps the per-item history filter trivial); items whose
 *     `rechargeRule` doesn't strictly match the trigger are untouched.
 *   - `'manual'` — Item Detail single-item Recharge button. Also the
 *     R6 DM force-recharge path (action shape prepared in MVP so R6
 *     doesn't break the log schema).
 *
 * Distinct from `ItemDefinition.charges.rechargeRule` (`'custom'` vs
 * `'manual'`): the rule describes how an item recharges; the trigger
 * describes what fired the recharge. A `rechargeRule: 'custom'` item's
 * Recharge button dispatches `trigger: 'manual'`.
 *
 * Per OUTLINE §3.11 this is hidden from the per-item history default
 * "ownership-transition" filter; the "Show all events" toggle exposes
 * it.
 */
const rechargeEntry = z.object({
  ...baseLogFields,
  type: z.literal('recharge'),
  payload: z.object({
    itemInstanceId: z.string().min(1),
    characterId: z.string().min(1),
    from: z.number().int().nonnegative(),
    to: z.number().int().positive(),
    trigger: z.enum(['dawn', 'dusk', 'long-rest', 'short-rest', 'manual']),
  }),
});

/**
 * `identify` — DM toggles the per-instance `identified` flag and / or
 * sets the unidentified-item hint (OUTLINE §3.8 + §4 line 317). The
 * action is bidirectional: an item can flip `true → false` ("actually
 * that was cursed all along") just as easily as `false → true`. Each
 * direction logs its own entry.
 *
 * OUTLINE §4 line 317 specifies `{ itemInstanceId, previousHint?,
 * newHint? }`. R2.3 adds `previousIdentified` / `newIdentified` so a
 * `true → false` flip with no hint change still records the transition
 * (mirrors how `recharge` carries `from`/`to` on top of its OUTLINE-
 * spec'd payload). OUTLINE amended in lockstep.
 *
 * Unlike `attune` / `use-charge`, identify has no Inventory restriction
 * — the DM force-identifies anywhere (Storage, Party Stash, Recovered
 * Loot, Shop). The "Unknown Magic Item" display invariant per OUTLINE
 * §8 is UI-enforced; the toggle itself works on any row.
 *
 * Per OUTLINE §3.11 this is in the per-item history default
 * "ownership-transition" filter (changes what the item IS).
 */
const identifyEntry = z.object({
  ...baseLogFields,
  type: z.literal('identify'),
  payload: z.object({
    itemInstanceId: z.string().min(1),
    previousIdentified: z.boolean(),
    newIdentified: z.boolean(),
    previousHint: z.string().optional(),
    newHint: z.string().optional(),
  }),
});

/**
 * `edit-character` — catch-all editor for the mutable Character fields
 * that compose naturally as a single dispatch (OUTLINE §4 line 320). The
 * R1.1 dedicated `set-encumbrance` action stays single-purpose; `size` is
 * creation-only in v1 and is therefore NOT in the editable enum. The
 * R1.2 entry covers:
 *   - `species`, `class`, `level`, `str` — owner-editable in MVP party-of-
 *     one; per OUTLINE §8.1 these are the player's own (DM may also edit
 *     in 2+-member parties via the same TxType).
 *   - `maxAttunement` — DM-only per OUTLINE §8.1 line 427. In MVP party-
 *     of-one the sole user wears both hats.
 *
 * Mirrors `edit-homebrew`: only `changedFields` are logged; the full new
 * values live on the Character row. `.min(1)` enforces no-op rejection at
 * the schema boundary.
 */
const editCharacterEntry = z.object({
  ...baseLogFields,
  type: z.literal('edit-character'),
  payload: z.object({
    characterId: z.string().min(1),
    changedFields: z.array(z.enum(['species', 'class', 'level', 'str', 'maxAttunement'])).min(1),
  }),
});

/**
 * `delete-character` — R4.1.b. Detaches a character from their party,
 * cascading their owned items + currency into the party's Recovered Loot
 * stash per OUTLINE §8.3 (same shape as the `leave-party` / `kick-player`
 * cascades).
 *
 * Cascade emits (in this order):
 *   - one `transfer` entry per row in any character-scope stash the
 *     character owned (Inventory + every Storage stash) → Recovered Loot
 *   - one `currency-change` entry against Recovered Loot with
 *     `reason: 'character-deleted'` IFF the aggregated character currency
 *     was non-zero (sum of CurrencyHolding across all owned stashes)
 *   - one terminal `delete-character` entry with the snapshot
 *     `{ characterId, name, itemCount, currencyTotalCp }`
 *
 * `itemCount` is the SUM of quantities (matches `delete-stash`'s
 * convention: "4 items" means 4 things, not 1 stack of 4).
 * `currencyTotalCp` is the CP-equivalent of the character's aggregate
 * holdings across all their stashes at delete time.
 *
 * `lastSessionId` is reserved for R5 session tagging per OUTLINE §4 line
 * 329; absent in R4.1 and unpopulated in RH3 (RH3 lands the
 * `GameSession` entity but the `delete-character` cascade doesn't yet
 * capture "last session the character participated in" — R5.2 wires
 * that when the session tools UI ships).
 *
 * After the cascade: the character's stash rows + their `CurrencyHolding`
 * rows are dropped from state, and the owning user's `PartyMembership`
 * row with `role='player'` retains its slot but with `characterId: null`
 * — the user keeps their seat in the party and can recreate a character
 * later (roadmap R4.1 line 1750).
 */
const deleteCharacterEntry = z.object({
  ...baseLogFields,
  type: z.literal('delete-character'),
  payload: z.object({
    characterId: z.string().min(1),
    name: z.string().min(1),
    itemCount: z.number().int().nonnegative(),
    currencyTotalCp: z.number().int().nonnegative(),
    lastSessionId: z.string().min(1).optional(),
  }),
});

/**
 * `leave-party` — R4.1.c. The actor self-removes from a party per
 * OUTLINE §8.3. If they had a character, it's deleted first (same
 * cascade as `delete-character` — items + currency → Recovered Loot,
 * then character + stashes + holdings dropped). After the optional
 * character cascade the actor's `PartyMembership` rows for this party
 * are soft-deleted (`leftAt` flipped from `null` to ISO datetime; row
 * stays for audit history). A user with both `dm` + `player` rows in
 * a party-of-one creator pattern soft-deletes BOTH rows in one
 * dispatch.
 *
 * Reducer guards (OUTLINE §8.3):
 *   - actor must be an active member (`leftAt === null`).
 *   - sole DM of a 2+-member party cannot leave (must transfer DM
 *     first via R4.3 `dm-transfer`). Surfaces as `not_a_member`-style
 *     reducer error.
 *   - sole member of any party (party-of-one) rejects with a guard-
 *     coded error pointing the server route at the archive flow
 *     (Party.archivedAt; ships in R4.1.e).
 *
 * Payload mirrors OUTLINE §4 line 323: `{ partyId, characterId? }`.
 * `characterId` is set IFF the leaver had a player membership with a
 * non-null character at leave time.
 *
 * Banker auto-clear (carryforward from R4.2): when the leaver was the
 * party's Banker the cascade also clears `Party.bankerUserId` and
 * emits a synthetic `revoke-banker` entry with `reason: 'left-party'`
 * per OUTLINE §8.3. R4.1 ships the conditional but the branch never
 * fires because `Party.bankerUserId` is always `null` in MVP-validated
 * state (`partySchema.bankerUserId: z.null()`); R4.2 widens both.
 */
const leavePartyEntry = z.object({
  ...baseLogFields,
  type: z.literal('leave-party'),
  payload: z.object({
    partyId: z.string().min(1),
    characterId: z.string().min(1).optional(),
  }),
});

/**
 * `kick-player` — R4.1.d. DM removes another member from the party per
 * OUTLINE §8.3 (same Recovered Loot cascade as `leave-party`). Payload
 * mirrors OUTLINE §4 line 325: `{ kickedUserId }`. The cascade emits
 * the same shape as `leave-party`:
 *   - if the kicked user had a character → character-delete cascade
 *     (items + currency → Recovered Loot)
 *   - soft-delete every active membership row for the kicked user
 *   - banker auto-clear stub (R4.2 emits `revoke-banker` with
 *     `reason: 'kicked'`)
 *   - terminal `kick-player` slice
 *
 * `actorRole` is `'dm'` on the log entry (the only role allowed to
 * dispatch this action per OUTLINE §8.1).
 */
const kickPlayerEntry = z.object({
  ...baseLogFields,
  type: z.literal('kick-player'),
  payload: z.object({
    kickedUserId: z.string().min(1),
  }),
});

/**
 * `join-party` — R4.1.e. A user redeems an invite code and gains a
 * `role='player'` membership in the target party (OUTLINE §4 line 323).
 *
 * Membership-only join: no character is minted as part of this slice.
 * The user lands on a "create your character" prompt after joining
 * (existing `create-character` reducer flow). The terminal slice
 * `characterId` field is therefore always absent in R4.1.
 *
 * Payload mirrors OUTLINE §4 line 323: `{ partyId, characterId? }`.
 */
const joinPartyEntry = z.object({
  ...baseLogFields,
  type: z.literal('join-party'),
  payload: z.object({
    partyId: z.string().min(1),
    characterId: z.string().min(1).optional(),
  }),
});

/**
 * `appoint-banker` — R4.2.a. DM appoints an active player as the
 * party's Banker per OUTLINE §3.14. `actorRole` is always `'dm'`
 * (the only role allowed to dispatch this action; reducer rejects
 * otherwise with `dm_only`).
 */
const appointBankerEntry = z.object({
  ...baseLogFields,
  type: z.literal('appoint-banker'),
  payload: z.object({
    bankerUserId: z.string().min(1),
  }),
});

/**
 * `revoke-banker` — R4.2.a / R4.3.a. Clears `Party.bankerUserId`.
 * Reasons:
 *   - `'manual'` — DM revoked explicitly via Party Settings.
 *   - `'reassigned'` — reserved (future combined revoke+appoint UX).
 *   - `'left-party'` — synthesized by `leave-party` reducer arm.
 *   - `'kicked'`     — synthesized by `kick-player` reducer arm.
 *   - `'dm-transfer'` — synthesized by `dm-transfer` reducer arm when
 *     the incoming DM is the current Banker (§4 invariant preserves
 *     `bankerUserId !== ownerUserId`). Added in R4.3.a.
 *
 * `actorRole` on synthesized entries inherits from the parent
 * `leave-party` / `kick-player` / `dm-transfer` dispatch.
 */
const revokeBankerEntry = z.object({
  ...baseLogFields,
  type: z.literal('revoke-banker'),
  payload: z.object({
    reason: z.enum(['manual', 'reassigned', 'left-party', 'kicked', 'dm-transfer']),
  }),
});

/**
 * `dm-transfer` — R4.3.a. Terminal log entry emitted by the `dm-transfer`
 * reducer arm. Records both old and new DM ids so the audit trail is
 * self-contained (readers don't need to reconstruct old-DM state from
 * prior log entries).
 *
 * `actorRole` is always `'dm'` — the outgoing DM is the only role
 * allowed to dispatch this action; reducer rejects otherwise with
 * `dm_only`. If the incoming DM was the current Banker, a synthetic
 * `revoke-banker` entry with `reason: 'dm-transfer'` is emitted BEFORE
 * this terminal entry (matches the leave-party / kick-player cascade
 * ordering: revoke → terminal).
 */
const dmTransferEntry = z.object({
  ...baseLogFields,
  type: z.literal('dm-transfer'),
  payload: z.object({
    oldDmUserId: z.string().min(1),
    newDmUserId: z.string().min(1),
  }),
});

/**
 * `start-game-session` — RH3.1. Marks the start of a play session
 * (OUTLINE §3.12). Reducer arm mints a fresh `GameSession` row with
 * `isCurrent: true` and demotes any prior current session (opt-in via
 * `endCurrentFirst` on the action payload; without it, `start-game-
 * session` rejects when a session is already current).
 *
 * The log entry captures the new session's `gameSessionId`, its
 * per-party sequence `number` (1-based), and calendar `date` — enough
 * for history readers to render "Session 12 started on 2026-03-05"
 * without joining against the `GameSession` table.
 *
 * **sessionId stamping on this entry itself.** The middleware stamps
 * `sessionId` from `currentGameSessionId(state)` on the PRE-reduce
 * state — same as `partyId` / `actorRole`. At the moment
 * `start-game-session` is composed, the new session doesn't exist
 * yet in pre-state, so the entry lands as Untagged (`sessionId:
 * null`). The payload still carries `gameSessionId` for audit;
 * only the derived `sessionId` field is null. Rationale: the "start"
 * marker announces the transition INTO the session from the Untagged
 * epoch — and belongs semantically to that epoch. Subsequent entries
 * dispatched AFTER `start-game-session` see `isCurrent: true` in
 * pre-state and inherit the new session's id.
 */
const startGameSessionEntry = z.object({
  ...baseLogFields,
  type: z.literal('start-game-session'),
  payload: z.object({
    gameSessionId: z.string().min(1),
    number: z.number().int().positive(),
    date: z.iso.date(),
  }),
});

/**
 * `end-game-session` — RH3.1. Marks the end of the current play
 * session. Reducer clears `isCurrent` on the current `GameSession`;
 * subsequent log entries land with `sessionId: null` ("Untagged"
 * bucket per OUTLINE §3.12) until a new `start-game-session` fires.
 *
 * **sessionId stamping on this entry itself.** The middleware stamps
 * `sessionId` from `currentGameSessionId(state)` on the PRE-reduce
 * state. At the moment `end-game-session` is composed, the ending
 * session is still `isCurrent: true` in pre-state — so the entry
 * lands WITH the ending session's id. The "end" marker belongs
 * semantically to the session it closes: subsequent Untagged
 * entries then land with `sessionId: null`.
 *
 * Symmetric with `start-game-session` (which lands Untagged because
 * the new session doesn't yet exist in pre-state): the pair encodes
 * the transitions rather than the epochs they bound.
 *
 * Emitted synthetically by `start-game-session` when the caller
 * passed `endCurrentFirst: true` (mirrors `revoke-banker` synthesis
 * inside `dm-transfer` — one dispatch, two log entries).
 */
const endGameSessionEntry = z.object({
  ...baseLogFields,
  type: z.literal('end-game-session'),
  payload: z.object({
    gameSessionId: z.string().min(1),
    number: z.number().int().positive(),
  }),
});

/**
 * R4.2.d — Banker split-evenly terminal log entry. Emitted by the
 * `split-evenly` reducer arm as the audit anchor; the N child
 * `currency-transfer` entries (one per recipient) carry the atomic
 * debit/credit machinery. Together they form a single logical
 * distribution event.
 *
 * `sharePerRecipient` is the per-recipient share as computed by the
 * cascade algorithm (packages/rules `splitEvenly`); `remainderInPool`
 * is the CP-level leftover that stayed in `fromStashId` (0 to N-1 cp).
 * Both fields are ALWAYS present, even when zero — keeps the shape
 * uniform for log readers.
 */
const splitEvenlyEntry = z.object({
  ...baseLogFields,
  type: z.literal('split-evenly'),
  payload: z.object({
    fromStashId: z.string().min(1),
    recipientCharacterIds: z.array(z.string().min(1)).min(1),
    sharePerRecipient: currencyDeltaSchema,
    remainderInPool: currencyDeltaSchema,
  }),
});

// MVP TxType subset (MVP §6). Each post-M1 milestone adds a variant here
// AND a reducer case in apps/web/src/store/reducer.ts.
export const transactionLogEntrySchema = z.discriminatedUnion('type', [
  createCharacterEntry,
  acquireEntry,
  consumeEntry,
  seedCatalogEntry,
  editItemInstanceEntry,
  transferEntry,
  splitEntry,
  createStashEntry,
  renameStashEntry,
  deleteStashEntry,
  currencyChangeEntry,
  currencyTransferEntry,
  createHomebrewEntry,
  editHomebrewEntry,
  deleteHomebrewEntry,
  renameCharacterEntry,
  renamePartyEntry,
  setEncumbranceEntry,
  equipEntry,
  unequipEntry,
  attuneEntry,
  unattuneEntry,
  useChargeEntry,
  rechargeEntry,
  identifyEntry,
  editCharacterEntry,
  deleteCharacterEntry,
  leavePartyEntry,
  kickPlayerEntry,
  joinPartyEntry,
  appointBankerEntry,
  revokeBankerEntry,
  dmTransferEntry,
  splitEvenlyEntry,
  startGameSessionEntry,
  endGameSessionEntry,
]);

export type TransactionLogEntry = z.infer<typeof transactionLogEntrySchema>;

/**
 * Allowed action `type` values. The reducer's input shape mirrors these
 * but without the derived log-only fields (id, timestamp, actorUserId,
 * actorRole, partyId, sessionId) — those are filled in by the store
 * middleware.
 */
export type TxType = TransactionLogEntry['type'];
