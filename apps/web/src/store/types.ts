import type {
  AppState as AppStateShape,
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
    };

export type TransactionLogEntry = LogEntry;
export type { TxType };
