# DM Dashboard & Modals — chosen designs (rebuild reference)

Decisions from the 2026-07-10 design-lab round. Detailed enough to recreate without the git-excluded lab. Shares R9 tokens (`CHARTER.md` → "Design baseline").

---

## DM Dashboard — chosen: "Command Center"

**Decision (2026-07-10): the multi-panel Command Center.** Chosen over "Stat cards" and "Session-focused" (both removed). Note: the **session/GameSession feature is not fully fleshed out yet** — the command center references a current session but does NOT lean on a rich session model, which suited the current state. Revisit the session surfacing when that feature matures.

**Concept.** A control surface (not a data page) that foregrounds the ACTIONS a DM takes.

**Layout** (outer `mx-auto max-w-5xl px-4 py-8`):

1. **Header:** party name (muted) + `font-display text-2xl font-bold` "DM Command Center".
2. **Current-session banner** (`rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-surface p-5 shadow-e2`, `flex justify-between`): left = a `ScrollText` icon medallion + eyebrow ("Session N · in progress" or "No active session") + title (`font-display text-xl font-bold`); right = a primary CTA ("Session tools" / "Start session", `Play` icon). *Keep this lightweight until the session feature grows.*
3. **DM-tool launcher tiles** (`grid gap-3 sm:grid-cols-2 lg:grid-cols-4`): one tile per DM action — **Generate hoard** (`Sparkles`), **Distribute loot** (`Coins`), **Identify items** (`Gem`), **Manage party** (`Users`). Each tile = `rounded-lg border bg-surface p-4 shadow-e1 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-e2`, with an icon chip (`h-9 w-9 rounded-md bg-primary/10 text-primary`), a bold label, and a muted one-line description.
4. **Party overview** (`grid md:grid-cols-[1fr_16rem]`):
   - Left card: "Party at a glance" — rows per character (initial tile + name + "{player} · L{level} {class}" + right-aligned inv. gp + `ChevronRight`), `hover:bg-surface-2/60`.
   - Right rail: a "Total party gold" stat card + a small pool-summary card (Party Stash / Recovered Loot item counts).

**Why:** most unlike the player screens; action-forward; the launcher tiles map cleanly to the DM-Tools nav group. **Watch-out:** the launcher tiles must route to the real DM tools (Hoard/Loot/Identify/Party) — they're the nav into those flows.

---

## Modals — chosen: "Centered form" + "Confirm" (complementary pair)

**Decision (2026-07-10): keep both, they fill different roles.** "Side sheet" removed. These two cover the whole modal surface: a **form dialog** for input actions and a **confirm dialog** for destructive/irreversible ones. Similar visual design (centered card, dim backdrop, titled header, footer actions) so they read as one family.

### Centered form dialog (the workhorse — ~15 real modals)

Move/transfer/split/create-stash/etc. Overlay `bg-foreground/40`; card `max-w-md rounded-lg border bg-surface shadow-e3`.

- **Header** (`border-b px-5 py-4`, `flex justify-between`): title (`font-display text-lg font-semibold`) + subtitle (context, e.g. "{item} · N in stack") + an `X` close button.
- **Body** (`space-y-4 px-5 py-4`): labelled fields — a target `<select>` (with a "Pick a target…" empty option) and a numeric quantity `<input>`. **Inline validation**: on invalid (e.g. qty > available) the input gets `border-destructive focus:ring-destructive` and a `text-xs text-destructive` message with `role="alert"`; a muted helper line otherwise.
- **Footer** (`border-t bg-surface-2/50 px-5 py-3`, `flex justify-end gap-2`): outlined **Cancel** + primary **Move** (`ArrowRight` icon), the primary **disabled** (`opacity-40`) while invalid.
- **R8.5 tie-in:** this is where the mutation-outcome flow surfaces — submit → optimistic → "Queued…" → success/rejection via `useDispatch`. The disabled-until-valid state is client-side pre-validation; the server is still authoritative.

### Confirm / destructive dialog

Delete-stash/kick/wipe/delete-account. Overlay `bg-foreground/40`; card `max-w-sm` (smaller = higher friction).

- **Body** (`px-5 pt-5`): a destructive icon medallion (`h-11 w-11 rounded-full bg-destructive/10 text-destructive` + `AlertTriangle`), title, a plain-language consequence sentence, and an optional **consequence snapshot** (`rounded-md bg-surface-2 px-3 py-2` with label→value rows, e.g. "Items moved 14 / Currency moved 220 gp" — mirrors the real delete-stash confirm).
- **Footer** (`border-t bg-surface-2/50`): outlined **Cancel** + **destructive confirm** (`bg-destructive text-destructive-foreground`).

**Shared:** both map to shadcn `dialog` (form) / `alert-dialog` (confirm) for real; both use the same header/footer rhythm so they're visually a set.

## Status

Chosen 2026-07-10. Screenshot into `drawings/` before the lab is deleted if a durable visual is wanted.
