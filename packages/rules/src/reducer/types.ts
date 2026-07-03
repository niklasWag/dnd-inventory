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
      payload:
        | {
            // Legacy bootstrap: mints User + Party + dm + player
            // memberships + Character + 3 stashes + 3 currency rows.
            // `partyName` optional; falls back to 'My Campaign'.
            //
            // RH1.2 — client-minted ids on the wire. `newCharacterId` +
            // `newInventoryStashId` + `newCurrencyHoldingId` are always
            // required (both bootstrap + in-existing-party paths). The
            // six bootstrap-only ids are optional at the type level and
            // required at the reducer boundary when state === null.
            dmOnly?: false;
            name: string;
            species: string;
            size: CreatureSize;
            class: string;
            level: number;
            str: number;
            partyName?: string;
            newCharacterId: string;
            newInventoryStashId: string;
            newCurrencyHoldingId: string;
            newUserId?: string;
            newPartyId?: string;
            newPartyStashId?: string;
            newRecoveredLootStashId?: string;
            newPartyStashCurrencyId?: string;
            newRecoveredLootCurrencyId?: string;
          }
        | {
            // R4.1-followup: DM-only bootstrap. No Character, no
            // Inventory stash, no player membership. Used by the
            // Hub's Create-party "I don't want to play a character"
            // branch (OUTLINE §3.1). RH1.2 — mints the 6 bootstrap-scope
            // ids (no character/inventory).
            dmOnly: true;
            partyName: string;
            newUserId: string;
            newPartyId: string;
            newPartyStashId: string;
            newRecoveredLootStashId: string;
            newPartyStashCurrencyId: string;
            newRecoveredLootCurrencyId: string;
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
        // RH1.2 — client-minted id for the new ItemInstance row. Ignored
        // on stack-merge paths (existing row's id wins).
        newItemInstanceId: string;
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
        // RH1.2 — client-minted ids for the Stash row and its
        // auto-provisioned CurrencyHolding (OUTLINE §3.5).
        newStashId: string;
        newCurrencyHoldingId: string;
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
        reason: 'deposit' | 'withdraw' | 'convert' | 'gameplay-drain';
      };
    }
  | {
      // M5: move an item (or part of one) from its current stash to
      // another. Auto-stacks onto matching `(definitionId, notes ?? "")`
      // rows on arrival. Same-stash transfers, over-quantity transfers,
      // and unknown stash / item ids are reducer-rejected.
      //
      // R1.5 — optional `toContainerInstanceId` adds same-stash packing UI:
      //   - absent / `undefined`: leave the moved row's
      //     `containerInstanceId` alone (every pre-R1.5 dispatch).
      //   - `null`: take-out — clear `containerInstanceId` on the moved row.
      //   - `string`: pack-into — set `containerInstanceId` to the supplied
      //     id. Reducer guards: self-reference, one-level-deep, same-stash
      //     (destination container must live in `toStashId`), unknown-id.
      type: 'transfer';
      payload: {
        itemInstanceId: string;
        toStashId: string;
        quantity: number;
        toContainerInstanceId?: string | null;
        // RH1.2 — client-minted id for the new row on the partial-move-
        // no-autostack branch. Ignored on full-move + partial-with-
        // autostack (existing row's id wins).
        newItemInstanceId: string;
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
        // RH1.2 — client-minted id for the new split-off ItemInstance.
        newItemInstanceId: string;
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
      payload: HomebrewDefinitionInput & {
        duplicatedFromId?: string;
        // RH1.2 — client-minted id for the new homebrew ItemDefinition.
        newDefinitionId: string;
      };
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
    }
  | {
      // R1.2: equip an item that lives in a character's Inventory stash.
      // Reducer rejects when the row is not in a `scope=character,
      // isCarried=true` stash, or when the stash's `ownerCharacterId`
      // does not match `characterId`, or when the row is already
      // equipped (no-op). `slot?` is reserved for R2.x slot tracking.
      type: 'equip';
      payload: {
        itemInstanceId: string;
        characterId: string;
        slot?: string;
      };
    }
  | {
      // R1.2: clear the `equipped` flag on an Inventory row. Same
      // Inventory-only + ownership guards as `equip`; rejects no-ops.
      type: 'unequip';
      payload: {
        itemInstanceId: string;
        characterId: string;
        slot?: string;
      };
    }
  | {
      // R1.2: attune an item that lives in a character's Inventory
      // stash. Reducer rejects when the row is not in Inventory, the
      // stash's `ownerCharacterId !== characterId`, the row is already
      // attuned (no-op), OR the character has no free attunement slot
      // (`attunement.hasFreeSlot(currentlyAttunedCount, maxAttunement)`
      // is `false`).
      type: 'attune';
      payload: {
        itemInstanceId: string;
        characterId: string;
        // R4.3.d — DM cap-override per OUTLINE §3.8. When true, reducer
        // skips the maxAttunement slot-cap check. Guard rejects non-DM
        // actors setting this flag.
        overrideCap?: boolean;
      };
    }
  | {
      // R1.2: clear the `attuned` flag on an Inventory row. Same
      // Inventory-only + ownership guards as `attune`; rejects no-ops.
      // No slot check (un-attuning always frees a slot).
      type: 'unattune';
      payload: {
        itemInstanceId: string;
        characterId: string;
      };
    }
  | {
      // R2.2: spend one or more charges on an Inventory row whose
      // `ItemDefinition` carries a `charges` block. Reducer rejects when:
      //   - the row isn't in the character's Inventory (Inventory-only
      //     per OUTLINE §3.8 "force-use-charge scope"),
      //   - the definition has no `charges` block,
      //   - the row's `currentCharges` is null (hasn't been initialised —
      //     defensive, the transfer cascade init should prevent this),
      //   - the resulting `currentCharges` would go below 0.
      //
      // Single-use cascade (per `def.charges.rechargeRule === 'none'`):
      // when the new `currentCharges` lands at 0, the reducer emits a
      // synthetic `consume` entry and either drops the row (stack=1) or
      // decrements `quantity` and resets `currentCharges` to `max` for
      // the surviving stack.
      //
      // `amount` defaults to 1 (the MVP UI always dispatches 1; R6 may
      // add a multi-charge spell-level picker).
      type: 'use-charge';
      payload: {
        itemInstanceId: string;
        characterId: string;
        amount?: number;
      };
    }
  | {
      // R2.2: restore charges on Inventory rows. Three dispatch modes:
      //   - `'single'`: Item Detail single-row Recharge button. Resolves
      //     one row, sets `currentCharges = def.charges.max`, emits one
      //     `recharge` entry with `trigger: 'manual'`.
      //   - `'manual'`: synonym for `'single'` in MVP; reserved for the
      //     R6 DM force-recharge surface (same action shape, different
      //     R4/R6 permission gate).
      //   - `'batch'`: Character Sheet Rest dropdown. Iterates the
      //     character's Inventory items, recharges every row whose
      //     `def.charges.rechargeRule` strictly matches the trigger,
      //     emits ONE `recharge` entry per recharged row (so the
      //     per-item history filter surfaces each recharge on its row).
      //     Eligibility check via `rules.charges.eligibleForBatchRecharge`.
      //
      // R2.2.1 — optional partial recharge:
      //   - single/manual: `amount?` clamps the rise to
      //     `Math.min(currentCharges + amount, max)`. Used by Item
      //     Detail's roll input on items with a `rechargeAmount` formula.
      //   - batch: `amounts?` maps `itemInstanceId -> partial amount`
      //     for the formula-bearing eligible items the modal collected
      //     rolls for. Items missing from `amounts` (or items with no
      //     `rechargeAmount` formula) full-recharge as before.
      type: 'recharge';
      payload:
        | {
            mode: 'single';
            itemInstanceId: string;
            characterId: string;
            amount?: number;
          }
        | {
            mode: 'manual';
            itemInstanceId: string;
            characterId: string;
            amount?: number;
          }
        | {
            mode: 'batch';
            characterId: string;
            trigger: 'dawn' | 'dusk' | 'long-rest' | 'short-rest';
            amounts?: Record<string, number>;
          };
    }
  | {
      // R2.3: DM toggle for an item's `identified` flag + optional
      // unidentified-item hint (OUTLINE §3.8). Bidirectional: an item
      // can flip true → false ("actually that was cursed") or false →
      // true. The reducer diffs the payload against the current row's
      // state and rejects exact no-op dispatches; the log entry
      // captures the full `(previousIdentified, newIdentified,
      // previousHint, newHint)` transition.
      //
      // No location restriction (unlike attune / use-charge / equip):
      // the DM force-identifies anywhere — Storage, Party Stash,
      // Recovered Loot, Shop. The "Unknown Magic Item" display
      // invariant per OUTLINE §8 is UI-enforced; the toggle itself
      // works on any row.
      //
      // No magic-item gate: mundane items default to identified: true
      // and never trigger the display swap, so a stray identify on a
      // Torch is a harmless no-op (and is rejected by the no-op gate
      // unless the user also supplies a new hint, in which case the
      // hint write is the only mutation).
      //
      // `hint` semantics on payload:
      //   - omitted (key absent): "do not change the existing hint".
      //   - explicit string: write that string as the new hint.
      //   - explicit `undefined`: clear the hint.
      // Under `exactOptionalPropertyTypes` the explicit-undefined case
      // requires the field type to include `| undefined`.
      type: 'identify';
      payload: {
        itemInstanceId: string;
        identified: boolean;
        hint?: string | undefined;
      };
    }
  | {
      // R1.2: catch-all Character editor for fields that compose
      // naturally per OUTLINE §4 line 320. `encumbranceRule` and
      // `enforceEncumbrance` have their own `set-encumbrance` action;
      // `size` is creation-only in v1. The reducer diffs the patch
      // against the current row, derives `changedFields`, and rejects
      // no-op edits (mirrors `edit-homebrew` / `edit-item-instance`).
      // In MVP party-of-one this is owner-only; R4 will widen the
      // role split per OUTLINE §8.1 (`maxAttunement` is DM-only in
      // 2+-member parties; `species`/`class`/`level`/`str` may be
      // owner-edited).
      type: 'edit-character';
      payload: {
        characterId: string;
        patch: {
          species?: string;
          class?: string;
          level?: number;
          str?: number;
          maxAttunement?: number;
        };
      };
    }
  | {
      // R4.1.b: detach a Character from their party with full cascade
      // per OUTLINE §8.3 (same shape as `leave-party` / `kick-player`):
      //   - every ItemInstance in any of the character's stashes
      //     (Inventory + Storage) is transferred to Recovered Loot
      //     (one synthetic `transfer` slice per row)
      //   - aggregated currency across the character's stashes rolls
      //     into Recovered Loot via one `currency-change` slice with
      //     `reason: 'character-deleted'` (omitted when zero)
      //   - the character's stash rows + CurrencyHolding rows are
      //     dropped from state
      //   - the owning user's `PartyMembership` row with
      //     `role='player'` retains its slot but with
      //     `characterId: null` — the user keeps their seat and may
      //     create a new character later (roadmap R4.1 line 1750)
      //   - one terminal `delete-character` slice carries the snapshot
      //     `{ characterId, name, itemCount, currencyTotalCp }`
      //
      // Reducer guards: unknown characterId rejects; missing CurrencyHolding
      // surfaces as an invariant violation. The OUTLINE §8.1 permission
      // gate (actor must be the character's owner OR DM in 2+-member
      // parties) lives in the server-side guard map; in MVP party-of-one
      // the sole user wears both hats so the reducer doesn't re-check.
      type: 'delete-character';
      payload: {
        characterId: string;
      };
    }
  | {
      // R4.1.c: actor self-removes from `state.party` per OUTLINE §8.3.
      // No payload on the wire — the reducer reads `state.user.id` for
      // the actor and `state.party.id` for the party (R4.1 web client
      // only holds one party at a time; SECURITY §2 forbids trusting
      // partyId from the request body server-side).
      //
      // Cascade:
      //   - if the actor has a player membership with `characterId !==
      //     null`, run the `delete-character` cascade first (items +
      //     currency → Recovered Loot, drop character + stashes).
      //   - soft-delete every active `PartyMembership` row for actor.userId
      //     in this party (a party-of-one creator's `dm` + `player` rows
      //     both flip).
      //   - if `state.party.bankerUserId === actor.userId`, also clear
      //     it + emit a synthetic `revoke-banker` entry (R4.2 stub; in
      //     R4.1 the field is always `null` so this branch is unreachable).
      //   - emit one terminal `leave-party` slice with `{ partyId,
      //     characterId? }` (characterId set IFF the leaver had one).
      //
      // Reducer guards:
      //   - sole-member party (party-of-one): rejects with the message
      //     "use archive flow". The server route handles archival via
      //     `Party.archivedAt`; in local mode this means "deleting your
      //     last party" is currently UI-unreachable. R4.1.e adds the
      //     server-side archive path.
      //   - sole DM of a 2+-member party: rejects with "transfer DM
      //     first". R4.3 ships the `dm-transfer` action.
      type: 'leave-party';
      payload: Record<string, never>;
    }
  | {
      // R4.1.d: DM removes another member from the party per OUTLINE
      // §8.3 (same Recovered Loot cascade as leave-party). Reducer
      // payload mirrors the log: { kickedUserId }. The reducer reads
      // the actor (DM) from `state.user.id` because the web client
      // only holds one party in memory; the server route resolves the
      // actor from the session cookie per SECURITY §2.
      //
      // Cascade:
      //   - if the kicked user has a player membership with
      //     `characterId !== null`, run the shared character-delete
      //     cascade (items + currency → Recovered Loot, drop character
      //     + stashes + holdings).
      //   - soft-delete every active membership row for the kicked
      //     user in this party.
      //   - if `state.party.bankerUserId === kickedUserId`, clear it
      //     + emit a synthetic `revoke-banker` slice with
      //     `reason: 'kicked'` (R4.2 stub; unreachable in R4.1).
      //   - terminal `kick-player` slice with `{ kickedUserId }`.
      //
      // Reducer guards:
      //   - kicked user must be an active member of this party.
      //   - actor must NOT be the kicked user (self-kick uses
      //     `leave-party` instead).
      //   - kicked user must NOT also be a DM (multi-DM out of scope
      //     in v1; DMs leave via `dm-transfer` + `leave-party`).
      //
      // OUTLINE §8.1 permission ("Kick player") is DM-only. The
      // server-side guard enforces this; the reducer treats the
      // actor's role as authoritative.
      type: 'kick-player';
      payload: {
        kickedUserId: string;
      };
    }
  | {
      // R4.1.e: a new player joins an existing party (after redeeming
      // an invite code server-side). Membership-only join — no
      // character is minted. Reducer:
      //   - reject if actor already has an active membership in
      //     `state.party.id` (idempotency).
      //   - append a `role='player'` membership row (characterId: null).
      //   - emit one `join-party` slice with `{ partyId }`.
      // The user's subsequent `create-character` dispatch mints the
      // character + 3 stashes, and updates the player membership row's
      // characterId pointer.
      //
      // Wire payload deliberately empty: actor = `state.user.id`,
      // party = `state.party.id`. The server route already authenticated
      // the user and resolved the party from the invite code before
      // dispatching this action.
      type: 'join-party';
      payload: Record<string, never>;
    }
  | {
      // R4.2.a: DM appoints an active player as the party's Banker per
      // OUTLINE §3.14. Reducer rejects self-appointment, already-set
      // Banker (forces a two-step revoke-then-appoint), and parties
      // with memberCount < 2. The §3.14 invariant `bankerUserId !==
      // ownerUserId` is enforced both here AND by the server guard
      // layer per SECURITY §2 (server is authoritative).
      type: 'appoint-banker';
      payload: {
        bankerUserId: string;
      };
    }
  | {
      // R4.2.a / R4.3.a: DM clears `Party.bankerUserId`. `reason`
      // distinguishes direct dispatches (`'manual'`, `'reassigned'`)
      // from cascade-emitted entries (`'left-party'`, `'kicked'`,
      // `'dm-transfer'`) — only the first two reach this action via
      // `POST /sync/actions`; the cascade entries are emitted directly
      // from the kick/leave/dm-transfer reducer arms and don't
      // round-trip through dispatch.
      type: 'revoke-banker';
      payload: {
        reason: 'manual' | 'reassigned' | 'left-party' | 'kicked' | 'dm-transfer';
      };
    }
  | {
      // R4.3.a: DM hands the DM role to another active player per
      // OUTLINE §3.14 + §8.3. Atomic swap: outgoing DM's `role='dm'`
      // row soft-deleted; incoming DM's `role='dm'` row upserted to
      // active (reactivates historical soft-deleted row per BUG-002
      // lesson, or creates fresh); outgoing DM's `role='player'` row
      // auto-minted if missing (DM-only outgoing DM case);
      // `Party.ownerUserId` updated. If the incoming DM is the current
      // Banker, `bankerUserId` is cleared and a synthetic
      // `revoke-banker` slice with `reason: 'dm-transfer'` is emitted
      // (preserves §4 invariant `bankerUserId !== ownerUserId`).
      type: 'dm-transfer';
      payload: {
        newDmUserId: string;
      };
    }
  | {
      // R4.2.d — Banker-only "split the pot" action. Splits Party Stash
      // currency evenly across the supplied recipients using the
      // cascade-down-denominations algorithm (packages/rules `splitEvenly`).
      // Emits one terminal `split-evenly` log entry + N `currency-transfer`
      // entries (one per recipient). Guards enforce: Banker-only,
      // fromStashId must be Party Stash, recipients must be active
      // players' characters in this party. The Banker's own character
      // is a valid recipient per OUTLINE §8.1.
      type: 'split-evenly';
      payload: {
        fromStashId: string;
        recipientCharacterIds: string[];
      };
    }
  | {
      // RH3.1: mark the start of a play session (OUTLINE §3.12).
      // Reducer mints a fresh `GameSession` row with `isCurrent: true`
      // and demotes any prior current session (opt-in via
      // `endCurrentFirst`; without the flag it rejects with
      // `session_already_current`). `newGameSessionId` is client-minted
      // per RH1. `date` defaults to `ctx.now()`'s calendar date when
      // omitted.
      type: 'start-game-session';
      payload: {
        newGameSessionId: string;
        date?: string;
        notes?: string;
        endCurrentFirst?: boolean;
      };
    }
  | {
      // RH3.1: mark the end of the current play session. Reducer clears
      // `isCurrent` on the current `GameSession`. Subsequent log entries
      // land with `sessionId: null` ("Untagged" bucket per OUTLINE §3.12)
      // until the next `start-game-session`. Wire payload deliberately
      // empty — the reducer resolves the current session from
      // `state.gameSessions`.
      type: 'end-game-session';
      payload: Record<string, never>;
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
