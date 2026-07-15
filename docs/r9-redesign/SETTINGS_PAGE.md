# Profile / Settings page — chosen design (rebuild reference)

**Decision (2026-07-10): the "Profile hero + cards" option.** Chosen from 4 explored (Profile hero, Two-pane, Single column, Card grid). Detailed enough to recreate without the git-excluded lab. Shares the R9 tokens (`CHARTER.md` → "Design baseline").

**Scope.** This is the **user / account** profile page (identity + login methods + appearance + sessions + account-level danger zone). **Party-level data settings** (JSON backup export/import, encumbrance rule, economy preset, wipe-party-data) are a **separate surface** — they belong to a party, not the user — and are NOT part of this page. Decide their home at implementation (likely under the party sidebar's Settings, distinct from this account page).

**Account surface modelled** (mirrors the current app + SECURITY §1 / OUTLINE §3.1):
`displayName`, `email` (+ `emailVerified`), `avatarUrl|null`, Discord link (`linked`, `username`), `memberSince`, `partyCount`, and a `sessions[]` list (`device`, `lastActive`, `current`).

## Layout

Outer: `mx-auto max-w-3xl px-4 py-8`.

**1. Hero banner** (`relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-primary/10 to-surface p-6 shadow-e2`), row = `flex flex-wrap items-center gap-4`:

- **Avatar (editable):** `group relative`; `h-20 w-20 rounded-full border-2 border-primary/40 bg-surface-2 ring-2 ring-surface`, initial in `font-display text-3xl font-bold text-primary` (or image if `avatarUrl`). A **camera pip** bottom-right: `absolute -bottom-0.5 -right-0.5 h-7 w-7 rounded-full border-2 border-surface bg-primary text-primary-foreground` + `Camera` icon → change photo.
- **Identity block** (`min-w-0 flex-1`): name (`font-display text-2xl font-bold`), email (muted), a meta row (`mt-2 flex gap-4 text-xs text-muted-foreground`) with `Users` + "{partyCount} parties" and `Calendar` + "Member since {memberSince}".
- **Primary CTA:** `Edit profile` (`rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground`).

**2. Setting sections** (`mt-6 space-y-4`), each a **`Section`** card (rounded-lg border, titled header = `font-display text-sm font-semibold uppercase tracking-wide` + optional muted `desc`, body `p-4`):

- **Account** ("Your identity across every party."): `divide-y` rows — Display name (value + `Edit`), Email (value + `sub` Verified/Unverified + `Change`).
- **Login methods** ("Sign in with either. Keep at least one."): stacked `LinkPill`s — Email (linked, detail=email), Discord (linked?, detail=username). `LinkPill` = bordered row; linked → green "Connected" pill, else a `Connect` ghost button.
- **Appearance:** a `Row` "Theme" with a **segmented `light / dark / system`** control (active = `bg-primary text-primary-foreground`).
- **Sessions** ("Devices signed in to your account."): `divide-y` rows per session — device label + `sub` lastActive; current → green "This device", else a `Revoke` ghost button.
- **Danger zone** (`danger` variant → `border-destructive/40`, destructive-colored title): `Export my data` + `Delete account`, both `border-destructive/50 text-destructive hover:bg-destructive/10`.

## Shared primitives (the settings kit)

Recreate these small helpers (prototyped in the lab's `settings/kit.tsx`):

- **`Section`** — titled card; `danger` prop swaps border/title to destructive.
- **`Row`** — `flex items-center justify-between`; `label` (+ optional `sub`) on the left, optional `value` (muted) + `action` on the right.
- **`GhostButton`** — small outlined button (`border-border px-2.5 py-1 text-xs hover:bg-surface-2`).
- **`ThemeSegmented`** — 3-way light/dark/system segmented control (persists the pref for real).
- **`LinkPill`** — linked/unlinked account method row (green "Connected" vs "Connect").

For real implementation, these map to vendored shadcn primitives: `card` (Section), `button` (Ghost/CTA), a segmented control or `tabs`/`toggle-group` (ThemeSegmented), `badge` (Connected pill), `alert-dialog` (delete-account confirm).

## Why chosen / watch-outs

- **Why:** person-forward "my account" feel; the hero makes identity the anchor; sections are scannable and extend cleanly (R10 will add email-change, session revoke, etc.). Reads friendly, not corporate.
- **Watch-outs:** the hero + `max-w-3xl` single column is desktop-comfortable but should collapse gracefully on mobile (hero row already `flex-wrap`s); consider whether the "Edit profile" CTA duplicates the inline per-row Edit actions (pick one pattern at build time — likely keep inline edits, drop the hero CTA or make it scroll-to/expand).

## Status

Chosen 2026-07-10. Screenshot into `drawings/` before the lab is deleted if a durable visual is wanted.
