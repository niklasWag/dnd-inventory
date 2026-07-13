# R9 — UI Redesign Charter (working draft)

> **Status: PLANNING.** Decisions below are agreed direction; open items are flagged. No code until the design language is validated on pilot mockups (roadmap R9 mandate). This is a working doc — canonical scope/tech changes still land in `OUTLINE.md` / `TECH_STACK.md`.

## Vision

A **complete redesign** of the D&D inventory app, evaluated without arbitrary limits. Target feel: **hybrid "tool + flavor"** — a clean, modern, data-dense tool skeleton (Linear/Notion-grade clarity) with restrained thematic D&D accents (lean into the existing item-rarity colors, one display heading font, subtle flavor as garnish — not kitsch).

## Agreed decisions (2026-07-10)

| Decision | Choice | Notes |
|---|---|---|
| **Ambition** | Complete redesign, evaluate without limits | Not just a consistency pass. |
| **Visual identity** | Hybrid tool + flavor | Tool-first; rarity colors + a display font + subtle flavor. |
| **Form factor** | Both desktop + mobile ideally; **desktop-priority** where full responsive isn't feasible | Feeds an `OUTLINE.md` §5 amendment. Players likely mobile, DMs likely desktop. |
| **Theming** | Light + dark **both first-class**; other variants later/nice-to-have | Existing R7.1 toggle stays. New palette must derive both modes from CSS vars. |
| **Accessibility** | **Best-effort** (not a formal WCAG AA gate) | Fix obvious gaps: icon-button labels, focus order, sensible contrast. |
| **Process** | **Minimal mockup screens with mock data first**, to validate the design before broad implementation | Then foundation → rollout. |
| **Navigation** | **DECIDED (2026-07-10): Option A — sidebar + grouped IA** | Task-grouped left sidebar (collapsible to an icon rail), mobile bottom-bar + `sheet` drawer. See "Navigation — decided" below. |
| **First pilot screen** | **Character Sheet — APPROVED as the design baseline** | See "Design baseline" below. |

## Navigation — DECIDED: Option A (sidebar + grouped IA)

**Decision (2026-07-10): adopt the task-grouped left sidebar.** Rationale: ~8 role-gated destinations with natural groupings + a legible DM-vs-player split, a tool (not a site) that people live in, room for icon+label + a party context/switcher, scales as features grow (R10+), and is the strongest foundation for the mobile bottom-bar + `sheet`-drawer story (the drawer *is* the sidebar). Accepted costs: breaks current top-bar muscle memory; needs a party-context header + switcher built in. Option B (refined top bar) was prototyped and rejected as the lighter-but-flatter choice that doesn't suit a multi-section tool.

The sidebar collapses to an **icon-only rail** (prototyped) to reclaim horizontal space for the dense tables; on mobile it becomes a bottom tab bar (top groups) + hamburger `sheet` drawer (overflow + DM Tools).

**IA (task-grouped):**

| Group | Destinations | Visible to |
|---|---|---|
| My Character | Character Sheet, Stashes, Item Detail (contextual) | all members |
| Party | Party Stash, Recovered Loot, Shops, Members/Settings, History | all members |
| Reference | Catalog | all |
| DM Tools | DM Dashboard, Hoard Generator, Loot Distribution, Identification | DM/solo only |
| footer | Settings, theme toggle, account | all |

> **Scope note:** Shops are **per-party** entities (party-owned, DM-managed, with their own stock + currency), so they live under **Party**, not alongside the Catalog. The **Catalog** is party-wide *reference* data (PHB/DMG + homebrew item definitions) — hence its own "Reference" group. Shops stay gated as today (visible to DM, or to players when ≥1 shop is open).

<details>
<summary>Rejected: Option B — refined top bar (kept for the record)</summary>

Keep the top-bar shape, add text labels, visually group player vs DM, add a mobile drawer. Lighter, preserves muscle memory — but flattens the group structure and hits horizontal-overflow pressure as destinations grow. Prototyped in the design lab (`TopBarShell`) alongside Option A for the comparison; not chosen.
</details>

## Design baseline — Character Sheet (APPROVED 2026-07-10; variant "Combined" chosen 2026-07-13)

The Character Sheet prototype in the design lab is **approved as the visual baseline** for R9. Of the explored variants (Baseline, Paperdoll, Combined, Combined-shadcn, Tome), the **"Combined"** variant is the chosen layout (see Decision log 2026-07-13). New screens should conform to its language; deviations need a reason.

**What the baseline establishes:**

- **Layout** — page max-width container; a screen header (identity + at-a-glance chips + primary/secondary action buttons top-right); content as **cards** with a small-caps `font-display` card header (title + right-aligned hint/count); a main-column + **right-rail** split (Combined: `lg:grid-cols-[1fr_20rem]`, rail on the right) that stacks on narrow screens.
- **Currency strip** — a 5-cell divided row, order **cp · sp · ep · gp · pp** (ascending), value in `tabular-nums` above a small-caps denomination label.
- **Prominent currency panel** (Combined's distinguishing feature) — a **full-width** panel above the main/rail split (`border-primary/30 bg-gradient-to-br from-primary/10 to-surface`): a big **gp total** (Coins medallion + `font-display` total) on the left + a **Convert** action; below, a 5-cell divided row of per-denomination **coin managers** — amount in `tabular-nums` with inline **+/-** to deposit/withdraw (withdraw disabled at 0). Money is front-and-center and directly manageable, not read-only.
- **Dense table** — `surface-2` header row (small-caps, muted), row hover, `divide-y` rows, right-aligned numeric columns in `tabular-nums`, a "State" column carrying small **chips** (Equipped / Attuned / N/M charges).
- **One item table + one currency display, reused everywhere.** Every stash-bearing surface — **Inventory, Storage (detail), Party Stash, Recovered Loot** — reuses the **same item-table** and the **same currency display** established on the Inventory screen. Do not design per-scope table/currency variants; scope-specific behaviour (Banker-mediated claim controls, encumbrance bar on Inventory only, etc.) is layered *on top of* the shared components as conditional affordances, not forked layouts. This is why Storage / Party Stash / Recovered Loot need no separate lab exploration — they inherit the Character Sheet's table + currency language.
- **Flavor layer** — item **rarity** as a bordered pill, shown only for identified, non-common items; unidentified items render as italic muted **"Unknown Magic Item"** (preserves the OUTLINE §8 identification invariant). This is the restrained "flavor" — accents, not chrome.
- **Right rail patterns** — encumbrance as a labelled progress bar (current / max lb, % of capacity); equipped/attunement as a labelled key→value list.
- **Tokens** (prototype values, see `design-lab/src/index.css`) — **Neutral-gray light / Cool blue-slate dark base (confirmed 2026-07-13)**; teal/violet brand accent (user/class-configurable); `Cinzel` display headings + `Inter` body; 3-step elevation (`e1/e2/e3`); 12px base radius; rarity color set. Both light + dark first-class.
- **Fonts** — two families, loaded via Google Fonts `<link>` in `design-lab/index.html`: **Inter** for body/UI (weights 400/500/600/700; fallback `system-ui, sans-serif`) and **Cinzel** for display/headings via `.font-display` (weights 500/600/700; fallback `Georgia, serif`). Wired in `tailwind.config.js` as `fontFamily.sans` / `fontFamily.display`. *(Real implementation should self-host, not `<link>` to Google — decide before rollout; `Cinzel` itself still tentative per Open Items.)*
- **Reusable primitives implied** (to vendor for real as shadcn): `card`, `table`, `badge`/chip, `progress`, `tooltip` (for the collapsed rail), `sheet` (mobile drawer).

**Reference:** `design-lab/` (git-excluded) — chosen variant `src/character/CharacterCombined.tsx` (other explored variants: `CharacterBaseline.tsx`, `CharacterPaperdoll.tsx`, `CharacterCombinedShadcn.tsx`, `CharacterTome.tsx`); mock data `src/mock/character.ts`; tokens in `src/index.css`. Run `npm install && npm run dev`. Since the lab is throwaway/ignored, capture screenshots into `drawings/` if a durable visual record is wanted before the lab is eventually deleted.

> **Baseline caveats:** the lab's `ui/kit.tsx` primitives are throwaway stand-ins; real implementation vendors proper shadcn primitives into `apps/web/src/components/ui/`. Token values (exact hues, font) remain tunable — the *patterns* are the baseline, the exact palette can still be refined.

## Design foundation (applies regardless of nav choice)

Grounded in the current-state survey:

1. **Token layer is stock shadcn** (default slate palette, single `--radius`, no elevation/type scale). R9 defines: a color palette (brand + semantic + rarity), a **type scale**, a **spacing rhythm**, an **elevation/shadow system**, and radii — all as CSS variables so light + dark derive cleanly. Stays in Tailwind + shadcn (no CSS-in-JS per `TECH_STACK.md`).
2. **Biggest consistency debt = missing primitives.** Only 10 shadcn primitives are vendored (`alert-dialog, button, dialog, dropdown-menu, input-otp, input, label, progress, select, sonner`). Cards, tables, badges/pills, tabs, tooltips are **hand-rolled with raw Tailwind across ~18 screens**. R9 vendors the missing ones — `card, table, tabs, badge, tooltip, skeleton, sheet` — and routes everything through them. This alone removes most inconsistency.
3. **Data density is a first-class pattern.** Stashes, currency rows, ~350-item catalog. Design a canonical dense-table pattern (sticky headers, `tabular-nums`, optional row-density toggle) instead of styling each table ad hoc.

## Sequencing (proposed)

1. **Foundation draft** — palette + type + spacing + elevation tokens. **DONE → `DESIGN_SYSTEM.md`** (foundation tokens extracted + confirmed 2026-07-13).
2. **Pilot mockups** — Character Sheet with mock data, rendered under BOTH nav shells (Option A vs B). Minimal, just enough to judge the language + nav.
3. **Compare + commit** — pick nav, lock tokens, sign off.
4. **Primitive foundation** — vendor missing shadcn primitives + apply tokens.
5. **Screen rollout** — by area, tracked as R9 sub-slices in `docs/roadmap.md`.

## Kickoff prereqs (from roadmap R9 Notes)

- [ ] Preserve the 2026-07-07 design audit → `UI_AUDIT_2026-07-07.md` (stub exists in this folder).
- [x] Amend `OUTLINE.md` §5 form factor to the agreed both-ideally / desktop-priority posture. **DONE 2026-07-13** — §5 now carries: nav note (sidebar + grouped IA), DM-tools desktop-priority with mobile deferred, Settings Appearance cluster, user-selectable Hub layout.
- [ ] Keep the "consistency-only, no visual redesign" scope guard **retired** for R9 — this IS the visual redesign (that guard was for the deferred R9-audit consistency pass).

## Open items still to decide

- Palette + accent — **ALL CONFIRMED (2026-07-13).** Base: **Neutral gray (light) + Cool blue-slate (dark)** (temperature-consistent cool pairing; flavor lives in Cinzel + rarity colors). Brand accent default: **cyan-teal** (`196 78% 38%` / `194 70% 56%`); offered accents cyan-teal / amber / emerald (+ others); optional per-character-class follow (12 unique hues, opt-in, party-scoped). See DESIGN_SYSTEM.md "Accent model".
- Display/heading font — **CONFIRMED: Cinzel (2026-07-13)** — explored Marcellus / Spectral / Inter-only in the lab; kept the Cinzel display + Inter body pairing. **Body font: Inter** — chosen over Roboto for first-class `tabular-nums` (load-bearing for the currency/qty/weight columns) and its neutral pairing with Cinzel.
- How far mobile goes for DM tools (reflow vs min-width banner) — **explicitly DEFERRED (2026-07-13)**: decide during implementation with real device testing; feeds an OUTLINE §5 amendment when settled.

## Decision log

- **2026-07-10** — Navigation: **Option A (sidebar + grouped IA)** adopted; Option B (top bar) prototyped + rejected.
- **2026-07-10** — Character Sheet prototype **approved as the R9 visual baseline** (layout, currency strip cp→pp, dense table, rarity flavor, tokens). See "Design baseline" above.
- **2026-07-13** — Character Sheet variant: **chose "Combined"** (rejected Baseline, Paperdoll, Combined-shadcn, Tome). Combined = Baseline's header + dense inventory table, Paperdoll's loadout+encumbrance rail, plus a **prominent full-width currency panel** (big gp total + per-denomination inline +/- + Convert) as the distinguishing feature. Rail sits on the **right** (`lg:grid-cols-[1fr_20rem]`). This currency + table language propagates to Stash / Party / Recovered Loot.
- **2026-07-10** — Hub: explored 5 variants; **shortlisted to 2 — Hero/Continue (A) and List+Detail (B)**; rejected Card grid, Command center, Split action. Detailed rebuild specs in `HUB_FINALISTS.md`. Final pick between A and B still open.
- **2026-07-10** — Profile/Settings page: explored 4 options; **chose "Profile hero + cards"** (rejected Two-pane, Single column, Card grid). Rebuild spec in `SETTINGS_PAGE.md`. Note: this is the *account/user* page; party-level data settings are a separate surface.
- **2026-07-10** — DM Dashboard: **chose "Command Center"** (rejected Stat cards, Session-focused). Session surfacing kept lightweight pending the not-yet-fleshed-out session feature. Spec in `DM_AND_MODALS.md`.
- **2026-07-10** — Modals: **kept "Centered form" + "Confirm"** as a complementary pair (rejected Side sheet). Spec in `DM_AND_MODALS.md`.
- **2026-07-10** — Catalog Browser: **chose "Table" (dense)** (rejected Gallery, Sidebar filter). Spec in `SCREENS.md`.
- **2026-07-10** — Shop: **chose TWO views — "Storefront" (player-facing) + "DM manage" (DM)** (rejected Buy/Sell split). Two audiences → two surfaces, not one winner. Storefront's sell flow is a search-filterable modal (whole inventory). Spec in `SCREENS.md`.
- **2026-07-10** — History: **chose "Table" (audit log)** (rejected Timeline, Grouped feed). Spec in `SCREENS.md`.
- **2026-07-10** — Loot Distribution Wizard: **chose "Stepper" (guided review → assign → confirm)** (rejected Table assign, Kanban). Spec in `SCREENS.md`.
- **2026-07-13** — Party Settings: explored 3 layouts; **chose "Sections"** (single-column stacked cards, reusing the account-Settings kit) — rejected Two-pane nav, Members-forward. Section order **Members → Invite code → House rules → Economy → Danger zone** (members first — the DM's most-referenced info). Solo party-of-one hides Banker / kick / invite-others per §3.14. Spec in `SCREENS.md`.
- **2026-07-13** — Item Detail: explored 4 layouts; **chose "Two-column"** (page: read-forward content left, state toggles + edit + per-item history in a right rail — mirrors the Combined character sheet). **Tabbed kept for reference** (not deleted); Single-column + Drawer removed. Popover ruled out as the container (content-heavy: description + charges + edit form + full history; outside-click dismissal risks losing edits). Presentation decision (separate `/item/:id` page vs. URL-addressable drawer) still open; current app ships the page.
- **2026-07-13** — Storage overview (Character Sheet → Storage tab): explored 2 layouts; **chose "Card grid"** (rejected List rows). Responsive `sm:2` cards, each name + item-count (sum of quantities) + currency breakdown → opens `/stash/:id`. Mirrors the shipped `StorageStashList`. Spec in `SCREENS.md`.
- **2026-07-13** — Hoard Generator: **chose "Stepper"** — reuses the Loot Wizard stepper shell (step indicator + card + footer nav): Parameters → Review roll → Hand off. Rejected the earlier flat form/preview/toolbar takes. Nothing dispatches; the roll prefills the Distribution wizard. Spec in `SCREENS.md`.
- **2026-07-13** — Transfer Modals: **kept BOTH "Currency" + "Item move"** as separate modals (matches the shipped `CurrencyTransferModal` + `MoveItemModal` — the dispatch splits: items → `transfer`, currency → `currency-transfer` atomic). Rejected a unified/tabbed single modal. Item move opens from a pre-selected row (no item picker) + shows the §3.4 equip/attune-clears-on-leave-Inventory warning. Spec in `SCREENS.md`.
- **2026-07-13** — Character Form (create/edit): explored 3 layouts; **chose "Grouped sections"** (rejected Single-column, Two-column grid). Fields under labelled sub-headers Identity / Class & level / Ability with helper text; hosted in the Modal shell (the shipped Hub create-solo / create-party context). Matches the shipped `CharacterForm` schema (name, species, size, class, level 1–20, STR 1–30; `size` creation-only, drives carry capacity). Spec in `SCREENS.md`.
- **2026-07-13** — Hub: resolved the open A/B pick — **chose "Hero/Continue" (A) as the default**; **List+Detail (B) is retained as a user-selectable alternative** (see the planned "Hub layout" preference below — not "reference-only" anymore). Supersedes the 2026-07-10 "final pick still open". Both rebuild specs remain in `HUB_FINALISTS.md`.
- **2026-07-13** — Hub layout = **user preference (planned, post-R9-rollout).** The Hub will offer a per-user **"Hub layout: Hero (default) / List+Detail"** setting, living in an **Appearance cluster** in the account Settings page (alongside theme + accent + follow-class). Rationale: the two finalists optimize for different party counts, and different users prefer different views — so let the user pick rather than force one. **Cost note:** this means **both Hub layouts ship + are maintained as production code** (B is no longer disposable reference). Not prototyped in the lab (deferred to implementation); recorded here + in `HUB_FINALISTS.md`.
- **2026-07-13** — Custom Item Editor (homebrew `ItemDefinition`): explored 3 layouts; **chose "Single-column (progressive)"** (rejected Grouped sections, Form + live preview). Full field set (name, category, weight, cost amount+currency, description, tags) with the **magic-only block — rarity + attunement + prereq — revealed only when category = Magic** (rarity required for magic items per §4 / BUG-012). Modal shell. Matches the shipped `HomebrewForm`. Spec in `SCREENS.md`.
- **2026-07-13** — Item Picker (shipped `catalog/ItemPicker`, a reusable catalog picker; not an OUTLINE §5 numbered screen): explored 3 layouts (List, Table, Filter rail). **Decision: ONE shared component with a `layout` prop** — `layout="list"` (base: search + rarity chips + list) is the default for inline picks; `layout="rail"` (left rarity+category filter rail + list) for big DM catalog actions (Loot Wizard add-row, Shop add-stock — the two existing `onPick` callers). Table rejected. Both layouts share the same props/`searchCatalog` ranker/result-row/fixed-height scroll region; only the filter chrome branches. Rail adds a category-filter dimension the current picker lacks (trivial). Low effort — additive chrome over the shared core, no new data/dispatch/schema. Caution: keep it to the two layouts; if per-caller flags proliferate, split. Spec in `SCREENS.md`.
- **2026-07-13** — Item Detail presentation: **chose the separate `/item/:id` page** (what ships today — simplest, deep-linkable, already built). The URL-addressable-drawer alternative is NOT pursued. Closes the presentation question left open when the Two-column layout was chosen.
- **2026-07-13** — DM-tools mobile scope: **explicitly DEFERRED** (reflow vs. min-width banner). Decide during implementation with real device testing; player views stay the responsive priority. Settling it feeds an OUTLINE §5 amendment.
- **2026-07-13** — Typography: **confirmed Cinzel (display) + Inter (body)** — explored Marcellus / Spectral / Inter-only display fonts in the lab, kept the Cinzel+Inter pairing. Closes the display-font open item.
- **2026-07-13** — Palette base: **confirmed Neutral gray (light) + Cool blue-slate (dark)** — explored 4 bases in the lab with independent light/dark pickers; picked a temperature-consistent cool pairing (rejected the warm Parchment light, which would flip warm→cool against the cool dark). Rationale: flavor is carried by Cinzel + the rarity color layer, so the base stays a neutral "tool" surface. Lab defaults + `design-lab/src/index.css` `:root`/`.dark` updated to match. Accent still layers on top.
- **2026-07-13** — Hub medallion: **chose the adventurer medallion WITHOUT the gear pip** (glow + double ring + gradient portrait retained; the little `Settings` gear pip removed for a cleaner mark — still opens the account menu on click). Explored full-medallion-with-pip, simplified-single-ring, and plain-avatar-top-right variants; all kept for reference. Avatar behaviour: accent gradient sits *behind* the portrait — visible as the fill when no photo is set (behind the initial), covered by the image when a photo is set (accent then only frames via the ring/border).
- **2026-07-13** — Brand accent + accent model: **default = cyan-teal** (`196 78% 38%` light / `194 70% 56%` dark) — rejected amber (currency/gold + legendary-rarity collisions) and emerald (uncommon-rarity collision). **Offered accents:** cyan-teal / amber / emerald (+ others). **"Follow character class" user setting (opt-in):** inside a party the accent follows the current character's class via **12 unique per-class hues** (Cleric = the accent amber exactly; see `DESIGN_SYSTEM.md` table + `design-lab/src/mock/classColors.ts`); **outside a party it reverts to the user's default accent** (resolves the party-wide-screen ambiguity). Lab: "Follow class" toggle + party/non-party auto-scoping + a "Reference → Class colors" grid view. Tokens updated in `design-lab/src/index.css` + `DESIGN_SYSTEM.md`.

## Feature parity + intentional cuts (2026-07-13)

R9 is a visual/consistency overhaul, **not a feature cull** — it must preserve capability parity with the shipped app (all 46 reducer actions reachable somewhere; see the feature audit). A few UI changes are intentional; everything else is kept.

**Reaffirmed — shadcn stays.** Per `TECH_STACK.md`. Vendor the missing primitives (`card, table, tabs, badge, tooltip, skeleton, sheet`) + route everything through them with the `DESIGN_SYSTEM.md` tokens. shadcn is owned copy-in source (not a locked dependency); "modernizing" = editing the vendored components, not leaving shadcn. Our custom token layer (Cinzel, cyan-teal, rarity flavor, elevation) keeps it from looking generic.

**Kept (explicitly — do not drop):**
- **±1 currency edits** (the chosen currency display supports them) **and** bulk currency entry (`+N` / `-N` / `=N` / absolute syntax). Both stay.
- **±1 item-quantity buttons** on stash rows.
- **Pack / Take-out** (move an item into/out of a D&D **container** — backpack, Bag of Holding, etc. — within one stash; ties to the `flatWeight` container-weight rule) is **distinct from Move** (transfer between two different stashes). Both kept — NOT unified.
- All load-bearing conditional features from the audit: DM attunement cap-override dialog, drain-currency (`gameplay-drain`), split-evenly, corrupted-party-data recovery, session lifecycle (start/end/notes) + session badge, encumbrance CapacityBar, EquippedSlotsPanel, permission-gated history, identify invariant, offline write-block + banner, JSON export/import.

**Cut / consolidated (intentional):**
- **Homebrew creation → Catalog only.** Remove the second entry point (the AddItemModal "Custom" tab that auto-acquires). `create-homebrew` lives solely on the Catalog "New homebrew" flow. (AddItemModal keeps its Catalog picker.)
- **Custom rest → removed for now.** Drop the disabled "Custom…" item in the Rest menu (the dead placeholder for DM force-recharge). Batch rest (Dawn/Dusk/Long/Short) stays. Can be added later if needed.
