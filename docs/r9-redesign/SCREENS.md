# Chosen screen designs — Catalog, Shop, History, Loot Wizard (rebuild reference)

Decisions from the 2026-07-10 design-lab round. Detailed enough to recreate without the git-excluded lab. Shares R9 tokens (`CHARTER.md` → "Design baseline") + the shared conventions in `HUB_FINALISTS.md` (rarity pill = non-`none` only; role/pill colors; `font-display` headings; `tabular-nums`; `bg-surface`/`surface-2`/`border-border`; `shadow-e1/2/3`).

---

## Catalog Browser — chosen: "Table" (dense)

Rejected: Gallery, Sidebar filter. The dense table matches the app's inventory/transaction table language and is the fastest scan of a ~350-item catalog.

**Layout** (`mx-auto max-w-5xl px-4 py-8`):
- **Header:** eyebrow "Reference · shared catalog" + `font-display text-2xl font-bold` "Catalog Browser".
- **Filter bar** (`rounded-lg border bg-surface p-3 shadow-e1`, `flex flex-wrap gap-2`): a flex-1 **search** input (with `Search` icon), a **category** `<select>` ("All categories" + categories), a **rarity** `<select>` ("All rarities" + the 5 rarities). Filters AND-compose, applied live via `useMemo`.
- **Table** (`overflow-hidden rounded-lg border bg-surface shadow-e1`): header row small-caps muted; columns **Name / Category / Price (right, tabular-nums) / Weight (right) / Add**. Name cell = item name + inline **rarity pill** (non-none) + optional **attune** hint (`Sparkles`, muted) + **Homebrew** tag (`FlaskConical`, `bg-primary/10 text-primary` pill). Rows `hover:bg-surface-2/60`, `divide-y`. Per-row **Add** button (`bg-primary` + `Plus`).
- **Empty state:** "No items match your filters." + a footer count "{n} of {total} definitions".
- **Real note:** Add → routes through the acquire flow (target stash context); this is the "add to a stash" per-row action.

---

## Shop — chosen: TWO views (per audience, not one winner)

Rejected: Buy/Sell split. Shops serve two audiences, so keep both surfaces; route by role (players see Storefront when the shop is open; DM sees Manage).

### Storefront (player-facing)
**Layout** (`mx-auto max-w-5xl px-4 py-8`):
- **Banner** (`rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-surface shadow-e2`): a `Store` icon medallion + shop name + **open/closed badge** (emerald dot when open) + a tagline; right = chips "Buy ×{modifier}" (`TrendingUp`) and "Sells at {rate}%" (`Coins`) + a primary **"Sell items"** button (`Tag`).
- **Stock grid** ("On the shelves" + count): responsive `sm:2 / lg:3` grid of **StockCard**s — name (rarity-colored) + rarity pill + "{qty} in stock", a Price block (`font-display text-lg`), a **qty stepper** (`Minus`/`Plus`, capped at stock qty), and a primary **"Buy N"** button (`ShoppingCart`).
- **Sell = modal** (opened by the banner button; NOT inline — keeps the storefront browse-to-buy): a centered dialog (`max-h-[70vh]`, scrolls) titled "Sell to {shop}" + rate note + close; a **filter** search input; the **whole inventory** listed by default (search filters, doesn't gate); each row = name + "{qty} owned · {price} each" + qty stepper + outlined **"Sell N"** (`Tag`). "Nothing matches" state when filtered to empty. *(Decision history: tried inline list → too long; tried search-gated inline → then modal → then modal shows full inventory since the modal is its own scrollable surface.)*

### DM manage (DM-facing)
**Layout** (`mx-auto max-w-*`):
- **Header:** shop name.
- **"Shop settings" section:** an **open/close Toggle** (with "Players can buy and sell." / "Hidden from players." helper), a **Price modifier** number input ("Buy price = seed × modifier."), a **Sell rate** input (shown as %).
- **"Stock" section:** an editable table with an **inline add-stock row** and **per-row remove**; live `useState` stock list.
- **Danger zone:** a fenced destructive **Delete shop** action.

---

## History — chosen: "Table" (audit log)

Rejected: Timeline, Grouped feed. The dense table is the best auditor/power-user view for finding a specific past action.

**Layout:**
- **Header:** "Party History" + "Showing N of M entries".
- **Filter bar:** a **type `<select>`** (from `historyTypes`) + a **search** input (matches summary + actor). Live filter via `useState`.
- **Table:** columns **When / Actor (+ role badge) / Type (chip) / Summary**. Each `HistoryType` has a distinct lucide icon + colored chip (`TYPE_VISUALS` map). **Role badge** colors: DM → primary tint, Banker → amber, Player → muted (exhaustive `switch`). `divide-y` rows, "no entries match" `colSpan` row.
- **Real note:** entries are server-emitted `TransactionLog` rows; redaction (other players' details) applies per SECURITY §4 — not modelled in the mock.

---

## Loot Distribution Wizard — chosen: "Stepper" (guided)

Rejected: Table assign, Kanban. The guided flow has the lowest cognitive load and prevents the "distributed with an unassigned row" mistake.

**Layout:** a **3-step flow** with a **step indicator** (icons: `ClipboardList` Review hoard → `Split` Assign targets → `PackageCheck` Confirm), `useState` step (0-2), rows in `useState` (copied from mock so it isn't mutated):
1. **Review hoard** — edit each row's amount (coin amount / item qty); coin rows show denom, item rows a rarity pill.
2. **Assign targets** — give every row a target (`<select>` from `lootTargets`: Party Stash / each character / Recovered Loot). Unassigned rows visibly flagged (`bg-destructive/5` + destructive label). **Next is disabled** while any row is unassigned (`nextDisabled = step === 1 && unassigned > 0`).
3. **Confirm** — a grouped summary (by target) + the **Distribute** action.
- **Real note:** Distribute fans out to N `acquire` / `currency-change` actions in one batch (per the R8.5 LootWizard batching fix — dispatch all, `Promise.all` the outcomes, one aggregate result). Session tagging is middleware-only; the wizard never sets `sessionId`.

---

## Party Settings — chosen: "Sections" (single-column)

Rejected: Two-pane nav, Members-forward. The single-column stack reuses the chosen account-Settings "Profile hero + cards" kit (`Section` / `Row`), so the party-level and account-level settings surfaces share one language. DM-only surface (OUTLINE §5.15).

**Layout** (`mx-auto max-w-2xl px-4 py-8`, stacked `Section` cards):
- **Header:** eyebrow "Party Settings · DM only" (`Shield` icon) + `font-display text-3xl` party name + member-count line ("· solo" when 1).
- **Section order — Members first**, then Invite, then rules/economy/danger (the roster is the DM's most-referenced info; invite is occasional):
  1. **Members** — per-member row: avatar initial, name (+ "(you)"), role line with **DM crown** / **Banker star** (amber) badges + joined date. Per-**player** row actions (multi-member only): **Make/Revoke Banker**, **Make DM**, **Remove** (destructive icon). Footer note: "DM cannot be Banker; removing a player moves their items + currency to Recovered Loot" (§3.14 + §8.1).
  2. **Invite code** — mono code well + **Copy** + **Regenerate** ghost buttons. *(Display only; real redemption is POST, never GET, per SECURITY §1.2.)*
  3. **House rules** — **encumbrance** segmented (`off` / `phb` / `variant`); **enforce** toggle shown only when rule ≠ off; **attunement cap** row. Party-wide (§3.6, BUG-011).
  4. **Economy** — **preset** segmented (`standard` / `lavish` / `gritty` / `custom`); `custom` reveals price-modifier + base-currency rows. Presets are UI sugar over the two raw knobs (§3.5).
  5. **Danger zone** (`danger` variant, destructive border) — Leave / Archive.
- **Solo party-of-one (`memberCount === 1`):** Banker / kick / Make-DM controls are **hidden** (no Banker role exists at this size per §3.14); Invite becomes an "Enable invites" CTA; danger action is **Archive** instead of Leave.
- **Real notes:** DM-only (server re-checks role from `PartyMembership`, never a request body). Every mutation is a logged action — `appoint-banker` / `revoke-banker` / `dm-transfer` / `set-encumbrance` / invite rotate / kick. `bankerUserId` only legal when `memberCount >= 2` and `!== ownerUserId`; `dm-transfer` onto the current Banker auto-clears the role (`revoke-banker reason: "dm-transfer"`).

---

## Storage Overview — chosen: "Card grid"

Rejected: List rows. The Character Sheet → **Storage tab**: the character's non-carried, character-scope stashes as overview cards. Mirrors the shipped `StorageStashList` (M3).

**Layout** (`mx-auto max-w-3xl px-4 py-8`):
- **Header:** Back-to-character link + "Storage" title + subline ("no encumbrance applies") + a primary **New Storage stash** button (`Plus`).
- **Card grid** (`grid gap-3 sm:grid-cols-2`): each card = a `Package` medallion + stash name (`font-display`) + a meta line "{itemCount} items · {currency breakdown}". **`itemCount` is the SUM OF QUANTITIES, not the row count** (M3 decision). Currency breakdown lists only non-zero denominations (or "no coin"). Clicking a card → `/stash/:stashId`.
- **Empty state:** dashed card — "No Storage stashes yet. Create one to carve out a chest, a vault, or a wagon for your hoard."
- **Real note:** Storage is character-scope + `isCarried: false`; encumbrance never applies (§3.3). Create goes through `create-stash`; the detail screen (`/stash/:id`, StorageDetail) reuses the Inventory table language.

---

## Hoard Generator — chosen: "Stepper" (reuses the Loot Wizard shell)

Rejected: flat form-and-preview / roll-forward / toolbar-and-grid takes. Uses the **same step-indicator + bordered-card + footer-nav shell as the Loot Distribution Wizard** so the two DM loot tools feel like one flow.

**Layout** (`mx-auto max-w-3xl px-4 py-8`), 3 steps:
1. **Parameters** — CR-band `<select>` (Levels 1–4 / 5–10 / 11–16 / 17+) + an "include homebrew" toggle.
2. **Review roll** — a **coins** strip (pp→cp), plus side-by-side **magic-item rarity counts** and **gem/art tier counts**, with a **Reroll** button. (Real screen: `hoard.rollHoard(band)`.)
3. **Hand off** — summary tiles (coins / magic items / gems) + **Continue → distribute**.
- **Footer nav:** Back / Next; step 0's Next is labelled "Roll"; last step's primary is "Continue → distribute".
- **Real note:** DM-only route (`DmOnlyRoute`). **Nothing dispatches here** — the roll is throwaway route-state handed to the Loot Wizard, which prefills its rows. Audit log only touches on the wizard's Distribute.

---

## Transfer Modals — chosen: BOTH "Currency" + "Item move" (two separate modals)

Rejected: a unified/tabbed single modal. The app has two distinct modals because the **dispatch splits** — items → `transfer`, currency → `currency-transfer` (atomic). Both are centered dialogs per the chosen Modal pattern; source stash is fixed (the row that opened the modal), target is a `<select>` excluding the source (labels via `buildStashLabels`).

### Item move (`MoveItemModal`)
- **Item is PRE-SELECTED** — the modal opens from a specific item row, so there is no item picker; the item is shown as a read-only summary (name + source + stack size).
- **Fields:** target stash `<select>` + a **quantity** input/stepper defaulting to the full stack (Zod: positive integer; inline upper-bound `qty ≤ stack`).
- **§3.4 warning:** when moving an item that is `equipped`/`attuned` out of the carried Inventory, an **amber "this will clear equipped/attuned" notice** shows before confirm. Auto-stack-on-arrival is reducer-handled; UI just says "Item moved".

### Currency transfer (`CurrencyTransferModal`)
- **Fields:** target stash `<select>` + **five denomination inputs** (cp/sp/ep/gp/pp), each capped at the source holding (inline max check, not a dynamic Zod bound).
- **Validation:** "Move at least one coin" (all-zero rejected); per-denom "insufficient" inline error. Atomic — the reducer re-validates via `currency.subtract`.

---

## Character Form — chosen: "Grouped sections"

Rejected: Single-column, Two-column grid. Fields grouped under labelled sub-headers reads as guided/first-run-friendly (the form is the create-character entry point). Hosted in the **Modal shell** — the shipped context (Hub "Create solo" / "Create party" dialogs); also renders as a standalone "Add your character" page.

**Layout** (centered dialog, `max-w-md`), three grouped sections (each a `surface-2/30` fenced block under a small-caps `font-display` sub-header with a lucide icon):
1. **Identity** (`User`) — **Name** (full width) + a 2-col row of **Species** (free-text `<input>` + `<datalist>` suggestions) and **Size** (`<select>` tiny→gargantuan).
2. **Class & level** (`Swords`) — a `[1fr_5rem]` row of **Class** (free-text + datalist) and **Level** (number 1–20).
3. **Ability** (`Dumbbell`) — **Strength** (number 1–30) with helper text "drives carrying capacity together with size (§3.6)".
- **Footer:** Cancel + **Create character**.
- **Real notes:** matches the shipped `CharacterForm` schema (`name`, `species`, `size`, `class`, `level`, `str`) — RHF + Zod, `zodResolver`. `size` is **creation-only** (not editable in v1; §3.3). Species/class are free-form strings (datalists are hints, not enums). The reducer's `create-character` mints everything else (party, memberships, Inventory stash, currencies). Edit-mode reuses the same form; `edit-character` widens the editable set (species/class/level/str/maxAttunement) but not `size`.

---

## Custom Item Editor — chosen: "Single-column (progressive)"

Rejected: Grouped sections, Form + live preview. The homebrew `ItemDefinition` editor (OUTLINE §5.14; shipped `HomebrewForm`), in the Modal shell.

**Layout** (centered dialog, `max-w-md`, scrollable body):
- **Fields (stacked):** Name · Category (`<select>`, 10 categories) · Weight + Cost (amount + denom `<select>`) · Description (textarea) · Tags (comma-separated).
- **Magic-only block — progressive reveal:** when **Category = Magic item**, a fenced `border-primary/30 bg-primary/5` block appears with **Rarity** (`<select>` incl. artifact; **required for magic items** per §4 / BUG-012), a **Requires attunement** toggle, and (when on) an **Attunement prerequisite** input. Non-magic categories hide the whole block.
- **Footer:** Cancel + Create item. Modes create / edit / duplicate reuse the same form (shipped `HomebrewForm`).
- **Real notes:** DM-only when party has 2+ members (permissive for solo, §3.7). Homebrew stored with `source: "homebrew"` + `createdBy`; party-scoped visibility via `ItemDefinition.partyId`. Homebrew price is stored as typed (not `priceModifier`-scaled).

---

## Item Picker — decision: ONE shared component, `layout` prop (List base + Rail for DM)

The shipped `catalog/ItemPicker` is a reusable callback picker (search catalog → `onPick(def)`), used by the **Loot Wizard** (add-row) and **Shop add-stock**. Not an OUTLINE §5 numbered screen. Explored 3 layouts (List, Table, Filter rail); **Table rejected**.

**Decision: a single component with `layout: 'list' | 'rail'`** (default `'list'`), so one search/rank/pick core serves both contexts:
- **`layout="list"` (base)** — search input + **rarity filter chips** over a fixed-height scrollable result list. Each row: rarity dot + name + `source · category · rarity · price` sub-line + attunement (`Sparkles`) / homebrew (`FlaskConical`) markers + a **Pick** button. Default for inline picks.
- **`layout="rail"` (DM)** — a left **rarity + category filter rail** beside the same result list. For big DM catalog actions (stocking a shop, adding loot rows from the full ~350-item catalog).
- **Shared:** props (`catalog`, `rarityFilter?`, `onCancel`, `onPick`), the `searchCatalog` fuzzy ranker, the result-row rendering, and a **fixed-height scroll region** (`h-[50vh]` in the mock) so the dialog does NOT resize as search/filter narrows the list. Only the filter chrome branches.
- **Effort:** low — the rail is additive chrome over the shared core; the one new bit is a category-filter dimension the current picker lacks (trivial). No new data / dispatch / schema. **Caution:** keep it to these two layouts; if per-caller flags proliferate, split the component.

## Status

Chosen 2026-07-10: Catalog, Shop, History, Loot Wizard. Chosen 2026-07-13: Party Settings (Sections), Storage Overview (Card grid), Hoard Generator (Stepper), Transfer Modals (Currency + Item move), Character Form (Grouped sections), Custom Item Editor (Single-column), Item Picker (shared component — List base + Rail for DM). Screenshot into `drawings/` before the lab is deleted if a durable visual is wanted.
