# R9 — UI Redesign (planning workspace)

Scratch + planning workspace for the **R9 UI redesign** (roadmap `### R9 — UI redesign`). This folder collects notes, the design audit, and draw-ups **before** any code is written — R9's charter mandates that the whole slice is planned + designed up front, not shipped as a trickle of small commits.

> **Branch note.** These docs currently live on `feat/r8-hardening` for convenience while R8 is under PR review. Once R8 merges to `main`, this folder moves to a fresh `r9-redesign` branch cut from `main`. Nothing here is load-bearing for R8.

## Sources of truth (don't duplicate — link)

R9 decisions that change product scope or tech choices must land in the canonical docs, not here:

- `docs/OUTLINE.md` — product scope, data model, permissions. **§5 form factor** needs amending for whatever mobile posture R9 decides (roadmap R9 kickoff prereq).
- `docs/TECH_STACK.md` — Tailwind + shadcn/ui are the styling stack; no CSS-in-JS. Any new design-system tokens/primitives are described there.
- `docs/USER_FLOWS.md` — screen-by-screen flows the redesign must preserve.
- `docs/roadmap.md` `### R9` — the checkbox list + Notes. This folder is the workspace; the roadmap stays the tracker.

## Contents

- [`CHARTER.md`](./CHARTER.md) — **agreed direction + open decisions.** Start here.
- [`HUB_FINALISTS.md`](./HUB_FINALISTS.md) — detailed rebuild specs for the 2 shortlisted Hub designs (Hero/Continue + List/Detail).
- [`SETTINGS_PAGE.md`](./SETTINGS_PAGE.md) — chosen Profile/Settings page ("Profile hero + cards") rebuild spec.
- [`DM_AND_MODALS.md`](./DM_AND_MODALS.md) — chosen DM Dashboard ("Command Center") + Modals ("Centered form" + "Confirm") rebuild specs.
- [`SCREENS.md`](./SCREENS.md) — chosen Catalog (Table), Shop (Storefront + DM manage), History (Table), Loot Wizard (Stepper) rebuild specs.
- [`UI_AUDIT_2026-07-07.md`](./UI_AUDIT_2026-07-07.md) — the 2026-07-07 design audit (roadmap kickoff prereq). Currently a stub to paste the original audit into.
- [`drawings/`](./drawings/) — draw.io / diagram files + mockups produced during planning.

## Status

**Planning — foundations agreed.** Direction set 2026-07-10 (see `CHARTER.md`): complete redesign, hybrid "tool + flavor", light+dark first-class, best-effort a11y, mockup-first. **Navigation decided: sidebar + task-grouped IA** (collapsible icon rail; mobile bottom-bar + drawer). **Character Sheet prototype approved as the visual baseline.** Next: extend the baseline to more screens (Party Stash, a modal) + plan the token/primitive foundation for real implementation.
