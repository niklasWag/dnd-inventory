import type {
  CurrencyHolding,
  ItemDefinition,
  ItemInstance,
  Stash,
  TransactionLogEntry,
} from '@app/shared';

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
        class: payload.class,
        level: payload.level,
        abilityScores: { STR: payload.str },
        maxAttunement: 3,
        encumbranceRule: 'off',
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
  if (!s.catalog.some((d) => d.id === payload.definitionId)) {
    throw new Error(`acquire: unknown definitionId ${payload.definitionId}`);
  }

  // Auto-stack key: (definitionId, notes ?? "").
  const notesKey = payload.notes ?? '';
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
    if (payload.notes !== undefined) newRow.notes = payload.notes;
    nextItems = [...s.items, newRow];
  }

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
 * `currencyTotalCp` uses an inline CP-equivalent formula —
 * `cp + sp*10 + ep*50 + gp*100 + pp*1000`. M4 extracts this to
 * `packages/rules` and replaces the call site here.
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
  // M4 will replace with `packages/rules` currency math. The inline
  // placeholder is dormant in M3 (currency is always 0 in M3 dispatches).
  const currencyTotalCp =
    stashCurrency.cp +
    stashCurrency.sp * 10 +
    stashCurrency.ep * 50 +
    stashCurrency.gp * 100 +
    stashCurrency.pp * 1000;

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
        },
      },
    ],
  };
}
