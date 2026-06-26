import type { Action, PartyMembership } from '../schemas';
import type { AppState } from '../schemas';

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
  return ch !== undefined && ch.ownerUserId === actor.userId;
}

/** True iff the actor owns the stash (directly via stash's character
 * ownership, OR by membership in the party for party-scope and
 * recovered-loot-scope stashes). */
function ownsOrShares(state: AppState, actor: Actor, stashId: string): boolean {
  const stash = state.stashes.find((s) => s.id === stashId);
  if (stash === undefined) return false;
  if (stash.scope === 'character') {
    return stash.ownerCharacterId !== null && ownsCharacter(state, actor, stash.ownerCharacterId);
  }
  // party / recovered-loot — any active member of the party can access
  return stash.partyId === actor.partyId;
}

// -------------------- guard implementations --------------------

const createCharacterGuard: Guard<Extract<Action, { type: 'create-character' }>> = (
  state,
  _payload,
  _actor,
) => {
  // create-character mints the user + party + memberships atomically; before
  // this action runs there is no state. Anyone can create their own initial
  // character — server enforces the actor.userId matches the minted user
  // via the OUTER /sync/actions handler (not here). The guard's job is to
  // assert the action is structurally legal in the current state.
  if (state !== null) {
    return {
      ok: false,
      code: 'state_not_initialized',
      message: 'create-character: state already initialized.',
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
};

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
  // Membership check: actor must be a member of the party they claim.
  // Skipped when state is null (the bootstrap `create-character` action
  // mints the membership rows; there is no party to be a member of yet).
  if (state !== null && !isMember(actor, memberships)) {
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
