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
    };

export type TransactionLogEntry = LogEntry;
export type { TxType };
