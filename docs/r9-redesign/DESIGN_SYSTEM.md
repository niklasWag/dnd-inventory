# R9 Design System — foundation tokens

The token foundation for the R9 redesign, extracted from the design lab (`design-lab/src/index.css` + `tailwind.config.js`) and the decisions in `CHARTER.md`. This is the **spec the real implementation vendors into `apps/web`** — palette, type, spacing, elevation, radii — all as CSS variables so light + dark derive from one source.

Status: **confirmed foundations** (2026-07-13). Values below are the locked defaults; the accent hue remains user/class-configurable at runtime (see "Accent"). Prototype exact HSL values may still be nudged during implementation, but the *system* (the token names, the scales, the relationships) is the baseline.

---

## 1. Color tokens

All colors are stored as **HSL channel triplets** (e.g. `222 24% 9%`) and consumed via `hsl(var(--token))`, so a single variable drives both `bg-*` and `text-*` utilities and light/dark derive cleanly. Base is neutral; flavor lives in the accent + rarity layers.

### Neutrals — base (confirmed: Neutral gray light / Cool blue-slate dark)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `0 0% 99%` | `222 24% 9%` | Page background |
| `--foreground` | `240 6% 12%` | `210 20% 92%` | Body text |
| `--surface` | `0 0% 100%` | `222 22% 13%` | Raised card surface |
| `--surface-2` | `240 5% 96%` | `222 18% 17%` | Secondary fill (table headers, wells) |
| `--muted` | `240 5% 92%` | `222 16% 22%` | Muted fill |
| `--muted-foreground` | `240 4% 46%` | `215 14% 62%` | Secondary text |
| `--border` | `240 6% 88%` | `222 14% 25%` | Borders / dividers |
| `--input` | `240 6% 88%` | `222 14% 25%` | Input borders |

Light stays temperature-neutral; dark is cool blue-slate — a temperature-consistent cool pairing (flavor is carried by type + accent, not the base). See CHARTER decision log 2026-07-13.

### Accent — brand (default; runtime-configurable)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--primary` / `--accent` | `196 78% 38%` (cyan-teal) | `194 70% 56%` | Brand accent, primary buttons, active states |
| `--primary-foreground` / `--accent-foreground` | `200 40% 98%` | `205 40% 10%` | Text on accent |
| `--ring` | `196 72% 42%` | `194 68% 56%` | Focus ring |

**Default = cyan-teal** (confirmed 2026-07-13) — pairs with gold/loot, sits clear of the rarity greens/blues/purples + destructive red (zero collisions), temperature-consistent with the cool dark base, and the most ownable of the candidates. The default *is* the brand (first impression before customization). Rejected: amber (collides with the currency/gold UI + `rarity-legendary`), emerald (collides with `rarity-uncommon`), plain teal (less distinctive).

**User-selectable accents (offered options):** cyan-teal (default), **amber**, **emerald** — plus the other presets in the lab. All re-set `--primary`/`--accent`/`--ring`.

### Accent model — user setting + per-class follow

The accent has a two-level runtime model:

1. **Default / explicit choice.** Every user starts on **cyan-teal**; they can pick a different explicit accent in Settings (amber / emerald / …). This is their "default accent."
2. **"Follow character class" setting (opt-in).** When enabled, the accent **follows the current character's D&D class while inside a party** — each of the 12 classes has its own **unique** hue (see below). **Outside any party** (auth / Hub / account Settings screens), the accent **reverts to the user's default accent** — resolving the party-screen ambiguity (a party-wide screen has no single class, so it uses the default, not a character's color).

**Per-class colors (12 unique hues).** Each 2024 PHB class maps to a distinct accent so switching characters visibly re-skins; mild overlap with the rarity/destructive bands is accepted since this accent is opt-in. Cleric = the current amber. (Lab: `design-lab/src/mock/classColors.ts`; visual reference: the "Reference → Class colors" lab view.)

6 classes **reuse an accent preset verbatim** (marked ✻); the other 6 have unique hues — all 12 stay distinct. (Lab: `design-lab/src/mock/classColors.ts`.)

| Class | Hue | Class | Hue |
|---|---|---|---|
| Barbarian | Crimson ✻ | Paladin | Radiant gold |
| Bard | Magenta | Ranger | Emerald ✻ |
| Cleric | Amber ✻ | Rogue | Indigo slate |
| Druid | Leaf green | Sorcerer | Orange-red |
| Fighter | Steel blue | Warlock | Violet ✻ |
| Monk | Teal ✻ | Wizard | Cyan-teal ✻ |

✻ = identical to the same-named accent preset (Barbarian=crimson, Cleric=amber, Monk=teal, Ranger=emerald, Warlock=violet, Wizard=cyan-teal).

### Semantic

| Token | Light | Dark |
|---|---|---|
| `--destructive` | `0 68% 48%` | `0 62% 55%` |
| `--destructive-foreground` | `40 40% 98%` | `40 40% 98%` |

Destructive red is reserved for irreversible/dangerous actions — never used as an accent, so it stays a clear signal.

### Rarity — flavor layer (D&D 2024)

| Token | Light | Dark |
|---|---|---|
| `--rarity-common` | `30 6% 45%` | `30 6% 62%` |
| `--rarity-uncommon` | `140 55% 34%` | `140 50% 58%` |
| `--rarity-rare` | `214 80% 48%` | `214 78% 66%` |
| `--rarity-very-rare` | `280 60% 52%` | `280 62% 72%` |
| `--rarity-legendary` | `36 90% 45%` | `40 90% 62%` |

Rarity is a **display invariant**, not chrome — shown as a bordered pill only for identified, non-common items (per OUTLINE §8). Dark values are lightened for legibility.

---

## 2. Typography

- **Body / UI:** **Inter** (`--font-sans`; weights 400/500/600/700). Chosen for first-class `tabular-nums` — load-bearing for the currency / quantity / weight columns — and its neutral pairing with the display serif.
- **Display / headings:** **Cinzel** (`--font-display`; weights 500/600/700; fallback Georgia, serif). The one thematic type choice; carries the "fantasy" flavor so the base palette can stay neutral. Driven by the `--font-display` CSS var so it's swappable at the token level.
- **Numerics:** always `tabular-nums` for aligned columns (currency, qty, weight, gp totals, stats).

**Type scale** (Tailwind defaults, as used across the lab — formalize these as the R9 scale):

| Role | Class | Size / line-height |
|---|---|---|
| Page title (`font-display`) | `text-3xl` | 1.875rem / 2.25rem |
| Screen/section heading (`font-display`) | `text-2xl` | 1.5rem / 2rem |
| Card header (small-caps `font-display`) | `text-sm` uppercase tracking-wide | 0.875rem |
| Body | `text-sm` | 0.875rem / 1.25rem |
| Body large / values | `text-base` / `text-lg` | 1rem / 1.125rem |
| Meta / secondary | `text-xs` | 0.75rem |
| Micro (labels, eyebrows) | `text-[11px]` / `text-[10px]` | — |

Card headers use small-caps `font-display` + `uppercase tracking-wide` (the established pattern). Fonts are loaded via Google Fonts in the lab; **real implementation should self-host** and ship the OFL license files (both Inter + Cinzel are SIL OFL 1.1).

---

## 3. Spacing rhythm

Tailwind's default 4px-based scale, as used consistently across the lab. Canonical steps:

| Context | Value |
|---|---|
| Inline gaps (icon↔text, chips) | `gap-1` / `gap-1.5` / `gap-2` (4–8px) |
| Intra-card content | `gap-3` / `gap-4` (12–16px) |
| Between cards / sections | `space-y-4` / `gap-6` (16–24px) |
| Card padding | `px-4 py-3` (headers) · `p-4` / `p-5` (bodies) |
| Page padding | `px-4 py-8` (standard) · `py-12` (hero screens like Hub) |
| Page max-width | `max-w-md` (forms) · `max-w-2xl` (focused) · `max-w-3xl`/`max-w-4xl`/`max-w-5xl`/`max-w-6xl` (data screens) |

Rule of thumb: 4px increments; tighten to `1.5`/`2` for dense data rows, loosen to `6`/`8` for section separation.

---

## 4. Elevation (shadows)

Three-step scale, all tinted by `--shadow-color` (light: `30 30% 20%`, dark: `210 40% 3%`):

| Token | Value | Use |
|---|---|---|
| `shadow-e1` | `0 1px 2px 0 hsl(var(--shadow-color) / 0.06)` | Resting cards, table containers |
| `shadow-e2` | `0 2px 8px -2px hsl(var(--shadow-color) / 0.10)` | Raised / hero cards, identity blocks |
| `shadow-e3` | `0 8px 24px -6px hsl(var(--shadow-color) / 0.16)` | Overlays — modals, drawers, popovers, dropdown menus |

Elevation maps to interaction layer: e1 = in-flow surface, e2 = emphasized/floating, e3 = above the scrim.

---

## 5. Radii

Driven by `--radius: 12px`:

| Token | Value | Use |
|---|---|---|
| `rounded-lg` | `var(--radius)` = 12px | Cards, panels, dialogs |
| `rounded-md` | `calc(var(--radius) - 4px)` = 8px | Buttons, inputs, chips |
| `rounded-sm` | `calc(var(--radius) - 8px)` = 4px | Small inset elements |
| `rounded-xl` | 12px (Tailwind) | Hero / prominent cards (used interchangeably with `lg` in the lab) |
| `rounded-full` | — | Avatars, coin dots, pills, toggles |

---

## 6. Reusable primitives (to vendor as shadcn)

Per the current-state audit, only 10 shadcn primitives are vendored. R9 adds the missing ones and routes everything through them (removes most hand-rolled inconsistency):

**Already vendored:** `alert-dialog, button, dialog, dropdown-menu, input-otp, input, label, progress, select, sonner`.

**To vendor for R9:** `card`, `table`, `tabs`, `badge` (chip), `tooltip`, `skeleton`, `sheet` (mobile drawer).

Each is currently hand-rolled with raw Tailwind across ~18 screens; the lab prototypes them ad hoc. Vendoring + applying these tokens is CHARTER sequencing step 4 (before screen rollout).

---

## Provenance

- Palette base + accent default: CHARTER decision log 2026-07-13 (Neutral+Cool base; teal accent).
- Fonts: CHARTER decision log 2026-07-13 (Cinzel + Inter).
- All token values mirror `design-lab/src/index.css` + `design-lab/tailwind.config.js` at extraction time. The lab is throwaway/git-excluded; this doc is the durable record.
