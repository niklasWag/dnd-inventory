# D&D 5e (2024) Inventory Manager — MVP Outline

A **local-only, single-user inventory tool** that ships the outline's full data model from day one — just with one user, one party-of-one, and the heavyweight features (encumbrance, magic items, multi-user, OAuth, server sync) deferred.

> **Strategy:** the MVP is **structurally identical** to the final product. The user has a `Party` (of one), one `Character`, an auto-created `Inventory` stash, optional named `Storage` stashes, plus a `Party Stash` and `Recovered Loot` stash. Adding multi-user/Discord/server-sync later is **additive**, not a rewrite.

---

## 1. MVP Goal

Let a single user manage **one D&D 5e (2024) character's** items and currency in a private browser session. They can carry an Inventory, stash extras in named Storage locations (chests, vaults), and use a shared Party Stash even though they're the only "player" — it doubles as a household / campaign pool.

Item catalog ships seeded with **PHB 2024 mundane items**; the user can create custom homebrew items.

---

## 2. In Scope

- One **Party** with one user (the same user is both DM and player; sole member).
- One **Character** for that user (name, species, class, level, STR — STR is stored but not enforced).
- **Auto-created Inventory stash** for the character.
- Any number of **Storage stashes** the character owns (create / rename / delete).
- **Party Stash** and **Recovered Loot** stash, auto-created with the party (usable as communal pools even in solo).
- **Item catalog**: PHB 2024 mundane items (read-only) + homebrew (editable).
- **Custom items** — one shared catalog entry; edits propagate everywhere.
- **Duplicate-to-edit** for PHB entries.
- **Add / remove / adjust quantity** of items in any stash; identical items **auto-stack**.
- **Move items** between any two stashes the user owns or has access to — move-all by default; **split** is a separate action.
- **Currency** (CP/SP/EP/GP/PP) per stash, with conversion helper and **GP-equivalent** totals.
- **Transaction log** for every mutation, structured exactly like the final product's `TransactionLog` (no UI view yet).
- **Local persistence** in browser storage (no auth, no server).
- **Import / export** the full app state as a JSON file — import **replaces** state (with confirm).

## 3. Out of Scope (Deferred — see Section 13)

| Feature | Why deferred |
|---|---|
| Discord OAuth / accounts | Single local user only. |
| Self-hosted backend & live sync | Browser-local persistence only. |
| Multi-member parties / Banker / DM-vs-player roles | One user wears all hats. |
| Encumbrance enforcement | STR is stored; weights show; no capacity bar yet. |
| Equip slots, attune flags | Items in Inventory can be marked equipped/attuned post-MVP. |
| Magic items, charges, recharge | DMG seed deferred. |
| Identification flow | All items shown by real name. |
| Shops, hoard generator | Post-MVP. |
| History UI / per-item history view | Log is captured but not displayed. |
| Containers (bag-in-bag) | Single-level container flag exists in schema but unused. |
| Mobile-responsive design | Desktop-only for MVP. |

---

## 4. Personas

- **The User** — one person running the app privately in their browser. Implicitly DM + sole player of a party-of-one. No login.

---

## 5. Core User Flows

1. **First launch** → app seeds PHB 2024 catalog → **welcome screen**: "Create your character".
2. **Create character** → form: name, species, class, level, STR. On submit, the app provisions: one `Party` (with `isSoloShortcut=true`), one DM membership + one Player membership (same user), the `Character`, an auto-created `Inventory` stash, an auto-created `Party Stash`, and an auto-created `Recovered Loot` stash.
3. **Land on Character Sheet** → tabs: *Inventory* | *Storage* | *Party Stash* | *Recovered Loot*.
4. **Add item to Inventory from catalog** → search "rope" → pick *Hempen Rope (50 ft.)* → set quantity → add. Auto-stacks if already present.
5. **Add custom item** → fill homebrew form → saves to catalog with `source: "homebrew"` → adds to current stash. Reusable from any stash.
6. **Duplicate-to-edit PHB item** → from catalog browser, click "Duplicate" on a PHB row → opens homebrew form pre-filled → save → edit freely.
7. **Edit homebrew item** → changes propagate to every stash holding it.
8. **Create Storage stash** → on Storage tab, "New Storage stash" → name it ("Chest at home", "Vault in Waterdeep") → opens empty.
9. **Move item (default)** → from any stash, pick item → choose target stash → entire stack moves.
10. **Split** → on an item row, "Split" → enter quantity → splits in place; the new row can then be moved.
11. **Adjust currency** → inline +/− on coin row in any stash, or "convert 100 sp → 10 gp" helper.
12. **Delete stash** → confirm dialog ("Delete *Chest at home* and its 23 items?") — items first transfer to Recovered Loot, then the stash is hard-deleted. Inventory, Party Stash, and Recovered Loot stashes are NOT deletable.
13. **Backup** → export JSON.
14. **Restore** → import JSON → confirm dialog ("Replace all current data?") → state replaced wholesale.

---

## 6. Data Model

Stored in browser storage as one JSON blob under a single key (e.g., `dnd-inv:v1`). The schema is a **strict subset** of the final outline's `AppState`. Field names match the outline so a future migration is a `JSON.parse` away.

```ts
type AppState = {
  version: 1;
  seedVersion: number;             // tracks bundled PHB seed version
  user: User;                      // the single local user
  party: Party;                    // exactly one
  memberships: PartyMembership[];  // exactly two: one dm + one player, same userId
  characters: Character[];         // exactly one in MVP
  stashes: Stash[];                // 1 Inventory + 0..N Storage + 1 Party + 1 Recovered Loot
  catalog: ItemDefinition[];       // PHB seed + homebrew
  items: ItemInstance[];           // all item instances across all stashes
  currencies: CurrencyHolding[];   // one per stash
  log: TransactionLog[];           // chronological; not rendered in MVP UI
};

type User = {
  id: string;                      // local UUID; will become discordId later
  displayName: string;             // user-entered; "You" by default
  createdAt: string;
};

type Party = {
  id: string;
  name: string;                    // user-entered; "My Campaign" by default
  ownerUserId: string;             // = User.id in MVP
  inviteCode: string;              // generated but unused in MVP
  recoveredLootStashId: string;
  bankerUserId: null;              // always null in MVP (no Banker in party-of-one)
  isSoloShortcut: true;            // MVP always sets true. NOTE: removed from OUTLINE §4 on 2026-06-24
                                   // — "solo" badge is now derived from memberCount === 1.
                                   // MVP keeps writing the literal `true` so existing Dexie
                                   // blobs validate; R4 treats it as "derived, ignored".
  createdAt: string;
};

type PartyMembership = {
  userId: string;
  partyId: string;
  role: "dm" | "player";           // MVP creates BOTH for the single user
  characterId: string | null;      // null on the dm row; set on the player row
  joinedAt: string;
  leftAt: null;                    // always null in MVP
};

type Character = {
  id: string;
  partyId: string;
  ownerUserId: string;
  name: string;
  species: string;
  size: "tiny" | "small" | "medium" | "large" | "huge" | "gargantuan"; // R1.1: drives capacity multiplier per PHB 2024 p. 366
  class: string;
  level: number;
  abilityScores: { STR: number };  // STR only in MVP
  maxAttunement: number;           // default 3; not enforced in MVP UI
  encumbranceRule: "off" | "phb" | "variant"; // R1.1 widened (was z.literal('off') in MVP)
  enforceEncumbrance: boolean;     // R1.1 added; default false. R1.2 wires reducer rejection.
  inventoryStashId: string;
};

type Stash = {
  id: string;
  scope: "character" | "party" | "recovered-loot";
  name: string;
  ownerCharacterId: string | null; // set when scope=character
  partyId: string | null;          // set when scope=party | recovered-loot
  isCarried: boolean;              // true for the auto-created Inventory; false otherwise
  createdAt: string;
};

type ItemDefinition = {
  id: string;
  name: string;
  source: "PHB" | "homebrew";      // DMG deferred
  category:
    | "weapon" | "armor" | "gear" | "tool"
    | "ammunition" | "consumable" | "container" | "other";
  weight?: number;                 // stored, not enforced in MVP
  cost?: { amount: number; currency: "cp" | "sp" | "ep" | "gp" | "pp" };
  description?: string;
  tags?: string[];
  duplicatedFromId?: string;
  createdBy?: string;              // userId for homebrew authorship
  partyId?: string;                // null for PHB; set to state.party.id on every M6 homebrew
                                   // (per OUTLINE §3.7 party-scoped visibility — forward-compat with R4).
};

type ItemInstance = {
  id: string;
  definitionId: string;
  ownerType: "stash" | "shop";     // MVP always "stash" (shops deferred)
  ownerId: string;                 // stashId
  containerInstanceId: null;       // single-level nesting deferred
  quantity: number;                // auto-stacks on (definitionId, notes)
  equipped: false;                 // hard-coded false in MVP
  attuned: false;                  // hard-coded false in MVP
  identified: true;                // hard-coded true in MVP (no magic items / id flow)
  currentCharges: null;            // hard-coded null in MVP
  customName?: string;
  notes?: string;
  conditionOverrides?: Record<string, unknown>;
};

type CurrencyHolding = {
  id: string;
  stashId: string;                 // one row per stash
  cp: number; sp: number; ep: number; gp: number; pp: number;
};

type TransactionLog = {
  id: string;
  partyId: string;                 // required (always present in MVP)
  sessionId: null;                 // sessions deferred
  timestamp: string;
  actorUserId: string;             // = User.id
  actorRole: "dm" | "player";      // derived: "dm" for DM-only actions, "player" otherwise
  type: TxType;                    // see below
  payload: TxPayload;              // typed per type, matches the outline's discriminated union
};

type TxType =
  | "transfer"
  | "acquire"
  | "consume"
  | "currency-change"
  | "currency-transfer"
  | "create-character"
  | "create-stash" | "rename-stash" | "delete-stash"
  | "create-homebrew" | "edit-homebrew" | "delete-homebrew"
  | "rename-character" | "rename-party"
  | "set-encumbrance";
// Note: MVP captures a SUBSET of the outline's full TxType enum.
// All MVP types are byte-compatible with the final schema.
```

**Invariants** (carried over from the outline):
- Exactly one `Party` exists in MVP, marked `isSoloShortcut: true`.
- Exactly two `PartyMembership` rows exist for the single user: one `dm`, one `player`.
- Exactly one `Character` exists, referenced by the player membership's `characterId`.
- Exactly one `Stash` per character has `isCarried === true` (the Inventory) and is referenced by `Character.inventoryStashId`.
- Exactly one `Stash` has `scope === "recovered-loot"` per party, referenced by `Party.recoveredLootStashId`.
- One `CurrencyHolding` row exists per stash.
- Auto-stack key: `(definitionId, notes ?? "")`.
- PHB entries (`source === "PHB"`) are immutable in UI; user can `duplicate-to-edit`.
- Homebrew entries are editable; edits propagate via `definitionId` lookup.

---

## 7. Screens (MVP)

1. **Welcome (empty state)** — appears when no character exists. Big "Create your character" CTA, settings link.
2. **Character Sheet (Home)** — header with character details (name, species, class, level, STR). Tabs:
   - **Inventory** — items in the carried stash; "Add item" button; per-row actions (edit qty, Move, Split, Remove).
   - **Storage** — list of named Storage stashes (cards with item count + GP-equivalent); "New Storage stash" button. Click into one for its detail view.
   - **Party Stash** — same item table as Inventory, plus currency row. Deposit/take from any character.
   - **Recovered Loot** — same shape as Party Stash.
3. **Storage Detail** — items table + currency row + rename/delete actions (with confirm).
4. **Item Detail** — full description, quantity, notes; (per-item history hidden but data captured).
5. **Add Item Modal** — tabs:
   - *Catalog* — searchable list (PHB + homebrew), filter by category, quantity selector, "Add to [current stash]".
   - *Custom* — homebrew form; saves to catalog and adds in one step.
6. **Move Item Modal** — pick target stash from any of the user's stashes (Inventory, Storage, Party Stash, Recovered Loot).
7. **Split Modal** — quantity selector; splits the row in place.
8. **Catalog Browser** — search/filter all items.
   - PHB rows: read-only with **"Duplicate"** action.
   - Homebrew rows: **Edit** / **Delete** actions.
9. **Settings** — export JSON, import JSON (with confirm), wipe data (with confirm), app version, seed version, character/party rename.

Single-page app; sidebar/tab navigation. **Desktop-only** for MVP.

---

## 8. Rules Logic (Tiny)

Only one module is functional in MVP; the others are stubbed for forward-compat:

- `currency.ts` (active)
  - `toCopper(coins)` — flatten any holding to a CP integer.
  - `fromCopper(cp)` — convert back into a sensible denomination mix.
  - `toGpEquivalent(coins): number` — for the Storage list + Party Stash summary.
  - `convert(coins, target)` — convert N of currency A to B.
  - `add(a, b)`, `subtract(a, b)` — guard against negatives.

- `inventory.ts` (active)
  - `addInstance(stashId, defId, qty, notes)` — auto-stack on `(defId, notes)` match.
  - `moveAll(itemInstanceId, toStashId)` — change `ownerId`; auto-stack into destination if a match exists.
  - `split(itemInstanceId, qty)` — clone the row with `qty`; decrement the original.

- `capacity.ts`, `attunement.ts`, `charges.ts`, `weight.ts`, `hoard.ts`, `validation.ts`, `pricing.ts`, `search.ts` — **stubs only** in MVP. Files exist with type signatures matching the outline so they can be filled in later without ripple-changes.

Mutations always go through a reducer that:
1. Validates + applies the change.
2. Appends a `TransactionLog` entry.
3. Persists the new `AppState` (debounced).

---

## 9. Catalog Seeding

- One-time on first load: read bundled `seed/phb-2024-mundane.json` → populate `catalog`, set `seedVersion`.
- If `seedVersion` is behind the bundled file on subsequent loads, upsert PHB entries (homebrew untouched).
- Categories covered:
  - **Weapons** (simple + martial, melee + ranged)
  - **Armor** (light, medium, heavy, shields)
  - **Adventuring Gear** (rope, torch, rations, tinderbox, etc.)
  - **Tools** (artisan's tools, gaming sets, musical instruments)
  - **Ammunition** (arrows, bolts, sling bullets)
  - **Containers** (backpack, pouch, sack, chest, etc.)

> **DMG (magic items) seed is deferred to post-MVP.** The catalog file path will live alongside as `seed/dmg-2024.json` when added.

---

## 10. Architecture

```
[ Browser SPA ] ── reads/writes ──► [ localStorage / IndexedDB: "dnd-inv:v1" ]
       │
       ├── catalog seed (bundled JSON file)
       └── import/export → user file system
```

- Single-page app, no backend.
- Stack-agnostic — any modern frontend framework (React, Vue, Svelte, vanilla).
- State management: one store/reducer keyed off `AppState`; persist on every mutation (debounced).
- **Forward-compat hook**: the reducer's action shape mirrors the outline's `TransactionLog` types. Adding a server later means routing actions through an API client instead of the local reducer.

---

## 11. Milestones (MVP)

| # | Milestone | Deliverable |
|---|---|---|
| **M0** | Skeleton | App boots; welcome empty state; settings page with wipe; logging plumbing in place. |
| **M1** | Character + auto-provisioned stashes | "Create your character" form provisions User + Party (party-of-one) + memberships + Character + auto-created Inventory / Party Stash / Recovered Loot. Lands on Character Sheet. |
| **M2** | Catalog + Inventory adds | PHB seed loads; Catalog Browser; add items to a stash; auto-stack; quantity edits. |
| **M3** | Storage stashes | Create / rename / delete named Storage stashes; per-stash detail view. |
| **M4** | Currency | Per-stash coins, conversion helper, GP-equivalent totals on stash list/cards. |
| **M5** | Move + Split | Move-all between any stashes; split action. Items moved out of a deleted stash flow to Recovered Loot first. |
| **M6** | Custom items + duplicate | Homebrew create/edit/delete with live propagation; duplicate-to-edit for PHB. |
| **M7** | Backup | Export JSON; import with replace-all confirm. Log entries captured for all mutations. |

**Definition of Done for MVP:**
- All seven milestones shipped.
- A fresh user can create a character, equip it with mundane items, set up at least one Storage stash, deposit into the Party Stash, and move items between all four stash types.
- PHB seed populates on first launch.
- JSON round-trip works: export → wipe → import restores everything bit-for-bit (including log).
- Editing a homebrew item updates its display in every stash holding it.
- Auto-stacking confirmed: adding the same item twice yields one row with quantity 2.

---

## 12. Risks & Open Questions

- **PHB 2024 content licensing** — private use only; seed file never redistributed. Note in repo README.
- **localStorage size** — JSON blob should stay well under quota; flag IndexedDB as a fallback if log + homebrew grows large.
- **Browser switching** — no sync in MVP; export/import is the manual cross-device story.
- **Search ergonomics** — default to fuzzy across name + description + tags (matches outline §3.7).
- **Re-seed conflicts** — if a PHB entry the user has duplicated changes upstream, the duplicate is untouched (it's homebrew). Surface a "this item has updates" hint post-MVP.
- **Log growth** — no UI to view or prune. Consider capping the last 1,000 entries (or moving to IndexedDB) before perf becomes an issue.
- **Forward-compat field hard-codings** — `equipped: false`, `attuned: false`, `identified: true`, `encumbranceRule: "off"`, `bankerUserId: null` are MVP placeholders. Migrations to enable these features just flip flags / fill fields, no schema rewrite.

---

## 13. Direct Path to the Full Outline

Each post-MVP outline section adds **purely additive** changes. No MVP schema field is renamed or removed. Order roughly matches outline M1→M7 (after the MVP itself ships):

1. **Equip + Attunement + Encumbrance** (outline M1)
   - Allow `ItemInstance.equipped` / `attuned` to be `true`; add equip/unequip and attune/unattune actions to the reducer.
   - Activate `capacity.ts` and `validation.ts`.
   - Add encumbrance UI (capacity bar, warning states) gated by `Character.encumbranceRule`.

2. **Magic items + charges** (outline M2)
   - Add DMG 2024 seed.
   - Extend `ItemDefinition` with `rarity`, `requiresAttunement`, `attunementPrereq`, `charges`.
   - Activate `charges.ts` and the recharge action types.

3. **Backend skeleton + Discord OAuth + sync** (outline M3)
   - Replace local UUID `User.id` with `discordId` linkage; add `avatarUrl`.
   - Mirror `AppState` to a server DB; introduce websocket sync (still single-user at this point).
   - Snapshot backups.

4. **Multi-member parties + Banker + roles** (outline M4)
   - `Party.isSoloShortcut` stays `true` for legacy solo parties; new multi-member parties set `false`.
   - Allow `PartyMembership` count > 2; activate role distinctions; appoint/revoke Banker actions.
   - Add Banker-mediated claim rules (already documented in outline §8).

5. **Live history UI + sessions** (outline M5)
   - Render the existing `TransactionLog` — no schema change. Add `GameSession` entity (called `GameSession` in code to avoid collision with the Auth.js `Session` model; see OUTLINE §4).

6. **DM tools** (outline M6) — hoard generator, identification flow, shop manager.

7. **Polish** (outline M7) — light/dark theme, mobile responsiveness for player views, fuzzy multi-field search, accessibility pass.

**The MVP `AppState` shape is the final shape with placeholders.** Loading the MVP's JSON export into a post-M1 build should "just work" with no migration code — the new features simply read fields that were always there but always default-valued.
