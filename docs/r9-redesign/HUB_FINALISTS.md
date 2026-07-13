# Hub — finalist specs (rebuild-from-scratch reference)

Two Hub (party-picker front door) variants made the shortlist from the 2026-07-10 design-lab exploration. This doc captures each in **enough detail to recreate without the lab** (which is git-excluded/throwaway). Both share the R9 tokens (`docs/r9-redesign/CHARTER.md` → "Design baseline"; prototype values in the deleted lab's `index.css`).

**Shared context both rely on:**

- **Tokens/classes used:** `surface`, `surface-2`, `border`, `primary` (+ `/10 /15 /5 /40 /50` opacity ramps), `muted-foreground`, `foreground`, `destructive`; shadows `shadow-e1/e2/e3`; radius `rounded-md/lg/xl`; `font-display` (Cinzel) for names/headings; `tabular-nums` for numeric stats. Dark mode via `.dark` ancestor.
- **Icons (lucide-react):** `Play, Plus, LogIn, Crown, Coins, Package, Users, ChevronRight, Clock, MoreHorizontal, Settings, Link2, User, LogOut`.
- **Party data shape** (per party): `{ id, name, memberCount (1===solo), myRole ('DM'|'Player'|'Player · Banker'), myCharacter (string|null), members string[], lastPlayed, itemCount, goldTotal }`. User: `{ displayName, email, avatarUrl|null, menu: ['Account','Linked accounts','Settings','Log out'] }`.
- **Solo rule:** `memberCount === 1` → show "Solo" instead of the role/member-count.
- **Role pill:** DM → `bg-primary/10 text-primary` with a `Crown` icon; else `bg-surface-2 text-muted-foreground`.
- **Account menu:** name+email header, then the 4 menu items; "Log out" rendered in `text-destructive`.

---

## Finalist A — Hero / Continue-focused

**Concept.** Optimize for the most common action: jump back into the last-played party. Personality-forward (least "business"-looking). Best when a user has 1-2 active parties.

**Layout** (outer: `relative mx-auto max-w-4xl px-4 py-12`):

1. **Adventurer medallion + greeting** (centered column, `mb-8 flex flex-col items-center gap-3`):
   - **Medallion** = the profile treatment (the distinctive part). A `relative flex flex-col items-center` button:
     - Glow layer: `absolute -inset-1 rounded-full bg-primary/20 opacity-0 blur group-hover:opacity-100`.
     - Portrait: `h-20 w-20 rounded-full border-2 border-primary/40 bg-gradient-to-br from-primary/15 to-surface-2 shadow-e2 ring-2 ring-surface`, `group-hover:border-primary/70`. Shows avatar image if present, else the display-name initial in `font-display text-3xl font-bold text-primary`.
     - **Gear pip** — **REMOVED (chosen 2026-07-13).** Earlier drafts placed a `Settings` gear pip bottom-right; the chosen medallion drops it for a cleaner mark (the portrait still opens the account menu on click). Simplified-single-ring + plain-avatar-top-right variants explored + kept for reference.
   - **Avatar fill behaviour (chosen 2026-07-13):** the accent gradient sits *behind* the portrait — visible as the fill when no photo is set (behind the display-name initial), covered by the image when a photo is set (accent then only frames the image via the ring/border, so the photo isn't tinted).
     - Click → account dropdown `absolute top-24 w-56 rounded-lg border bg-surface shadow-e3` (centered header with name/email, then the 4 menu items; full-screen click-catcher `fixed inset-0 z-40` to dismiss).
   - **Greeting** (centered): muted "Welcome back, {name}" + `font-display text-3xl font-bold` "Ready to play?".
2. **Continue hero card** (`relative overflow-hidden rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-surface p-6 shadow-e2`):
   - Eyebrow: `text-[11px] font-semibold uppercase tracking-widest text-primary` with a `Clock` icon + "Continue".
   - Row (`flex flex-wrap items-end justify-between gap-4`): left = party name (`font-display text-3xl font-bold`) + a muted meta line (`Solo`/`N members` · DM-with-Crown or character-name · lastPlayed) + a stats row (`Package` items, `Coins` gp, `tabular-nums`); right = a large primary CTA `Enter party` (`rounded-lg bg-primary px-5 py-3 text-sm font-semibold` + `Play` icon).
   - "Most recent" party = pick by recency (mock used `lastPlayed === 'yesterday'`; real: max `lastPlayedAt`).
3. **Other parties strip** (`mt-8`, only if others exist): small-caps "Your other parties" heading + a `grid gap-2 sm:grid-cols-2` of compact rows (initial tile `h-8 w-8` + name + `Solo`/`N members` · lastPlayed).
4. **Tertiary CTAs** (`mt-8 flex justify-center gap-3`): outlined "New party" (`Plus`) + "Join with a code" (`LogIn`).

**Why it's a finalist:** most emotionally engaging, fastest "resume play," flavor-forward medallion. **Watch-outs:** the "Continue" bias is weaker for users with many equally-active parties; the medallion is bespoke (more to build/maintain than a plain avatar).

---

## Finalist B — List + Detail rail (master-detail)

**Concept.** A tool-home (email/Slack-style): compact selectable party list on the left, selected party's details + stable "Enter" action on the right. Scales cleanly as party count grows.

**Layout** (outer: `mx-auto max-w-5xl px-4 py-8`):

1. **Header** (`mb-6`): muted "Welcome back, {name}" + `font-display text-2xl font-bold` "Choose a party".
2. **Two columns** (`grid gap-6 md:grid-cols-[20rem_1fr]`):
   - **Master (left, `space-y-2`):**
     - Party rows: full-width button `flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left`. Selected = `border-primary/50 bg-primary/5`; else `border-border bg-surface hover:bg-surface-2`. Contents: initial tile (`h-9 w-9 rounded-md font-display font-bold`; selected → `bg-primary/15 text-primary`, else `bg-surface-2 text-muted-foreground`) + name (truncate, `text-sm font-medium`) + meta (`Solo`/`N members` · lastPlayed) + trailing `ChevronRight`.
     - **New / Join** (`grid grid-cols-2 gap-2 pt-2`): two dashed-border buttons (`border-dashed border-border ... hover:border-primary/50 hover:text-primary`) — "New" (`Plus`) and "Join" (`LogIn`).
     - **Profile footer** (the profile treatment): `mt-3 flex items-center gap-2.5 rounded-lg border bg-surface px-3 py-2` — `Avatar` (32px) + name/email stack (truncate) + a trailing `MoreHorizontal` icon-button (opens account menu; workspace-footer style, à la Slack/Discord).
   - **Detail (right, `rounded-lg border bg-surface p-6 shadow-e1`):**
     - Top row (`flex items-start justify-between`): left = role pill (`Solo`/role, `Crown` if DM) + party name (`font-display text-2xl font-bold`) + meta ("Playing {character | italic '— no character yet'} · last played {…}"); right = primary `Enter` CTA (`rounded-md bg-primary px-4 py-2` + `Play`).
     - **Stat trio** (`mt-6 grid grid-cols-3 gap-3`): reusable `Stat` card = `rounded-md bg-surface-2 px-3 py-2.5`, small-caps label with icon (`Users` Members / `Package` Items / `Coins` Gold gp-eq.) + `text-lg font-semibold tabular-nums` value.
     - **Roster** (`mt-6`): small-caps "Roster" heading + wrapped member chips (`rounded-md bg-surface-2 px-2 py-1 text-xs`).
   - State: `selected` party id (defaults to first); detail derives from it.

**Why it's a finalist:** scales to many parties, stable action location, matches the "tool you live in" identity + the sidebar nav decision. **Watch-outs:** slightly more clicks to enter (select → Enter) vs the Hero's one-click continue; the detail pane is empty-ish for brand-new users with one party.

---

## Decision status

Shortlist of 2 (recorded 2026-07-10). Rejected from the round of 5: Card grid, Command center, Split action.

**Resolved 2026-07-13: BOTH ship.** **A (Hero/Continue) is the default**; **B (List+Detail) is a user-selectable alternative** via a planned **"Hub layout" preference** in the account Settings "Appearance" cluster (alongside theme + accent + follow-class). The two optimize for different party counts / user tastes, so the user picks rather than being forced onto one. Consequence: both layouts are production code to build + maintain (B is no longer disposable reference). The medallion refinement (no gear pip; accent-behind-portrait avatar) applies to A — see the "Finalist A" edits above. Not prototyped further in the lab; the two specs above are the rebuild reference.
