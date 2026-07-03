import type {
  CurrencyHolding,
  GameSession,
  ItemDefinition,
  ItemInstance,
  Stash,
  TransactionLogEntry,
} from '@app/shared';
import { isValidUuidV7 } from '@app/shared';

import * as attunement from '../attunement';
import * as capacity from '../capacity';
import * as charges from '../charges';
import * as currency from '../currency';
import * as inventory from '../inventory';
import * as weightRules from '../weight';

import type { Action, AppState } from './types';

/**
 * Pure reducer. Takes the current state, an action, and a
 * `ReducerContext` for non-deterministic operations (id minting, current
 * time, invite-code generation), and returns the next state along with
 * the log entry payloads that should be appended.
 *
 * Why split the log entry across reducer / middleware:
 *   - the reducer is pure ONCE `ctx` is fixed — its only sources of
 *     non-determinism are the three calls on `ctx`. Tests inject a
 *     deterministic `ctx` and the reducer becomes trivially reproducible;
 *     production injects `crypto.randomUUID` / `new Date().toISOString` /
 *     a 128-bit base32 invite-code generator.
 *   - the middleware (web: `apps/web/src/store/index.ts`; server:
 *     `apps/server/src/sync/log-builder.ts`) injects the per-entry
 *     `actorUserId`, `actorRole`, `partyId`, `sessionId` AFTER the
 *     reducer has minted its `id` + `timestamp` via `ctx`.
 *
 * Every reducer case must return a `logEntry` slice typed against the
 * `TransactionLogEntry` discriminated union — that's how we ensure
 * "every mutation appends one log entry" stays a type-level invariant.
 *
 * The reducer MUST validate-then-apply: if the action is illegal in the
 * current state (e.g. `create-character` dispatched when a character
 * already exists), throw. The store middleware does NOT swallow errors;
 * callers see them.
 */

/**
 * R3.4.a — non-determinism injection seam. Web and server both inject
 * `new Date().toISOString` + a 128-bit base32 invite-code generator.
 * Tests inject deterministic sequences to make reducer behaviour
 * bit-reproducible.
 *
 * RH1.2 — `newId` is no longer part of the context. Every id-creating
 * action carries its ids explicitly in the payload
 * (`payload.new<EntityName>Id`); the reducer + persistor consume those
 * fields instead of minting ids from the context. See `docs/roadmap.md`
 * RH1 charter and `packages/shared/src/ids.ts`.
 */
export interface ReducerContext {
  /** Returns the current time as an ISO-8601 string. */
  now(): string;
  /**
   * Returns a fresh invite code. OUTLINE §3.1 says 128-bit base32 with
   * an `INV-` prefix. Kept distinct from the id namespace so a UUID is
   * never a valid invite code and vice versa.
   */
  newInviteCode(): string;
}
/**
 * `LogEntrySlice` is the per-variant pair of `(type, payload)` that the
 * reducer returns. We define it distributively over the
 * `TransactionLogEntry` union so the discriminant survives — a plain
 * `Pick<TransactionLogEntry, 'type' | 'payload'>` would collapse the
 * union into a single member with `type: TxType` and lose the link
 * between each `type` literal and its matching payload shape.
 *
 * `T extends T` (rather than `T extends infer U`) is a distributive
 * conditional: TS evaluates it once per union member, then unions the
 * results. That preserves the discriminated-union narrowing in callers.
 */
export type LogEntrySlice<T extends TransactionLogEntry = TransactionLogEntry> = T extends T
  ? { type: T['type']; payload: T['payload'] }
  : never;

export interface ReducerResult {
  state: AppState;
  /**
   * Log entries to append to `state.log`, in order. Most reducer cases
   * emit exactly one slice; `delete-stash` (M3) is the first case to emit
   * a cascade (N `transfer` + 0–1 `currency-change` + 1 `delete-stash`).
   *
   * Middleware (`apps/web/src/store/index.ts`) iterates this array and
   * resolves each slice into a fully-formed `TransactionLogEntry` via
   * `resolveActor` + `buildLogEntry`, appending the resolved array to
   * `state.log` in one `set()` call.
   */
  logEntries: LogEntrySlice[];
}

export function reduce(state: AppState, action: Action, ctx: ReducerContext): ReducerResult {
  switch (action.type) {
    case 'create-character':
      return createCharacter(state, action.payload, ctx);
    case 'acquire':
      return acquire(state, action.payload, ctx);
    case 'consume':
      return consume(state, action.payload);
    case 'seed-catalog':
      return seedCatalog(state, action.payload);
    case 'edit-item-instance':
      return editItemInstance(state, action.payload);
    case 'create-stash':
      return createStash(state, action.payload, ctx);
    case 'rename-stash':
      return renameStash(state, action.payload);
    case 'delete-stash':
      return deleteStash(state, action.payload);
    case 'currency-change':
      return currencyChange(state, action.payload);
    case 'transfer':
      return transfer(state, action.payload, ctx);
    case 'split':
      return split(state, action.payload, ctx);
    case 'currency-transfer':
      return currencyTransfer(state, action.payload);
    case 'create-homebrew':
      return createHomebrew(state, action.payload, ctx);
    case 'edit-homebrew':
      return editHomebrew(state, action.payload);
    case 'delete-homebrew':
      return deleteHomebrew(state, action.payload);
    case 'rename-character':
      return renameCharacter(state, action.payload);
    case 'rename-party':
      return renameParty(state, action.payload);
    case 'set-encumbrance':
      return setEncumbrance(state, action.payload);
    case 'equip':
    case 'unequip':
      return equipOrUnequip(state, action.type, action.payload);
    case 'attune':
    case 'unattune':
      return attuneOrUnattune(state, action.type, action.payload);
    case 'use-charge':
      return spendCharge(state, action.payload);
    case 'recharge':
      return rechargeAction(state, action.payload);
    case 'identify':
      return identifyAction(state, action.payload);
    case 'edit-character':
      return editCharacter(state, action.payload);
    case 'delete-character':
      return deleteCharacter(state, action.payload);
    case 'leave-party':
      return leaveParty(state, ctx);
    case 'kick-player':
      return kickPlayer(state, action.payload, ctx);
    case 'join-party':
      return joinParty(state, ctx);
    case 'appoint-banker':
      return appointBanker(state, action.payload);
    case 'revoke-banker':
      return revokeBanker(state, action.payload);
    case 'dm-transfer':
      return dmTransfer(state, action.payload, ctx);
    case 'split-evenly':
      return splitEvenlyReducer(state, action.payload);
    case 'start-game-session':
      return startGameSession(state, action.payload, ctx);
    case 'end-game-session':
      return endGameSession(state);
  }
}

/**
 * Narrows `AppState` from `... | null` to its populated shape, throwing
 * with the action name if state is null. Centralizes the boilerplate that
 * every post-bootstrap reducer case needs.
 */
function requireState(state: AppState, action: string): NonNullable<AppState> {
  if (state === null) {
    throw new Error(`${action}: no AppState (create-character must run first)`);
  }
  return state;
}

/**
 * R1.4 — hard-mode encumbrance guard. Called by `acquire` and `transfer`
 * BEFORE committing `nextItems`. Speculative: `nextItems` already reflects
 * the proposed mutation (so the §3.4 cascade has already cleared flags on
 * cross-stash moves). Reads the destination stash; if it's a character's
 * Inventory AND the character has `enforceEncumbrance: true` AND
 * `encumbranceRule !== 'off'`, computes the container-aware weight of the
 * post-write Inventory rows and rejects when over `heavyThreshold`.
 *
 * Composition with R1.3: passing `nextItems` (post-cascade) means a
 * leave-Inventory transfer ALWAYS lowers the source's weight (the row
 * left) and never trips the guard. The entering-Inventory case is the
 * one that matters; the destination's flatWeight-container exception
 * applies via `containerAwareWeight` so packing into a Bag of Holding
 * doesn't add weight (R1.5 packing UI will land on the same call).
 *
 * Throws with a `<action>: would exceed carrying capacity ...` message
 * carrying the post-write weight + the threshold so toasts can surface
 * the numbers. The action label is prefixed for log-style consistency
 * with the rest of the reducer's rejection messages.
 */
function checkHardMode(
  action: string,
  s: NonNullable<AppState>,
  nextItems: ReadonlyArray<ItemInstance>,
  destinationStashId: string,
): void {
  const stash = s.stashes.find((st) => st.id === destinationStashId);
  if (stash === undefined) return;
  if (stash.scope !== 'character' || !stash.isCarried) return;
  if (stash.ownerCharacterId === null) return;
  const character = s.characters.find((c) => c.id === stash.ownerCharacterId);
  if (character === undefined) return;
  if (!character.enforceEncumbrance) return;
  if (character.encumbranceRule === 'off') return;

  const defsById = new Map(
    s.catalog.map(
      (d) =>
        [
          d.id,
          d.flatWeight === undefined
            ? { weight: d.weight ?? 0 }
            : { weight: d.weight ?? 0, flatWeight: d.flatWeight },
        ] as const,
    ),
  );
  const inventoryRows = nextItems.filter((i) => i.ownerId === stash.id);
  const postWeight = weightRules.containerAwareWeight(inventoryRows, defsById);
  const threshold = capacity.heavyThreshold(
    character.abilityScores.STR,
    character.size,
    character.encumbranceRule,
  );
  if (postWeight > threshold) {
    throw new Error(
      `${action}: would exceed carrying capacity (${String(postWeight)} > ${String(threshold)} lb)`,
    );
  }
}

// -------------------------------------------------------------------- //
// create-character (M1)
// -------------------------------------------------------------------- //

/**
 * Provisions a fresh AppState in one atomic step:
 *   - the single local User (if missing)
 *   - the Party (solo or multi-member share the same shape; the "solo"
 *     hub badge is derived from `memberCount === 1` per OUTLINE §4
 *     amendment 2026-06-24)
 *   - two PartyMemberships for the user (dm + player)
 *   - the Character
 *   - three Stashes: Inventory (carried), Party Stash, Recovered Loot
 *   - one CurrencyHolding per stash (all zeroed)
 *
 * Per the resolved open question (roadmap §Open Questions): zero default
 * Storage stashes — those are user-opt-in via M3's "New Storage stash".
 *
 * **R4.1.f — post-bootstrap branch.** When `state !== null`, the action
 * routes to `createCharacterInExistingParty` (below): a joiner who already
 * minted a `role='player'` membership with `characterId: null` via
 * `POST /parties/join`, OR a DM-only DM adding their character later, OR
 * a user recreating after `delete-character`. All three end at the same
 * shape: an active player membership pointing at a new Character with its
 * own Inventory stash + zero-balance CurrencyHolding.
 */
function createCharacterInExistingParty(
  state: NonNullable<AppState>,
  payload: Extract<Action, { type: 'create-character' }>['payload'],
  ctx: ReducerContext,
): ReducerResult {
  // The action's payload union allows dmOnly: true alongside `partyName`,
  // but that combination is a bootstrap-only flag (mints a party without a
  // player slot). Adding a "non-character DM thing" to an existing party
  // makes no sense — reject.
  if (payload.dmOnly === true) {
    throw new Error(
      'create-character: dmOnly is only valid on the bootstrap (state === null) branch',
    );
  }

  // RH1.2 — reducer-boundary id-shape assertions. The guard layer has
  // already validated these upstream; this is defense-in-depth.
  // (TS has already narrowed `payload` to the with-character branch via
  // the `dmOnly === true` throw above — no cast needed.)
  if (!isValidUuidV7(payload.newCharacterId)) {
    throw new Error('create-character: newCharacterId must be a valid UUID v7');
  }
  if (!isValidUuidV7(payload.newInventoryStashId)) {
    throw new Error('create-character: newInventoryStashId must be a valid UUID v7');
  }
  if (!isValidUuidV7(payload.newCurrencyHoldingId)) {
    throw new Error('create-character: newCurrencyHoldingId must be a valid UUID v7');
  }

  const actorUserId = state.user.id;

  // The actor must be an active member of state.party (DM or player).
  const activeMembership = state.memberships.find(
    (m) => m.userId === actorUserId && m.leftAt === null,
  );
  if (activeMembership === undefined) {
    throw new Error('create-character: actor is not an active member of this party');
  }

  // One-character-per-user-per-party invariant per OUTLINE §4. If the
  // actor already has a player row with a non-null characterId, reject.
  const existingPlayerWithCharacter = state.memberships.find(
    (m) =>
      m.userId === actorUserId &&
      m.role === 'player' &&
      m.leftAt === null &&
      m.characterId !== null,
  );
  if (existingPlayerWithCharacter !== undefined) {
    throw new Error('create-character: actor already has an active player character in this party');
  }

  // Locate the existing party-scope stash ids so the log entry can echo
  // them in the same shape as the legacy bootstrap branch (consumers can
  // reconstruct the same payload across both variants).
  const partyStash = state.stashes.find((s) => s.scope === 'party' && s.partyId === state.party.id);
  if (partyStash === undefined) {
    throw new Error('create-character: party stash missing — state is structurally invalid');
  }
  const partyStashId = partyStash.id;
  const recoveredLootStashId = state.party.recoveredLootStashId;

  const now = ctx.now();
  const characterId = payload.newCharacterId;
  const inventoryStashId = payload.newInventoryStashId;

  const newCharacter = {
    id: characterId,
    partyId: state.party.id,
    ownerUserId: actorUserId,
    name: payload.name,
    species: payload.species,
    size: payload.size,
    class: payload.class,
    level: payload.level,
    abilityScores: { STR: payload.str },
    maxAttunement: 3,
    encumbranceRule: 'off' as const,
    enforceEncumbrance: false,
    inventoryStashId,
  };

  const newInventoryStash = {
    id: inventoryStashId,
    scope: 'character' as const,
    name: 'Inventory',
    ownerCharacterId: characterId,
    partyId: null,
    isCarried: true as const,
    createdAt: now,
  };

  const newInventoryHolding = {
    id: payload.newCurrencyHoldingId,
    stashId: inventoryStashId,
    cp: 0,
    sp: 0,
    ep: 0,
    gp: 0,
    pp: 0,
  };

  // Membership patch: if an existing player row has characterId: null,
  // update it in place (joiner / post-delete case). Otherwise the actor
  // is a DM-only DM adding their character — append a fresh player row.
  const existingNullPlayer = state.memberships.find(
    (m) =>
      m.userId === actorUserId &&
      m.role === 'player' &&
      m.leftAt === null &&
      m.characterId === null,
  );

  const nextMemberships =
    existingNullPlayer !== undefined
      ? state.memberships.map((m) => (m === existingNullPlayer ? { ...m, characterId } : m))
      : [
          ...state.memberships,
          {
            userId: actorUserId,
            partyId: state.party.id,
            role: 'player' as const,
            characterId,
            joinedAt: now,
            leftAt: null,
          },
        ];

  const nextState: NonNullable<AppState> = {
    ...state,
    memberships: nextMemberships,
    characters: [...state.characters, newCharacter],
    stashes: [...state.stashes, newInventoryStash],
    currencies: [...state.currencies, newInventoryHolding],
  };

  return {
    state: nextState,
    logEntries: [
      {
        type: 'create-character',
        payload: {
          characterId,
          userId: actorUserId,
          partyId: state.party.id,
          name: payload.name,
          inventoryStashId,
          partyStashId,
          recoveredLootStashId,
        },
      },
    ],
  };
}

function createCharacter(
  state: AppState,
  payload: Extract<Action, { type: 'create-character' }>['payload'],
  ctx: ReducerContext,
): ReducerResult {
  if (state !== null) {
    return createCharacterInExistingParty(state, payload, ctx);
  }

  // RH1.2 — bootstrap-branch id-shape assertions. The 6 party-scope ids
  // are always required at bootstrap. The guard layer has already
  // validated these upstream; this is defense-in-depth.
  const requiredBootstrapIds = {
    newUserId: payload.newUserId,
    newPartyId: payload.newPartyId,
    newPartyStashId: payload.newPartyStashId,
    newRecoveredLootStashId: payload.newRecoveredLootStashId,
    newPartyStashCurrencyId: payload.newPartyStashCurrencyId,
    newRecoveredLootCurrencyId: payload.newRecoveredLootCurrencyId,
  };
  for (const [key, value] of Object.entries(requiredBootstrapIds)) {
    if (typeof value !== 'string' || !isValidUuidV7(value)) {
      throw new Error(`create-character (bootstrap): ${key} must be a valid UUID v7`);
    }
  }
  if (payload.dmOnly !== true) {
    if (!isValidUuidV7(payload.newCharacterId)) {
      throw new Error('create-character (bootstrap): newCharacterId must be a valid UUID v7');
    }
    if (!isValidUuidV7(payload.newInventoryStashId)) {
      throw new Error('create-character (bootstrap): newInventoryStashId must be a valid UUID v7');
    }
    if (!isValidUuidV7(payload.newCurrencyHoldingId)) {
      throw new Error('create-character (bootstrap): newCurrencyHoldingId must be a valid UUID v7');
    }
  }

  const now = ctx.now();
  const userId = payload.newUserId!;
  const partyId = payload.newPartyId!;
  const partyStashId = payload.newPartyStashId!;
  const recoveredLootStashId = payload.newRecoveredLootStashId!;
  const partyName = payload.partyName ?? 'My Campaign';

  // Shared shell (User, Party, party-scope stashes + currency).
  const user = {
    id: userId,
    // R3.2 — userSchema requires at least one of discordId or
    // emailVerified per SECURITY §1.2 / OUTLINE §4. The browser-only MVP
    // has no OAuth or OTP flow yet, so we synthesize discordId === id as
    // a placeholder. R3.5 (web ↔ server integration) will overwrite this
    // with the real Discord snowflake once the user authenticates.
    discordId: userId,
    displayName: 'You',
    createdAt: now,
  };
  const party = {
    id: partyId,
    name: partyName,
    ownerUserId: userId,
    inviteCode: ctx.newInviteCode(),
    recoveredLootStashId,
    bankerUserId: null,
    createdAt: now,
  } as const;
  const dmMembership = {
    userId,
    partyId,
    role: 'dm' as const,
    characterId: null,
    joinedAt: now,
    leftAt: null,
  };
  const partyStash = {
    id: partyStashId,
    scope: 'party' as const,
    name: 'Party Stash',
    ownerCharacterId: null,
    partyId,
    isCarried: false as const,
    createdAt: now,
  };
  const recoveredLootStash = {
    id: recoveredLootStashId,
    scope: 'recovered-loot' as const,
    name: 'Recovered Loot',
    ownerCharacterId: null,
    partyId,
    isCarried: false as const,
    createdAt: now,
  };
  const partyStashCurrency = {
    id: payload.newPartyStashCurrencyId!,
    stashId: partyStashId,
    cp: 0,
    sp: 0,
    ep: 0,
    gp: 0,
    pp: 0,
  };
  const recoveredLootCurrency = {
    id: payload.newRecoveredLootCurrencyId!,
    stashId: recoveredLootStashId,
    cp: 0,
    sp: 0,
    ep: 0,
    gp: 0,
    pp: 0,
  };

  if (payload.dmOnly === true) {
    // DM-only bootstrap: skip Character + Inventory stash + player
    // membership. The DM may later add a character via a future
    // "create-character-in-existing-party" path (R4 carryforward).
    const nextState: NonNullable<AppState> = {
      version: 1,
      seedVersion: 0,
      user,
      party,
      memberships: [dmMembership],
      characters: [],
      gameSessions: [],
      stashes: [partyStash, recoveredLootStash],
      catalog: [],
      items: [],
      currencies: [partyStashCurrency, recoveredLootCurrency],
      log: [],
    };

    return {
      state: nextState,
      logEntries: [
        {
          type: 'create-character',
          payload: {
            userId,
            partyId,
            partyStashId,
            recoveredLootStashId,
            dmOnly: true,
          },
        },
      ],
    };
  }

  // Legacy bootstrap (`dmOnly: false` or absent): mint Character +
  // Inventory stash + player membership alongside the shell.
  const characterId = payload.newCharacterId;
  const inventoryStashId = payload.newInventoryStashId;

  const nextState: NonNullable<AppState> = {
    version: 1,
    seedVersion: 0,
    user,
    party,
    memberships: [
      dmMembership,
      {
        userId,
        partyId,
        role: 'player',
        characterId,
        joinedAt: now,
        leftAt: null,
      },
    ],
    characters: [
      {
        id: characterId,
        partyId,
        ownerUserId: userId,
        name: payload.name,
        species: payload.species,
        size: payload.size,
        class: payload.class,
        level: payload.level,
        abilityScores: { STR: payload.str },
        maxAttunement: 3,
        encumbranceRule: 'off',
        enforceEncumbrance: false,
        inventoryStashId,
      },
    ],
    stashes: [
      {
        id: inventoryStashId,
        scope: 'character',
        name: 'Inventory',
        ownerCharacterId: characterId,
        partyId: null,
        isCarried: true,
        createdAt: now,
      },
      partyStash,
      recoveredLootStash,
    ],
    gameSessions: [],
    catalog: [],
    items: [],
    currencies: [
      {
        id: payload.newCurrencyHoldingId,
        stashId: inventoryStashId,
        cp: 0,
        sp: 0,
        ep: 0,
        gp: 0,
        pp: 0,
      },
      partyStashCurrency,
      recoveredLootCurrency,
    ],
    log: [],
  };

  return {
    state: nextState,
    logEntries: [
      {
        type: 'create-character',
        payload: {
          characterId,
          userId,
          partyId,
          name: payload.name,
          inventoryStashId,
          partyStashId,
          recoveredLootStashId,
        },
      },
    ],
  };
}

// -------------------------------------------------------------------- //
// acquire (M2)
// -------------------------------------------------------------------- //

/**
 * Adds `quantity` of `definitionId` to `stashId`. Auto-stacks on
 * `(definitionId, notes ?? "")` per MVP §6 — identical adds collapse into
 * the existing row.
 *
 * Validate-then-apply: rejects unknown stash, unknown definition, and
 * non-positive quantities. The log entry always carries the resolved
 * `itemInstanceId` (the existing one when stacked, a fresh one when new)
 * so log replayers can follow the row through later `consume` / move
 * actions.
 */
function acquire(
  state: AppState,
  payload: Extract<Action, { type: 'acquire' }>['payload'],
  _ctx: ReducerContext,
): ReducerResult {
  const s = requireState(state, 'acquire');

  if (!isValidUuidV7(payload.newItemInstanceId)) {
    throw new Error('acquire: newItemInstanceId must be a valid UUID v7');
  }

  if (payload.quantity <= 0) {
    throw new Error('acquire: quantity must be positive');
  }
  if (!s.stashes.some((st) => st.id === payload.stashId)) {
    throw new Error(`acquire: unknown stashId ${payload.stashId}`);
  }
  const definition = s.catalog.find((d) => d.id === payload.definitionId);
  if (definition === undefined) {
    throw new Error(`acquire: unknown definitionId ${payload.definitionId}`);
  }

  // R1.5 Approach B — synthesize a distinguishing `notes` value when the
  // acquired definition is a container AND the caller didn't pass an
  // explicit notes value. Each container instance gets its own per-stash
  // `#1`, `#2`, … tag so the auto-stack key `(definitionId, notes ?? "")`
  // never collides (two backpacks stay as two rows). Counter strategy is
  // "highest existing + 1" rather than "count + 1" so deletes don't
  // recycle ids: deleting `#1` then acquiring yields `#3`, not `#1` again.
  // The user can rename the tag via the existing M2.5 Item Detail edit
  // path (`edit-item-instance` with `changedFields: ["notes"]`).
  const effectiveNotes =
    payload.notes !== undefined
      ? payload.notes
      : definition.category === 'container'
        ? nextContainerNotes(s.items, payload.definitionId, payload.stashId)
        : undefined;

  // Auto-stack key: (definitionId, notes ?? "").
  const notesKey = effectiveNotes ?? '';
  const existing = s.items.find(
    (i) =>
      i.ownerId === payload.stashId &&
      i.definitionId === payload.definitionId &&
      (i.notes ?? '') === notesKey,
  );

  let resolvedItemId: string;
  let nextItems: ItemInstance[];

  if (existing !== undefined) {
    resolvedItemId = existing.id;
    nextItems = s.items.map((i) =>
      i.id === existing.id ? { ...i, quantity: i.quantity + payload.quantity } : i,
    );
  } else {
    resolvedItemId = payload.newItemInstanceId;
    // R2.2 — if the destination is a character's Inventory AND the
    // definition has a `charges` block, initialise `currentCharges` to
    // `def.charges.max`. Items entering non-Inventory stashes start at
    // null per OUTLINE §3.4 ("only meaningful in Inventory"); the
    // transfer cascade re-initialises if they later cross into one.
    const targetStash = s.stashes.find((st) => st.id === payload.stashId);
    const intoInventory =
      targetStash !== undefined &&
      targetStash.scope === 'character' &&
      targetStash.isCarried === true;
    const initialCharges: number | null =
      intoInventory && definition.charges !== undefined ? definition.charges.max : null;
    const newRow: ItemInstance = {
      id: resolvedItemId,
      definitionId: payload.definitionId,
      ownerType: 'stash',
      ownerId: payload.stashId,
      containerInstanceId: null,
      quantity: payload.quantity,
      equipped: false,
      attuned: false,
      identified: true,
      currentCharges: initialCharges,
    };
    if (effectiveNotes !== undefined) newRow.notes = effectiveNotes;
    nextItems = [...s.items, newRow];
  }

  // R1.4 — hard-mode threshold check on the post-write items. Guard
  // short-circuits when the destination isn't a character's Inventory
  // OR the character has `enforceEncumbrance: false` / `rule === 'off'`.
  checkHardMode('acquire', s, nextItems, payload.stashId);

  return {
    state: { ...s, items: nextItems },
    logEntries: [
      {
        type: 'acquire',
        payload: {
          stashId: payload.stashId,
          itemInstanceId: resolvedItemId,
          definitionId: payload.definitionId,
          quantity: payload.quantity,
          source: payload.source,
        },
      },
    ],
  };
}

/**
 * R1.5 Approach B helper — derive the next synthesized `notes` value
 * for a container `acquire` in `stashId`. Scans existing instances of
 * `definitionId` in the same stash for `#N` tags and returns `#<max+1>`
 * (or `#1` if none exist). Per-stash scope: acquiring the same backpack
 * definition in Inventory and Party Stash yields `#1` in each.
 *
 * Non-matching notes (user-set or imported) are ignored by the regex
 * so the counter doesn't trip on `"Volo's backpack"` or similar.
 */
function nextContainerNotes(
  items: ReadonlyArray<ItemInstance>,
  definitionId: string,
  stashId: string,
): string {
  const SYNTH_RE = /^#(\d+)$/;
  let max = 0;
  for (const row of items) {
    if (row.definitionId !== definitionId) continue;
    if (row.ownerId !== stashId) continue;
    if (row.notes === undefined) continue;
    const m = SYNTH_RE.exec(row.notes);
    if (m === null) continue;
    const n = Number.parseInt(m[1]!, 10);
    if (n > max) max = n;
  }
  return `#${String(max + 1)}`;
}

// -------------------------------------------------------------------- //
// consume (M2)
// -------------------------------------------------------------------- //

/**
 * Decrements `quantity` from `itemInstanceId`. If the new quantity hits
 * zero the row is removed entirely and the log entry records `removed: true`
 * so downstream readers (future history view, undo) don't need to replay
 * AppState to know the row is gone.
 *
 * Rejects unknown ids and over-consumption (no negative quantities).
 */
function consume(
  state: AppState,
  payload: Extract<Action, { type: 'consume' }>['payload'],
): ReducerResult {
  const s = requireState(state, 'consume');

  if (payload.quantity <= 0) {
    throw new Error('consume: quantity must be positive');
  }

  const row = s.items.find((i) => i.id === payload.itemInstanceId);
  if (row === undefined) {
    throw new Error(`consume: unknown itemInstanceId ${payload.itemInstanceId}`);
  }
  if (payload.quantity > row.quantity) {
    throw new Error(
      `consume: quantity ${String(payload.quantity)} exceeds row quantity ${String(row.quantity)}`,
    );
  }

  const remaining = row.quantity - payload.quantity;
  const removed = remaining === 0;
  const nextItems = removed
    ? s.items.filter((i) => i.id !== row.id)
    : s.items.map((i) => (i.id === row.id ? { ...i, quantity: remaining } : i));

  return {
    state: { ...s, items: nextItems },
    logEntries: [
      {
        type: 'consume',
        payload: {
          stashId: row.ownerId,
          itemInstanceId: row.id,
          quantity: payload.quantity,
          removed,
        },
      },
    ],
  };
}

// -------------------------------------------------------------------- //
// seed-catalog (M2)
// -------------------------------------------------------------------- //

/**
 * Bulk-upserts catalog entries from the bundled PHB seed and bumps
 * `state.seedVersion` to the supplied value. First-launch path adds every
 * entry; subsequent boots upsert by id and never touch homebrew rows
 * (the upsert key is the entry id, so homebrew ids — which don't share the
 * `phb-2024:` prefix — are invisible to this loop).
 *
 * Rejects when state is null because the catalog lives inside `AppState`;
 * the bootstrap (`src/store/seed.ts`) is responsible for sequencing this
 * AFTER `create-character` or AFTER hydration of an existing state.
 */
function seedCatalog(
  state: AppState,
  payload: Extract<Action, { type: 'seed-catalog' }>['payload'],
): ReducerResult {
  const s = requireState(state, 'seed-catalog');

  const byId = new Map(s.catalog.map((d) => [d.id, d]));
  const added: string[] = [];
  const updated: string[] = [];

  for (const entry of payload.entries) {
    if (byId.has(entry.id)) {
      updated.push(entry.id);
    } else {
      added.push(entry.id);
    }
    byId.set(entry.id, entry);
  }

  // Preserve insertion order for tests + DOM stability: existing rows in
  // their original positions (re-pointed at the upserted definition), then
  // any new rows appended in seed-file order.
  const nextCatalog: ItemDefinition[] = s.catalog.map((d) => byId.get(d.id) ?? d);
  for (const entry of payload.entries) {
    if (added.includes(entry.id)) nextCatalog.push(entry);
  }

  return {
    state: { ...s, catalog: nextCatalog, seedVersion: payload.seedVersion },
    logEntries: [
      {
        type: 'seed-catalog',
        payload: {
          seedVersion: payload.seedVersion,
          addedDefinitionIds: added,
          updatedDefinitionIds: updated,
        },
      },
    ],
  };
}

// -------------------------------------------------------------------- //
// edit-item-instance (M2.5)
// -------------------------------------------------------------------- //

/**
 * Per-instance editor for the two MVP-mutable fields on `ItemInstance`:
 * `customName` and `notes`. R1 (equip/attune) and R2 (identification +
 * charges) will widen this allowlist as the `itemInstance` schema relaxes
 * its `z.literal(...)` placeholders.
 *
 * Design (per M2.5 plan, user-locked):
 *   - Payload carries a partial `patch`. Reducer iterates a CLOSED
 *     allowlist (`customName`, `notes`) so unknown keys are dropped
 *     silently — TS already gates the patch shape; this is defense.
 *   - `changedFields` is derived from the actual diff against the row.
 *     Keys present in the patch but identical to the current value are
 *     NOT recorded.
 *   - **No-op edits throw**: if no field actually changed (or the patch
 *     was empty / all-allowlist-keys-absent), we reject. Matches the
 *     CLAUDE.md store invariant "every dispatch appends one log entry"
 *     — we don't paper over by logging `changedFields: []`.
 *   - Empty-string `notes` is a valid distinct value from `undefined`.
 *     The auto-stack key `(definitionId, notes ?? "")` already collapses
 *     `''` and `undefined`, so this is invisible to `acquire`; the raw
 *     row still records what the user typed.
 *   - **No auto-merge on edit-induced auto-stack collision** (M2.5
 *     decision #5). Editing notes such that `(definitionId, notes)`
 *     would collide with another row leaves the rows separate. The
 *     auto-stack invariant in M2 was scoped to `acquire`, not edits.
 *     Surfaced as an M5 follow-up.
 */
function editItemInstance(
  state: AppState,
  payload: Extract<Action, { type: 'edit-item-instance' }>['payload'],
): ReducerResult {
  const s = requireState(state, 'edit-item-instance');
  const row = s.items.find((i) => i.id === payload.itemInstanceId);
  if (row === undefined) {
    throw new Error(`edit-item-instance: unknown itemInstanceId ${payload.itemInstanceId}`);
  }

  // Closed allowlist of MVP-mutable fields. R1/R2 extend; widening here
  // is additive — no migration required.
  const allowed = ['customName', 'notes'] as const;
  const changedFields: ('customName' | 'notes')[] = [];
  const next: ItemInstance = { ...row };

  for (const key of allowed) {
    if (!(key in payload.patch)) continue;
    const newVal = payload.patch[key];
    if (newVal !== row[key]) {
      changedFields.push(key);
      // Cast: we know the key is in `allowed`, and the patch value type
      // already matches `ItemInstance[key]` (TS enforced via Action union).
      (next as Record<string, unknown>)[key] = newVal;
    }
  }

  if (changedFields.length === 0) {
    throw new Error('edit-item-instance: no fields changed');
  }

  const nextItems = s.items.map((i) => (i.id === row.id ? next : i));

  return {
    state: { ...s, items: nextItems },
    logEntries: [
      {
        type: 'edit-item-instance',
        payload: {
          itemInstanceId: row.id,
          changedFields,
        },
      },
    ],
  };
}

/**
 * A short uppercase invite code, 30 bits of entropy from `crypto.getRandomValues`.
 * OUTLINE §3.1 forward-compat with R4 multi-member join flow; display-only in MVP.
 *
 * Exported so web (`apps/web/src/store/index.ts`) and server
 * (`apps/server/src/sync/routes.ts`) can both use it as their
 * `ReducerContext.newInviteCode` — a single source of truth for the
 * keyspace prevents drift. NOT called from inside the reducer body
 * (which goes through `ctx.newInviteCode()` instead).
 */
export function generateInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = '';
  for (const b of bytes) code += alphabet[b % alphabet.length];
  return `INV-${code}`;
}

// -------------------------------------------------------------------- //
// create-stash / rename-stash / delete-stash (M3)
// -------------------------------------------------------------------- //

/**
 * Create a Storage stash (character-scope, non-carried) owned by
 * `ownerCharacterId`. Atomically adds the `Stash` row + its zeroed
 * `CurrencyHolding`. Inventory / Party Stash / Recovered Loot are
 * NOT dispatched here — `create-character` auto-provisions all three.
 *
 * Validate-then-apply: rejects unknown owner; rejects empty/whitespace-
 * only names. Trims leading/trailing whitespace before persisting so the
 * stored name is the canonical form (matches the `editItemInstance`
 * decision to preserve user-typed values otherwise).
 */
function createStash(
  state: AppState,
  payload: Extract<Action, { type: 'create-stash' }>['payload'],
  ctx: ReducerContext,
): ReducerResult {
  const s = requireState(state, 'create-stash');

  if (!isValidUuidV7(payload.newStashId)) {
    throw new Error('create-stash: newStashId must be a valid UUID v7');
  }
  if (!isValidUuidV7(payload.newCurrencyHoldingId)) {
    throw new Error('create-stash: newCurrencyHoldingId must be a valid UUID v7');
  }

  const name = payload.name.trim();
  if (name.length === 0) {
    throw new Error('create-stash: name is empty');
  }
  const owner = s.characters.find((c) => c.id === payload.ownerCharacterId);
  if (owner === undefined) {
    throw new Error(`create-stash: unknown ownerCharacterId ${payload.ownerCharacterId}`);
  }

  const stashId = payload.newStashId;
  const newStash: Stash = {
    id: stashId,
    scope: 'character',
    name,
    ownerCharacterId: owner.id,
    partyId: null,
    isCarried: false,
    createdAt: ctx.now(),
  };
  const newCurrency: CurrencyHolding = {
    id: payload.newCurrencyHoldingId,
    stashId,
    cp: 0,
    sp: 0,
    ep: 0,
    gp: 0,
    pp: 0,
  };

  return {
    state: {
      ...s,
      stashes: [...s.stashes, newStash],
      currencies: [...s.currencies, newCurrency],
    },
    logEntries: [
      {
        type: 'create-stash',
        payload: {
          stashId,
          scope: 'character',
          name,
          ownerCharacterId: owner.id,
        },
      },
    ],
  };
}

function renameStash(
  state: AppState,
  payload: Extract<Action, { type: 'rename-stash' }>['payload'],
): ReducerResult {
  const s = requireState(state, 'rename-stash');

  const stash = s.stashes.find((st) => st.id === payload.stashId);
  if (stash === undefined) {
    throw new Error(`rename-stash: unknown stashId ${payload.stashId}`);
  }

  // M3 lock: only Storage stashes (character-scope + non-carried) are
  // renamable. The three auto-provisioned names — Inventory, Party Stash,
  // Recovered Loot — are MVP §7 fixtures.
  if (stash.scope === 'character' && stash.isCarried) {
    throw new Error('rename-stash: cannot rename Inventory');
  }
  if (stash.scope === 'party') {
    throw new Error('rename-stash: cannot rename Party Stash');
  }
  if (stash.scope === 'recovered-loot') {
    throw new Error('rename-stash: cannot rename Recovered Loot');
  }

  const newName = payload.newName.trim();
  if (newName.length === 0) {
    throw new Error('rename-stash: newName is empty');
  }
  if (newName === stash.name) {
    // Matches the M2.5 invariant: every dispatch appends one log entry —
    // a no-op rename can't satisfy that, so we reject.
    throw new Error('rename-stash: name unchanged');
  }

  const oldName = stash.name;
  const next: Stash = { ...stash, name: newName };

  return {
    state: {
      ...s,
      stashes: s.stashes.map((st) => (st.id === stash.id ? next : st)),
    },
    logEntries: [
      {
        type: 'rename-stash',
        payload: { stashId: stash.id, oldName, newName },
      },
    ],
  };
}

/**
 * Delete a Storage stash, cascading the doomed stash's contents into
 * Recovered Loot. Order of operations (one atomic reducer call):
 *
 *   1. Move each item row to Recovered Loot (`ownerId` updated; same
 *      `itemInstanceId`, same `quantity`; no auto-stack collapse —
 *      M3 keeps transfer-into-Recovered-Loot rows separate. M5
 *      will decide the merge UX for user-initiated transfers).
 *   2. If the doomed stash held non-zero currency, roll it into
 *      Recovered Loot's `CurrencyHolding` (additive). In M3 this is
 *      dormant since currency editing arrives in M4; the path is
 *      tested via direct state injection so M4 can ship without
 *      revisiting this reducer.
 *   3. Remove the stash row and its `CurrencyHolding`.
 *   4. Emit the log cascade in order:
 *      - one `transfer` entry per item moved,
 *      - one `currency-change` entry with `reason: 'stash-deleted'`
 *        IFF the stash held non-zero currency,
 *      - one terminal `delete-stash` entry with the snapshot
 *        `{ name, itemCount, currencyTotalCp }`.
 *
 * Refuses to delete Inventory (`isCarried=true`), Party Stash
 * (`scope='party'`), and Recovered Loot (`scope='recovered-loot'`).
 *
 * `currencyTotalCp` is computed via `@app/rules` currency.toCopper —
 * single source of truth for the CP-equivalent ladder shared with the
 * M4 currency editor.
 */
function deleteStash(
  state: AppState,
  payload: Extract<Action, { type: 'delete-stash' }>['payload'],
): ReducerResult {
  const s = requireState(state, 'delete-stash');

  const stash = s.stashes.find((st) => st.id === payload.stashId);
  if (stash === undefined) {
    throw new Error(`delete-stash: unknown stashId ${payload.stashId}`);
  }
  if (stash.scope === 'character' && stash.isCarried) {
    throw new Error('delete-stash: cannot delete Inventory');
  }
  if (stash.scope === 'party') {
    throw new Error('delete-stash: cannot delete Party Stash');
  }
  if (stash.scope === 'recovered-loot') {
    throw new Error('delete-stash: cannot delete Recovered Loot');
  }

  const recoveredLootId = s.party.recoveredLootStashId;
  // RH2.2 — stable sort by id so the emitted `transfer` log slices
  // (line ~1233 below) fan out in a deterministic order across clients.
  // The `itemCount` reduce is order-independent; safe to share the sort.
  const itemsInStash = s.items
    .filter((i) => i.ownerId === stash.id)
    .sort((a, b) => a.id.localeCompare(b.id));
  const stashCurrency = s.currencies.find((c) => c.stashId === stash.id);
  if (stashCurrency === undefined) {
    throw new Error(`delete-stash: invariant violation — no CurrencyHolding for ${stash.id}`);
  }
  const recoveredHolding = s.currencies.find((c) => c.stashId === recoveredLootId);
  if (recoveredHolding === undefined) {
    throw new Error('delete-stash: invariant violation — no CurrencyHolding for Recovered Loot');
  }

  // 1. Re-point each item's ownerId to Recovered Loot (no auto-stack).
  const nextItems = s.items.map((i) =>
    i.ownerId === stash.id ? { ...i, ownerId: recoveredLootId } : i,
  );

  // 2. Roll currency into Recovered Loot (only when non-zero).
  const isNonZero =
    stashCurrency.cp !== 0 ||
    stashCurrency.sp !== 0 ||
    stashCurrency.ep !== 0 ||
    stashCurrency.gp !== 0 ||
    stashCurrency.pp !== 0;
  const nextRecovered: CurrencyHolding = isNonZero
    ? {
        ...recoveredHolding,
        cp: recoveredHolding.cp + stashCurrency.cp,
        sp: recoveredHolding.sp + stashCurrency.sp,
        ep: recoveredHolding.ep + stashCurrency.ep,
        gp: recoveredHolding.gp + stashCurrency.gp,
        pp: recoveredHolding.pp + stashCurrency.pp,
      }
    : recoveredHolding;

  // 3. Remove the stash row + its CurrencyHolding; rewrite Recovered
  //    Loot's holding when currency rolled in.
  const nextStashes = s.stashes.filter((st) => st.id !== stash.id);
  const nextCurrencies = s.currencies
    .filter((c) => c.stashId !== stash.id)
    .map((c) => (c.stashId === recoveredLootId ? nextRecovered : c));

  // 4. Build the log cascade.
  const transferEntries: LogEntrySlice[] = itemsInStash.map((item) => ({
    type: 'transfer',
    payload: {
      itemInstanceId: item.id,
      quantity: item.quantity,
      fromStashId: stash.id,
      toStashId: recoveredLootId,
    },
  }));

  const currencyEntries: LogEntrySlice[] = isNonZero
    ? [
        {
          type: 'currency-change',
          payload: {
            stashId: recoveredLootId,
            delta: {
              cp: stashCurrency.cp,
              sp: stashCurrency.sp,
              ep: stashCurrency.ep,
              gp: stashCurrency.gp,
              pp: stashCurrency.pp,
            },
            reason: 'stash-deleted',
          },
        },
      ]
    : [];

  const itemCount = itemsInStash.reduce((sum, i) => sum + i.quantity, 0);
  // CP-equivalent snapshot of the deleted stash's currency at delete time
  // (always 0 in M3; M4 lets users actually fund stashes via the inline
  // currency editor, after which this path becomes load-bearing).
  const currencyTotalCp = currency.toCopper(stashCurrency);

  return {
    state: {
      ...s,
      stashes: nextStashes,
      currencies: nextCurrencies,
      items: nextItems,
    },
    logEntries: [
      ...transferEntries,
      ...currencyEntries,
      {
        type: 'delete-stash',
        payload: {
          stashId: stash.id,
          name: stash.name,
          itemCount,
          currencyTotalCp,
          // Capture the owning character so post-delete history views
          // can render the character-prefixed label "{character.name} —
          // {stash.name} (deleted)". M3 only deletes character-scope
          // stashes (party / recovered-loot are protected), so this is
          // always present in practice — but the schema keeps it
          // optional to match the protected-stash branch types and
          // allow back-compat with pre-amendment entries.
          ownerCharacterId: stash.ownerCharacterId,
        },
      },
    ],
  };
}

// -------------------------------------------------------------------- //
// currency-change (M4)
// -------------------------------------------------------------------- //

/**
 * Signed denomination delta on a single stash's CurrencyHolding. M4's
 * inline `<CurrencyRow>` editor dispatches this for every +/− click
 * (reason: 'deposit' | 'withdraw') and the Convert modal dispatches one
 * with a mixed two-denomination delta (reason: 'convert'). The reducer
 * is reason-agnostic: it validates the target, refuses no-op and
 * negative-result deltas, applies the change, and emits one log entry
 * with the dispatch reason preserved.
 *
 * Note: the synthetic delete-cascade currency entry (reason:
 * 'stash-deleted', M3) is emitted directly from `deleteStash` against
 * Recovered Loot, NOT routed through this reducer case — the cascade
 * shares the same pre-mutation snapshot with the surrounding transfer
 * entries.
 */
function currencyChange(
  state: AppState,
  payload: Extract<Action, { type: 'currency-change' }>['payload'],
): ReducerResult {
  const s = requireState(state, 'currency-change');
  const stash = s.stashes.find((st) => st.id === payload.stashId);
  if (stash === undefined) {
    throw new Error(`currency-change: unknown stashId ${payload.stashId}`);
  }
  const holding = s.currencies.find((c) => c.stashId === payload.stashId);
  if (holding === undefined) {
    throw new Error(
      `currency-change: invariant violation — no CurrencyHolding for ${payload.stashId}`,
    );
  }

  const { delta } = payload;
  const allZero =
    delta.cp === 0 && delta.sp === 0 && delta.ep === 0 && delta.gp === 0 && delta.pp === 0;
  if (allZero) throw new Error('currency-change: no-op delta');

  const nextHolding: CurrencyHolding = {
    ...holding,
    cp: holding.cp + delta.cp,
    sp: holding.sp + delta.sp,
    ep: holding.ep + delta.ep,
    gp: holding.gp + delta.gp,
    pp: holding.pp + delta.pp,
  };
  if (
    nextHolding.cp < 0 ||
    nextHolding.sp < 0 ||
    nextHolding.ep < 0 ||
    nextHolding.gp < 0 ||
    nextHolding.pp < 0
  ) {
    throw new Error(`currency-change: would push a denomination negative on ${payload.stashId}`);
  }

  return {
    state: {
      ...s,
      currencies: s.currencies.map((c) => (c.stashId === payload.stashId ? nextHolding : c)),
    },
    logEntries: [
      {
        type: 'currency-change',
        payload: { stashId: payload.stashId, delta, reason: payload.reason },
      },
    ],
  };
}

// -------------------------------------------------------------------- //
// transfer (M5)
// -------------------------------------------------------------------- //

/**
 * Move `quantity` units of `itemInstanceId` from its current stash to
 * `toStashId`. M5 promotes `transfer` from M3's internal delete-cascade
 * emitter to a first-class user-initiated action.
 *
 * Behavior (per the M5 plan, user-decided):
 *   1. Same-stash transfers are rejected (no-op; UI also guards).
 *   2. Quantity is validated via `inventory.validateTransfer`
 *      (`1 \u2264 qty \u2264 source.quantity`).
 *   3. Auto-stack on arrival per `(definitionId, notes ?? "")` —
 *      matches `acquire`. When the destination already has a matching
 *      row, the surviving row is the destination's; the source row's
 *      id is destroyed on full-move auto-stack (Item Detail
 *      `<Navigate to="/" replace />`s on unknown ids — documented as
 *      expected in the M5 plan).
 *   4. When no auto-stack target exists:
 *      - Full move (qty === source.quantity): re-point source.ownerId,
 *        id preserved.
 *      - Partial move (qty < source.quantity): decrement source, create
 *        a fresh row in destination with the moved qty.
 *
 * Emits one `transfer` log entry whose `itemInstanceId` is the surviving
 * destination row id so the per-item history filter resolves cleanly.
 */
function transfer(
  state: AppState,
  payload: Extract<Action, { type: 'transfer' }>['payload'],
  _ctx: ReducerContext,
): ReducerResult {
  const s = requireState(state, 'transfer');

  if (!isValidUuidV7(payload.newItemInstanceId)) {
    throw new Error('transfer: newItemInstanceId must be a valid UUID v7');
  }

  const source = s.items.find((i) => i.id === payload.itemInstanceId);
  if (source === undefined) {
    throw new Error(`transfer: unknown itemInstanceId ${payload.itemInstanceId}`);
  }
  const toStash = s.stashes.find((st) => st.id === payload.toStashId);
  if (toStash === undefined) {
    throw new Error(`transfer: unknown toStashId ${payload.toStashId}`);
  }

  // R1.5 — `toContainerInstanceId` adds pack / take-out / no-op semantics.
  //   - `undefined`: parent unchanged (every pre-R1.5 dispatch).
  //   - `null`: take-out — clear `containerInstanceId` on the moved row.
  //   - `string`: pack-into — set `containerInstanceId` to the supplied id.
  // The same-stash transfer rule (was unconditional reject) now allows
  // same-stash dispatches when the caller is explicitly changing the
  // container parent — that's the entire R1.5 surface. A same-stash
  // dispatch WITHOUT an explicit `toContainerInstanceId` change is still
  // a no-op and reject.
  const changingContainerParent =
    payload.toContainerInstanceId !== undefined &&
    payload.toContainerInstanceId !== source.containerInstanceId;
  if (source.ownerId === payload.toStashId && !changingContainerParent) {
    throw new Error('transfer: same stash (no-op)');
  }

  // R1.5 guards on the destination container, if any:
  if (payload.toContainerInstanceId !== undefined && payload.toContainerInstanceId !== null) {
    // Self-reference: a row can't contain itself.
    if (payload.toContainerInstanceId === payload.itemInstanceId) {
      throw new Error('transfer: cannot pack a row into itself (self-reference)');
    }
    const parent = s.items.find((i) => i.id === payload.toContainerInstanceId);
    if (parent === undefined) {
      throw new Error(`transfer: unknown toContainerInstanceId ${payload.toContainerInstanceId}`);
    }
    // One-level-deep (OUTLINE §3.6): the destination container itself
    // must be top-level (no parent), otherwise this pack would create
    // two-level nesting.
    if (parent.containerInstanceId !== null) {
      throw new Error('transfer: destination container is already nested (one level deep only)');
    }
    // Same-stash (v1): destination container must live in the same stash
    // as the moved row's destination. Cross-stash pack is a 2-step (move
    // then pack) per the R1.5 scope.
    if (parent.ownerId !== payload.toStashId) {
      throw new Error('transfer: destination container must live in the same stash as toStashId');
    }
  }

  inventory.validateTransfer(source, payload.quantity);

  const fromStashId = source.ownerId;
  const isFullMove = payload.quantity === source.quantity;
  // Auto-stack on arrival is gated on "actually changing stash" — a same-
  // stash pack/take-out dispatch must NOT auto-stack onto a matching row
  // (it'd merge the packed/unpacked row into a sibling and lose the
  // container parent change). The R1.5 Approach B synthesized notes
  // generally prevent collisions already, but the guard is defensive.
  const target =
    source.ownerId === payload.toStashId
      ? undefined
      : inventory.findAutoStackTarget(
          s.items,
          payload.toStashId,
          source.definitionId,
          source.notes,
        );

  // R1.3 — leave-Inventory cascade (OUTLINE §3.4): when the source row
  // lives in a character's Inventory stash and the destination is
  // anything else, clear `equipped` / `attuned` atomically. The cascade
  // is a no-op when the source row was already at the MVP-placeholder
  // values (un-equipped, un-attuned) — in that case we don't emit the
  // paired `edit-item-instance` entry because nothing actually changed.
  //
  // R2.3 amendment: `currentCharges` is NO LONGER cleared on leave-
  // Inventory. The R2.2 design (clear-on-leave + re-init-on-enter) had
  // an exploit — a spent wand could be moved to Storage and back to
  // refill its charges for free. R2.3 preserves charge state across
  // moves: the row keeps its `currentCharges` regardless of location.
  // The OUTLINE §3.4 "only meaningful in Inventory" invariant becomes
  // a display rule (UI hides the indicator outside Inventory) rather
  // than a storage rule. See R2.3 retro decisions.
  const fromStash = s.stashes.find((st) => st.id === fromStashId);
  const leavingInventory =
    fromStash !== undefined &&
    fromStash.scope === 'character' &&
    fromStash.isCarried === true &&
    payload.toStashId !== fromStashId;
  const clearedFields: ('equipped' | 'attuned')[] = [];
  if (leavingInventory) {
    if (source.equipped) clearedFields.push('equipped');
    if (source.attuned) clearedFields.push('attuned');
  }
  // Cross-stash container-orphan check (OUTLINE §3.4 invariant: parent
  // and contents live in the same stash). When the moved row is itself
  // a CHILD (`containerInstanceId !== null`) and we're changing stash,
  // AND the parent isn't following along (the parent row's `ownerId`
  // stays put because we're moving the child, not the parent), the
  // moved row's `containerInstanceId` would dangle — pointing at a row
  // in a different stash. Drop the reference atomically so the UI's
  // "is this row contained?" check stays accurate post-move.
  //
  // Skips when an explicit `toContainerInstanceId` is set on the payload
  // (the user is re-parenting in the destination — `applyMovedRowMutations`
  // already handles that case via the R1.5 branch below).
  const droppingParent =
    payload.toContainerInstanceId === undefined &&
    source.containerInstanceId !== null &&
    payload.toStashId !== fromStashId;

  // R2.2 — entering-Inventory init: when the destination IS a character's
  // Inventory stash AND the moved row's definition has a `charges` block
  // AND the row's `currentCharges` is currently `null` (it's never been
  // initialised — e.g. a wand acquired directly into Storage), seed
  // `currentCharges` to `def.charges.max`. R2.3 amendment: only inits
  // when the row's current value is `null` — non-null values are
  // preserved, fixing the R2.2 round-trip-recharge exploit.
  const enteringInventory =
    toStash.scope === 'character' &&
    toStash.isCarried === true &&
    fromStashId !== payload.toStashId;
  const enteringDef = enteringInventory
    ? s.catalog.find((d) => d.id === source.definitionId)
    : undefined;
  const enteringChargesMax =
    enteringDef?.charges !== undefined && source.currentCharges === null
      ? enteringDef.charges.max
      : undefined;

  // Helper: apply the cascade clear-fields + R1.5 parent change + cross-
  // stash orphan-drop to a row (used in every branch below where we
  // either move or split the source row). Container-parent re-assignment
  // is part of the same atomic write so the §3.4 cascade and R1.5
  // pack/take-out compose cleanly.
  function applyMovedRowMutations(row: ItemInstance): ItemInstance {
    let next = row;
    if (clearedFields.length > 0) {
      next = {
        ...next,
        equipped: false,
        attuned: false,
      };
    }
    // R2.2 enter-Inventory init (R2.3-amended). Only seeds charges when
    // the row's currentCharges is currently null — non-null values are
    // preserved across moves. A spent wand transferred to Storage and
    // back stays spent.
    if (enteringChargesMax !== undefined) {
      next = { ...next, currentCharges: enteringChargesMax };
    }
    if (payload.toContainerInstanceId !== undefined) {
      next = { ...next, containerInstanceId: payload.toContainerInstanceId };
    } else if (droppingParent) {
      next = { ...next, containerInstanceId: null };
    }
    return next === row ? row : next;
  }

  let nextItems: ItemInstance[];
  let survivingId: string;

  // R1.3 — container-contents-follow cascade (OUTLINE §3.4): when the
  // moved row's `id` is referenced as `containerInstanceId` by other
  // rows in the SAME source stash, those child rows' `ownerId` updates
  // to the destination stash atomically. Children's `containerInstanceId`
  // is preserved so the (parent, contents) hierarchy survives the move.
  // The cascade is implicit in the state diff — no per-child log entry
  // is emitted (cf. M3's delete-stash cascade which IS per-child).
  //
  // Only meaningful on a full move (`isFullMove === true`); a partial
  // move would split the container into two rows, which the OUTLINE
  // §3.6 one-level-deep rule has nothing to say about and the M5 split
  // path already rejects via `validateSplit` rules. For R1.3 we follow
  // children only on full moves.
  //
  // Same-stash transfers (R1.5 pack/take-out) never need this cascade
  // — children stay in the same stash regardless — so we short-circuit
  // when the destination matches the source stash.
  const childRows =
    isFullMove && target === undefined && source.ownerId !== payload.toStashId
      ? s.items.filter((i) => i.containerInstanceId === source.id && i.ownerId === fromStashId)
      : [];

  if (target !== undefined) {
    // Auto-stack onto target. Target row absorbs the moved quantity;
    // source row either disappears (full move) or stays decremented.
    // The cascade's flag clears apply to the TARGET because that's the
    // surviving row carrying the moved quantity. (The source row, if it
    // remains, stays in Inventory — its flags don't change.)
    survivingId = target.id;
    if (isFullMove) {
      nextItems = s.items
        .filter((i) => i.id !== source.id)
        .map((i) =>
          i.id === target.id
            ? applyMovedRowMutations({ ...i, quantity: i.quantity + payload.quantity })
            : i,
        );
    } else {
      nextItems = s.items.map((i) => {
        if (i.id === source.id) return { ...i, quantity: i.quantity - payload.quantity };
        if (i.id === target.id)
          return applyMovedRowMutations({ ...i, quantity: i.quantity + payload.quantity });
        return i;
      });
    }
  } else if (isFullMove) {
    // Re-point source to the new stash; id preserved. Cascade applies
    // directly to the moved row. Plus R1.3: any child rows in the
    // source stash whose `containerInstanceId === source.id` follow the
    // parent atomically (their `containerInstanceId` stays unchanged;
    // only their `ownerId` re-points to the destination).
    survivingId = source.id;
    const childIds = new Set(childRows.map((c) => c.id));
    nextItems = s.items.map((i) => {
      if (i.id === source.id) return applyMovedRowMutations({ ...i, ownerId: payload.toStashId });
      if (childIds.has(i.id)) return { ...i, ownerId: payload.toStashId };
      return i;
    });
  } else {
    // Partial move with no auto-stack target: clone source into a fresh
    // row in the destination, decrement source. The cascade applies to
    // the NEW row (it's the one that left Inventory). Source row stays
    // in Inventory — flags untouched.
    const newId = payload.newItemInstanceId;
    survivingId = newId;
    const newRow: ItemInstance = applyMovedRowMutations({
      ...source,
      id: newId,
      ownerId: payload.toStashId,
      quantity: payload.quantity,
    });
    nextItems = [
      ...s.items.map((i) =>
        i.id === source.id ? { ...i, quantity: i.quantity - payload.quantity } : i,
      ),
      newRow,
    ];
  }

  const transferPayload: {
    itemInstanceId: string;
    quantity: number;
    fromStashId: string;
    toStashId: string;
    toContainerInstanceId?: string | null;
  } = {
    itemInstanceId: survivingId,
    quantity: payload.quantity,
    fromStashId,
    toStashId: payload.toStashId,
  };
  if (payload.toContainerInstanceId !== undefined) {
    transferPayload.toContainerInstanceId = payload.toContainerInstanceId;
  } else if (droppingParent) {
    // Surface the implicit orphan-drop in the audit trail so a log
    // reader can explain why a row's `containerInstanceId` flipped to
    // null on a cross-stash move without an explicit take-out dispatch.
    transferPayload.toContainerInstanceId = null;
  }
  const logEntries: LogEntrySlice[] = [
    {
      type: 'transfer',
      payload: transferPayload,
    },
  ];
  // Paired `edit-item-instance` entry per OUTLINE §3.4: only emitted
  // when the cascade actually changed something. Same `actorUserId` /
  // `partyId` / `timestamp` because both entries resolve off the same
  // pre-mutation snapshot in `index.ts` (M3 cascade contract).
  if (clearedFields.length > 0) {
    logEntries.push({
      type: 'edit-item-instance',
      payload: {
        itemInstanceId: survivingId,
        changedFields: clearedFields,
      },
    });
  }

  // R1.4 — hard-mode threshold check on the destination side. Composes
  // with the §3.4 cascade above: `nextItems` already has flags cleared,
  // so the guard sees the true post-write Inventory weight. The
  // leave-Inventory direction always lowers source weight; only the
  // entering-Inventory case can trip the guard.
  checkHardMode('transfer', s, nextItems, payload.toStashId);

  return {
    state: { ...s, items: nextItems },
    logEntries,
  };
}

// -------------------------------------------------------------------- //
// split (M5)
// -------------------------------------------------------------------- //

/**
 * Break one stack into two rows in the same stash. The new row inherits
 * `notes` and `customName` so the user can edit them via Item Detail
 * (M2.5) afterwards — splitting is the way to detach a "different"
 * sub-stack from a homogeneous row.
 *
 * Strict bounds (per `inventory.validateSplit`):
 *   - `1 \u2264 quantity < source.quantity`
 *   - A split that empties the source is a transfer, not a split.
 *   - A singleton row (quantity 1) cannot be split.
 *
 * Emits one `split` log entry carrying both `sourceInstanceId` and
 * `newInstanceId` so the per-item history filter surfaces the entry
 * on BOTH rows' Item Detail screens.
 */
function split(
  state: AppState,
  payload: Extract<Action, { type: 'split' }>['payload'],
  _ctx: ReducerContext,
): ReducerResult {
  const s = requireState(state, 'split');

  if (!isValidUuidV7(payload.newItemInstanceId)) {
    throw new Error('split: newItemInstanceId must be a valid UUID v7');
  }

  const source = s.items.find((i) => i.id === payload.itemInstanceId);
  if (source === undefined) {
    throw new Error(`split: unknown itemInstanceId ${payload.itemInstanceId}`);
  }
  inventory.validateSplit(source, payload.quantity);

  const newId = payload.newItemInstanceId;
  // Spread source to inherit notes / customName / conditionOverrides;
  // overwrite id + quantity.
  const newRow: ItemInstance = {
    ...source,
    id: newId,
    quantity: payload.quantity,
  };
  const nextItems: ItemInstance[] = [
    ...s.items.map((i) =>
      i.id === source.id ? { ...i, quantity: i.quantity - payload.quantity } : i,
    ),
    newRow,
  ];

  return {
    state: { ...s, items: nextItems },
    logEntries: [
      {
        type: 'split',
        payload: {
          sourceInstanceId: source.id,
          newInstanceId: newId,
          quantity: payload.quantity,
          stashId: source.ownerId,
        },
      },
    ],
  };
}

// -------------------------------------------------------------------- //
// currency-transfer (M5.5)
// -------------------------------------------------------------------- //

/**
 * Atomic stash-to-stash currency move (OUTLINE §4 `currency-transfer`).
 * Replaces a paired debit/credit `currency-change` dispatch — readers of
 * the log see a single entry with both endpoints + the moved delta.
 *
 * MVP (party-of-one, `bankerUserId === null`): any of the user's four
 * stashes is a valid source / target. Same-stash and all-zero deltas
 * throw. Negative-result is caught by `currency.subtract` (which throws
 * if any denomination would go below zero). R4 widens the actor
 * model — adds DM cross-character + Banker-from-pool variants.
 *
 * `delta` semantics: positive amounts being moved. Negative inputs are
 * rejected up front (the schema allows signed values for the existing
 * `currency-change` reason='convert' shape, but `currency-transfer`'s
 * direction is encoded by `fromStashId` / `toStashId` — negative
 * deltas would invert that and confuse log readers).
 */
function currencyTransfer(
  state: AppState,
  payload: Extract<Action, { type: 'currency-transfer' }>['payload'],
): ReducerResult {
  const s = requireState(state, 'currency-transfer');

  if (payload.fromStashId === payload.toStashId) {
    throw new Error('currency-transfer: same stash (no-op)');
  }

  const { delta } = payload;
  const allZero =
    delta.cp === 0 && delta.sp === 0 && delta.ep === 0 && delta.gp === 0 && delta.pp === 0;
  if (allZero) throw new Error('currency-transfer: no-op delta');

  // Negative inputs rejected — direction lives on `from/to`, not on the
  // sign of the delta.
  if (delta.cp < 0 || delta.sp < 0 || delta.ep < 0 || delta.gp < 0 || delta.pp < 0) {
    throw new Error(
      'currency-transfer: delta values must be non-negative (use the from/to ids to encode direction)',
    );
  }

  const fromStash = s.stashes.find((st) => st.id === payload.fromStashId);
  if (fromStash === undefined) {
    throw new Error(`currency-transfer: unknown fromStashId ${payload.fromStashId}`);
  }
  const toStash = s.stashes.find((st) => st.id === payload.toStashId);
  if (toStash === undefined) {
    throw new Error(`currency-transfer: unknown toStashId ${payload.toStashId}`);
  }

  const sourceHolding = s.currencies.find((c) => c.stashId === payload.fromStashId);
  if (sourceHolding === undefined) {
    throw new Error(
      `currency-transfer: invariant violation — no CurrencyHolding for ${payload.fromStashId}`,
    );
  }
  const destHolding = s.currencies.find((c) => c.stashId === payload.toStashId);
  if (destHolding === undefined) {
    throw new Error(
      `currency-transfer: invariant violation — no CurrencyHolding for ${payload.toStashId}`,
    );
  }

  // `currency.subtract` throws when any denomination would go negative.
  // We let that error bubble — it's the "insufficient funds" boundary
  // the M5.5 plan describes.
  const nextSource: CurrencyHolding = {
    ...sourceHolding,
    ...currency.subtract(sourceHolding, delta),
  };
  const nextDest: CurrencyHolding = { ...destHolding, ...currency.add(destHolding, delta) };

  return {
    state: {
      ...s,
      currencies: s.currencies.map((c) => {
        if (c.stashId === payload.fromStashId) return nextSource;
        if (c.stashId === payload.toStashId) return nextDest;
        return c;
      }),
    },
    logEntries: [
      {
        type: 'currency-transfer',
        payload: {
          fromStashId: payload.fromStashId,
          toStashId: payload.toStashId,
          delta,
        },
      },
    ],
  };
}

// -------------------------------------------------------------------- //
// create-homebrew / edit-homebrew / delete-homebrew (M6)
// -------------------------------------------------------------------- //

/**
 * Editable fields on a homebrew `ItemDefinition` per the M6 plan. The
 * reducer accepts these on `create-homebrew` payload (with `name` and
 * `category` required) and on `edit-homebrew.patch` (all optional;
 * keys present in the patch are diffed against the current row).
 *
 * `id`, `source`, `partyId`, `createdBy`, `duplicatedFromId` are NOT
 * in this set — they're either reducer-stamped (id, source, partyId,
 * createdBy) or set once at creation only (duplicatedFromId).
 */
const HOMEBREW_EDITABLE_FIELDS = [
  'name',
  'category',
  'weight',
  'cost',
  'description',
  'tags',
] as const;
type HomebrewEditableField = (typeof HOMEBREW_EDITABLE_FIELDS)[number];

/**
 * Create a homebrew `ItemDefinition`. The reducer:
 *   - validates the name (trimmed, non-empty),
 *   - consumes `payload.newDefinitionId` (RH1.2 — client-minted UUID v7),
 *   - stamps `source: 'homebrew'`, `partyId`, `createdBy` from the
 *     post-bootstrap state,
 *   - preserves the optional `duplicatedFromId` lineage from the
 *     Catalog Browser's Duplicate flow.
 *
 * Per the M6 plan + OUTLINE §3.7, every homebrew row carries
 * `partyId = state.party.id` so future R4 multi-party visibility is a
 * pure filter against the existing schema field — no migration.
 */
function createHomebrew(
  state: AppState,
  payload: Extract<Action, { type: 'create-homebrew' }>['payload'],
  _ctx: ReducerContext,
): ReducerResult {
  const s = requireState(state, 'create-homebrew');

  if (!isValidUuidV7(payload.newDefinitionId)) {
    throw new Error('create-homebrew: newDefinitionId must be a valid UUID v7');
  }

  const name = payload.name.trim();
  if (name.length === 0) {
    throw new Error('create-homebrew: name is empty');
  }

  const definitionId = payload.newDefinitionId;
  const newDef: ItemDefinition = {
    id: definitionId,
    name,
    source: 'homebrew',
    category: payload.category,
    partyId: s.party.id,
    createdBy: s.user.id,
    ...(payload.weight !== undefined ? { weight: payload.weight } : {}),
    ...(payload.cost !== undefined ? { cost: payload.cost } : {}),
    ...(payload.description !== undefined ? { description: payload.description } : {}),
    ...(payload.tags !== undefined ? { tags: payload.tags } : {}),
    ...(payload.duplicatedFromId !== undefined
      ? { duplicatedFromId: payload.duplicatedFromId }
      : {}),
  };

  return {
    state: { ...s, catalog: [...s.catalog, newDef] },
    logEntries: [
      {
        type: 'create-homebrew',
        payload: { definitionId, name },
      },
    ],
  };
}

/**
 * Edit a homebrew `ItemDefinition` per the M6 plan. Mirrors
 * `edit-item-instance`:
 *   - validate the target exists and is homebrew (PHB rows are
 *     immutable per OUTLINE §3.7),
 *   - diff the patch against the current row over the
 *     `HOMEBREW_EDITABLE_FIELDS` allowlist,
 *   - reject no-op edits (`changedFields.length === 0`),
 *   - apply the diff and log only the changed field names.
 *
 * Patch values can be `undefined` to explicitly clear an optional
 * field (e.g. setting `cost: undefined` removes the cost entry — the
 * UI uses this when the user blanks the cost-amount input). The
 * diff considers `undefined` distinct from "key absent in patch".
 */
function editHomebrew(
  state: AppState,
  payload: Extract<Action, { type: 'edit-homebrew' }>['payload'],
): ReducerResult {
  const s = requireState(state, 'edit-homebrew');

  const row = s.catalog.find((d) => d.id === payload.definitionId);
  if (row === undefined) {
    throw new Error(`edit-homebrew: unknown definitionId ${payload.definitionId}`);
  }
  if (row.source !== 'homebrew') {
    throw new Error(
      `edit-homebrew: definition ${payload.definitionId} is not homebrew (source=${row.source}); PHB rows are immutable`,
    );
  }

  const changedFields: HomebrewEditableField[] = [];
  const next: ItemDefinition = { ...row };

  for (const key of HOMEBREW_EDITABLE_FIELDS) {
    if (!(key in payload.patch)) continue;
    // `JSON.stringify` round-trip detects nested-object changes on
    // `cost` (the only nested-shape field in the allowlist). For
    // primitive fields it degenerates to value equality.
    const newVal = payload.patch[key];
    const currentVal = row[key];
    const changed = JSON.stringify(newVal) !== JSON.stringify(currentVal);
    if (changed) {
      changedFields.push(key);
      if (newVal === undefined) {
        // Distinguish "explicitly clear optional field" from "key absent".
        // Build a record without the key.
        delete (next as Record<string, unknown>)[key];
      } else {
        (next as Record<string, unknown>)[key] = newVal;
      }
    }
  }

  if (changedFields.length === 0) {
    throw new Error('edit-homebrew: no fields changed');
  }

  return {
    state: {
      ...s,
      catalog: s.catalog.map((d) => (d.id === row.id ? next : d)),
    },
    logEntries: [
      {
        type: 'edit-homebrew',
        payload: {
          definitionId: row.id,
          changedFields,
        },
      },
    ],
  };
}

/**
 * Delete a homebrew `ItemDefinition` per the M6 plan. Delete policy is
 * **reject when referenced**: if any `ItemInstance.definitionId` points
 * at the definition, throw. The UI surfaces the reference count and
 * disables the delete button until the user manually removes the items.
 *
 * Rejects deletion of PHB rows for symmetry with `edit-homebrew` (the
 * PHB catalog is read-only per OUTLINE §3.7). The error message names
 * the count + the affected stashIds so the UI can render a friendlier
 * "X stashes hold this — remove items first" message.
 */
function deleteHomebrew(
  state: AppState,
  payload: Extract<Action, { type: 'delete-homebrew' }>['payload'],
): ReducerResult {
  const s = requireState(state, 'delete-homebrew');

  const row = s.catalog.find((d) => d.id === payload.definitionId);
  if (row === undefined) {
    throw new Error(`delete-homebrew: unknown definitionId ${payload.definitionId}`);
  }
  if (row.source !== 'homebrew') {
    throw new Error(
      `delete-homebrew: definition ${payload.definitionId} is not homebrew (source=${row.source}); PHB rows cannot be deleted`,
    );
  }

  const referencing = s.items.filter((i) => i.definitionId === payload.definitionId);
  if (referencing.length > 0) {
    // Count distinct stashes for the human-readable message; the UI
    // counts itself for the disabled-button tooltip, but the reducer
    // error stays informative for non-UI consumers / tests.
    const stashCount = new Set(referencing.map((i) => i.ownerId)).size;
    throw new Error(
      `delete-homebrew: definition is in use (${stashCount} stash${stashCount === 1 ? '' : 'es'} hold this); remove items first`,
    );
  }

  return {
    state: {
      ...s,
      catalog: s.catalog.filter((d) => d.id !== row.id),
    },
    logEntries: [
      {
        type: 'delete-homebrew',
        payload: { definitionId: row.id, name: row.name },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// rename-character / rename-party (M7)
//
// Both mirror `rename-stash` (M3) exactly: trim newName, reject empty,
// reject same-name (no-op), capture the pre-mutation `oldName`, emit a
// single log slice with `{ <id>, oldName, newName }`. Keeping the same
// shape across all three rename actions means the future history-view
// (R5) can render them with one component.
// ---------------------------------------------------------------------------

function renameCharacter(
  state: AppState,
  payload: Extract<Action, { type: 'rename-character' }>['payload'],
): ReducerResult {
  const s = requireState(state, 'rename-character');

  const character = s.characters.find((c) => c.id === payload.characterId);
  if (character === undefined) {
    throw new Error(`rename-character: unknown characterId ${payload.characterId}`);
  }

  const newName = payload.newName.trim();
  if (newName.length === 0) {
    throw new Error('rename-character: newName is empty');
  }
  if (newName === character.name) {
    // Matches the M3 rename-stash invariant: every dispatch appends one
    // log entry — a no-op rename can't satisfy that, so we reject.
    throw new Error('rename-character: name unchanged');
  }

  const oldName = character.name;
  return {
    state: {
      ...s,
      characters: s.characters.map((c) => (c.id === character.id ? { ...c, name: newName } : c)),
    },
    logEntries: [
      {
        type: 'rename-character',
        payload: { characterId: character.id, oldName, newName },
      },
    ],
  };
}

function renameParty(
  state: AppState,
  payload: Extract<Action, { type: 'rename-party' }>['payload'],
): ReducerResult {
  const s = requireState(state, 'rename-party');

  // MVP has exactly one party — the lookup is `state.party.id`. R4
  // (multi-party) keeps the same pattern; the reducer would still find
  // the party by id, just from a multi-row collection.
  if (payload.partyId !== s.party.id) {
    throw new Error(`rename-party: unknown partyId ${payload.partyId}`);
  }

  const newName = payload.newName.trim();
  if (newName.length === 0) {
    throw new Error('rename-party: newName is empty');
  }
  if (newName === s.party.name) {
    throw new Error('rename-party: name unchanged');
  }

  const oldName = s.party.name;
  return {
    state: {
      ...s,
      party: { ...s.party, name: newName },
    },
    logEntries: [
      {
        type: 'rename-party',
        payload: { partyId: s.party.id, oldName, newName },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// set-encumbrance (R1.1)
// ---------------------------------------------------------------------------

/**
 * Flip a Character's encumbrance configuration:
 *   - `rule`    — `off | phb | variant` — which math the CapacityBar
 *                 and (R1.2) the reducer cascade use. `phb` is the
 *                 standard PHB 2024 rule: at-or-under `STR × 15` is
 *                 fine; above is over-capacity. `variant` is the
 *                 sidebar rule on PHB p. 366 with bands at 5×/10×STR.
 *   - `enforce` — orthogonal boolean. R1.2 will reject `acquire` /
 *                 `transfer` that pushes weight over the rule's upper
 *                 band only when this flag is `true`. R1.1 stores the
 *                 flag; behavior is display-only.
 *
 * Guards: unknown characterId rejects; no-op rejects only when BOTH
 * fields match the current row (a caller dispatching the current rule
 * with a new enforce value is a real change).
 *
 * Per the CLAUDE.md "every mutation logs once" invariant, the single
 * log entry captures `{ oldRule, newRule, oldEnforce, newEnforce }`
 * so the history view can render either / both transitions.
 */
function setEncumbrance(
  state: AppState,
  payload: Extract<Action, { type: 'set-encumbrance' }>['payload'],
): ReducerResult {
  const s = requireState(state, 'set-encumbrance');

  const character = s.characters.find((c) => c.id === payload.characterId);
  if (character === undefined) {
    throw new Error(`set-encumbrance: unknown characterId ${payload.characterId}`);
  }
  const ruleUnchanged = payload.rule === character.encumbranceRule;
  const enforceUnchanged = payload.enforce === character.enforceEncumbrance;
  if (ruleUnchanged && enforceUnchanged) {
    throw new Error('set-encumbrance: nothing changed');
  }

  const oldRule = character.encumbranceRule;
  const oldEnforce = character.enforceEncumbrance;
  return {
    state: {
      ...s,
      characters: s.characters.map((c) =>
        c.id === character.id
          ? { ...c, encumbranceRule: payload.rule, enforceEncumbrance: payload.enforce }
          : c,
      ),
    },
    logEntries: [
      {
        type: 'set-encumbrance',
        payload: {
          characterId: character.id,
          oldRule,
          newRule: payload.rule,
          oldEnforce,
          newEnforce: payload.enforce,
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// equip / unequip / attune / unattune (R1.2)
// ---------------------------------------------------------------------------

/**
 * Resolves an `(itemInstanceId, characterId)` pair to the row + the
 * character + the character's Inventory stash. Throws with the action's
 * label if any of the following invariants fail:
 *   - unknown `itemInstanceId`
 *   - unknown `characterId`
 *   - the row's owning stash is not the character's Inventory (the
 *     `scope=character, isCarried=true` stash referenced by
 *     `Character.inventoryStashId`).
 *
 * Shared by `equip` / `unequip` / `attune` / `unattune` per OUTLINE §3.4
 * ("equip/attune are only meaningful on items in a character's Inventory
 * stash"). The Inventory-only guard is the schema's `ownerCharacterId`
 * check expressed at the reducer level.
 */
function resolveInventoryRow(
  s: NonNullable<AppState>,
  action: string,
  itemInstanceId: string,
  characterId: string,
): { row: ItemInstance; character: NonNullable<AppState>['characters'][number] } {
  const character = s.characters.find((c) => c.id === characterId);
  if (character === undefined) {
    throw new Error(`${action}: unknown characterId ${characterId}`);
  }
  const row = s.items.find((i) => i.id === itemInstanceId);
  if (row === undefined) {
    throw new Error(`${action}: unknown itemInstanceId ${itemInstanceId}`);
  }
  if (row.ownerId !== character.inventoryStashId) {
    throw new Error(
      `${action}: item ${itemInstanceId} is not in character ${characterId}'s Inventory stash`,
    );
  }
  return { row, character };
}

/**
 * Flips `ItemInstance.equipped` on an Inventory row. One reducer for
 * both `equip` (target = true) and `unequip` (target = false) — the
 * shape is identical apart from the discriminant. Rejects no-ops so the
 * "every dispatch logs exactly one entry" invariant holds.
 *
 * R1.2 does NOT enforce slot conflicts (2H + shield etc.) at the reducer
 * layer — `packages/rules/validation.ts` flags those as advisory issues
 * for the UI to render. R2.x revisits this when `ItemDefinition` gains
 * the `properties` shape and the reducer can read the conflict set.
 */
function equipOrUnequip(
  state: AppState,
  type: 'equip' | 'unequip',
  payload: Extract<Action, { type: 'equip' | 'unequip' }>['payload'],
): ReducerResult {
  const s = requireState(state, type);
  const { row } = resolveInventoryRow(s, type, payload.itemInstanceId, payload.characterId);

  const target = type === 'equip';
  if (row.equipped === target) {
    throw new Error(`${type}: row ${payload.itemInstanceId} already equipped=${target}`);
  }

  return {
    state: {
      ...s,
      items: s.items.map((i) => (i.id === row.id ? { ...i, equipped: target } : i)),
    },
    logEntries: [
      {
        type,
        payload: {
          itemInstanceId: row.id,
          characterId: payload.characterId,
          ...(payload.slot !== undefined ? { slot: payload.slot } : {}),
        },
      },
    ],
  };
}

/**
 * Flips `ItemInstance.attuned` on an Inventory row. Mirrors
 * `equipOrUnequip`; additionally enforces the attunement slot cap on
 * the `attune` direction via `attunement.hasFreeSlot`. The cap is read
 * from `Character.maxAttunement` (default 3, DM-overridable via
 * `edit-character` per OUTLINE §8.1).
 *
 * `unattune` always succeeds (modulo no-op) — un-attuning can only free
 * a slot, never exceed the cap.
 */
function attuneOrUnattune(
  state: AppState,
  type: 'attune' | 'unattune',
  payload: Extract<Action, { type: 'attune' | 'unattune' }>['payload'],
): ReducerResult {
  const s = requireState(state, type);
  const { row, character } = resolveInventoryRow(
    s,
    type,
    payload.itemInstanceId,
    payload.characterId,
  );

  const target = type === 'attune';
  if (row.attuned === target) {
    throw new Error(`${type}: row ${payload.itemInstanceId} already attuned=${target}`);
  }

  if (type === 'attune') {
    // R2.1 — magic-item gate per OUTLINE §3.8 / PHB 2024 attunement
    // rules: only items whose `ItemDefinition.requiresAttunement` is
    // `true` can be attuned. Mundane rows (Torch, Rope, Rations, etc.)
    // are reducer-rejected here even when the Inventory-only + slot-cap
    // checks would otherwise pass. Order: Inventory-only (via
    // `resolveInventoryRow` above) → no-op (above) → magic-item gate
    // (here) → slot-cap (below). `unattune` deliberately skips this
    // gate so MVP / R1.2-vintage state with `attuned: true` on a
    // mundane row can still be cleaned up.
    const def = s.catalog.find((d) => d.id === row.definitionId);
    if (def === undefined) {
      throw new Error(`attune: definition ${row.definitionId} not in catalog for row ${row.id}`);
    }
    if (def.requiresAttunement !== true) {
      throw new Error(
        `attune: item "${def.name}" (${def.id}) is not a magic item (requiresAttunement !== true)`,
      );
    }

    // R4.3.d — DM cap-override per OUTLINE §3.8. When `overrideCap: true`
    // is present on the payload, skip the slot-cap check entirely. The
    // guard (`attuneGuard`) already rejected non-DM actors setting this
    // flag before we get here. The `overrideCap: true` flag is preserved
    // on the log entry for audit trail.
    const overrideCap =
      'overrideCap' in payload && (payload as { overrideCap?: boolean }).overrideCap === true;
    if (!overrideCap) {
      // Slot cap is the character's `maxAttunement` (OUTLINE §3.3, default
      // 3). Counted against the character's currently-attuned rows in
      // Inventory — items in Storage / Party Stash / Recovered Loot / Shop
      // cannot be attuned (the Inventory-only invariant above already
      // rejects those rows before we get here).
      const attunedCount = s.items.filter(
        (i) => i.ownerId === character.inventoryStashId && i.attuned,
      ).length;
      if (!attunement.hasFreeSlot(attunedCount, character.maxAttunement)) {
        throw new Error(
          `attune: character ${character.id} has no free attunement slot (${attunedCount}/${character.maxAttunement})`,
        );
      }
    }
  }

  // R4.3.d — preserve `overrideCap: true` on the attune log entry per
  // OUTLINE §3.8 "cap-override still logs". `unattune` never carries
  // this field (only attune has a cap to override). Absent from the
  // payload => absent from the log (audit reads absence as "normal
  // attune within cap").
  const overrideCapForLog =
    type === 'attune' &&
    'overrideCap' in payload &&
    (payload as { overrideCap?: boolean }).overrideCap === true
      ? { overrideCap: true }
      : {};

  return {
    state: {
      ...s,
      items: s.items.map((i) => (i.id === row.id ? { ...i, attuned: target } : i)),
    },
    logEntries: [
      {
        type,
        payload: {
          itemInstanceId: row.id,
          characterId: payload.characterId,
          ...overrideCapForLog,
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// use-charge (R2.2)
// ---------------------------------------------------------------------------

/**
 * Spend one or more charges on an Inventory row. Validation order mirrors
 * R2.1 `attune`:
 *   1. `requireState`
 *   2. `resolveInventoryRow` (Inventory-only + ownership)
 *   3. catalog-lookup (defensive — schema can't guarantee join)
 *   4. definition has a `charges` block
 *   5. `currentCharges` is initialised (not null)
 *   6. `currentCharges - amount >= 0`
 *
 * Then applies via `charges.useCharge`. Emits one `use-charge` log entry.
 *
 * Single-use cascade (per `def.charges.rechargeRule === 'none'`): when
 * the new `currentCharges` lands at 0, the reducer also emits a
 * synthetic `consume` entry and either drops the row (`quantity === 1`)
 * or decrements `quantity` and resets `currentCharges` to `def.charges.max`
 * for the surviving stack. A stack of 5 potions becomes 4 + full
 * charges; spending the last potion drops the row.
 */
function spendCharge(
  state: AppState,
  payload: Extract<Action, { type: 'use-charge' }>['payload'],
): ReducerResult {
  const s = requireState(state, 'use-charge');
  const { row } = resolveInventoryRow(s, 'use-charge', payload.itemInstanceId, payload.characterId);

  const def = s.catalog.find((d) => d.id === row.definitionId);
  if (def === undefined) {
    throw new Error(`use-charge: definition ${row.definitionId} not in catalog for row ${row.id}`);
  }
  if (def.charges === undefined) {
    throw new Error(`use-charge: item "${def.name}" (${def.id}) has no charges defined`);
  }
  if (row.currentCharges === null) {
    throw new Error(
      `use-charge: row ${row.id} has no current-charges state (was it just transferred in?)`,
    );
  }
  const amount = payload.amount ?? 1;
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`use-charge: amount must be a positive integer, got ${amount}`);
  }
  if (row.currentCharges - amount < 0) {
    throw new Error(
      `use-charge: insufficient charges on row ${row.id} (have ${row.currentCharges}, want ${amount})`,
    );
  }

  const newCharges = charges.useCharge(row.currentCharges, amount);
  const singleUseConsumed =
    charges.isSingleUse(def.charges) && newCharges === 0 && row.quantity > 0;

  const logEntries: LogEntrySlice[] = [
    {
      type: 'use-charge',
      payload: {
        itemInstanceId: row.id,
        characterId: payload.characterId,
        amount,
      },
    },
  ];

  let nextItems: ItemInstance[];

  if (singleUseConsumed) {
    const removed = row.quantity === 1;
    if (removed) {
      // Drop the row entirely.
      nextItems = s.items.filter((i) => i.id !== row.id);
    } else {
      // Stack-decrement: one potion consumed, the rest stay fully charged.
      nextItems = s.items.map((i) =>
        i.id === row.id ? { ...i, quantity: i.quantity - 1, currentCharges: def.charges!.max } : i,
      );
    }
    // Synthetic `consume` entry alongside `use-charge`. Mirrors the
    // M3 `delete-stash` cascade pattern — both entries share the same
    // actor / partyId / timestamp via the middleware in `index.ts`.
    logEntries.push({
      type: 'consume',
      payload: {
        stashId: row.ownerId,
        itemInstanceId: row.id,
        quantity: 1,
        removed,
      },
    });
  } else {
    nextItems = s.items.map((i) => (i.id === row.id ? { ...i, currentCharges: newCharges } : i));
  }

  return {
    state: { ...s, items: nextItems },
    logEntries,
  };
}

// ---------------------------------------------------------------------------
// recharge (R2.2)
// ---------------------------------------------------------------------------

/**
 * Restore charges on Inventory rows. Three dispatch modes:
 *
 *   - `'single'` / `'manual'`: resolve one row, recharge to `def.charges.max`,
 *     emit one `recharge` log entry with `trigger: 'manual'`.
 *     `'single'` and `'manual'` are MVP synonyms (same code path); the
 *     distinct mode names reserve action shapes for R6's permission gates
 *     (player-driven single vs DM force-recharge) without a future schema
 *     break.
 *
 *   - `'batch'`: iterate the character's Inventory items, recharge every
 *     row whose `def.charges.rechargeRule` strictly matches the trigger
 *     (per `rules.charges.eligibleForBatchRecharge`), emit ONE
 *     `recharge` entry per recharged row. Items at full charges are
 *     skipped (no-op edits don't log). Empty result is allowed —
 *     "I took a long rest but no items needed recharging" is a valid
 *     dispatch.
 *
 * Rejects when:
 *   - the row isn't in the character's Inventory (single/manual modes),
 *   - the definition has no `charges` block (single/manual modes),
 *   - the row is already at `def.charges.max` (single/manual modes —
 *     batch silently skips).
 */
function rechargeAction(
  state: AppState,
  payload: Extract<Action, { type: 'recharge' }>['payload'],
): ReducerResult {
  const s = requireState(state, 'recharge');

  if (payload.mode === 'single' || payload.mode === 'manual') {
    const { row } = resolveInventoryRow(s, 'recharge', payload.itemInstanceId, payload.characterId);
    const def = s.catalog.find((d) => d.id === row.definitionId);
    if (def === undefined) {
      throw new Error(`recharge: definition ${row.definitionId} not in catalog for row ${row.id}`);
    }
    if (def.charges === undefined) {
      throw new Error(`recharge: item "${def.name}" (${def.id}) has no charges defined`);
    }
    const from = row.currentCharges ?? 0;
    // R2.2.1 — optional partial recharge. When `amount` is provided,
    // the post-recharge value is `min(from + amount, max)`. Without
    // `amount`, full-recharge to `def.charges.max` (R2.2 default).
    let to: number;
    if (payload.amount !== undefined) {
      if (!Number.isInteger(payload.amount) || payload.amount <= 0) {
        throw new Error(`recharge: amount must be a positive integer, got ${payload.amount}`);
      }
      to = Math.min(from + payload.amount, def.charges.max);
    } else {
      to = charges.rechargeTo(def.charges);
    }
    if (from === to) {
      throw new Error(
        `recharge: row ${row.id} already at full charges (${from}/${def.charges.max})`,
      );
    }
    return {
      state: {
        ...s,
        items: s.items.map((i) => (i.id === row.id ? { ...i, currentCharges: to } : i)),
      },
      logEntries: [
        {
          type: 'recharge',
          payload: {
            itemInstanceId: row.id,
            characterId: payload.characterId,
            from,
            to,
            trigger: 'manual',
          },
        },
      ],
    };
  }

  // mode: 'batch'
  const character = s.characters.find((c) => c.id === payload.characterId);
  if (character === undefined) {
    throw new Error(`recharge: unknown characterId ${payload.characterId}`);
  }
  const trigger = payload.trigger;
  const amounts = payload.amounts;

  const updated: { row: ItemInstance; from: number; to: number }[] = [];
  for (const row of s.items) {
    if (row.ownerId !== character.inventoryStashId) continue;
    const def = s.catalog.find((d) => d.id === row.definitionId);
    if (def?.charges === undefined) continue;
    if (!charges.eligibleForBatchRecharge(def.charges, trigger)) continue;
    const from = row.currentCharges ?? 0;
    // R2.2.1 — when the caller supplied a per-item roll amount and
    // this row's definition has a `rechargeAmount` formula, apply the
    // partial recharge. Rows without a formula always full-recharge;
    // rows with a formula whose id is absent from `amounts` also
    // full-recharge (defensive — the modal should always provide all
    // formula-bearing rolls, but skipping is harmless).
    const rollAmount =
      amounts !== undefined &&
      def.charges.rechargeAmount !== undefined &&
      amounts[row.id] !== undefined
        ? amounts[row.id]
        : undefined;
    let to: number;
    if (rollAmount !== undefined) {
      if (!Number.isInteger(rollAmount) || rollAmount <= 0) {
        throw new Error(
          `recharge: amount for row ${row.id} must be a positive integer, got ${String(rollAmount)}`,
        );
      }
      to = Math.min(from + rollAmount, def.charges.max);
    } else {
      to = charges.rechargeTo(def.charges);
    }
    if (from === to) continue; // skip no-op rows silently
    updated.push({ row, from, to });
  }

  const updatedIds = new Set(updated.map((u) => u.row.id));
  const nextItems = s.items.map((i) => {
    if (!updatedIds.has(i.id)) return i;
    const u = updated.find((x) => x.row.id === i.id)!;
    return { ...i, currentCharges: u.to };
  });

  const logEntries: LogEntrySlice[] = updated.map((u) => ({
    type: 'recharge',
    payload: {
      itemInstanceId: u.row.id,
      characterId: payload.characterId,
      from: u.from,
      to: u.to,
      trigger,
    },
  }));

  return {
    state: { ...s, items: nextItems },
    logEntries,
  };
}

// ---------------------------------------------------------------------------
// identify (R2.3)
// ---------------------------------------------------------------------------

/**
 * Identify — DM toggles a row's `identified` flag and / or sets the
 * unidentified-item hint (OUTLINE §3.8 + §4 line 317). Bidirectional:
 * `true → false` and `false → true` both produce a log entry; the
 * payload captures the full `(previousIdentified, newIdentified,
 * previousHint, newHint)` transition.
 *
 * Validation order:
 *   1. requireState
 *   2. locate row by id
 *   3. catalog lookup (defensive — schema can't enforce referential
 *      integrity between item.definitionId and catalog ids)
 *   4. compute diff
 *   5. reject exact no-op (same identified + same hint)
 *
 * Deliberate non-gates (captured for the R2.3 retro):
 *   - NO location restriction. OUTLINE §8.1 doesn't qualify identify
 *     by location; a DM identifies a chest of loot in Storage just as
 *     easily as a wand in Inventory.
 *   - NO magic-item gate. Mundane items default to `identified: true`
 *     and the display invariant never fires on them, so an errant
 *     identify on a Torch is harmless (and is rejected by the no-op
 *     gate unless the user also writes a hint).
 *
 * Hint semantics:
 *   - `hint` key absent in payload: leave the current hint untouched.
 *   - `hint: 'text'`: write that string as the new hint.
 *   - `hint: undefined` (explicit): clear the hint.
 * The action type uses `hint?: string | undefined` to make the
 * explicit-undefined case representable under
 * `exactOptionalPropertyTypes: true`.
 */
function identifyAction(
  state: AppState,
  payload: Extract<Action, { type: 'identify' }>['payload'],
): ReducerResult {
  const s = requireState(state, 'identify');

  const row = s.items.find((i) => i.id === payload.itemInstanceId);
  if (row === undefined) {
    throw new Error(`identify: unknown itemInstanceId ${payload.itemInstanceId}`);
  }
  const def = s.catalog.find((d) => d.id === row.definitionId);
  if (def === undefined) {
    throw new Error(`identify: definition ${row.definitionId} not in catalog`);
  }

  const previousIdentified = row.identified;
  const newIdentified = payload.identified;
  const previousHint = row.hint;
  // `hint` absent on payload keeps the current hint; present (string OR
  // explicit undefined) replaces it. The action's
  // `hint?: string | undefined` shape distinguishes the two cases.
  const hintInPayload = 'hint' in payload;
  const newHint = hintInPayload ? payload.hint : previousHint;

  if (previousIdentified === newIdentified && previousHint === newHint) {
    throw new Error('identify: no-op (same identified state and hint)');
  }

  const nextRow: ItemInstance = { ...row, identified: newIdentified };
  if (newHint === undefined) {
    delete nextRow.hint;
  } else {
    nextRow.hint = newHint;
  }
  const nextItems = s.items.map((i) => (i.id === row.id ? nextRow : i));

  // Build the log payload conditionally — under exactOptionalPropertyTypes
  // `previousHint?: string` can't accept `string | undefined`, so only
  // include the key when the value is a string.
  const logPayload: {
    itemInstanceId: string;
    previousIdentified: boolean;
    newIdentified: boolean;
    previousHint?: string;
    newHint?: string;
  } = {
    itemInstanceId: row.id,
    previousIdentified,
    newIdentified,
  };
  if (previousHint !== undefined) logPayload.previousHint = previousHint;
  if (newHint !== undefined) logPayload.newHint = newHint;

  return {
    state: { ...s, items: nextItems },
    logEntries: [
      {
        type: 'identify',
        payload: logPayload,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// edit-character (R1.2)
// ---------------------------------------------------------------------------

/**
 * Editable Character-field allowlist per OUTLINE §4 line 320.
 * `encumbranceRule` and `enforceEncumbrance` have their own dedicated
 * `set-encumbrance` TxType (single-field actions stay single-purpose
 * per the R1.1 design note); `size` is creation-only in v1; `name` has
 * its own `rename-character` TxType.
 */
const EDIT_CHARACTER_FIELDS = ['species', 'class', 'level', 'str', 'maxAttunement'] as const;
type EditCharacterField = (typeof EDIT_CHARACTER_FIELDS)[number];

/**
 * Catch-all Character editor for the fields that compose naturally
 * (OUTLINE §4 line 320). Diffs the patch against the current row,
 * derives `changedFields`, and rejects no-op edits — mirrors
 * `edit-homebrew` and `edit-item-instance`.
 *
 * `str` is carried on the payload as `str` but the Character row stores
 * it under `abilityScores.STR`. The reducer hides the shape difference
 * at the storage layer; the log entry's `changedFields` names `str` to
 * match the user-facing field name.
 */
function editCharacter(
  state: AppState,
  payload: Extract<Action, { type: 'edit-character' }>['payload'],
): ReducerResult {
  const s = requireState(state, 'edit-character');

  const character = s.characters.find((c) => c.id === payload.characterId);
  if (character === undefined) {
    throw new Error(`edit-character: unknown characterId ${payload.characterId}`);
  }

  const changedFields: EditCharacterField[] = [];
  const next = { ...character, abilityScores: { ...character.abilityScores } };

  for (const key of EDIT_CHARACTER_FIELDS) {
    if (!(key in payload.patch)) continue;
    const newVal = payload.patch[key];
    if (newVal === undefined) continue; // explicit-undefined treated as "key absent"

    switch (key) {
      case 'species':
      case 'class':
        if (newVal !== character[key]) {
          changedFields.push(key);
          (next as Record<string, unknown>)[key] = newVal;
        }
        break;
      case 'level':
        if (newVal !== character.level) {
          changedFields.push('level');
          next.level = newVal as number;
        }
        break;
      case 'str':
        if (newVal !== character.abilityScores.STR) {
          changedFields.push('str');
          next.abilityScores.STR = newVal as number;
        }
        break;
      case 'maxAttunement':
        if (newVal !== character.maxAttunement) {
          changedFields.push('maxAttunement');
          next.maxAttunement = newVal as number;
        }
        break;
    }
  }

  if (changedFields.length === 0) {
    throw new Error('edit-character: no fields changed');
  }

  return {
    state: {
      ...s,
      characters: s.characters.map((c) => (c.id === character.id ? next : c)),
    },
    logEntries: [
      {
        type: 'edit-character',
        payload: { characterId: character.id, changedFields },
      },
    ],
  };
}

// -------------------------------------------------------------------- //
// delete-character (R4.1.b)
// -------------------------------------------------------------------- //

/**
 * Detach a Character from their party with full cascade per OUTLINE §8.3.
 *
 * Cascade (in this order, all in a single dispatch):
 *   1. Every `ItemInstance` owned by any of the character's stashes
 *      (Inventory + any Storage stashes — every `scope='character',
 *      ownerCharacterId === characterId` row) is re-pointed to the
 *      party's Recovered Loot stash. Equip / attune flags clear in the
 *      same write (the items are no longer in *any* Inventory). Each
 *      moved row emits one `transfer` log slice.
 *   2. The character's aggregated currency (sum across every owned
 *      stash's `CurrencyHolding`) rolls into Recovered Loot's holding
 *      via a synthetic `currency-change` slice with
 *      `reason: 'character-deleted'` IFF the aggregate was non-zero.
 *   3. The character's stash rows + their `CurrencyHolding` rows are
 *      removed from state.
 *   4. The owning user's `PartyMembership` row with `role='player'` is
 *      kept (slot reserved for a fresh character) but its
 *      `characterId` is set to `null`. The user retains their seat in
 *      the party (roadmap R4.1 line 1750 — "owning user keeps their
 *      membership; can recreate a character").
 *   5. One terminal `delete-character` slice carries the snapshot
 *      `{ characterId, name, itemCount, currencyTotalCp }`.
 *
 * Mirrors the `delete-stash` cascade pattern (M3) but generalised over
 * every stash the character owned. `itemCount` is the SUM of
 * quantities; `currencyTotalCp` is the CP-equivalent of the aggregate
 * holdings.
 *
 * Reducer guards: unknown characterId rejects; missing
 * `CurrencyHolding` for the character's Inventory or for Recovered Loot
 * surfaces as an invariant violation. Permission (`actor.userId ===
 * character.ownerUserId` OR `actor.role === 'dm'`) lives in the
 * server-side guard map, not here — in MVP party-of-one the sole user
 * wears both hats so the gate is moot.
 */
/**
 * R4.1.b/c — Shared cascade helper used by both `delete-character` and
 * `leave-party` (and R4.1.d `kick-player`). Pure: takes a populated
 * `AppState` + a character row, returns the next state and the log slices
 * `[transfer..., currency-change?]` (no terminal slice — the caller
 * appends `delete-character` / `leave-party` / `kick-player` themselves).
 *
 * Mirrors the OUTLINE §8.3 cascade exactly:
 *   - every `ItemInstance` in any of the character's owned stashes
 *     (Inventory + Storage) → Recovered Loot, with equip/attune flags
 *     and `containerInstanceId` cleared (R1.3 / §3.4 invariant).
 *   - aggregated currency across owned stashes → Recovered Loot via
 *     one synthetic `currency-change` slice with `reason:
 *     'character-deleted'` IFF the aggregate was non-zero.
 *   - drop the character's stash rows + CurrencyHolding rows.
 *   - clear `PartyMembership.characterId` on the owning user's player
 *     row(s).
 *   - drop the Character row.
 *
 * `itemCount` is the SUM of quantities; `currencyTotalCp` is the CP-
 * equivalent of the aggregate holdings — both surfaced for the caller
 * to embed in its terminal slice snapshot.
 */
function cascadeCharacterToRecoveredLoot(
  s: NonNullable<AppState>,
  character: NonNullable<AppState>['characters'][number],
): {
  state: NonNullable<AppState>;
  logEntries: LogEntrySlice[];
  itemCount: number;
  currencyTotalCp: number;
} {
  const recoveredLootId = s.party.recoveredLootStashId;
  const recoveredHolding = s.currencies.find((c) => c.stashId === recoveredLootId);
  if (recoveredHolding === undefined) {
    throw new Error(
      'cascadeCharacterToRecoveredLoot: invariant violation — no CurrencyHolding for Recovered Loot',
    );
  }

  // Identify every stash this character owns (Inventory + any Storage).
  const ownedStashes = s.stashes.filter(
    (st) => st.scope === 'character' && st.ownerCharacterId === character.id,
  );
  const ownedStashIds = new Set(ownedStashes.map((st) => st.id));

  // 1. Items → Recovered Loot (clear equip/attune/container).
  // RH2.2 — sort by id so the emitted `transfer` log slices (line
  // ~2998 below) fan out deterministically across clients. `nextItems`
  // and `itemCount` don't depend on this array's order.
  const itemsToTransfer = s.items
    .filter((i) => ownedStashIds.has(i.ownerId))
    .sort((a, b) => a.id.localeCompare(b.id));
  const nextItems = s.items.map((i) =>
    ownedStashIds.has(i.ownerId)
      ? {
          ...i,
          ownerId: recoveredLootId,
          equipped: false,
          attuned: false,
          containerInstanceId: null,
        }
      : i,
  );

  // 2. Aggregate currency across owned stashes.
  const ownedCurrencies = s.currencies.filter((c) => ownedStashIds.has(c.stashId));
  const aggregated: CurrencyHolding = ownedCurrencies.reduce<CurrencyHolding>(
    (acc, h) => ({
      ...acc,
      cp: acc.cp + h.cp,
      sp: acc.sp + h.sp,
      ep: acc.ep + h.ep,
      gp: acc.gp + h.gp,
      pp: acc.pp + h.pp,
    }),
    { id: 'aggregate', stashId: recoveredLootId, cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
  );
  const isNonZero =
    aggregated.cp !== 0 ||
    aggregated.sp !== 0 ||
    aggregated.ep !== 0 ||
    aggregated.gp !== 0 ||
    aggregated.pp !== 0;
  const nextRecovered: CurrencyHolding = isNonZero
    ? {
        ...recoveredHolding,
        cp: recoveredHolding.cp + aggregated.cp,
        sp: recoveredHolding.sp + aggregated.sp,
        ep: recoveredHolding.ep + aggregated.ep,
        gp: recoveredHolding.gp + aggregated.gp,
        pp: recoveredHolding.pp + aggregated.pp,
      }
    : recoveredHolding;

  // 3. Drop stash rows + CurrencyHolding rows; rewrite Recovered Loot.
  const nextStashes = s.stashes.filter((st) => !ownedStashIds.has(st.id));
  const nextCurrencies = s.currencies
    .filter((c) => !ownedStashIds.has(c.stashId))
    .map((c) => (c.stashId === recoveredLootId ? nextRecovered : c));

  // 4. Clear PartyMembership.characterId on owning user's player row.
  const nextMemberships = s.memberships.map((m) =>
    m.role === 'player' && m.characterId === character.id ? { ...m, characterId: null } : m,
  );

  // 5. Drop the Character row.
  const nextCharacters = s.characters.filter((c) => c.id !== character.id);

  // Build the cascade log slices (no terminal slice — caller appends).
  const transferEntries: LogEntrySlice[] = itemsToTransfer.map((item) => ({
    type: 'transfer',
    payload: {
      itemInstanceId: item.id,
      quantity: item.quantity,
      fromStashId: item.ownerId,
      toStashId: recoveredLootId,
    },
  }));

  const currencyEntries: LogEntrySlice[] = isNonZero
    ? [
        {
          type: 'currency-change',
          payload: {
            stashId: recoveredLootId,
            delta: {
              cp: aggregated.cp,
              sp: aggregated.sp,
              ep: aggregated.ep,
              gp: aggregated.gp,
              pp: aggregated.pp,
            },
            reason: 'character-deleted',
          },
        },
      ]
    : [];

  const itemCount = itemsToTransfer.reduce((sum, i) => sum + i.quantity, 0);
  const currencyTotalCp = currency.toCopper(aggregated);

  return {
    state: {
      ...s,
      characters: nextCharacters,
      stashes: nextStashes,
      currencies: nextCurrencies,
      items: nextItems,
      memberships: nextMemberships,
    },
    logEntries: [...transferEntries, ...currencyEntries],
    itemCount,
    currencyTotalCp,
  };
}

function deleteCharacter(
  state: AppState,
  payload: Extract<Action, { type: 'delete-character' }>['payload'],
): ReducerResult {
  const s = requireState(state, 'delete-character');

  const character = s.characters.find((c) => c.id === payload.characterId);
  if (character === undefined) {
    throw new Error(`delete-character: unknown characterId ${payload.characterId}`);
  }

  const cascade = cascadeCharacterToRecoveredLoot(s, character);

  return {
    state: cascade.state,
    logEntries: [
      ...cascade.logEntries,
      {
        type: 'delete-character',
        payload: {
          characterId: character.id,
          name: character.name,
          itemCount: cascade.itemCount,
          currencyTotalCp: cascade.currencyTotalCp,
        },
      },
    ],
  };
}

// -------------------------------------------------------------------- //
// leave-party (R4.1.c)
// -------------------------------------------------------------------- //

/**
 * Actor self-removes from `state.party` per OUTLINE §8.3.
 *
 * Cascade (in this order, all in one dispatch):
 *   1. If the actor has a `role='player'` membership with `characterId
 *      !== null`, run the same character-delete cascade as R4.1.b
 *      (items + currency → Recovered Loot; drop character + stashes +
 *      holdings).
 *   2. Soft-delete every active `PartyMembership` row for actor.userId
 *      in this party (a party-of-one creator has `dm` + `player` rows;
 *      both flip). `leftAt` goes from `null` → `ctx.now()`.
 *   3. Banker auto-clear stub (R4.2 carryforward): if the actor was the
 *      Banker (`state.party.bankerUserId === actor.userId`), the cascade
 *      WOULD clear `Party.bankerUserId` and emit a synthetic
 *      `revoke-banker` slice with `reason: 'left-party'`. R4.1 guards
 *      this in code but the conditional never fires because
 *      `partySchema.bankerUserId: z.null()` makes the field always null;
 *      R4.2 widens both the schema and this branch.
 *   4. Append one terminal `leave-party` slice with `{ partyId,
 *      characterId? }` (characterId set IFF the leaver had a player
 *      membership with a non-null character at leave time, per OUTLINE
 *      §4 line 323).
 *
 * Reducer guards:
 *   - actor must be an active member (at least one `leftAt: null` row
 *     for `state.user.id` in `state.party.id`).
 *   - sole member (party-of-one): rejects with the explicit message
 *     "use archive flow". R4.1.e ships the server-side `Party.archivedAt`
 *     path; local mode just refuses to let the user delete their last
 *     party via this action (the UI must offer a separate "delete party"
 *     affordance if needed).
 *   - sole DM of a 2+-member party: rejects with the explicit message
 *     "transfer DM first" (R4.3 ships `dm-transfer`).
 *
 * Local-mode note: in R4.1 the web client only holds ONE party at a time
 * in memory, so `state.user.id` and `state.party.id` are the canonical
 * actor + party identifiers. The server route (R4.1.e) re-derives both
 * from the session cookie + URL.
 */
function leaveParty(state: AppState, ctx: ReducerContext): ReducerResult {
  const s = requireState(state, 'leave-party');
  const actorUserId = s.user.id;
  const partyId = s.party.id;

  // Active memberships for the actor in this party (every role row).
  const actorMemberships = s.memberships.filter(
    (m) => m.userId === actorUserId && m.partyId === partyId && m.leftAt === null,
  );
  if (actorMemberships.length === 0) {
    throw new Error('leave-party: actor is not an active member of this party');
  }

  // Active memberships for OTHER users in this party (used for the
  // sole-member / sole-DM guards). Banker is denormalised on Party so
  // it doesn't appear in the membership rows.
  const otherActiveMemberships = s.memberships.filter(
    (m) => m.userId !== actorUserId && m.partyId === partyId && m.leftAt === null,
  );
  const otherActiveUserIds = new Set(otherActiveMemberships.map((m) => m.userId));

  if (otherActiveUserIds.size === 0) {
    // Sole-member party-of-one: server-only archive flow per the R4.1
    // open-question resolution. Reducer rejects so the local-mode
    // optimistic dispatch can't silently drop a user's last party.
    throw new Error('leave-party: sole member must use archive flow (server-only)');
  }

  // Sole-DM check. The actor holds a 'dm' row, and no OTHER active
  // membership in this party has role='dm'. Multi-DM is out of v1 scope
  // but the check uses a set rather than a count so future widening
  // is straightforward.
  const actorIsDm = actorMemberships.some((m) => m.role === 'dm');
  if (actorIsDm) {
    const otherDmExists = otherActiveMemberships.some((m) => m.role === 'dm');
    if (!otherDmExists) {
      throw new Error(
        'leave-party: sole DM must transfer DM role first (use `dm-transfer` in R4.3)',
      );
    }
  }

  // Find the leaver's character (if any) BEFORE running the cascade.
  // The player row carries the link; the dm row's characterId is null
  // per the §4 invariant.
  const playerRow = actorMemberships.find((m) => m.role === 'player');
  const characterId = playerRow?.characterId ?? null;
  const character =
    characterId !== null ? s.characters.find((c) => c.id === characterId) : undefined;

  // 1. Character cascade (if the leaver had one).
  let afterCharacterCascade: NonNullable<AppState> = s;
  let cascadeSlices: LogEntrySlice[] = [];
  if (character !== undefined) {
    const cascade = cascadeCharacterToRecoveredLoot(s, character);
    afterCharacterCascade = cascade.state;
    cascadeSlices = cascade.logEntries;
  }

  // 2. Soft-delete every active membership row for the leaver in this party.
  const now = ctx.now();
  const nextMemberships = afterCharacterCascade.memberships.map((m) =>
    m.userId === actorUserId && m.partyId === partyId && m.leftAt === null
      ? { ...m, leftAt: now }
      : m,
  );

  // 3. Banker auto-clear stub. In R4.1 partySchema.bankerUserId is
  //    z.null(), so this conditional is structurally unreachable. R4.2
  //    will widen + emit `revoke-banker` with reason: 'left-party'.
  //    Kept as documentation; structured so the R4.2 patch is a 1-line
  //    addition.
  const wasBanker = afterCharacterCascade.party.bankerUserId === actorUserId;
  const nextParty = wasBanker
    ? { ...afterCharacterCascade.party, bankerUserId: null }
    : afterCharacterCascade.party;

  // 4. Terminal slice. characterId only present when the leaver had one.
  const leavePayload: { partyId: string; characterId?: string } =
    characterId !== null ? { partyId, characterId } : { partyId };

  // 5. Banker auto-clear slice (R4.2.a — light up the carryforward).
  //    Sits AFTER the cascade slices and BEFORE the terminal leave-party
  //    slice so the audit ordering reads: items/currency rollup → revoke →
  //    terminal departure. Only emitted when the leaver IS the Banker.
  const bankerSlice: LogEntrySlice[] = wasBanker
    ? [{ type: 'revoke-banker', payload: { reason: 'left-party' } }]
    : [];

  return {
    state: {
      ...afterCharacterCascade,
      party: nextParty,
      memberships: nextMemberships,
    },
    logEntries: [
      ...cascadeSlices,
      ...bankerSlice,
      {
        type: 'leave-party',
        payload: leavePayload,
      },
    ],
  };
}

// -------------------------------------------------------------------- //
// kick-player (R4.1.d)
// -------------------------------------------------------------------- //

/**
 * DM removes another member from the party per OUTLINE §8.3.
 *
 * Symmetric to `leave-party` but parameterised on `kickedUserId`
 * rather than the actor. Cascade mirrors `leave-party`:
 *   1. If the kicked user has a player membership with `characterId !==
 *      null`, run the shared `cascadeCharacterToRecoveredLoot` (items +
 *      currency → Recovered Loot, drop character + stashes + holdings).
 *   2. Soft-delete every active `PartyMembership` row for the kicked
 *      user in this party (player + dm rows, though a kick targeting
 *      a DM is rejected by guard #3 below).
 *   3. Banker auto-clear stub: if the kicked user was the Banker
 *      (`state.party.bankerUserId === kickedUserId`), the cascade
 *      WOULD clear it and emit `revoke-banker` with
 *      `reason: 'kicked'`. R4.1 ships the conditional; the schema
 *      keeps `bankerUserId: z.null()` so the branch is structurally
 *      unreachable until R4.2 widens both.
 *   4. Terminal `kick-player` slice with `{ kickedUserId }`.
 *
 * Reducer guards:
 *   - kicked user must be an active member (`leftAt: null`) of this
 *     party.
 *   - actor must NOT be the kicked user (self-kick → use
 *     `leave-party`).
 *   - kicked user must NOT have an active `role='dm'` row (multi-DM is
 *     out of scope; DMs leave via `dm-transfer` + `leave-party`).
 *
 * Permission (actor.role === 'dm') is enforced by the server-side
 * guard map, not here — in MVP party-of-one the gate is moot
 * (solo bypass) and in 2+-member parties the §8.1 row "Kick player"
 * is DM-only.
 */
function kickPlayer(
  state: AppState,
  payload: Extract<Action, { type: 'kick-player' }>['payload'],
  ctx: ReducerContext,
): ReducerResult {
  const s = requireState(state, 'kick-player');
  const actorUserId = s.user.id;
  const partyId = s.party.id;
  const kickedUserId = payload.kickedUserId;

  if (kickedUserId === actorUserId) {
    throw new Error('kick-player: actor cannot kick themselves (use `leave-party` instead)');
  }

  const kickedMemberships = s.memberships.filter(
    (m) => m.userId === kickedUserId && m.partyId === partyId && m.leftAt === null,
  );
  if (kickedMemberships.length === 0) {
    throw new Error(
      `kick-player: target user ${kickedUserId} is not an active member of this party`,
    );
  }

  const kickedIsDm = kickedMemberships.some((m) => m.role === 'dm');
  if (kickedIsDm) {
    throw new Error(
      'kick-player: cannot kick a DM (use `dm-transfer` then have them leave instead)',
    );
  }

  // Find the kicked user's character (if any).
  const playerRow = kickedMemberships.find((m) => m.role === 'player');
  const characterId = playerRow?.characterId ?? null;
  const character =
    characterId !== null ? s.characters.find((c) => c.id === characterId) : undefined;

  // 1. Character cascade (if the kicked user had one).
  let afterCharacterCascade: NonNullable<AppState> = s;
  let cascadeSlices: LogEntrySlice[] = [];
  if (character !== undefined) {
    const cascade = cascadeCharacterToRecoveredLoot(s, character);
    afterCharacterCascade = cascade.state;
    cascadeSlices = cascade.logEntries;
  }

  // 2. Soft-delete every active membership row for the kicked user.
  const now = ctx.now();
  const nextMemberships = afterCharacterCascade.memberships.map((m) =>
    m.userId === kickedUserId && m.partyId === partyId && m.leftAt === null
      ? { ...m, leftAt: now }
      : m,
  );

  // 3. Banker auto-clear (R4.2.a). Mirrors the `leave-party` cascade.
  const wasBanker = afterCharacterCascade.party.bankerUserId === kickedUserId;
  const nextParty = wasBanker
    ? { ...afterCharacterCascade.party, bankerUserId: null }
    : afterCharacterCascade.party;

  const bankerSlice: LogEntrySlice[] = wasBanker
    ? [{ type: 'revoke-banker', payload: { reason: 'kicked' } }]
    : [];

  return {
    state: {
      ...afterCharacterCascade,
      party: nextParty,
      memberships: nextMemberships,
    },
    logEntries: [
      ...cascadeSlices,
      ...bankerSlice,
      {
        type: 'kick-player',
        payload: { kickedUserId },
      },
    ],
  };
}

// -------------------------------------------------------------------- //
// join-party (R4.1.e)
// -------------------------------------------------------------------- //

/**
 * A user joins an existing party as a `role='player'` member after
 * redeeming an invite code server-side. The server has already verified
 * the invite code, party membership uniqueness, and the user's
 * authentication; this reducer is the client-side mirror that updates
 * the local AppState in lockstep with the server's persistence.
 *
 * Membership-only: no character is minted here. The user's subsequent
 * `create-character` dispatch creates the character + 3 stashes and
 * updates the player row's `characterId` pointer.
 *
 * Idempotency: the reducer rejects if the actor already has an active
 * `role='player'` row in this party (server-side route also rejects
 * with `already_member`).
 */
function joinParty(state: AppState, ctx: ReducerContext): ReducerResult {
  const s = requireState(state, 'join-party');
  const actorUserId = s.user.id;
  const partyId = s.party.id;

  const existingActivePlayer = s.memberships.find(
    (m) =>
      m.userId === actorUserId && m.partyId === partyId && m.role === 'player' && m.leftAt === null,
  );
  if (existingActivePlayer !== undefined) {
    throw new Error('join-party: actor already has an active player membership in this party');
  }

  const now = ctx.now();

  // BUG-002: a previously-left user has a SOFT-DELETED player row
  // (`leftAt: <timestamp>`). The composite PK `(userId, partyId, role)`
  // means we MUST reactivate that row, not append a duplicate. The
  // server persistor's `partyMembership.create()` would otherwise raise
  // P2002; the in-memory reducer would silently double-list the row.
  // Rejoin is a state transition on the existing row.
  const existingSoftDeletedPlayerIndex = s.memberships.findIndex(
    (m) =>
      m.userId === actorUserId && m.partyId === partyId && m.role === 'player' && m.leftAt !== null,
  );

  if (existingSoftDeletedPlayerIndex !== -1) {
    const reactivated = s.memberships.map((m, i) =>
      i === existingSoftDeletedPlayerIndex
        ? { ...m, leftAt: null, joinedAt: now, characterId: null }
        : m,
    );
    return {
      state: { ...s, memberships: reactivated },
      logEntries: [
        {
          type: 'join-party',
          payload: { partyId },
        },
      ],
    };
  }

  // No prior row — first-time join. Append a fresh membership.
  const newMembership = {
    userId: actorUserId,
    partyId,
    role: 'player' as const,
    characterId: null,
    joinedAt: now,
    leftAt: null,
  };

  return {
    state: {
      ...s,
      memberships: [...s.memberships, newMembership],
    },
    logEntries: [
      {
        type: 'join-party',
        payload: { partyId },
      },
    ],
  };
}

// -------------------------------------------------------------------- //
// appoint-banker / revoke-banker (R4.2.a)
// -------------------------------------------------------------------- //

/**
 * DM appoints an active player as the party's Banker (OUTLINE §3.14).
 *
 * Rejects when:
 *   - actor lacks an active `role='dm'` membership in this party
 *     (`dm_only`).
 *   - target equals `Party.ownerUserId` (no self-banker; the role is
 *     for delegating to a player).
 *   - target lacks an active `role='player'` membership in this party.
 *   - `memberCount < 2` — solo parties have no Banker. memberCount is
 *     the count of DISTINCT active user ids across all membership rows.
 *   - `Party.bankerUserId` is already non-null. Reassignment is the
 *     two-step revoke-then-appoint flow per §3.14; an `appoint` against
 *     an already-set banker would otherwise silently overwrite the
 *     existing audit anchor.
 *
 * Emits one `appoint-banker` log slice. `actorRole` is filled in by the
 * store middleware via `deriveActorRole`; for this action it always
 * resolves to `'dm'`.
 */
function appointBanker(state: AppState, payload: { bankerUserId: string }): ReducerResult {
  const s = requireState(state, 'appoint-banker');
  const actorUserId = s.user.id;
  const partyId = s.party.id;
  const { bankerUserId } = payload;

  // DM guard.
  const actorIsDm = s.memberships.some(
    (m) =>
      m.userId === actorUserId && m.partyId === partyId && m.role === 'dm' && m.leftAt === null,
  );
  if (!actorIsDm) {
    throw new Error('appoint-banker: dm_only (actor must be an active DM of this party)');
  }

  // Self-appoint guard. OUTLINE §3.14: "the DM cannot appoint themselves".
  if (bankerUserId === s.party.ownerUserId) {
    throw new Error(
      'appoint-banker: banker_membership_forbidden (DM cannot self-appoint as Banker)',
    );
  }

  // Already-set guard (forces explicit revoke + re-appoint).
  if (s.party.bankerUserId !== null) {
    throw new Error(
      'appoint-banker: banker_membership_forbidden (a Banker is already set; revoke first)',
    );
  }

  // Target must be an active player in this party.
  const targetIsActivePlayer = s.memberships.some(
    (m) =>
      m.userId === bankerUserId &&
      m.partyId === partyId &&
      m.role === 'player' &&
      m.leftAt === null,
  );
  if (!targetIsActivePlayer) {
    throw new Error(
      'appoint-banker: banker_membership_forbidden (target lacks an active player membership in this party)',
    );
  }

  // memberCount ≥ 2 guard. Count distinct active user ids across all
  // membership rows (a creator's dm + player rows count as one user).
  const activeUserIds = new Set(
    s.memberships.filter((m) => m.partyId === partyId && m.leftAt === null).map((m) => m.userId),
  );
  if (activeUserIds.size < 2) {
    throw new Error(
      'appoint-banker: banker_membership_forbidden (party must have two members before a Banker is allowed)',
    );
  }

  return {
    state: {
      ...s,
      party: { ...s.party, bankerUserId },
    },
    logEntries: [
      {
        type: 'appoint-banker',
        payload: { bankerUserId },
      },
    ],
  };
}

/**
 * DM revokes the current Banker (OUTLINE §3.14). Only `reason: 'manual'`
 * and `'reassigned'` are valid as direct dispatches; `'left-party'` and
 * `'kicked'` are synthesized by the `leave-party` / `kick-player`
 * cascades and never reach this function via the action route.
 *
 * Rejects when:
 *   - actor lacks an active DM membership (`dm_only`).
 *   - `Party.bankerUserId` is already null (nothing to revoke).
 */
function revokeBanker(
  state: AppState,
  payload: { reason: 'manual' | 'reassigned' | 'left-party' | 'kicked' | 'dm-transfer' },
): ReducerResult {
  const s = requireState(state, 'revoke-banker');
  const actorUserId = s.user.id;
  const partyId = s.party.id;

  const actorIsDm = s.memberships.some(
    (m) =>
      m.userId === actorUserId && m.partyId === partyId && m.role === 'dm' && m.leftAt === null,
  );
  if (!actorIsDm) {
    throw new Error('revoke-banker: dm_only (actor must be an active DM of this party)');
  }

  if (s.party.bankerUserId === null) {
    throw new Error('revoke-banker: banker_membership_forbidden (no Banker is currently set)');
  }

  return {
    state: {
      ...s,
      party: { ...s.party, bankerUserId: null },
    },
    logEntries: [
      {
        type: 'revoke-banker',
        payload: { reason: payload.reason },
      },
    ],
  };
}

// -------------------------------------------------------------------- //
// R4.3.a — dm-transfer (DM role transfer + Banker auto-clear cascade)
// -------------------------------------------------------------------- //

/**
 * R4.3.a — DM hands the DM role to another active player per OUTLINE
 * §3.14 + §8.3. Atomic swap:
 *   1. Outgoing DM's `role='dm'` row → soft-deleted (`leftAt: now`).
 *   2. Outgoing DM's `role='player'` row → left active; if none exists
 *      (DM-only outgoing DM case) an active row is auto-minted with
 *      `characterId: null`. Matches the party-creator bootstrap shape
 *      so the outgoing DM ends up as a plain player. They can add a
 *      character later via the existing post-join CTA.
 *   3. Incoming DM's `role='dm'` row → upsert to active. Reactivates a
 *      historical soft-deleted row per the BUG-002 composite-PK lesson
 *      (`(userId, partyId, role)` PK + soft-delete = never `create`,
 *      always upsert). Creates fresh if no row exists.
 *   4. `Party.ownerUserId` → newDmUserId.
 *   5. If `party.bankerUserId === newDmUserId` → cleared + synthetic
 *      `revoke-banker` slice with `reason: 'dm-transfer'` emitted
 *      BEFORE the terminal `dm-transfer` slice. Preserves §4 invariant
 *      `bankerUserId !== ownerUserId`.
 *
 * Reducer guards (reject order):
 *   - `dm_only` — actor lacks an active DM membership in this party.
 *   - `dm_transfer_self` — actor targets themselves. UI hides the
 *     affordance for the actor's own row.
 *   - `dm_transfer_target_not_member` — target lacks an active
 *     `role='player'` membership in this party.
 *
 * `actorRole` on all emitted slices resolves to `'dm'` at the store
 * middleware via `deriveActorRole`.
 */
function dmTransfer(
  state: AppState,
  payload: { newDmUserId: string },
  ctx: ReducerContext,
): ReducerResult {
  const s = requireState(state, 'dm-transfer');
  const actorUserId = s.user.id;
  const partyId = s.party.id;
  const { newDmUserId } = payload;

  // Guard 1: actor must be an active DM.
  const actorIsDm = s.memberships.some(
    (m) =>
      m.userId === actorUserId && m.partyId === partyId && m.role === 'dm' && m.leftAt === null,
  );
  if (!actorIsDm) {
    throw new Error('dm-transfer: dm_only (actor must be an active DM of this party)');
  }

  // Guard 2: no self-transfer.
  if (newDmUserId === actorUserId) {
    throw new Error('dm-transfer: dm_transfer_self (cannot transfer DM to yourself)');
  }

  // Guard 3: target must be an active player.
  const targetIsActivePlayer = s.memberships.some(
    (m) =>
      m.userId === newDmUserId && m.partyId === partyId && m.role === 'player' && m.leftAt === null,
  );
  if (!targetIsActivePlayer) {
    throw new Error(
      'dm-transfer: dm_transfer_target_not_member (target lacks an active player membership in this party)',
    );
  }

  const now = ctx.now();

  // Step 1 + 2 + 3: membership row swap.
  //
  // Build the next memberships in one pass. We track whether the
  // outgoing DM already has an active player row and whether the
  // incoming DM has a historical dm row we can reactivate; both drive
  // the append list.
  let outgoingDmHasActivePlayerRow = false;
  let incomingDmHadHistoricalDmRow = false;

  const nextMemberships = s.memberships.map((m) => {
    // Outgoing DM's dm row → soft-delete.
    if (m.userId === actorUserId && m.partyId === partyId && m.role === 'dm' && m.leftAt === null) {
      return { ...m, leftAt: now };
    }
    // Track outgoing DM's active player row (leave it as-is).
    if (
      m.userId === actorUserId &&
      m.partyId === partyId &&
      m.role === 'player' &&
      m.leftAt === null
    ) {
      outgoingDmHasActivePlayerRow = true;
      return m;
    }
    // Incoming DM's historical dm row → reactivate (BUG-002 upsert).
    if (m.userId === newDmUserId && m.partyId === partyId && m.role === 'dm' && m.leftAt !== null) {
      incomingDmHadHistoricalDmRow = true;
      return { ...m, leftAt: null, joinedAt: now, characterId: null };
    }
    return m;
  });

  // Append new rows for the ones that didn't exist.
  if (!incomingDmHadHistoricalDmRow) {
    nextMemberships.push({
      userId: newDmUserId,
      partyId,
      role: 'dm',
      characterId: null,
      joinedAt: now,
      leftAt: null,
    });
  }
  if (!outgoingDmHasActivePlayerRow) {
    // DM-only outgoing DM: auto-mint an active player row so they
    // remain in the party as a plain player. `joinedAt: now` follows
    // BUG-002's current-tenure semantics — the row represents "player
    // role activated at transfer time", not "user joined the party".
    // Historical DM tenure is preserved by the soft-deleted dm row's
    // original `joinedAt` (untouched by this reducer).
    nextMemberships.push({
      userId: actorUserId,
      partyId,
      role: 'player',
      characterId: null,
      joinedAt: now,
      leftAt: null,
    });
  }

  // Step 4 + 5: party ownership + Banker cascade.
  const bankerCascade = s.party.bankerUserId === newDmUserId;
  const nextParty = {
    ...s.party,
    ownerUserId: newDmUserId,
    bankerUserId: bankerCascade ? null : s.party.bankerUserId,
  };

  // Log slices. Ordering mirrors leave-party / kick-player: cascade
  // slice (if any) → terminal.
  const bankerSlice: LogEntrySlice[] = bankerCascade
    ? [{ type: 'revoke-banker', payload: { reason: 'dm-transfer' } }]
    : [];

  return {
    state: {
      ...s,
      party: nextParty,
      memberships: nextMemberships,
    },
    logEntries: [
      ...bankerSlice,
      {
        type: 'dm-transfer',
        payload: { oldDmUserId: actorUserId, newDmUserId },
      },
    ],
  };
}

// -------------------------------------------------------------------- //
// R4.2.d — split-evenly (Banker distribution toolkit)
// -------------------------------------------------------------------- //

/**
 * R4.2.d — Banker "split the pot" action. Splits the Party Stash's
 * currency evenly across the supplied recipients using the cascade-
 * down-denominations algorithm (`packages/rules/currency` `splitEvenly`).
 *
 * Emits ONE terminal `split-evenly` log entry (the audit anchor
 * carrying `sharePerRecipient` + `remainderInPool`) plus N
 * `currency-transfer` entries — one per recipient — that carry the
 * atomic pool→character-Inventory debits/credits. The log order is:
 * terminal entry first, then one transfer per recipient in the order
 * the Banker supplied.
 *
 * Guards (see `packages/shared/guards/map.ts` `splitEvenlyGuard`)
 * already ensure: actor is Banker, `fromStashId` is this party's
 * Party Stash, every recipient is an active player's character in
 * this party. The reducer re-checks the invariants for defence in
 * depth, but the shapes it consults are already validated by the
 * guard.
 *
 * Invariant: pool balance after = pool balance before − N × share.
 * The `remainderInPool` in the terminal entry equals the leftover
 * (0 to N-1 cp, per the `splitEvenly` contract).
 */
function splitEvenlyReducer(
  state: AppState,
  payload: { fromStashId: string; recipientCharacterIds: string[] },
): ReducerResult {
  const s = requireState(state, 'split-evenly');
  const { fromStashId, recipientCharacterIds } = payload;
  const n = recipientCharacterIds.length;
  if (n < 1) {
    throw new Error('split-evenly: recipient list must be non-empty');
  }

  const fromStash = s.stashes.find((st) => st.id === fromStashId);
  if (fromStash === undefined || fromStash.scope !== 'party') {
    throw new Error(`split-evenly: fromStashId ${fromStashId} is not a Party Stash`);
  }
  const poolHolding = s.currencies.find((c) => c.stashId === fromStashId);
  if (poolHolding === undefined) {
    throw new Error(`split-evenly: no CurrencyHolding for ${fromStashId}`);
  }

  // Resolve recipient Inventory stash ids (log entries + credits target
  // Inventories, not the character rows themselves — matches every
  // other currency-transfer in the codebase).
  const recipientInventoryIds: string[] = recipientCharacterIds.map((charId) => {
    const ch = s.characters.find((c) => c.id === charId);
    if (ch === undefined) {
      throw new Error(`split-evenly: character ${charId} not found`);
    }
    return ch.inventoryStashId;
  });

  const { share, remainder } = currency.splitEvenly(
    {
      cp: poolHolding.cp,
      sp: poolHolding.sp,
      ep: poolHolding.ep,
      gp: poolHolding.gp,
      pp: poolHolding.pp,
    },
    n,
  );

  // Debit N × share from the pool; new pool balance equals the
  // remainder. This is a structural equality (splitEvenly's contract:
  // N × share + remainder === pool) so we can just assign remainder
  // directly rather than re-computing via subtract().
  const nextPool: CurrencyHolding = { ...poolHolding, ...remainder };

  // Credit each recipient Inventory by `share`.
  const nextCurrencies = s.currencies.map((c) => {
    if (c.stashId === fromStashId) return nextPool;
    const idx = recipientInventoryIds.indexOf(c.stashId);
    if (idx === -1) return c;
    return { ...c, ...currency.add(c, share) };
  });

  const shareIsAllZero =
    share.cp === 0 && share.sp === 0 && share.ep === 0 && share.gp === 0 && share.pp === 0;

  // Terminal entry first, then N currency-transfer entries in
  // recipient-order. When the pool was empty (share all zeros), skip
  // the per-recipient transfer entries — nothing moved — but still
  // emit the terminal for audit ("Banker attempted a split; pool was
  // empty; nothing distributed").
  const logEntries: LogEntrySlice[] = [
    {
      type: 'split-evenly',
      payload: {
        fromStashId,
        recipientCharacterIds,
        sharePerRecipient: share,
        remainderInPool: remainder,
      },
    },
  ];
  if (!shareIsAllZero) {
    for (const toStashId of recipientInventoryIds) {
      logEntries.push({
        type: 'currency-transfer',
        payload: { fromStashId, toStashId, delta: share },
      });
    }
  }

  return {
    state: { ...s, currencies: nextCurrencies },
    logEntries,
  };
}

// -------------------------------------------------------------------- //
// start-game-session / end-game-session (RH3.1)
// -------------------------------------------------------------------- //

/**
 * `start-game-session` — marks the start of a play session (OUTLINE §3.12).
 *
 * Guards:
 *   - `state === null` rejects — no bootstrap-via-session.
 *   - `newGameSessionId` must be UUID v7 (RH1 id-authority contract).
 *   - If any prior session has `isCurrent: true`:
 *       - `payload.endCurrentFirst === true` → demote it and emit a
 *         synthetic `end-game-session` slice before the new one.
 *       - Else → throw `session_already_current`.
 *
 * The `number` field is a per-party monotone sequence: `max(existing) + 1`.
 * `date` defaults to `ctx.now()`'s calendar-date portion when omitted.
 * `createdAt` is `ctx.now()` verbatim (full timestamp).
 */
function startGameSession(
  state: AppState,
  payload: Extract<Action, { type: 'start-game-session' }>['payload'],
  ctx: ReducerContext,
): ReducerResult {
  const s = requireState(state, 'start-game-session');

  if (!isValidUuidV7(payload.newGameSessionId)) {
    throw new Error('start-game-session: newGameSessionId must be a valid UUID v7');
  }

  const priorCurrent = s.gameSessions.find((gs) => gs.isCurrent);
  if (priorCurrent !== undefined && payload.endCurrentFirst !== true) {
    throw new Error('start-game-session: session_already_current');
  }

  const now = ctx.now();
  const nextNumber = s.gameSessions.reduce((m, gs) => Math.max(m, gs.number), 0) + 1;
  const date = payload.date ?? now.slice(0, 10);

  const newSession: GameSession = {
    id: payload.newGameSessionId,
    partyId: s.party.id,
    number: nextNumber,
    date,
    ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
    isCurrent: true,
    createdAt: now,
  };

  const logEntries: LogEntrySlice[] = [];

  const demoted: GameSession[] =
    priorCurrent !== undefined
      ? s.gameSessions.map((gs) =>
          gs.id === priorCurrent.id ? { ...gs, isCurrent: false as const } : gs,
        )
      : s.gameSessions;

  if (priorCurrent !== undefined) {
    logEntries.push({
      type: 'end-game-session',
      payload: {
        gameSessionId: priorCurrent.id,
        number: priorCurrent.number,
      },
    });
  }

  logEntries.push({
    type: 'start-game-session',
    payload: {
      gameSessionId: newSession.id,
      number: newSession.number,
      date: newSession.date,
    },
  });

  return {
    state: { ...s, gameSessions: [...demoted, newSession] },
    logEntries,
  };
}

/**
 * `end-game-session` — clears `isCurrent` on the party's current
 * `GameSession`. Subsequent log entries land with `sessionId: null`
 * ("Untagged" bucket per OUTLINE §3.12) until the next `start-game-session`.
 *
 * Guards: rejects with `no_current_session` if no `GameSession` has
 * `isCurrent: true`.
 */
function endGameSession(state: AppState): ReducerResult {
  const s = requireState(state, 'end-game-session');
  const current = s.gameSessions.find((gs) => gs.isCurrent);
  if (current === undefined) {
    throw new Error('end-game-session: no_current_session');
  }
  return {
    state: {
      ...s,
      gameSessions: s.gameSessions.map((gs) =>
        gs.id === current.id ? { ...gs, isCurrent: false as const } : gs,
      ),
    },
    logEntries: [
      {
        type: 'end-game-session',
        payload: {
          gameSessionId: current.id,
          number: current.number,
        },
      },
    ],
  };
}
