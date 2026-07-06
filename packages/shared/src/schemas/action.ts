import { z } from 'zod';

import { creatureSizeSchema, encumbranceRuleSchema } from './character';
import {
  currencyDenominationSchema,
  itemCategorySchema,
  itemDefinitionSchema,
  raritySchema,
} from './itemDefinition';

/**
 * Action — discriminated-union Zod schema mirroring the runtime
 * `Action` type exported from `@app/rules/reducer/types`. The TS type
 * is the reducer's source-of-truth for what the UI / server sync route
 * dispatches; the Zod schema is the wire-validation source-of-truth for
 * R3.4.a `POST /sync/actions`.
 *
 * The reducer's `Action` payloads are intentionally a SUBSET of the
 * corresponding `TransactionLogEntry` payloads — the reducer + middleware
 * mint the derived fields (ids, timestamps, derived `removed` flag, etc.)
 * during dispatch. This file mirrors that subset 1:1 with the TS type.
 *
 * **Drift detection.** When adding a new action variant: update BOTH
 * the TS type in `@app/rules/reducer/types` AND this Zod schema. The
 * `assertActionsAlign` cross-test in `action.test.ts` performs a
 * type-level compatibility check between the two so this never drifts.
 */

const currencyDeltaPayloadSchema = z.object({
  cp: z.number().int(),
  sp: z.number().int(),
  ep: z.number().int(),
  gp: z.number().int(),
  pp: z.number().int(),
});

const homebrewDefinitionInputSchema = z.object({
  name: z.string().min(1),
  category: itemCategorySchema,
  weight: z.number().nonnegative().optional(),
  cost: z
    .object({
      amount: z.number().int().nonnegative(),
      currency: currencyDenominationSchema,
    })
    .optional(),
  description: z.string().optional(),
  tags: z.array(z.string().min(1)).optional(),
  // BUG-012 (2026-07-06) — magic-item metadata surfaced by the homebrew
  // form when `category === 'magic'`. Optional at the wire level; the
  // form enforces "rarity required for magic items" via cross-field
  // refinement, while non-magic categories omit all three.
  rarity: raritySchema.optional(),
  requiresAttunement: z.boolean().optional(),
  attunementPrereq: z.string().optional(),
});

export type HomebrewDefinitionInput = z.infer<typeof homebrewDefinitionInputSchema>;

/**
 * Patch shape for `edit-homebrew`. Each field optional AND may be
 * explicit `undefined` (= "clear this optional field") — distinct from
 * "key absent" (= "don't touch"). Under `exactOptionalPropertyTypes`
 * the TS type uses `T | undefined` on each member. The Zod runtime
 * doesn't have to encode that distinction; the reducer's diff loop
 * does the "absent vs explicit-undefined" branching.
 */
const homebrewDefinitionPatchSchema = z.object({
  name: z.string().min(1).optional(),
  category: itemCategorySchema.optional(),
  weight: z.number().nonnegative().optional(),
  cost: z
    .object({
      amount: z.number().int().nonnegative(),
      currency: currencyDenominationSchema,
    })
    .optional(),
  description: z.string().optional(),
  tags: z.array(z.string().min(1)).optional(),
  // BUG-012 — same three fields the input schema carries. In patch
  // context, `undefined` = "clear this optional field" per the reducer's
  // diff loop. Emitted by the form when the user unchecks
  // `requiresAttunement` or switches `category` away from `magic`.
  rarity: raritySchema.optional(),
  requiresAttunement: z.boolean().optional(),
  attunementPrereq: z.string().optional(),
});

export type HomebrewDefinitionPatch = z.infer<typeof homebrewDefinitionPatchSchema>;

// -------------------- 25 action variants --------------------

const createCharacterAction = z.object({
  type: z.literal('create-character'),
  /**
   * R4.1-followup — two payload shapes share the `create-character`
   * action:
   *   - With character: full character payload, `dmOnly` absent or
   *     `false`. Mints User + Party + dm + player memberships +
   *     Character + Inventory stash + party-scope stashes + currencies.
   *   - DM-only: `dmOnly: true` + `partyName`. No character fields.
   *     Mints User + Party + ONE dm membership + party-scope stashes
   *     + currencies.
   *
   * Modelled as a `z.union` (not `z.discriminatedUnion`) so the
   * with-character variant can omit `dmOnly` entirely — keeps the
   * common-case dispatch ergonomic (`dispatch({ type: 'create-character',
   * payload: { name, species, ... } })`) without forcing an explicit
   * `dmOnly: false`.
   *
   * RH1.2 — client-minted ids on the wire. The with-character branch
   * mints one of two id sets depending on reducer state:
   *   - **Bootstrap** (state === null): mints the full User + Party +
   *     party-scope stashes + currencies + Character + Inventory stash +
   *     inventory currency = 9 ids.
   *   - **In-existing-party** (state !== null): mints only Character +
   *     Inventory stash + inventory currency = 3 ids.
   *
   * Wire-shape decision: keep the union at 2 branches (not 3). The six
   * bootstrap-only ids (`newUserId`, `newPartyId`, `newPartyStashId`,
   * `newRecoveredLootStashId`, `newPartyStashCurrencyId`,
   * `newRecoveredLootCurrencyId`) are optional on the with-character
   * branch; the reducer boundary asserts they're present when state is
   * null. This avoids introducing a 3rd discriminant purely for id
   * validation.
   *
   * The dmOnly branch always mints the 6 bootstrap ids (no character,
   * no inventory).
   */
  payload: z.union([
    z.object({
      dmOnly: z.literal(false).optional(),
      name: z.string().min(1),
      species: z.string().min(1),
      size: creatureSizeSchema,
      class: z.string().min(1),
      level: z.number().int().positive(),
      str: z.number().int().positive(),
      partyName: z.string().min(1).optional(),
      // Always required (both bootstrap + in-existing-party):
      newCharacterId: z.string().min(1),
      newInventoryStashId: z.string().min(1),
      newCurrencyHoldingId: z.string().min(1),
      // Bootstrap-only ids (required when state === null, optional at wire):
      newUserId: z.string().min(1).optional(),
      newPartyId: z.string().min(1).optional(),
      newPartyStashId: z.string().min(1).optional(),
      newRecoveredLootStashId: z.string().min(1).optional(),
      newPartyStashCurrencyId: z.string().min(1).optional(),
      newRecoveredLootCurrencyId: z.string().min(1).optional(),
    }),
    z.object({
      dmOnly: z.literal(true),
      partyName: z.string().min(1),
      newUserId: z.string().min(1),
      newPartyId: z.string().min(1),
      newPartyStashId: z.string().min(1),
      newRecoveredLootStashId: z.string().min(1),
      newPartyStashCurrencyId: z.string().min(1),
      newRecoveredLootCurrencyId: z.string().min(1),
    }),
  ]),
});

const acquireAction = z.object({
  type: z.literal('acquire'),
  payload: z.object({
    stashId: z.string().min(1),
    definitionId: z.string().min(1),
    quantity: z.number().int().positive(),
    source: z.enum(['hoard', 'purchase', 'custom-create', 'duplicate', 'catalog-add']),
    notes: z.string().optional(),
    // RH1.2 — client-minted id for the new ItemInstance row. Required on
    // the wire. If the acquire lands on a stack-eligible row the id is
    // discarded (existing row's id wins); reducer + persistor decide.
    newItemInstanceId: z.string().min(1),
  }),
});

const consumeAction = z.object({
  type: z.literal('consume'),
  payload: z.object({
    itemInstanceId: z.string().min(1),
    quantity: z.number().int().positive(),
  }),
});

const seedCatalogAction = z.object({
  type: z.literal('seed-catalog'),
  payload: z.object({
    seedVersion: z.number().int().nonnegative(),
    entries: z.array(itemDefinitionSchema),
  }),
});

const editItemInstanceAction = z.object({
  type: z.literal('edit-item-instance'),
  payload: z.object({
    itemInstanceId: z.string().min(1),
    patch: z.object({
      customName: z.string().optional(),
      notes: z.string().optional(),
    }),
  }),
});

const createStashAction = z.object({
  type: z.literal('create-stash'),
  payload: z.object({
    ownerCharacterId: z.string().min(1),
    name: z.string().min(1),
    // RH1.2 — client-minted ids. `newStashId` for the Stash row,
    // `newCurrencyHoldingId` for the CurrencyHolding auto-provisioned
    // per OUTLINE §3.5 (every stash has a CP-integer currency row).
    newStashId: z.string().min(1),
    newCurrencyHoldingId: z.string().min(1),
  }),
});

const renameStashAction = z.object({
  type: z.literal('rename-stash'),
  payload: z.object({
    stashId: z.string().min(1),
    newName: z.string().min(1),
  }),
});

const deleteStashAction = z.object({
  type: z.literal('delete-stash'),
  payload: z.object({
    stashId: z.string().min(1),
  }),
});

const currencyChangeAction = z.object({
  type: z.literal('currency-change'),
  payload: z.object({
    stashId: z.string().min(1),
    delta: currencyDeltaPayloadSchema,
    // `deposit | withdraw | convert` — self-managed adjustments a player
    // makes to a stash they own. `gameplay-drain` (R4.2.d) is a DM-only
    // reason for removing currency from Party Stash / Recovered Loot
    // for gameplay reasons (magical drain, NPC tax, theft). The guard
    // layer enforces the DM-only constraint.
    reason: z.enum(['deposit', 'withdraw', 'convert', 'gameplay-drain']),
  }),
});

const transferAction = z.object({
  type: z.literal('transfer'),
  payload: z.object({
    itemInstanceId: z.string().min(1),
    toStashId: z.string().min(1),
    quantity: z.number().int().positive(),
    // R1.5 — `toContainerInstanceId`:
    //   - absent / undefined: leave the moved row's containerInstanceId alone
    //   - null: take-out (clear containerInstanceId)
    //   - string: pack-into (set containerInstanceId)
    toContainerInstanceId: z.string().min(1).nullable().optional(),
    // RH1.2 — client-minted id for the partial-move-no-autostack branch
    // (reducer/index.ts `transfer` arm, ~line 1573). Required on the
    // wire. Full-move + partial-with-autostack paths ignore it (existing
    // row's id wins).
    newItemInstanceId: z.string().min(1),
  }),
});

const splitAction = z.object({
  type: z.literal('split'),
  payload: z.object({
    itemInstanceId: z.string().min(1),
    quantity: z.number().int().positive(),
    // RH1.2 — client-minted id for the new split-off ItemInstance row.
    newItemInstanceId: z.string().min(1),
  }),
});

const currencyTransferAction = z.object({
  type: z.literal('currency-transfer'),
  payload: z.object({
    fromStashId: z.string().min(1),
    toStashId: z.string().min(1),
    delta: currencyDeltaPayloadSchema,
  }),
});

const createHomebrewAction = z.object({
  type: z.literal('create-homebrew'),
  payload: homebrewDefinitionInputSchema.extend({
    duplicatedFromId: z.string().min(1).optional(),
    // RH1.2 — client-minted id for the new ItemDefinition (homebrew) row.
    newDefinitionId: z.string().min(1),
  }),
});

const editHomebrewAction = z.object({
  type: z.literal('edit-homebrew'),
  payload: z.object({
    definitionId: z.string().min(1),
    patch: homebrewDefinitionPatchSchema,
  }),
});

const deleteHomebrewAction = z.object({
  type: z.literal('delete-homebrew'),
  payload: z.object({
    definitionId: z.string().min(1),
  }),
});

const renameCharacterAction = z.object({
  type: z.literal('rename-character'),
  payload: z.object({
    characterId: z.string().min(1),
    newName: z.string().min(1),
  }),
});

const renamePartyAction = z.object({
  type: z.literal('rename-party'),
  payload: z.object({
    partyId: z.string().min(1),
    newName: z.string().min(1),
  }),
});

const setEncumbranceAction = z.object({
  type: z.literal('set-encumbrance'),
  payload: z.object({
    partyId: z.string().min(1),
    rule: encumbranceRuleSchema,
    enforce: z.boolean(),
  }),
});

const equipAction = z.object({
  type: z.literal('equip'),
  payload: z.object({
    itemInstanceId: z.string().min(1),
    characterId: z.string().min(1),
    slot: z.string().optional(),
    // BUG-008 — when the source row has quantity > 1, the reducer
    // auto-splits off a fresh quantity-1 row and flips `equipped:true`
    // on it (invariant: equipped rows always have quantity=1 per
    // OUTLINE §3.4 — you can't equip two of a kind). Client mints
    // this UUID v7 per RH1 id-authority; reducer ignores it when
    // quantity is already 1 (no split needed).
    newItemInstanceId: z.string().min(1).optional(),
  }),
});

const unequipAction = z.object({
  type: z.literal('unequip'),
  payload: z.object({
    itemInstanceId: z.string().min(1),
    characterId: z.string().min(1),
    slot: z.string().optional(),
  }),
});

const attuneAction = z.object({
  type: z.literal('attune'),
  payload: z.object({
    itemInstanceId: z.string().min(1),
    characterId: z.string().min(1),
    // R4.3.d — DM cap-override per OUTLINE §3.8. When true, the reducer
    // skips the maxAttunement slot-cap check. Guard (`attuneGuard`)
    // rejects non-DM actors setting this flag. Absent / false = normal
    // cap enforcement.
    overrideCap: z.boolean().optional(),
    // BUG-008 — see `equipAction.payload.newItemInstanceId`. Same
    // auto-split rationale.
    newItemInstanceId: z.string().min(1).optional(),
  }),
});

const unattuneAction = z.object({
  type: z.literal('unattune'),
  payload: z.object({
    itemInstanceId: z.string().min(1),
    characterId: z.string().min(1),
  }),
});

const useChargeAction = z.object({
  type: z.literal('use-charge'),
  payload: z.object({
    itemInstanceId: z.string().min(1),
    characterId: z.string().min(1),
    amount: z.number().int().positive().optional(),
  }),
});

const rechargeAction = z.object({
  type: z.literal('recharge'),
  payload: z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('single'),
      itemInstanceId: z.string().min(1),
      characterId: z.string().min(1),
      amount: z.number().int().positive().optional(),
    }),
    z.object({
      mode: z.literal('manual'),
      itemInstanceId: z.string().min(1),
      characterId: z.string().min(1),
      amount: z.number().int().positive().optional(),
    }),
    z.object({
      mode: z.literal('batch'),
      characterId: z.string().min(1),
      trigger: z.enum(['dawn', 'dusk', 'long-rest', 'short-rest']),
      amounts: z.record(z.string().min(1), z.number().int().positive()).optional(),
    }),
  ]),
});

const identifyAction = z.object({
  type: z.literal('identify'),
  payload: z.object({
    itemInstanceId: z.string().min(1),
    identified: z.boolean(),
    // R2.3 hint semantics: key absent vs explicit `undefined` vs string
    // is differentiated by the reducer; runtime Zod accepts any of the
    // three (`undefined` is encoded as absent at the wire boundary; the
    // server's diff loop treats it the same way as the web reducer).
    hint: z.string().optional(),
  }),
});

const editCharacterAction = z.object({
  type: z.literal('edit-character'),
  payload: z.object({
    characterId: z.string().min(1),
    patch: z.object({
      species: z.string().min(1).optional(),
      class: z.string().min(1).optional(),
      level: z.number().int().positive().optional(),
      str: z.number().int().positive().optional(),
      maxAttunement: z.number().int().nonnegative().optional(),
    }),
  }),
});

const deleteCharacterAction = z.object({
  type: z.literal('delete-character'),
  payload: z.object({
    characterId: z.string().min(1),
  }),
});

/**
 * R4.1.c — `leave-party`. The actor self-removes from `partyId`.
 * Payload deliberately empty (no `partyId` in the wire shape) — the
 * server resolves the party from session + URL (SECURITY §2 "Server is
 * authoritative; never trust partyId from a request body"). The
 * reducer reads `state.party.id` directly because R4.1's web client
 * only ever holds one party in memory at a time.
 */
const leavePartyAction = z.object({
  type: z.literal('leave-party'),
  payload: z.object({}),
});

/**
 * R4.1.d — `kick-player`. DM removes another member from the party.
 * Wire payload is `{ kickedUserId }`; the partyId is resolved
 * server-side from session + URL per SECURITY §2. The reducer reads
 * `state.party.id` directly because R4.1's web client only holds one
 * party in memory at a time.
 */
const kickPlayerAction = z.object({
  type: z.literal('kick-player'),
  payload: z.object({
    kickedUserId: z.string().min(1),
  }),
});

/**
 * R4.1.e — `join-party`. Dispatched server-side after a successful
 * invite-code redemption. The reducer mints one `role='player'`
 * `PartyMembership` row (characterId: null) and appends a `join-party`
 * log entry; the user creates their character via a subsequent
 * `create-character` action.
 *
 * Wire payload deliberately empty — the server resolves the party
 * from the invite code (route layer) and the user from the session.
 * In the local reducer it reads `state.user.id` and `state.party.id`.
 * NB: the client never directly dispatches `join-party`; the server
 * does on the client's behalf as part of `POST /parties/join`. The
 * action exists in the union so the log entry round-trips through
 * the same `applied[]` channel the rest of `/sync/actions` uses.
 */
const joinPartyAction = z.object({
  type: z.literal('join-party'),
  payload: z.object({}),
});

/**
 * R4.2.a — `appoint-banker`. DM appoints an active player as the
 * party's Banker per OUTLINE §3.14. Reducer guards reject if:
 *   - actor lacks an active DM membership in this party (`dm_only`).
 *   - target equals `Party.ownerUserId` (DM cannot self-appoint).
 *   - target lacks an active `role='player'` membership in this party.
 *   - `memberCount < 2` (solo parties have no Banker).
 *   - `Party.bankerUserId` is already non-null (reassignment is a
 *     two-step revoke-then-appoint per OUTLINE §3.14).
 *
 * Wire payload carries only `bankerUserId`; `partyId` comes from the
 * URL/session per SECURITY §2.
 */
const appointBankerAction = z.object({
  type: z.literal('appoint-banker'),
  payload: z.object({
    bankerUserId: z.string().min(1),
  }),
});

/**
 * R4.2.a / R4.3.a — `revoke-banker`. Clears `Party.bankerUserId`.
 * Reasons:
 *   - `'manual'` — DM explicitly revokes.
 *   - `'reassigned'` — reserved for a future "reassign Banker" CTA
 *     that combines revoke + appoint in two clicks. R4.2.a only
 *     emits `'manual'`; the enum value is reserved.
 *   - `'left-party'` — synthesized by the `leave-party` reducer arm
 *     when the leaver was the Banker.
 *   - `'kicked'` — synthesized by `kick-player` when the kicked user
 *     was the Banker.
 *   - `'dm-transfer'` — synthesized by the `dm-transfer` reducer arm
 *     when the incoming DM is the current Banker (§4 invariant:
 *     `bankerUserId !== ownerUserId`). Added in R4.3.a.
 *
 * Only `'manual'` and `'reassigned'` reach this action via the
 * `POST /sync/actions` route; the other three are synthesized by
 * cascade reducer arms and never round-trip through dispatch.
 */
const revokeBankerAction = z.object({
  type: z.literal('revoke-banker'),
  payload: z.object({
    reason: z.enum(['manual', 'reassigned', 'left-party', 'kicked', 'dm-transfer']),
  }),
});

/**
 * R4.3.a — `dm-transfer`. DM hands the DM role to another active
 * player in the party per OUTLINE §3.14 + §8.3. Atomic swap:
 *   - Outgoing DM's `role='dm'` row → soft-deleted (`leftAt: now`).
 *   - Outgoing DM's `role='player'` row → left active; if none exists
 *     (DM-only outgoing DM) it is auto-minted with `characterId: null`.
 *   - Incoming DM's `role='dm'` row → upsert to active (reactivates a
 *     historical soft-deleted row per BUG-002 lesson, or creates fresh).
 *   - `Party.ownerUserId` → newDmUserId.
 *   - If `Party.bankerUserId === newDmUserId` → cleared + synthetic
 *     `revoke-banker` slice with `reason: 'dm-transfer'`.
 *
 * Wire payload carries only `newDmUserId`; `partyId` comes from the
 * URL/session per SECURITY §2.
 */
const dmTransferAction = z.object({
  type: z.literal('dm-transfer'),
  payload: z.object({
    newDmUserId: z.string().min(1),
  }),
});

/**
 * R4.2.d — Banker-only "split-evenly" action. Splits `fromStashId`'s
 * currency across the supplied `recipientCharacterIds` using the
 * cascade-down-denominations algorithm (`packages/rules/currency.ts`
 * `splitEvenly`). Emits one terminal `split-evenly` log entry plus N
 * `currency-transfer` entries (one per recipient).
 *
 * `fromStashId` must be the party's Party Stash (`scope: 'party'`).
 * Recovered Loot is out of scope for R4.2.d — the Banker can move that
 * currency manually via `currency-transfer` if needed.
 *
 * `recipientCharacterIds` must all be active players' characters in
 * this party. The Banker's own character is a valid recipient per
 * OUTLINE §8.1 ("Take Party Stash currency into own character's
 * purse" — Banker: allowed).
 */
const splitEvenlyAction = z.object({
  type: z.literal('split-evenly'),
  payload: z.object({
    fromStashId: z.string().min(1),
    recipientCharacterIds: z.array(z.string().min(1)).min(1),
  }),
});

/**
 * RH3.1 — `start-game-session`. Marks the start of a play session
 * (OUTLINE §3.12). Reducer mints a fresh `GameSession` row with
 * `isCurrent: true` and demotes any prior current session.
 *
 * `newGameSessionId` is client-minted per RH1's id-authority contract
 * (UUID v7). `date` defaults to today's calendar date (from `ctx.now()`)
 * when omitted — the caller can override for "recording a session that
 * happened yesterday" workflows.
 *
 * `endCurrentFirst` opts into auto-ending the prior current session
 * before starting the new one. Without the flag, the reducer rejects
 * with `session_already_current` — preserves the "exactly one current
 * session per party" invariant by making the caller acknowledge the
 * end-then-start transition explicitly.
 */
const startGameSessionAction = z.object({
  type: z.literal('start-game-session'),
  payload: z.object({
    newGameSessionId: z.string().min(1),
    date: z.iso.date().optional(),
    notes: z.string().optional(),
    endCurrentFirst: z.boolean().optional(),
  }),
});

/**
 * RH3.1 — `end-game-session`. Marks the end of the current play
 * session. Reducer clears `isCurrent` on the current `GameSession`
 * (found via `state.gameSessions.find(s => s.isCurrent)`); subsequent
 * log entries land with `sessionId: null` ("Untagged" bucket per
 * OUTLINE §3.12) until the next `start-game-session`.
 *
 * Wire payload deliberately empty — the reducer reads which session
 * is current directly from `state.gameSessions`.
 */
const endGameSessionAction = z.object({
  type: z.literal('end-game-session'),
  payload: z.object({}),
});

/**
 * R5.2 — `edit-game-session-notes`. DM edits the free-text notes on
 * any `GameSession` (current or past). Follows the same patch-object
 * shape as `edit-character` but with a single field.
 *
 * Reducer rejects unknown `gameSessionId` and rejects no-op writes
 * (matches the `rename-stash` / `rename-character` invariant that
 * every dispatch appends exactly one log entry). Empty string is a
 * legal value — it clears the notes.
 */
const editGameSessionNotesAction = z.object({
  type: z.literal('edit-game-session-notes'),
  payload: z.object({
    gameSessionId: z.string().min(1),
    notes: z.string(),
  }),
});

export const actionSchema = z.discriminatedUnion('type', [
  createCharacterAction,
  acquireAction,
  consumeAction,
  seedCatalogAction,
  editItemInstanceAction,
  createStashAction,
  renameStashAction,
  deleteStashAction,
  currencyChangeAction,
  transferAction,
  splitAction,
  currencyTransferAction,
  createHomebrewAction,
  editHomebrewAction,
  deleteHomebrewAction,
  renameCharacterAction,
  renamePartyAction,
  setEncumbranceAction,
  equipAction,
  unequipAction,
  attuneAction,
  unattuneAction,
  useChargeAction,
  rechargeAction,
  identifyAction,
  editCharacterAction,
  deleteCharacterAction,
  leavePartyAction,
  kickPlayerAction,
  joinPartyAction,
  appointBankerAction,
  revokeBankerAction,
  dmTransferAction,
  splitEvenlyAction,
  startGameSessionAction,
  endGameSessionAction,
  editGameSessionNotesAction,
]);

export type Action = z.infer<typeof actionSchema>;
