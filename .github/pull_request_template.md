<!--
Commit-message style (from CLAUDE.md): gitmoji + one-line subject.
The PR title should match this style — e.g. "✨ shops MVP", "🐛 BUG-013 …".
Detail belongs here in the body, not in commit messages.
-->

## Summary

<!-- One or two sentences on WHY this change exists. Link the driving issue / slice. -->

Closes #

## Type of change

<!-- Check all that apply. -->

- [ ] ✨ Feature — new capability
- [ ] 🐛 Bug fix — see `docs/BUGS.md` entry: BUG-…
- [ ] ♻️ Refactor / internal cleanup
- [ ] 📝 Docs only
- [ ] 👷 CI / infra / tooling
- [ ] 🔥 Removal of code or feature

## Scope

<!-- Which packages / apps changed? Keeps reviewers oriented before opening the diff. -->

- [ ] `apps/web`
- [ ] `apps/server`
- [ ] `packages/rules`
- [ ] `packages/shared`
- [ ] `packages/seeds`
- [ ] `infra/`
- [ ] `docs/`

## Testing

<!-- Which tests cover this? Note new tests added. See TECH_STACK §3.5 for layer selection. -->

- [ ] Unit tests (`packages/rules` / helpers)
- [ ] Component tests (React Testing Library)
- [ ] Server-integration tests (real DB, mutation routes touching Postgres)
- [ ] Manual verification — steps documented below
- [ ] Not applicable — docs / cosmetic only

### Manual test notes

<!-- If manual verification: what did you click / observe? Reproduce for reviewers. -->

## Docs updated

<!-- The docs are the source of truth. If the change contradicts a doc, the doc wins — update it here. -->

- [ ] `docs/OUTLINE.md`
- [ ] `docs/MVP.md`
- [ ] `docs/TECH_STACK.md`
- [ ] `docs/SECURITY.md`
- [ ] `docs/roadmap.md` (ticked shipped tasks, added Notes block)
- [ ] `docs/BUGS.md` (moved entry to "Recently fixed")
- [ ] `CLAUDE.md`
- [ ] N/A — no doc impact

## Pre-flight checklist

<!-- Copy-pasted from CLAUDE.md — the recurring gotchas. -->

- [ ] `pnpm exec prettier --write` on touched files
- [ ] `pnpm typecheck` passes
- [ ] `pnpm --filter @app/web test` (and `@app/server` when applicable) passes
- [ ] No `any`, `as any`, or `// @ts-ignore` added
- [ ] No `localStorage` / CSS-in-JS / router-state-lib introduced
- [ ] `src/components/ui/*` untouched (managed by `shadcn-ui add`)
- [ ] Every mutation still appends a `TransactionLog` entry (if applicable)
- [ ] Zod schema updated + `actionMetadata` registry updated (if new action variant)

## Security review (if applicable)

<!-- Fill this in for changes touching auth, permissions, currency, WebSocket, JSON import, or user-controlled input. -->

- [ ] Server derives identity from session cookie, never from request body
- [ ] Zod `.strict()` at every new boundary
- [ ] Currency math stays integer CP
- [ ] No `dangerouslySetInnerHTML` with user-controlled values
- [ ] N/A — change doesn't touch a security-sensitive surface

## Screenshots / recordings

<!-- Drag & drop for UI changes. Delete if not applicable. -->
