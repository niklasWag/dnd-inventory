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
 * `actorRole` is derived at write time: in MVP everything is `"player"`
 * for player-driven actions and `"dm"` for DM-only ones; in MVP there is
 * only one user wearing both hats, so reducer cases that are conceptually
 * DM-driven log as `"dm"` for forward-compat (e.g. `create-character`
 * provisions the party).
 *
 * `sessionId` is `null` until R5 (`Session` entity).
 */

const baseLogFields = {
  id: z.string().min(1),
  partyId: z.string().min(1),
  sessionId: z.null(),
  timestamp: z.string().datetime(),
  actorUserId: z.string().min(1),
  actorRole: z.enum(['dm', 'player']),
};

const createCharacterEntry = z.object({
  ...baseLogFields,
  type: z.literal('create-character'),
  payload: z.object({
    characterId: z.string().min(1),
    userId: z.string().min(1),
    partyId: z.string().min(1),
    name: z.string().min(1),
    inventoryStashId: z.string().min(1),
    partyStashId: z.string().min(1),
    recoveredLootStashId: z.string().min(1),
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
 * mass-edits a row at once. R2 will widen further to include
 * `identified` and `currentCharges`.
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
      .array(z.enum(['customName', 'notes', 'equipped', 'attuned']))
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
 */
const transferEntry = z.object({
  ...baseLogFields,
  type: z.literal('transfer'),
  payload: z.object({
    itemInstanceId: z.string().min(1),
    quantity: z.number().int().positive(),
    fromStashId: z.string().min(1),
    toStashId: z.string().min(1),
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
 * convert | stash-deleted`. M3 introduced `'stash-deleted'` (the
 * delete-cascade synthetic entry); M4 dispatches `'deposit' | 'withdraw'
 * | 'convert'` from the inline currency editor + Convert modal. R4 will
 * extend with `'split-evenly' | 'gameplay-drain'` for multi-member parties.
 */
const currencyChangeEntry = z.object({
  ...baseLogFields,
  type: z.literal('currency-change'),
  payload: z.object({
    stashId: z.string().min(1),
    delta: currencyDeltaSchema,
    reason: z
      .enum(['deposit', 'withdraw', 'split-evenly', 'gameplay-drain', 'convert', 'stash-deleted'])
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
    changedFields: z
      .array(z.enum(['species', 'class', 'level', 'str', 'maxAttunement']))
      .min(1),
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
  editCharacterEntry,
]);

export type TransactionLogEntry = z.infer<typeof transactionLogEntrySchema>;

/**
 * Allowed action `type` values. The reducer's input shape mirrors these
 * but without the derived log-only fields (id, timestamp, actorUserId,
 * actorRole, partyId, sessionId) — those are filled in by the store
 * middleware.
 */
export type TxType = TransactionLogEntry['type'];
