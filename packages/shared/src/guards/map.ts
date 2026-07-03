import type { Action, PartyMembership } from '../schemas';
import type { AppState } from '../schemas';
import { CLOCK_SKEW_TOLERANCE_MS, isValidUuidV7, timestampFromUuidV7 } from '../ids';

import type { Actor, GuardResult, GuardState } from './index';
import { isSolo, isMember } from './actor';

/**
 * R3.4.a — guard map for OUTLINE §8.1.
 *
 * Each guard is a pure function `(state, payload, actor) => GuardResult`.
 * The reducer's payload is a SUBSET of the corresponding log payload
 * (the user-supplied bits); the guard inspects pre-mutation `AppState`
 * + the actor's session-derived identity tuple.
 *
 * Per OUTLINE §8.2 the entire matrix is bypassed for solo parties
 * (`memberCount === 1`) — `checkGuard` short-circuits before consulting
 * the map. The per-action guards below are written for the 2+-member
 * future; today they're exercised only by tests that force a
 * non-solo membership list.
 *
 * **DM-only actions in the current 25-action set:**
 *   - `create-homebrew` / `edit-homebrew` / `delete-homebrew`
 *     (OUTLINE §3.7 "Edit ItemDefinition (homebrew)")
 *   - `identify` (OUTLINE §8.1 "Identify magic item (toggle identified)")
 *   - `rename-party` (CLAUDE.md note on `rename-party`: "R4 widens to
 *     DM-only when 2+ members"). Solo: player; multi-member: dm.
 *   - `edit-character.patch.maxAttunement` and `set-encumbrance`
 *     (OUTLINE §8.1 "Edit any character max attunement", "Edit any
 *     character encumbrance rule") — DM-only when 2+ members.
 *
 * **Cross-character actions (DM-only when targeting someone else's
 * character):** `transfer`, `currency-change`, `currency-transfer`,
 * `acquire`, `edit-item-instance`, `equip`/`unequip`, `attune`/
 * `unattune`, `use-charge`, `recharge`, `edit-character`,
 * `rename-character`, `create-stash`/`rename-stash`/`delete-stash`,
 * `consume`, `split`.
 *
 * **System actions:** `seed-catalog` is dispatched at server boot, not
 * by the sync route. The guard is `dm_only` as defense-in-depth in
 * case a client ever tries to drive it.
 *
 * **Banker write rejection.** No action in this set writes
 * `PartyMembership.role = 'banker'` directly. The Zod
 * `partyMembershipSchema` already narrows the role enum to
 * `['dm', 'player']` in MVP (banker is denormalized on
 * `Party.bankerUserId` per OUTLINE §3.14), so this is structural.
 * The guard map ships a defensive `create-character` check that the
 * resulting memberships set never carries a banker row — surfaces a
 * `banker_membership_forbidden` rejection if a future regression
 * ever does so.
 */
export type Guard<A extends Action = Action> = (
  state: GuardState,
  payload: A extends { payload: infer P } ? P : never,
  actor: Actor,
) => GuardResult;

// We need a NonNull AppState helper since most guards consult state.

/** True iff the supplied stash is the supplied character's Inventory.
 * R1.2 / OUTLINE §3.4 — equip/attune/use-charge ONLY work on items in
 * a `scope=character, isCarried=true` stash whose `ownerCharacterId`
 * matches the supplied characterId. */
function isCharacterInventoryStash(state: AppState, stashId: string, characterId: string): boolean {
  const stash = state.stashes.find((s) => s.id === stashId);
  if (stash === undefined) return false;
  return stash.scope === 'character' && stash.isCarried && stash.ownerCharacterId === characterId;
}

/** True iff the actor owns the supplied character. The actor's `userId`
 * must equal the character's `ownerUserId`. */
function ownsCharacter(state: AppState, actor: Actor, characterId: string): boolean {
  const ch = state.characters.find((c) => c.id === characterId);
  if (ch === undefined) return false;
  // R4.3.d — DM can act on any character in their party per OUTLINE §8.1
  // ("Edit any character equip/attune/use-charge/recharge/name via
  // explicit action"). Enforced through the character's partyId; the
  // solo bypass in checkGuard covers the party-of-one case.
  if (actor.role === 'dm' && ch.partyId === actor.partyId) return true;
  return ch.ownerUserId === actor.userId;
}

/** True iff the actor owns the stash (directly via stash's character
 * ownership, OR by membership in the party for party-scope and
 * recovered-loot-scope stashes). */
function ownsOrShares(state: AppState, actor: Actor, stashId: string): boolean {
  const stash = state.stashes.find((s) => s.id === stashId);
  if (stash === undefined) return false;
  if (stash.scope === 'character') {
    // R4.3.c — DM can access any character stash in their party per
    // OUTLINE §8.1 "Edit other players' inventory via explicit action".
    // Verified through the character's partyId (not the stash's, since
    // character stashes have partyId: null — party membership lives on
    // the character row).
    if (actor.role === 'dm' && stash.ownerCharacterId !== null) {
      const character = state.characters.find((c) => c.id === stash.ownerCharacterId);
      if (character !== undefined && character.partyId === actor.partyId) {
        return true;
      }
    }
    return stash.ownerCharacterId !== null && ownsCharacter(state, actor, stash.ownerCharacterId);
  }
  // party / recovered-loot — any active member of the party can access
  return stash.partyId === actor.partyId;
}

/** R4.2.c — true iff the supplied stash is a shared pool (Party Stash
 * or Recovered Loot). Used by the Banker gate on `currency-change` /
 * `currency-transfer` / `transfer` to distinguish "OUT of the shared
 * pool" (gated) from "into own Inventory" or "deposit INTO the pool"
 * (not gated). */
function isSharedPoolStash(state: AppState, stashId: string): boolean {
  const stash = state.stashes.find((s) => s.id === stashId);
  if (stash === undefined) return false;
  return stash.scope === 'party' || stash.scope === 'recovered-loot';
}

/** R4.2.c — Banker-mediated shared-pool gate. Returns a rejection
 * `GuardResult` when the caller should stop; returns `null` when the
 * gate is satisfied and the guard should continue. Applied by
 * `currency-change` (withdraw/convert only), `currency-transfer` (on
 * `fromStashId`), and `transfer` (on the item's `ownerId`). Deposits
 * are un-gated by caller — this helper does NOT distinguish deposit
 * from withdraw; the caller checks the reason/direction first.
 *
 * Solo bypass (§8.2) is handled by `checkGuard` before the guard map
 * is consulted; individual guards (like this one) don't need to
 * re-check. */
function checkBankerGate(
  state: AppState,
  actor: Actor,
  sourceStashId: string,
  actionLabel: string,
): { ok: false; code: 'banker_required_for_claim'; message: string } | null {
  if (!state.party.bankerUserId) return null;
  if (actor.role === 'banker') return null;
  if (!isSharedPoolStash(state, sourceStashId)) return null;
  return {
    ok: false,
    code: 'banker_required_for_claim',
    message: `A Banker is appointed; only the Banker can ${actionLabel} shared-pool contents.`,
  };
}

// -------------------- guard implementations --------------------

const createCharacterGuard: Guard<Extract<Action, { type: 'create-character' }>> = (
  state,
  payload,
  actor,
) => {
  // Two valid shapes per R4.1.f:
  //
  //   1. Bootstrap (state === null): mints the user + party + memberships
  //      atomically. The server enforces actor.userId == minted user via
  //      the /sync/actions handler; the guard's job is structural.
  //
  //   2. Post-bootstrap (state !== null): a joiner who minted a player
  //      row with characterId: null via POST /parties/join, a DM-only DM
  //      adding their character later, or a user recreating after
  //      delete-character. Requires the actor to be an active member of
  //      this party and NOT already to hold a character here.
  if (state === null) {
    return { ok: true };
  }

  // Post-bootstrap path.
  if (payload.dmOnly === true) {
    return {
      ok: false,
      code: 'state_already_initialized',
      message: 'create-character: dmOnly is bootstrap-only; state is already initialized.',
    };
  }

  const activeMembership = state.memberships.find(
    (m) => m.userId === actor.userId && m.leftAt === null,
  );
  if (activeMembership === undefined) {
    return {
      ok: false,
      code: 'not_a_member',
      message: 'create-character: actor is not an active member of this party.',
    };
  }

  const existingPlayerWithCharacter = state.memberships.find(
    (m) =>
      m.userId === actor.userId &&
      m.role === 'player' &&
      m.leftAt === null &&
      m.characterId !== null,
  );
  if (existingPlayerWithCharacter !== undefined) {
    return {
      ok: false,
      code: 'character_already_exists',
      message: 'create-character: actor already has an active player character in this party.',
    };
  }

  return { ok: true };
};

const seedCatalogGuard: Guard<Extract<Action, { type: 'seed-catalog' }>> = (
  _state,
  _payload,
  actor,
) => {
  // System-driven. If a client ever dispatches this, it must be a DM.
  if (actor.role !== 'dm') {
    return { ok: false, code: 'dm_only', message: 'seed-catalog is a DM-only action.' };
  }
  return { ok: true };
};

const acquireGuard: Guard<Extract<Action, { type: 'acquire' }>> = (state, payload, actor) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'acquire: no state.' };
  if (!ownsOrShares(state, actor, payload.stashId)) {
    return {
      ok: false,
      code: 'not_own_stash',
      message: 'Cannot acquire into a stash you do not own / share.',
    };
  }
  return { ok: true };
};

const consumeGuard: Guard<Extract<Action, { type: 'consume' }>> = (state, payload, actor) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'consume: no state.' };
  const item = state.items.find((i) => i.id === payload.itemInstanceId);
  if (item === undefined)
    return { ok: false, code: 'item_not_found', message: 'Item instance not found.' };
  if (!ownsOrShares(state, actor, item.ownerId)) {
    return {
      ok: false,
      code: 'not_own_stash',
      message: 'Cannot consume items in a stash you do not own / share.',
    };
  }
  return { ok: true };
};

const editItemInstanceGuard: Guard<Extract<Action, { type: 'edit-item-instance' }>> = (
  state,
  payload,
  actor,
) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'edit-item-instance: no state.' };
  const item = state.items.find((i) => i.id === payload.itemInstanceId);
  if (item === undefined)
    return { ok: false, code: 'item_not_found', message: 'Item instance not found.' };
  if (!ownsOrShares(state, actor, item.ownerId)) {
    return {
      ok: false,
      code: 'not_own_stash',
      message: 'Cannot edit items in a stash you do not own / share.',
    };
  }
  return { ok: true };
};

const createStashGuard: Guard<Extract<Action, { type: 'create-stash' }>> = (
  state,
  payload,
  actor,
) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'create-stash: no state.' };
  if (!ownsCharacter(state, actor, payload.ownerCharacterId)) {
    return {
      ok: false,
      code: 'not_own_character',
      message: "Cannot create a stash for another player's character.",
    };
  }
  return { ok: true };
};

const renameStashGuard: Guard<Extract<Action, { type: 'rename-stash' }>> = (
  state,
  payload,
  actor,
) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'rename-stash: no state.' };
  if (!ownsOrShares(state, actor, payload.stashId)) {
    return {
      ok: false,
      code: 'not_own_stash',
      message: 'Cannot rename a stash you do not own / share.',
    };
  }
  return { ok: true };
};

const deleteStashGuard: Guard<Extract<Action, { type: 'delete-stash' }>> = (
  state,
  payload,
  actor,
) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'delete-stash: no state.' };
  if (!ownsOrShares(state, actor, payload.stashId)) {
    return {
      ok: false,
      code: 'not_own_stash',
      message: 'Cannot delete a stash you do not own / share.',
    };
  }
  return { ok: true };
};

const currencyChangeGuard: Guard<Extract<Action, { type: 'currency-change' }>> = (
  state,
  payload,
  actor,
) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'currency-change: no state.' };
  if (!ownsOrShares(state, actor, payload.stashId)) {
    return {
      ok: false,
      code: 'not_own_stash',
      message: 'Cannot change currency in a stash you do not own / share.',
    };
  }
  // R4.2.d — `gameplay-drain` is a DM-only reason. Any non-DM using it
  // is rejected regardless of Banker state. For the DM it bypasses the
  // R4.2.c Banker gate on shared-pool sources (§8.1: DM may drain the
  // pool for gameplay reasons while a Banker is active — the Banker
  // controls distribution to players, not the world-level drain).
  if (payload.reason === 'gameplay-drain') {
    if (actor.role !== 'dm') {
      return {
        ok: false,
        code: 'dm_only',
        message: 'Only the DM may drain a shared pool for gameplay reasons.',
      };
    }
    return { ok: true };
  }
  // R4.2.c — Banker-mediated shared-pool gate. Withdrawals & currency
  // conversions on a Party Stash / Recovered Loot are Banker-only when
  // a Banker is appointed. Deposits are un-gated (§8.1: any member can
  // add currency INTO a shared pool).
  if (payload.reason === 'withdraw' || payload.reason === 'convert') {
    const gated = checkBankerGate(state, actor, payload.stashId, 'withdraw or convert');
    if (gated !== null) return gated;
  }
  return { ok: true };
};

const transferGuard: Guard<Extract<Action, { type: 'transfer' }>> = (state, payload, actor) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'transfer: no state.' };
  const item = state.items.find((i) => i.id === payload.itemInstanceId);
  if (item === undefined)
    return { ok: false, code: 'item_not_found', message: 'Item instance not found.' };
  // Source ownership: must own/share the source stash. Destination
  // ownership is implicit (transferring INTO a shared party stash is
  // a deposit; transferring INTO another player's stash is a DM-only
  // action per §8.1 — but in MVP-solo that's solo-bypass anyway).
  if (!ownsOrShares(state, actor, item.ownerId)) {
    return {
      ok: false,
      code: 'not_own_stash',
      message: 'Cannot transfer from a stash you do not own / share.',
    };
  }
  // R4.2.c — Banker-mediated shared-pool gate. Moving an item OUT of a
  // Party Stash / Recovered Loot is Banker-only when a Banker is
  // appointed. Deposits (INTO the pool) stay allowed for anyone.
  const gated = checkBankerGate(state, actor, item.ownerId, 'move items out of');
  if (gated !== null) return gated;
  return { ok: true };
};

const splitGuard: Guard<Extract<Action, { type: 'split' }>> = (state, payload, actor) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'split: no state.' };
  const item = state.items.find((i) => i.id === payload.itemInstanceId);
  if (item === undefined)
    return { ok: false, code: 'item_not_found', message: 'Item instance not found.' };
  if (!ownsOrShares(state, actor, item.ownerId)) {
    return {
      ok: false,
      code: 'not_own_stash',
      message: 'Cannot split items in a stash you do not own / share.',
    };
  }
  return { ok: true };
};

const currencyTransferGuard: Guard<Extract<Action, { type: 'currency-transfer' }>> = (
  state,
  payload,
  actor,
) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'currency-transfer: no state.' };
  if (!ownsOrShares(state, actor, payload.fromStashId)) {
    return {
      ok: false,
      code: 'not_own_stash',
      message: 'Cannot move currency from a stash you do not own / share.',
    };
  }
  // R4.2.c — Banker-mediated shared-pool gate. Moving currency OUT of a
  // Party Stash / Recovered Loot is Banker-only when a Banker is
  // appointed. Depositing INTO a shared pool (fromStashId = character
  // stash, toStashId = pool) stays allowed for anyone.
  const gated = checkBankerGate(state, actor, payload.fromStashId, 'move currency out of');
  if (gated !== null) return gated;
  return { ok: true };
};

const createHomebrewGuard: Guard<Extract<Action, { type: 'create-homebrew' }>> = (
  state,
  _payload,
  actor,
) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'create-homebrew: no state.' };
  if (actor.role !== 'dm') {
    return {
      ok: false,
      code: 'dm_only',
      message: 'create-homebrew is a DM-only action when the party has 2+ members.',
    };
  }
  return { ok: true };
};

const editHomebrewGuard: Guard<Extract<Action, { type: 'edit-homebrew' }>> = (
  state,
  _payload,
  actor,
) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'edit-homebrew: no state.' };
  if (actor.role !== 'dm') {
    return {
      ok: false,
      code: 'dm_only',
      message: 'edit-homebrew is a DM-only action when the party has 2+ members.',
    };
  }
  return { ok: true };
};

const deleteHomebrewGuard: Guard<Extract<Action, { type: 'delete-homebrew' }>> = (
  state,
  _payload,
  actor,
) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'delete-homebrew: no state.' };
  if (actor.role !== 'dm') {
    return {
      ok: false,
      code: 'dm_only',
      message: 'delete-homebrew is a DM-only action when the party has 2+ members.',
    };
  }
  return { ok: true };
};

const renameCharacterGuard: Guard<Extract<Action, { type: 'rename-character' }>> = (
  state,
  payload,
  actor,
) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'rename-character: no state.' };
  if (!ownsCharacter(state, actor, payload.characterId)) {
    return {
      ok: false,
      code: 'not_own_character',
      message: "Cannot rename another player's character.",
    };
  }
  return { ok: true };
};

const renamePartyGuard: Guard<Extract<Action, { type: 'rename-party' }>> = (
  state,
  _payload,
  actor,
) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'rename-party: no state.' };
  if (actor.role !== 'dm') {
    return {
      ok: false,
      code: 'dm_only',
      message: 'rename-party is a DM-only action when the party has 2+ members.',
    };
  }
  return { ok: true };
};

const setEncumbranceGuard: Guard<Extract<Action, { type: 'set-encumbrance' }>> = (
  state,
  _payload,
  actor,
) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'set-encumbrance: no state.' };
  // OUTLINE §8.1 "Edit any character encumbrance rule + enforce flag" → DM-only.
  if (actor.role !== 'dm') {
    return {
      ok: false,
      code: 'dm_only',
      message: 'set-encumbrance is a DM-only action when the party has 2+ members.',
    };
  }
  return { ok: true };
};

const equipGuard: Guard<Extract<Action, { type: 'equip' }>> = (state, payload, actor) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'equip: no state.' };
  if (!ownsCharacter(state, actor, payload.characterId)) {
    return {
      ok: false,
      code: 'not_own_character',
      message: "Cannot equip items on another player's character.",
    };
  }
  const item = state.items.find((i) => i.id === payload.itemInstanceId);
  if (item === undefined)
    return { ok: false, code: 'item_not_found', message: 'Item instance not found.' };
  if (!isCharacterInventoryStash(state, item.ownerId, payload.characterId)) {
    return {
      ok: false,
      code: 'equip_only_in_inventory',
      message: "Equip only works on items in the character's Inventory.",
    };
  }
  return { ok: true };
};

const unequipGuard: Guard<Extract<Action, { type: 'unequip' }>> = (state, payload, actor) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'unequip: no state.' };
  if (!ownsCharacter(state, actor, payload.characterId)) {
    return {
      ok: false,
      code: 'not_own_character',
      message: "Cannot unequip items on another player's character.",
    };
  }
  const item = state.items.find((i) => i.id === payload.itemInstanceId);
  if (item === undefined)
    return { ok: false, code: 'item_not_found', message: 'Item instance not found.' };
  if (!isCharacterInventoryStash(state, item.ownerId, payload.characterId)) {
    return {
      ok: false,
      code: 'equip_only_in_inventory',
      message: "Unequip only works on items in the character's Inventory.",
    };
  }
  return { ok: true };
};

const attuneGuard: Guard<Extract<Action, { type: 'attune' }>> = (state, payload, actor) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'attune: no state.' };
  // R4.3.d — cap-override is DM-only per OUTLINE §3.8. Bankers stay
  // bound by the cap; DM must explicitly opt in via `overrideCap: true`.
  if (payload.overrideCap === true && actor.role !== 'dm') {
    return {
      ok: false,
      code: 'dm_only',
      message: 'attune cap-override is a DM-only action.',
    };
  }
  if (!ownsCharacter(state, actor, payload.characterId)) {
    return {
      ok: false,
      code: 'not_own_character',
      message: "Cannot attune items on another player's character.",
    };
  }
  const item = state.items.find((i) => i.id === payload.itemInstanceId);
  if (item === undefined)
    return { ok: false, code: 'item_not_found', message: 'Item instance not found.' };
  if (!isCharacterInventoryStash(state, item.ownerId, payload.characterId)) {
    return {
      ok: false,
      code: 'attune_only_in_inventory',
      message: "Attune only works on items in the character's Inventory.",
    };
  }
  return { ok: true };
};

const unattuneGuard: Guard<Extract<Action, { type: 'unattune' }>> = (state, payload, actor) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'unattune: no state.' };
  if (!ownsCharacter(state, actor, payload.characterId)) {
    return {
      ok: false,
      code: 'not_own_character',
      message: "Cannot unattune items on another player's character.",
    };
  }
  const item = state.items.find((i) => i.id === payload.itemInstanceId);
  if (item === undefined)
    return { ok: false, code: 'item_not_found', message: 'Item instance not found.' };
  if (!isCharacterInventoryStash(state, item.ownerId, payload.characterId)) {
    return {
      ok: false,
      code: 'attune_only_in_inventory',
      message: "Unattune only works on items in the character's Inventory.",
    };
  }
  return { ok: true };
};

const useChargeGuard: Guard<Extract<Action, { type: 'use-charge' }>> = (state, payload, actor) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'use-charge: no state.' };
  if (!ownsCharacter(state, actor, payload.characterId)) {
    return {
      ok: false,
      code: 'not_own_character',
      message: "Cannot use charges on another player's character.",
    };
  }
  const item = state.items.find((i) => i.id === payload.itemInstanceId);
  if (item === undefined)
    return { ok: false, code: 'item_not_found', message: 'Item instance not found.' };
  if (!isCharacterInventoryStash(state, item.ownerId, payload.characterId)) {
    return {
      ok: false,
      code: 'use_charge_only_in_inventory',
      message: "use-charge only works on items in the character's Inventory.",
    };
  }
  return { ok: true };
};

const rechargeGuard: Guard<Extract<Action, { type: 'recharge' }>> = (state, payload, actor) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'recharge: no state.' };
  if (!ownsCharacter(state, actor, payload.characterId)) {
    return {
      ok: false,
      code: 'not_own_character',
      message: "Cannot recharge another player's character's items.",
    };
  }
  // batch mode operates across the character's Inventory; single/manual
  // checks the specific item is in the character's Inventory.
  if (payload.mode !== 'batch') {
    const item = state.items.find((i) => i.id === payload.itemInstanceId);
    if (item === undefined)
      return { ok: false, code: 'item_not_found', message: 'Item instance not found.' };
    if (!isCharacterInventoryStash(state, item.ownerId, payload.characterId)) {
      return {
        ok: false,
        code: 'use_charge_only_in_inventory',
        message: "recharge only works on items in the character's Inventory.",
      };
    }
  }
  return { ok: true };
};

const identifyGuard: Guard<Extract<Action, { type: 'identify' }>> = (state, _payload, actor) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'identify: no state.' };
  // OUTLINE §8.1 "Identify magic item (toggle identified)" → DM-only.
  if (actor.role !== 'dm') {
    return {
      ok: false,
      code: 'dm_only',
      message: 'identify is a DM-only action when the party has 2+ members.',
    };
  }
  return { ok: true };
};

const editCharacterGuard: Guard<Extract<Action, { type: 'edit-character' }>> = (
  state,
  payload,
  actor,
) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'edit-character: no state.' };
  // OUTLINE §8.1 "Edit any character max attunement" is DM-only;
  // species / class / level / str are owner-editable. Mixed patch:
  //   - if patch includes maxAttunement, require DM,
  //   - if patch includes ANY of the others, require owner.
  // Owner is a strict superset for DM-only actions (DM may edit any
  // character per §8.1 "Edit own character name / species / class /
  // level — DM (any character, via explicit action)").
  const patchHasMaxAttunement = payload.patch.maxAttunement !== undefined;
  if (patchHasMaxAttunement && actor.role !== 'dm') {
    return {
      ok: false,
      code: 'dm_only',
      message: 'maxAttunement is a DM-only edit when the party has 2+ members.',
    };
  }
  if (actor.role === 'dm') return { ok: true };
  if (!ownsCharacter(state, actor, payload.characterId)) {
    return {
      ok: false,
      code: 'not_own_character',
      message: "Cannot edit another player's character.",
    };
  }
  return { ok: true };
};

/**
 * R4.1.b — `delete-character`. Per OUTLINE §8.3 the cascade is invoked
 * by (a) the owning player self-removing their character, or (b) the
 * DM removing any character via explicit action. Both go through this
 * same TxType; the guard accepts the owner OR DM (DM is the strict
 * superset). Solo bypass (`checkGuard`) means the sole member of a
 * party-of-one always succeeds.
 */
const deleteCharacterGuard: Guard<Extract<Action, { type: 'delete-character' }>> = (
  state,
  payload,
  actor,
) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'delete-character: no state.' };
  const ch = state.characters.find((c) => c.id === payload.characterId);
  if (ch === undefined) {
    return { ok: false, code: 'character_not_found', message: 'Character not found.' };
  }
  if (actor.role === 'dm') return { ok: true };
  if (ch.ownerUserId !== actor.userId) {
    return {
      ok: false,
      code: 'not_own_character',
      message: "Cannot delete another player's character.",
    };
  }
  return { ok: true };
};

/**
 * R4.1.c — `leave-party`. Self-service: any active member may leave
 * (the reducer enforces sole-member / sole-DM rejection separately).
 * The guard's role is purely "is the actor a member of this party at
 * all?" — the §8.3 cascade business rules live in the reducer.
 *
 * Solo bypass (`checkGuard`) means the sole member's leave attempt
 * always reaches the reducer, which rejects with the archive-flow
 * message — surfacing as a 422 to the client with a clear next step.
 */
const leavePartyGuard: Guard<Extract<Action, { type: 'leave-party' }>> = (
  state,
  _payload,
  actor,
) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'leave-party: no state.' };
  // `actor.partyId` is the canonical party for this dispatch (resolved
  // server-side from session + URL). Confirm the actor has at least one
  // active membership row.
  const hasActive = state.memberships.some(
    (m) => m.userId === actor.userId && m.partyId === actor.partyId && m.leftAt === null,
  );
  if (!hasActive) {
    return { ok: false, code: 'not_a_member', message: 'You are not a member of this party.' };
  }
  return { ok: true };
};

/**
 * R4.1.d — `kick-player`. Per OUTLINE §8.1 "Kick player" the action is
 * DM-only. The guard rejects non-DM actors and verifies the target is
 * an active member of this party.
 *
 * The reducer enforces the business invariants (no self-kick; kicked
 * user must not be a DM); the guard only asserts the
 * `state.memberships` evidence that the target is actually here. Solo
 * bypass (`checkGuard`) means the sole member can't structurally
 * dispatch `kick-player` against anyone — there's no one else to kick.
 */
const kickPlayerGuard: Guard<Extract<Action, { type: 'kick-player' }>> = (
  state,
  payload,
  actor,
) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'kick-player: no state.' };
  if (actor.role !== 'dm') {
    return { ok: false, code: 'dm_only', message: 'Only the DM can kick a player.' };
  }
  const targetActive = state.memberships.some(
    (m) => m.userId === payload.kickedUserId && m.partyId === actor.partyId && m.leftAt === null,
  );
  if (!targetActive) {
    return {
      ok: false,
      code: 'not_a_member',
      message: 'Target user is not an active member of this party.',
    };
  }
  return { ok: true };
};

/**
 * R4.1.e — `join-party`. Server-driven action dispatched on the user's
 * behalf after a successful invite-code redemption. The guard's job is
 * narrow: reject if the actor is *already* an active member of this
 * party (the server route also rejects with `already_member`, but
 * defense-in-depth never hurts).
 *
 * Unlike most other guards, this one does NOT check `isMember` against
 * the standard membership list — the actor is by definition not yet
 * a member when this action runs. `checkGuard`'s top-level
 * `isMember` short-circuit must be bypassed for this action; we
 * handle that in `checkGuard` via the special-case list (see R3.4.a
 * for the `create-character` precedent).
 */
const joinPartyGuard: Guard<Extract<Action, { type: 'join-party' }>> = (state, _payload, actor) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'join-party: no state.' };
  const alreadyMember = state.memberships.some(
    (m) =>
      m.userId === actor.userId &&
      m.partyId === actor.partyId &&
      m.role === 'player' &&
      m.leftAt === null,
  );
  if (alreadyMember) {
    return {
      ok: false,
      code: 'not_a_member',
      message: 'You are already a member of this party.',
    };
  }
  return { ok: true };
};

/**
 * R4.2.a — `appoint-banker`. DM-only. Mirrors the reducer's invariants
 * server-side per SECURITY §2 (server is authoritative; never trust
 * client claims about role / target / state). Covers:
 *   - actor must be DM in this party (`dm_only`).
 *   - target must not equal `party.ownerUserId` (no self-banker).
 *   - target must have an active `role='player'` membership.
 *   - party must have memberCount ≥ 2 (solo has no Banker).
 *   - party.bankerUserId must currently be null (reassign = explicit
 *     two-step revoke + appoint per OUTLINE §3.14).
 *
 * `banker_membership_forbidden` is the rejection code defined in
 * `GuardRejectionCode` (R3.4.a) — this guard is its first live caller.
 */
const appointBankerGuard: Guard<Extract<Action, { type: 'appoint-banker' }>> = (
  state,
  payload,
  actor,
) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'appoint-banker: no state.' };
  if (actor.role !== 'dm') {
    return { ok: false, code: 'dm_only', message: 'Only the DM can appoint a Banker.' };
  }
  if (payload.bankerUserId === state.party.ownerUserId) {
    return {
      ok: false,
      code: 'banker_membership_forbidden',
      message: 'The DM cannot appoint themselves as Banker.',
    };
  }
  if (state.party.bankerUserId !== null) {
    return {
      ok: false,
      code: 'banker_membership_forbidden',
      message: 'A Banker is already appointed; revoke first before appointing a new one.',
    };
  }
  const targetIsActivePlayer = state.memberships.some(
    (m) =>
      m.userId === payload.bankerUserId &&
      m.partyId === actor.partyId &&
      m.role === 'player' &&
      m.leftAt === null,
  );
  if (!targetIsActivePlayer) {
    return {
      ok: false,
      code: 'banker_membership_forbidden',
      message: 'Target user lacks an active player membership in this party.',
    };
  }
  const activeUserIds = new Set(
    state.memberships
      .filter((m) => m.partyId === actor.partyId && m.leftAt === null)
      .map((m) => m.userId),
  );
  if (activeUserIds.size < 2) {
    return {
      ok: false,
      code: 'banker_membership_forbidden',
      message: 'A Banker can only be appointed in a party with two or more members.',
    };
  }
  return { ok: true };
};

/**
 * R4.2.a — `revoke-banker`. DM-only. Rejects if no Banker is currently
 * set. Only `reason: 'manual' | 'reassigned'` reach this guard via
 * direct dispatch; `'left-party'` and `'kicked'` are emitted as
 * synthetic cascade slices from the leave/kick reducer arms and don't
 * go through `POST /sync/actions` separately, so the guard layer
 * doesn't need to special-case them.
 */
const revokeBankerGuard: Guard<Extract<Action, { type: 'revoke-banker' }>> = (
  state,
  _payload,
  actor,
) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'revoke-banker: no state.' };
  if (actor.role !== 'dm') {
    return { ok: false, code: 'dm_only', message: 'Only the DM can revoke the Banker.' };
  }
  if (state.party.bankerUserId === null) {
    return {
      ok: false,
      code: 'banker_membership_forbidden',
      message: 'No Banker is currently set; nothing to revoke.',
    };
  }
  return { ok: true };
};

/**
 * R4.3.a — `dm-transfer`. DM-only. Full server-authoritative guard
 * lands in R4.3.b (with dedicated tests + integration coverage); this
 * R4.3.a placeholder mirrors the reducer's three rejection cases so
 * the type-level exhaustiveness of the guards map is satisfied and
 * dispatches from the web client are gated identically on both sides
 * of the wire (defense-in-depth per SECURITY §2).
 *
 * Rejects when:
 *   - actor.role !== 'dm' (`dm_only`).
 *   - actor.userId === newDmUserId (`dm_transfer_self`).
 *   - newDmUserId lacks an active `role='player'` membership in this
 *     party (`dm_transfer_target_not_member`).
 */
const dmTransferGuard: Guard<Extract<Action, { type: 'dm-transfer' }>> = (
  state,
  payload,
  actor,
) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'dm-transfer: no state.' };
  if (actor.role !== 'dm') {
    return { ok: false, code: 'dm_only', message: 'Only the DM can transfer the DM role.' };
  }
  if (payload.newDmUserId === actor.userId) {
    return {
      ok: false,
      code: 'dm_transfer_self',
      message: 'The DM cannot transfer the DM role to themselves.',
    };
  }
  const targetIsActivePlayer = state.memberships.some(
    (m) =>
      m.userId === payload.newDmUserId &&
      m.partyId === actor.partyId &&
      m.role === 'player' &&
      m.leftAt === null,
  );
  if (!targetIsActivePlayer) {
    return {
      ok: false,
      code: 'dm_transfer_target_not_member',
      message: 'Target user lacks an active player membership in this party.',
    };
  }
  return { ok: true };
};

/**
 * R4.2.d — `split-evenly`. Banker-only. Splits `fromStashId`'s currency
 * across the supplied `recipientCharacterIds`. Guards:
 *   - actor.role must be 'banker' (rejected otherwise with the same
 *     `banker_required_for_claim` code as R4.2.c so the client can
 *     branch uniformly on shared-pool distribution rejections).
 *   - fromStashId must reference a Party Stash (`scope: 'party'`) in
 *     this party. Recovered Loot / Inventory / other scopes rejected
 *     with `stash_not_found` (the resource isn't a valid split source).
 *   - Every recipient must be an active player's character in this
 *     party; otherwise `character_not_found`. The Banker's own
 *     character IS a valid recipient per OUTLINE §8.1.
 */
const splitEvenlyGuard: Guard<Extract<Action, { type: 'split-evenly' }>> = (
  state,
  payload,
  actor,
) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'split-evenly: no state.' };
  if (actor.role !== 'banker') {
    return {
      ok: false,
      code: 'banker_required_for_claim',
      message: 'Only the Banker can split shared-pool currency across the party.',
    };
  }
  const stash = state.stashes.find((s) => s.id === payload.fromStashId);
  if (stash === undefined || stash.scope !== 'party' || stash.partyId !== actor.partyId) {
    return {
      ok: false,
      code: 'stash_not_found',
      message: 'split-evenly source must be the Party Stash of this party.',
    };
  }
  const activePartyCharacterIds = new Set(
    state.memberships
      .filter(
        (m) =>
          m.partyId === actor.partyId &&
          m.role === 'player' &&
          m.leftAt === null &&
          m.characterId !== null,
      )
      .map((m) => m.characterId as string),
  );
  for (const recipientId of payload.recipientCharacterIds) {
    if (!activePartyCharacterIds.has(recipientId)) {
      return {
        ok: false,
        code: 'character_not_found',
        message: `Recipient ${recipientId} is not an active player character in this party.`,
      };
    }
  }
  return { ok: true };
};

/**
 * RH3.1 — `start-game-session`. DM-only per OUTLINE §3.12 ("the DM
 * marks the current session"). §8.2 solo bypass is handled by
 * `checkGuard` upstream.
 */
const startGameSessionGuard: Guard<Extract<Action, { type: 'start-game-session' }>> = (
  state,
  _payload,
  actor,
) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'start-game-session: no state.' };
  if (actor.role !== 'dm') {
    return {
      ok: false,
      code: 'dm_only',
      message: 'start-game-session is a DM-only action when the party has 2+ members.',
    };
  }
  return { ok: true };
};

/**
 * RH3.1 — `end-game-session`. DM-only per OUTLINE §3.12 (symmetric with
 * `start-game-session`). §8.2 solo bypass is handled by `checkGuard`
 * upstream.
 */
const endGameSessionGuard: Guard<Extract<Action, { type: 'end-game-session' }>> = (
  state,
  _payload,
  actor,
) => {
  if (state === null)
    return { ok: false, code: 'state_not_initialized', message: 'end-game-session: no state.' };
  if (actor.role !== 'dm') {
    return {
      ok: false,
      code: 'dm_only',
      message: 'end-game-session is a DM-only action when the party has 2+ members.',
    };
  }
  return { ok: true };
};

export const guards: { [K in Action['type']]: Guard<Extract<Action, { type: K }>> } = {
  'create-character': createCharacterGuard,
  acquire: acquireGuard,
  consume: consumeGuard,
  'seed-catalog': seedCatalogGuard,
  'edit-item-instance': editItemInstanceGuard,
  'create-stash': createStashGuard,
  'rename-stash': renameStashGuard,
  'delete-stash': deleteStashGuard,
  'currency-change': currencyChangeGuard,
  transfer: transferGuard,
  split: splitGuard,
  'currency-transfer': currencyTransferGuard,
  'create-homebrew': createHomebrewGuard,
  'edit-homebrew': editHomebrewGuard,
  'delete-homebrew': deleteHomebrewGuard,
  'rename-character': renameCharacterGuard,
  'rename-party': renamePartyGuard,
  'set-encumbrance': setEncumbranceGuard,
  equip: equipGuard,
  unequip: unequipGuard,
  attune: attuneGuard,
  unattune: unattuneGuard,
  'use-charge': useChargeGuard,
  recharge: rechargeGuard,
  identify: identifyGuard,
  'edit-character': editCharacterGuard,
  'delete-character': deleteCharacterGuard,
  'leave-party': leavePartyGuard,
  'kick-player': kickPlayerGuard,
  'join-party': joinPartyGuard,
  'appoint-banker': appointBankerGuard,
  'revoke-banker': revokeBankerGuard,
  'dm-transfer': dmTransferGuard,
  'split-evenly': splitEvenlyGuard,
  'start-game-session': startGameSessionGuard,
  'end-game-session': endGameSessionGuard,
};

/**
 * RH1.2 — Validate all client-minted UUID v7 ids attached to an action's
 * payload. Runs upstream of every per-action guard (see `checkGuard`
 * below) so a malformed or clock-skewed id is rejected regardless of
 * §8.1 permissions and the §8.2 solo bypass.
 *
 * Returns `null` on success, or a `GuardResult` rejection with code
 * `id_malformed` / `id_clock_skew` on failure. The `id_already_exists`
 * code is NOT checked here — it requires a Prisma unique-constraint
 * round-trip and is mapped at the server route layer (§3 in the RH1
 * charter: `POST /sync/actions` catches `P2002` and re-throws as
 * `BatchRejected(index, 'id_already_exists', ...)`).
 *
 * Actions with no client-minted ids (25 of the 31 in the union) pass
 * through as `null`. The six minting actions per RH1.2 are:
 *   - `create-character` (3 or 9 ids depending on branch/state)
 *   - `acquire` (`newItemInstanceId`)
 *   - `create-stash` (`newStashId`, `newCurrencyHoldingId`)
 *   - `transfer` (`newItemInstanceId`)
 *   - `split` (`newItemInstanceId`)
 *   - `create-homebrew` (`newDefinitionId`)
 */
function checkMintedIds(action: Action): GuardResult | null {
  const ids: string[] = [];
  switch (action.type) {
    case 'acquire':
    case 'transfer':
    case 'split':
      ids.push(action.payload.newItemInstanceId);
      break;
    case 'create-stash':
      ids.push(action.payload.newStashId, action.payload.newCurrencyHoldingId);
      break;
    case 'create-homebrew':
      ids.push(action.payload.newDefinitionId);
      break;
    case 'create-character': {
      // Both branches carry party-scope bootstrap ids (optional on the
      // with-character branch, required on the dmOnly branch). Collect
      // whatever is present; the reducer boundary is the authority on
      // "which subset is required for this state".
      const p = action.payload;
      const maybeIds = [
        p.newUserId,
        p.newPartyId,
        p.newPartyStashId,
        p.newRecoveredLootStashId,
        p.newPartyStashCurrencyId,
        p.newRecoveredLootCurrencyId,
      ];
      for (const id of maybeIds) {
        if (typeof id === 'string') ids.push(id);
      }
      if (p.dmOnly !== true) {
        // with-character branch: character/inventory ids are always required.
        ids.push(p.newCharacterId, p.newInventoryStashId, p.newCurrencyHoldingId);
      }
      break;
    }
    default:
      return null;
  }
  const now = Date.now();
  for (const id of ids) {
    if (!isValidUuidV7(id)) {
      return {
        ok: false,
        code: 'id_malformed',
        message: `Action ${action.type} carries a malformed id (not a UUID v7): ${id}`,
      };
    }
    const drift = Math.abs(timestampFromUuidV7(id) - now);
    if (drift > CLOCK_SKEW_TOLERANCE_MS) {
      return {
        ok: false,
        code: 'id_clock_skew',
        message: `Action ${action.type} carries an id with clock skew ${drift}ms > ${CLOCK_SKEW_TOLERANCE_MS}ms tolerance.`,
      };
    }
  }
  return null;
}

/**
 * Dispatch a guard for an action. Per OUTLINE §8.2: solo parties bypass
 * the §8.1 matrix (the sole member gets the UNION of DM + Player rights),
 * so we short-circuit to `{ ok: true }` for those cases. The per-action
 * guards below are written for the 2+-member future and tested with a
 * forced non-solo membership list.
 */
export function checkGuard(
  state: GuardState,
  action: Action,
  actor: Actor,
  memberships: readonly PartyMembership[],
): GuardResult {
  // RH1.2 — id-shape + clock-skew validation on client-minted UUID v7
  // ids in the payload. Runs BEFORE the solo bypass so a malformed or
  // clock-skewed id is rejected even for party-of-one. This is a pure
  // check (payload-only + Date.now()) that applies to every mutation
  // regardless of §8.1 permission logic.
  const idCheck = checkMintedIds(action);
  if (idCheck !== null) return idCheck;

  // Membership check: actor must be a member of the party they claim.
  // Skipped when state is null (the bootstrap `create-character` action
  // mints the membership rows; there is no party to be a member of yet).
  // Also skipped for `join-party` (R4.1.e) since the actor is by
  // definition not yet a member.
  if (state !== null && action.type !== 'join-party' && !isMember(actor, memberships)) {
    return {
      ok: false,
      code: 'not_a_member',
      message: 'Actor is not an active member of the party.',
    };
  }
  // §8.2 solo bypass.
  if (isSolo(memberships)) return { ok: true };
  const guard = guards[action.type];
  // The map is `Record<Action['type'], Guard>` so guard is non-null in
  // normal flow. The structural fallback is defense against runtime
  // erosion (e.g. a rogue dispatch with an unknown discriminator that
  // slipped past Zod somehow).
  if (guard === undefined) {
    return {
      ok: false,
      code: 'unknown_action',
      message: `No guard registered for action ${(action as { type: string }).type}.`,
    };
  }
  // The TS-level type-narrowing inside the map's heterogeneous record
  // doesn't carry through to a generic `Action` parameter, so the cast
  // here is unavoidable; the runtime dispatch is sound because the
  // map keys come from `Action['type']` and the per-key value's payload
  // type matches the per-key extracted payload.
  return (guard as Guard)(state, (action as { payload: unknown }).payload as never, actor);
}
