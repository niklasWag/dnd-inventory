import type {
  CurrencyHolding,
  ItemDefinition,
  ItemInstance,
  Stash,
  TransactionLogEntry,
} from '@app/shared';
import { attunement, capacity, currency, inventory, weight as weightRules } from '@app/rules';

import type { Action, AppState } from './types';

/**
 * Pure reducer. Takes the current state and an action, returns the next
 * state along with the log entry payload that should be appended.
 *
 * Why split the log entry across reducer / middleware:
 *   - the reducer is pure (no `crypto.randomUUID`, no `new Date()`), so
 *     it stays trivially testable.
 *   - the middleware (in `index.ts`) injects `id`, `timestamp`,
 *     `actorUserId`, `actorRole`, `partyId`, `sessionId`.
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

export function reduce(state: AppState, action: Action): ReducerResult {
  switch (action.type) {
    case 'create-character':
      return createCharacter(state, action.payload);
    case 'acquire':
      return acquire(state, action.payload);
    case 'consume':
      return consume(state, action.payload);
    case 'seed-catalog':
      return seedCatalog(state, action.payload);
    case 'edit-item-instance':
      return editItemInstance(state, action.payload);
    case 'create-stash':
      return createStash(state, action.payload);
    case 'rename-stash':
      return renameStash(state, action.payload);
    case 'delete-stash':
      return deleteStash(state, action.payload);
    case 'currency-change':
      return currencyChange(state, action.payload);
    case 'transfer':
      return transfer(state, action.payload);
    case 'split':
      return split(state, action.payload);
    case 'currency-transfer':
      return currencyTransfer(state, action.payload);
    case 'create-homebrew':
      return createHomebrew(state, action.payload);
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
    case 'edit-character':
      return editCharacter(state, action.payload);
  }
}

/**
 * Narrows `AppState` from `... | null` to its populated shape, throwing
 * with the action name if state is null. Centralizes the boilerplate that
 * every post-bootstrap reducer case needs.
 */
function requireState(
  state: AppState,
  action: string,
): NonNullable<AppState> {
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
 *   - the Party-of-one with `isSoloShortcut: true`
 *   - two PartyMemberships for the user (dm + player)
 *   - the Character
 *   - three Stashes: Inventory (carried), Party Stash, Recovered Loot
 *   - one CurrencyHolding per stash (all zeroed)
 *
 * Per the resolved open question (roadmap §Open Questions): zero default
 * Storage stashes — those are user-opt-in via M3's "New Storage stash".
 *
 * Refuses to run if a character already exists (MVP §6: "exactly one
 * Character"). M1 enforces this at the reducer; future milestones may
 * allow re-creation after `delete-character`.
 */
function createCharacter(
  state: AppState,
  payload: Extract<Action, { type: 'create-character' }>['payload'],
): ReducerResult {
  if (state !== null) {
    throw new Error('create-character: a character already exists');
  }

  const now = new Date().toISOString();
  const userId = crypto.randomUUID();
  const partyId = crypto.randomUUID();
  const characterId = crypto.randomUUID();
  const inventoryStashId = crypto.randomUUID();
  const partyStashId = crypto.randomUUID();
  const recoveredLootStashId = crypto.randomUUID();

  const nextState: NonNullable<AppState> = {
    version: 1,
    seedVersion: 0,
    user: {
      id: userId,
      displayName: 'You',
      createdAt: now,
    },
    party: {
      id: partyId,
      name: 'My Campaign',
      ownerUserId: userId,
      inviteCode: generateInviteCode(),
      recoveredLootStashId,
      bankerUserId: null,
      isSoloShortcut: true,
      createdAt: now,
    },
    memberships: [
      {
        userId,
        partyId,
        role: 'dm',
        characterId: null,
        joinedAt: now,
        leftAt: null,
      },
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
      {
        id: partyStashId,
        scope: 'party',
        name: 'Party Stash',
        ownerCharacterId: null,
        partyId,
        isCarried: false,
        createdAt: now,
      },
      {
        id: recoveredLootStashId,
        scope: 'recovered-loot',
        name: 'Recovered Loot',
        ownerCharacterId: null,
        partyId,
        isCarried: false,
        createdAt: now,
      },
    ],
    catalog: [],
    items: [],
    currencies: [
      { id: crypto.randomUUID(), stashId: inventoryStashId, cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
      { id: crypto.randomUUID(), stashId: partyStashId, cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
      { id: crypto.randomUUID(), stashId: recoveredLootStashId, cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    ],
    log: [],
  };

  return {
    state: nextState,
    logEntries: [{
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
    }],
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
): ReducerResult {
  const s = requireState(state, 'acquire');

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
    resolvedItemId = crypto.randomUUID();
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
      currentCharges: null,
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
    logEntries: [{
      type: 'acquire',
      payload: {
        stashId: payload.stashId,
        itemInstanceId: resolvedItemId,
        definitionId: payload.definitionId,
        quantity: payload.quantity,
        source: payload.source,
      },
    }],
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
    logEntries: [{
      type: 'consume',
      payload: {
        stashId: row.ownerId,
        itemInstanceId: row.id,
        quantity: payload.quantity,
        removed,
      },
    }],
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
    logEntries: [{
      type: 'seed-catalog',
      payload: {
        seedVersion: payload.seedVersion,
        addedDefinitionIds: added,
        updatedDefinitionIds: updated,
      },
    }],
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
    logEntries: [{
      type: 'edit-item-instance',
      payload: {
        itemInstanceId: row.id,
        changedFields,
      },
    }],
  };
}

/** A short uppercase invite code. Display-only in MVP (Party.inviteCode
 * exists for forward-compat with R4 multi-member join flow). */
function generateInviteCode(): string {
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
): ReducerResult {
  const s = requireState(state, 'create-stash');

  const name = payload.name.trim();
  if (name.length === 0) {
    throw new Error('create-stash: name is empty');
  }
  const owner = s.characters.find((c) => c.id === payload.ownerCharacterId);
  if (owner === undefined) {
    throw new Error(`create-stash: unknown ownerCharacterId ${payload.ownerCharacterId}`);
  }

  const stashId = crypto.randomUUID();
  const newStash: Stash = {
    id: stashId,
    scope: 'character',
    name,
    ownerCharacterId: owner.id,
    partyId: null,
    isCarried: false,
    createdAt: new Date().toISOString(),
  };
  const newCurrency: CurrencyHolding = {
    id: crypto.randomUUID(),
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
    logEntries: [{
      type: 'create-stash',
      payload: {
        stashId,
        scope: 'character',
        name,
        ownerCharacterId: owner.id,
      },
    }],
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
    logEntries: [{
      type: 'rename-stash',
      payload: { stashId: stash.id, oldName, newName },
    }],
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
  const itemsInStash = s.items.filter((i) => i.ownerId === stash.id);
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
    throw new Error(
      `currency-change: would push a denomination negative on ${payload.stashId}`,
    );
  }

  return {
    state: {
      ...s,
      currencies: s.currencies.map((c) =>
        c.stashId === payload.stashId ? nextHolding : c,
      ),
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
): ReducerResult {
  const s = requireState(state, 'transfer');

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
  if (
    payload.toContainerInstanceId !== undefined &&
    payload.toContainerInstanceId !== null
  ) {
    // Self-reference: a row can't contain itself.
    if (payload.toContainerInstanceId === payload.itemInstanceId) {
      throw new Error('transfer: cannot pack a row into itself (self-reference)');
    }
    const parent = s.items.find((i) => i.id === payload.toContainerInstanceId);
    if (parent === undefined) {
      throw new Error(
        `transfer: unknown toContainerInstanceId ${payload.toContainerInstanceId}`,
      );
    }
    // One-level-deep (OUTLINE §3.6): the destination container itself
    // must be top-level (no parent), otherwise this pack would create
    // two-level nesting.
    if (parent.containerInstanceId !== null) {
      throw new Error(
        'transfer: destination container is already nested (one level deep only)',
      );
    }
    // Same-stash (v1): destination container must live in the same stash
    // as the moved row's destination. Cross-stash pack is a 2-step (move
    // then pack) per the R1.5 scope.
    if (parent.ownerId !== payload.toStashId) {
      throw new Error(
        'transfer: destination container must live in the same stash as toStashId',
      );
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
  // anything else, clear `equipped` / `attuned` / `currentCharges`
  // atomically. The cascade is a no-op when the source row was already
  // at the MVP-placeholder values (un-equipped, un-attuned, no charges)
  // — in that case we don't emit the paired `edit-item-instance` entry
  // because nothing actually changed.
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
    // `currentCharges` is still null-locked (R2.2 widens it); the cascade
    // has nothing to clear there yet, but the structure is in place.
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

  // Helper: apply the cascade clear-fields + R1.5 parent change + cross-
  // stash orphan-drop to a row (used in every branch below where we
  // either move or split the source row). Container-parent re-assignment
  // is part of the same atomic write so the §3.4 cascade and R1.5
  // pack/take-out compose cleanly.
  function applyMovedRowMutations(row: ItemInstance): ItemInstance {
    let next = row;
    if (clearedFields.length > 0) {
      next = { ...next, equipped: false, attuned: false };
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
      ? s.items.filter(
          (i) => i.containerInstanceId === source.id && i.ownerId === fromStashId,
        )
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
      if (i.id === source.id)
        return applyMovedRowMutations({ ...i, ownerId: payload.toStashId });
      if (childIds.has(i.id)) return { ...i, ownerId: payload.toStashId };
      return i;
    });
  } else {
    // Partial move with no auto-stack target: clone source into a fresh
    // row in the destination, decrement source. The cascade applies to
    // the NEW row (it's the one that left Inventory). Source row stays
    // in Inventory — flags untouched.
    const newId = crypto.randomUUID();
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
): ReducerResult {
  const s = requireState(state, 'split');

  const source = s.items.find((i) => i.id === payload.itemInstanceId);
  if (source === undefined) {
    throw new Error(`split: unknown itemInstanceId ${payload.itemInstanceId}`);
  }
  inventory.validateSplit(source, payload.quantity);

  const newId = crypto.randomUUID();
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
    throw new Error('currency-transfer: delta values must be non-negative (use the from/to ids to encode direction)');
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
  const nextSource: CurrencyHolding = { ...sourceHolding, ...currency.subtract(sourceHolding, delta) };
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
 *   - mints `definitionId` via `crypto.randomUUID()`,
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
): ReducerResult {
  const s = requireState(state, 'create-homebrew');

  const name = payload.name.trim();
  if (name.length === 0) {
    throw new Error('create-homebrew: name is empty');
  }

  const definitionId = crypto.randomUUID();
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
      characters: s.characters.map((c) =>
        c.id === character.id ? { ...c, name: newName } : c,
      ),
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
        },
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
