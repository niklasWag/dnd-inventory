import type {
  AppState as AppStateShape,
  CreatureSize,
  CurrencyDenomination,
  EncumbranceRule,
  ItemCategory,
  ItemDefinition,
  TransactionLogEntry as LogEntry,
  TxType,
} from '@app/shared';

/**
 * AppState — the typed root from `@app/shared`. The store models the
 * pre-character-creation phase as `null`; M1's `create-character` is the
 * first reducer case that populates the full object.
 */
export type AppState = AppStateShape | null;

/**
 * Action — the discriminated union of every dispatchable mutation. Adding
 * a milestone means extending BOTH this union AND the `TransactionLogEntry`
 * union in `@app/shared` (CLAUDE.md: action types correspond 1:1 to
 * `TransactionLog.type` values).
 *
 * Action payloads here are intentionally a SUBSET of the corresponding log
 * payload — the store middleware fills in the derived fields (ids,
 * timestamps, etc.) at dispatch time, so the UI only supplies what the
 * user actually entered.
 *
 * `seed-catalog` is internal (dispatched by the bootstrap, not by UI), but
 * runs through the same dispatch path so the "every mutation logs" store
 * invariant holds.
 */
export type Action =
  | {
      type: 'create-character';
      payload: {
        name: string;
        species: string;
        size: CreatureSize;
        class: string;
        level: number;
        str: number;
      };
    }
  | {
      type: 'acquire';
      payload: {
        stashId: string;
        definitionId: string;
        quantity: number;
        // 'catalog-add' is the M2.5 catalog-picker source. 'custom-create'
        // stays in the union (back-compat with M2-vintage logs) but new
        // dispatches use 'catalog-add'; M6 will use 'custom-create' for
        // homebrew authorship.
        source: 'hoard' | 'purchase' | 'custom-create' | 'duplicate' | 'catalog-add';
        notes?: string;
      };
    }
  | {
      type: 'consume';
      payload: {
        itemInstanceId: string;
        quantity: number;
      };
    }
  | {
      type: 'seed-catalog';
      payload: {
        seedVersion: number;
        entries: ItemDefinition[];
      };
    }
  | {
      // M2.5: per-instance editor for `customName` + `notes`. R1/R2 widen
      // the patch shape as ItemInstance schema literals relax. The reducer
      // diffs `patch` against the current row, derives `changedFields` from
      // the actually-changed keys, and rejects no-op edits.
      type: 'edit-item-instance';
      payload: {
        itemInstanceId: string;
        patch: {
          customName?: string;
          notes?: string;
        };
      };
    }
  | {
      // M3: create a Storage stash (character-scope, non-carried) owned
      // by `ownerCharacterId`. The reducer constructs the `Stash` row +
      // its `CurrencyHolding` (all zeroed) atomically. Inventory / Party
      // Stash / Recovered Loot are auto-provisioned by `create-character`
      // and are NOT dispatched here.
      type: 'create-stash';
      payload: {
        ownerCharacterId: string;
        name: string;
      };
    }
  | {
      // M3: rename a Storage stash. Reducer rejects rename of Inventory
      // (`isCarried=true`), Party Stash, and Recovered Loot — the three
      // auto-provisioned names are MVP §7 fixtures.
      type: 'rename-stash';
      payload: {
        stashId: string;
        newName: string;
      };
    }
  | {
      // M3: delete a Storage stash. Cascade: items move to Recovered Loot
      // (one synthetic `transfer` per item), currency rolls into Recovered
      // Loot if non-zero (one synthetic `currency-change`), then the stash
      // row + its `CurrencyHolding` are removed. Reducer rejects deletion
      // of Inventory, Party Stash, and Recovered Loot.
      type: 'delete-stash';
      payload: {
        stashId: string;
      };
    }
  | {
      // M4: signed delta on a single stash's CurrencyHolding. Dispatched
      // from the inline +/− editor (reason: 'deposit' | 'withdraw') and
      // from the Convert modal (reason: 'convert', mixed delta). The
      // reducer rejects all-zero deltas, unknown stashIds, and any delta
      // that would push a denomination below zero. R4 will extend the
      // reason enum with 'split-evenly' | 'gameplay-drain' for multi-
      // member Banker actions; M3 already wired 'stash-deleted' for the
      // synthetic delete-cascade entry (emitted directly from the
      // reducer, not via this dispatch path).
      type: 'currency-change';
      payload: {
        stashId: string;
        delta: { cp: number; sp: number; ep: number; gp: number; pp: number };
        reason: 'deposit' | 'withdraw' | 'convert';
      };
    }
  | {
      // M5: move an item (or part of one) from its current stash to
      // another. Auto-stacks onto matching `(definitionId, notes ?? "")`
      // rows on arrival. Same-stash transfers, over-quantity transfers,
      // and unknown stash / item ids are reducer-rejected.
      type: 'transfer';
      payload: {
        itemInstanceId: string;
        toStashId: string;
        quantity: number;
      };
    }
  | {
      // M5: break one stack into two rows in the same stash. The new row
      // inherits `notes` and `customName` from the source so it can
      // immediately be edited via Item Detail (M2.5). Strict validation:
      // `1 \u2264 quantity < source.quantity` — a "split" that empties
      // the source is a transfer, not a split.
      type: 'split';
      payload: {
        itemInstanceId: string;
        quantity: number;
      };
    }
  | {
      // M5.5: atomic stash-to-stash currency move. Replaces a paired
      // debit/credit `currency-change` dispatch. `delta` is the positive
      // amount moving from source to destination; the reducer applies
      // `currency.subtract` to the source (throws on negative result)
      // and `currency.add` to the destination. In MVP (party-of-one,
      // `bankerUserId === null`) any pair of the user's four stashes
      // is a valid source/target. R4 adds Banker-mediated branches.
      type: 'currency-transfer';
      payload: {
        fromStashId: string;
        toStashId: string;
        delta: { cp: number; sp: number; ep: number; gp: number; pp: number };
      };
    }
  | {
      // M6: create a homebrew `ItemDefinition`. The reducer mints
      // `definitionId`, stamps `source: 'homebrew'`, `partyId`, and
      // `createdBy`. `duplicatedFromId` is set when the homebrew was
      // created via the Catalog Browser's Duplicate flow against a PHB
      // row (the user's homebrew clone-with-edits). Reducer requires
      // post-bootstrap state (party + user already provisioned).
      type: 'create-homebrew';
      payload: HomebrewDefinitionInput & { duplicatedFromId?: string };
    }
  | {
      // M6: edit a homebrew `ItemDefinition`. PHB rows are immutable
      // (OUTLINE §3.7) — the reducer rejects edits where the target
      // `source !== 'homebrew'`. The reducer diffs the patch against
      // the current row, derives `changedFields`, and rejects no-op
      // edits (mirrors M2.5 `edit-item-instance`). Each optional field
      // accepts an explicit `undefined` (= "clear this field") which
      // is distinct from absent (= "don't touch this field"), so the
      // patch type uses `T | undefined` rather than `Partial<T>` (which
      // under `exactOptionalPropertyTypes` would forbid the undefined).
      type: 'edit-homebrew';
      payload: {
        definitionId: string;
        patch: HomebrewDefinitionPatch;
      };
    }
  | {
      // M6: delete a homebrew `ItemDefinition`. Reducer rejects when
      // any `ItemInstance.definitionId` references it (delete policy
      // for M6: reject, not cascade). UI surfaces the reference count
      // and disables the delete button until items are removed.
      type: 'delete-homebrew';
      payload: {
        definitionId: string;
      };
    }
  | {
      // M7: rename a Character. UI sends `{ characterId, newName }`; the
      // reducer trims newName, rejects empty + same-name, captures the
      // pre-mutation `oldName` from the row, and emits the full
      // `{ characterId, oldName, newName }` log payload. Mirrors
      // `rename-stash` (M3) exactly. In MVP party-of-one this is always
      // the sole character; R4 widens to owner-only checks in multi-
      // member parties per OUTLINE §8.1.
      type: 'rename-character';
      payload: {
        characterId: string;
        newName: string;
      };
    }
  | {
      // M7: rename the Party. Same split as `rename-character`: UI sends
      // `{ partyId, newName }`; reducer captures `oldName` and emits
      // `{ partyId, oldName, newName }`. In MVP this is the only party
      // (matches `state.party.id`); R4 will restrict to DM in multi-
      // member parties per OUTLINE §8.1.
      type: 'rename-party';
      payload: {
        partyId: string;
        newName: string;
      };
    }
  | {
      // R1.1: flip a Character's encumbrance configuration. Two
      // orthogonal fields covered in one dispatch:
      //   - `rule`    — off | phb | variant — which math to apply.
      //   - `enforce` — orthogonal boolean — does Hard-mode rejection
      //                 apply? R1.1 stores the flag; R1.2 wires the
      //                 actual `acquire` / `transfer` rejection.
      // Reducer captures pre-mutation `oldRule` + `oldEnforce` from the
      // row and rejects no-op (both unchanged) dispatches. UI may set
      // both fields at once or just one; if a caller only wants to
      // touch one, they read the current value and resend it.
      type: 'set-encumbrance';
      payload: {
        characterId: string;
        rule: EncumbranceRule;
        enforce: boolean;
      };
    };

/**
 * User-supplied subset of `ItemDefinition` editable via the M6
 * HomebrewForm. The reducer fills in `id`, `source: 'homebrew'`,
 * `partyId`, `createdBy`, and (when applicable) `duplicatedFromId`.
 *
 * `category` is required so every homebrew row has a stable filter
 * bucket in the catalog browser; everything else is optional.
 */
export interface HomebrewDefinitionInput {
  name: string;
  category: ItemCategory;
  weight?: number;
  cost?: {
    amount: number;
    currency: CurrencyDenomination;
  };
  description?: string;
  tags?: string[];
}

/**
 * Patch shape for `edit-homebrew`. Every field is optional AND may be
 * explicitly `undefined` to mean "clear this optional field". The
 * reducer's diff loop treats "key absent" and "key present with
 * undefined value" as distinct — the latter clears, the former is
 * a no-op for that field. Under `exactOptionalPropertyTypes: true`
 * this requires explicit `| undefined` on each union member.
 */
export interface HomebrewDefinitionPatch {
  name?: string | undefined;
  category?: ItemCategory | undefined;
  weight?: number | undefined;
  cost?:
    | {
        amount: number;
        currency: CurrencyDenomination;
      }
    | undefined;
  description?: string | undefined;
  tags?: string[] | undefined;
}

export type TransactionLogEntry = LogEntry;
export type { TxType };
