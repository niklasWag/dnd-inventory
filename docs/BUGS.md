# Bugs

Open + recently-closed bugs in the project. Each entry has a stable id (`BUG-<n>`), severity, status, repro steps, root-cause analysis, fix sketch, and back-pointers to the code involved.

**Conventions.**

- New bugs get appended at the bottom under `## Open`.
- A bug graduates to `## Recently fixed` once the fix has shipped (with the commit / PR / RH-slice that closed it). Entries stay there for one release cycle so a future review can audit the fix.
- IDs never rewind; the next bug after `BUG-007` is `BUG-008`, even if some earlier ones are closed.
- Severity: **blocker** (the affected flow cannot complete) > **high** (broken UX with no workaround) > **medium** (workaround exists) > **low** (cosmetic / observability).
- Status: **open** | **investigating** | **fix-pending** (PR open) | **fixed** (merged).
- Each entry is roadmap-aware: if the fix belongs to an existing RH-slice or feature slice, note it. Architectural bugs that need their own slice get promoted with a `Promoted to <slice>` note.

## Process

- File a bug as soon as the symptom is reproducible. Don't wait for root-cause analysis — the entry becomes the workspace for the analysis.
- Update the entry as understanding evolves. The original symptom (browser screenshot, server log, etc.) stays at the top; new findings get appended in dated sections beneath.
- When a bug is fixed, move the whole entry under `## Recently fixed` and add a closing summary section. Don't delete content — the entry is now a postmortem.

---

## Open

None — all filed bugs are fixed. New bugs get appended here (see Process above).

---

## Recently fixed

### BUG-005 — Optimistic success toast flashes before the server rejection toast on guarded actions

- **Filed:** 2026-07-01
- **Fixed:** 2026-07-10 (branch: `feat/r8-hardening`; R8.5)
- **Severity:** medium (cosmetic + UX-confusing — no data corruption; the final state is correct because the queue rolls back via BUG-003's snapshot pattern, and the rejection toast is the last one shown. But a user who blinks may think their action succeeded before seeing the rejection.)
- **Status:** fixed
- **Affected slice:** cross-cutting — surfaced during R4.4 manual testing. Underlying defect predates R4 (present since R3.5 when the sync queue landed).

**Symptom.** Server mode, multi-member party. A player attempts a DM-only action they don't have permission for (e.g. clicks "New homebrew" in the Catalog Browser, or drags an item out of Party Stash while a Banker is active). Two toasts flash in quick succession:
1. A green success toast (e.g. "Homebrew created" / "Item transferred") appears for a brief moment.
2. It's replaced by the red rejection toast ("Action rejected: dm_only" / "banker_required_for_claim").

The final on-screen state is correct — the optimistic mutation is rolled back via `deps.restoreSnapshot(snapshot)` in `queue.ts:247`. But the two-toast flash makes the UX ambiguous: users may believe their action succeeded and only afterwards see the rejection.

**Reproduction.**
1. Server mode, 2+-member party with a dedicated DM.
2. Sign in as a non-DM player.
3. Attempt any DM-only action:
   - Click "New homebrew" in `/catalog` → fill form → Save.
   - As a non-Banker player with a Banker appointed: try to move currency OUT of Party Stash.
   - Try to rename the party.
4. Observe the two-toast sequence: green then red.

**Root-cause hypothesis (needs verification).** The mutation dispatch path in the UI runs BEFORE the server round-trip:
- User clicks Save → screen calls `useStore.getState().dispatch(action)` → the reducer runs locally, mutation applies to `appState`, `TransactionLog` entry appended. Screen shows the green "success" toast because the local dispatch didn't throw.
- The action then joins the sync queue → `queue.ts:flushBatch` → `POST /sync/actions` → server calls `checkGuard` → 422 with the rejection code.
- Queue catches the `BatchRejectedError`, restores the pre-batch snapshot, calls `toast.error(...)` with the rejected code. Red toast replaces the green one.

The client-side reducer is **actor-role-agnostic** (it doesn't know whether the actor is DM or player — role is derived server-side per SECURITY §2.1). So the local dispatch always succeeds when the payload is well-formed; the auth rejection only surfaces after the network round-trip.

**Why this pattern isn't a security issue.** SECURITY §2.1 mandates that the server is authoritative; the client's optimistic dispatch is display-only. The rejection + rollback is the correct enforcement path. This bug is about the UI showing a **misleading intermediate state** (the green toast), not about the enforcement itself failing.

**Fix sketch (options — pick after triage).**

- **Option A (recommended): suppress the success toast for actions that MAY be server-rejected.** Screens that dispatch a mutation subject to server auth guards should NOT show an immediate success toast. Instead, they should either (a) show no toast on optimistic dispatch and rely on the queue to show a success toast on 200, or (b) show a "queued..." toast that upgrades to success or gets replaced by rejection. Requires threading queue-completion callbacks into calling screens. Bigger change, cleaner UX.

- **Option B: run client-side guards in the dispatch path.** Before calling `dispatch`, run `checkGuard(state, action, localActor, memberships)` in the UI and short-circuit with the same rejection toast. Faster feedback, no green flash. Downside: duplicates the guard check between client + server (client-side guard becomes a "prevalidation" that isn't security-load-bearing but must stay in sync). This is close to what §2.1 permits for "optimistic UI" — the client rules engine already runs for the mutation itself; extending it to guards is symmetric.

- **Option C (minimal): change every screen's dispatch site to defer the success toast until the queue confirms.** Similar to Option A but per-screen rather than centralized. High per-screen surface area.

Option B is the cheapest per-screen and structurally symmetric (client already runs the reducer for optimistic UI; adding the guard is the missing piece). Option A is cleaner long-term. Option C is highest churn.

**Affected callsites (non-exhaustive).**
- `apps/web/src/screens/CatalogBrowser.tsx` — "New homebrew" success toast.
- `apps/web/src/components/catalog/HomebrewForm.tsx` — save/edit success toasts.
- `apps/web/src/components/stash/CurrencyTransferModal.tsx` — currency transfer success toast.
- `apps/web/src/screens/PartySettings.tsx` — rename-party / kick-player / dm-transfer success toasts.
- Likely more; audit with `grep -rn "toast.success" apps/web/src`.

**Roadmap placement.** Not architectural — this is a per-screen UX polish issue with a well-scoped fix (Option B is essentially "call `checkGuard` before `dispatch`"). Could ship as an RH-slice ("RH5 — client-side pre-guard for optimistic UI") or as a small polish slice inside R4.5 / a pre-M5 hardening pass. Filing here for triage; the user should decide the slice placement.

**Related.**
- BUG-003 (rollback captures pre-mutation state) — the rollback mechanism itself works correctly; this bug is upstream of that.
- SECURITY §2.1 — server-authoritative rejection is the invariant; the fix must not soften it, only front-load the client-side check for display purposes.
- `apps/web/src/sync/queue.ts:247` — where the current red rejection toast fires.

**Closing summary (2026-07-10, R8.5 — mutation outcome authority).** Fixed via **Option A**, generalized into an addressable outcome rather than per-screen callback threading. The store's `dispatch` now returns `Promise<MutationOutcome>` (`{ ok: true; applied } | { ok: false; code; message? }`); in server mode the sync queue is the sole authority that resolves it — once `POST /sync/actions` reaches a terminal state (200 / 422 / auth / parked) it drains a per-dispatch correlation map (`registerOutcome(dispatchId)` ↔ `enqueue`). In local mode the outcome resolves synchronously (the local apply IS the terminal outcome). A new `useDispatch` hook (`apps/web/src/lib/useDispatch.ts`) is the single UI seam: `dispatch(action, { onSuccess, onRejection, queuedToast })` runs `onSuccess` ONLY on a genuinely-terminal `{ ok: true }`, so the green toast can no longer precede a server rejection. The queue's inline `toast.error` on 422 is retired — the rejection rides the outcome and `useDispatch`'s default consumer renders it via the shared `apps/web/src/sync/rejectionToast.ts` map (also reused by the reconnect-drain path, which has no live awaiter). Reducer-invariant throws stay a SYNCHRONOUS throw at the raw `dispatch` boundary (preserving the `reduce`-throws → `dispatch`-throws reducer test surface); `useDispatch` catches them and normalizes to `{ ok: false, code: 'reducer_error' }`. ~25 mutation callsites migrated off the `dispatch(); toast.success()` shape. A custom ESLint rule `local/no-sync-toast-success-after-dispatch` (`apps/web/eslint-rules/`) now fails the build on the naive pattern so the class cannot regress. See `docs/SECURITY.md` §2.1 for the optimistic-UI clarification (the terminal success signal waits for server ack, or the local-mode shim). No security-posture change — the server stays authoritative; this only governs what the client is allowed to *show*.

---


### BUG-014 — Socket connects during `needsDisplayName`; server rejects it, reconnect loop throws an uncaught TypeError

- **Filed:** 2026-07-09
- **Fixed:** 2026-07-09 (branch: `feat/r8-hardening`; R8.4.d)
- **Severity:** medium (uncaught client exception + an infinite failing-reconnect loop during first-time onboarding. Benign for slow human timing — the socket reconnects cleanly once onboarding finishes — but it derails any action fired in the same tick, and it trains users/devs to ignore console errors. A regression introduced by BUG-006's fix.)
- **Status:** fixed
- **Affected slice:** R5.1.b (client socket consumer). Introduced 2026-07-04 by **BUG-006's fix**, which auth-gated the socket connect but on a wrong assumption about the server contract (see below).

**Symptom.** Server mode, first-time email-OTP login. During onboarding the browser console shows:

```
WebSocket connection to 'ws://.../socket.io/?...' failed: WebSocket is closed before the connection is established.
[socket] connect_error: display_name_required
TypeError: Cannot read properties of undefined (reading 'request')
```

The `connect_error: display_name_required` repeats (Socket.IO's `reconnectionAttempts: Infinity`), and the `authenticated` transition that follows onboarding throws the uncaught `TypeError`. No user-visible toast; the final state is usually fine because the socket eventually reconnects post-onboarding.

**Reproduction.**

1. Server mode, fresh email that has never signed in.
2. `/login/email` → enter email → submit → enter OTP → verify. Session cookie is now set with `needsDisplayName: true`.
3. The boot-time `useSession.subscribe` fires `syncSocketWithSession('needsDisplayName')`, which (pre-fix) built + connected the socket.
4. Server's `io.use()` middleware rejects the upgrade with `display_name_required` (`apps/server/src/realtime/io.ts:132`).
5. socket.io-client enters its infinite reconnect loop; each retry logs `connect_error`.
6. User submits their display name → status flips to `authenticated` → `syncSocketWithSession('authenticated')` calls `.connect()` again, racing the in-flight reconnect machinery → uncaught `TypeError: Cannot read properties of undefined (reading 'request')` inside socket.io-client.

**Root cause.** A **client/server contract mismatch**. The server's `io.use()` rejects BOTH unauthenticated AND `needsDisplayName` socket upgrades (`io.ts:17` + `io.ts:132`). But BUG-006's fix wired `syncSocketWithSession` to connect during `needsDisplayName`, with an inline comment asserting *"`needsDisplayName` still holds a valid session cookie that `io.use()` accepts"* — which is factually wrong. So the client opened a socket the server was always going to reject, then thrashed.

**Fix.** `apps/web/src/sync/socket.ts::syncSocketWithSession` now connects ONLY when `status === 'authenticated'`. `needsDisplayName` is treated like `loading`/`anonymous` (tear down; do not connect). The socket connects the instant onboarding completes and the status flips to `authenticated`. This aligns the client with the server's `io.use()` contract and corrects the wrong comment BUG-006 introduced.

**Tests.** `apps/web/src/sync/socket.test.ts` — flipped the `needsDisplayName` case from "builds + connects" to "does NOT build a socket" (encoding the correct contract). Suite stays at 14 tests, all passing.

**How it was found.** The R8.4.d `party-lifecycle` E2E spec (create party → join → leave → rejoin → kick, driven through the real SPA). This is the exact BUG-001/BUG-002 profile TECH_STACK §3.3 cited for why E2E matters: a defect invisible to unit + server-integration tests, only reproduced by driving the full stack fast. The E2E spec is now the regression fence.

**Fix commit.** [pending — same commit as this entry].

---

### BUG-013 — Adding a no-cost catalog row to a shop with no price override silently succeeds, then throws at buy time

- **Filed:** 2026-07-07
- **Fixed:** 2026-07-07
- **Severity:** high (broken buy flow with no workaround for players — the mutation throws in the reducer with a technical error message; also affects nearly every DMG magic item, which is exactly what a DM most often wants to sell).
- **Status:** fixed
- **Affected slice:** R6.2 amendment — the R6.2 shop/pricing surface accepted stock rows whose catalog def has no `cost`, deferring the failure to `purchase`.

**Symptom.** DM adds "Cloak of the Bat" (or any other DMG magic item) to a shop's stock with the "Price override (cp)" field left blank. The Add succeeds silently and the row appears in the stock table with price shown as `—`. Later, when a player clicks Buy on that row, the reducer throws `"purchase: catalog row dmg-2024:cloak-of-the-bat has no cost"` and surfaces it via the standard error toast. Player has no way to complete the buy.

**Reproduction.**

1. Solo party or DM in a multi-member party.
2. Open shop → Add stock → Pick item → search "cloak of the bat" → Pick → leave "Price override (cp)" blank → Add.
3. Observe the row lands with `—` for price.
4. Player (or the DM in solo) clicks Buy 1.
5. Toast: `purchase: catalog row dmg-2024:cloak-of-the-bat has no cost`.

**Root cause.** Two-layer gap:

- `ItemDefinition.cost` is optional in the seed schema (`packages/shared/src/schemas/itemDefinition.ts`). The DMG 2024 seed omits `cost` on 272/305 rows: all 202 magic items, all 19 armor, all 21 weapons, 5 ammunition, 4 containers, 2 gear, and 19/41 consumables. This is canonical — the 2024 DMG doesn't publish market prices for magic items; pricing is DM discretion. PHB mundane items (181/181) all have cost.
- `edit-shop-stock/add` in `packages/rules/src/reducer/index.ts` didn't validate that either `def.cost` exists or a `priceOverride` is provided. The row was accepted, and `resolvePurchaseUnitCostCp` (`reducer/index.ts:2617-2640`) — the buy-time price resolver — threw on the null intersection.
- `ShopDetail.tsx` compounded the problem: the price cell rendered `—` for no-cost rows but the Buy button stayed enabled, so the player saw a clickable Buy that always failed.

**Fix.** Defense in depth across three layers:

1. **Reducer guard** (`packages/rules/src/reducer/index.ts`): `edit-shop-stock/add` rejects when the catalog def has no `cost` and no `priceOverride` is provided. Also adds the previously-missing "unknown itemDefinitionId" guard. `edit-shop-stock/update` rejects an explicit `priceOverride: null` on a no-cost def (qty-only updates on pre-existing broken rows are still allowed as a DM escape hatch).
2. **UI hint** (`apps/web/src/screens/ShopDetail.tsx`): new `defaultCostCp(def)` helper mirrors `unitCostCp` for a picked def with no stock entry. Below the "Price override (cp)" input the form now shows either `Default: <price> — leave blank to use.` (item with cost) or a red `No default price. Set an override to sell this item.` (no cost). The Add handler short-circuits with the same reducer message before dispatching to save the round-trip.
3. **Buy disable** (`apps/web/src/screens/ShopDetail.tsx`): Buy button is `disabled` when `unitCostCp(entry) === null` and carries `title="No price set for this item"`. Covers pre-fix rows still in the shop from before the guard shipped — the DM's escape hatch is to edit those rows to set a `priceOverride`.

3 new reducer tests cover: add rejection, add with override succeeds, update rejection on null override. 4 new ShopDetail tests cover: default-price hint, no-default hint, blocked Add, allowed Add with override, disabled Buy.

**Related.**

- Original R6.2 slice — commits `6144b8f` (shops + purchase/sale), `d92ff59` (add-stock picker).
- `pricing.buyPrice` + `currency.toCopper` composition — the same code path is used to compute the displayed default and to compute the actual purchase price at dispatch.
- The `sale` action already correctly throws on missing cost (`packages/rules/src/reducer/index.ts:2767-2875`), but the player-side Sell UI gates on `sellableItems` having a cost (`ShopDetail.tsx:77-98`), so no equivalent bug exists on the sell side.

**Not fixed / intentional.** Existing shop rows created before this fix that have no cost and no override are left as-is on disk. They render `—` with a disabled Buy; the DM can edit them to add an override. No migration or auto-cleanup runs (per user decision — risks losing intentional half-configured setups).

---

### BUG-012 — Homebrew form has no rarity select; homebrew magic items can't be attuned

- **Filed:** 2026-07-06
- **Fixed:** 2026-07-06
- **Severity:** high (multi-user product gap — DMs can't create attunable magic items via the UI at all).
- **Status:** fixed
- **Affected slice:** R2.1 amendment — the magic-item metadata fields (`rarity`, `requiresAttunement`, `attunementPrereq`) shipped on `itemDefinitionSchema` but the homebrew form was never widened to collect them.

**Symptom.** In `/catalog` → New homebrew:

1. There is no rarity select in the form (no way to mark a homebrew as `common | uncommon | rare | very-rare | legendary | artifact`).
2. Attempting to attune a homebrew magic item (Acquire → Inventory → Attune) fails with `attune: item "…" is not a magic item (requiresAttunement !== true)`.

**Reproduction.**

1. Open `/catalog` → click New homebrew.
2. Set category = Magic item. Observe: no rarity, no attunement toggle.
3. Save → row lands with `rarity: undefined`, `requiresAttunement: undefined`.
4. Acquire the row into Inventory → click Attune → reducer throws "not a magic item".

**Root cause (single defect, two symptoms).** `apps/web/src/components/catalog/HomebrewForm.tsx` never surfaces the three magic-item fields. All three exist on `itemDefinitionSchema` since R2.1, but every layer of the homebrew create/edit path was written before the magic-item slice added them:

- `homebrewDefinitionInputSchema` / `homebrewDefinitionPatchSchema` — omit the fields.
- `HomebrewDefinitionInput` / `HomebrewDefinitionPatch` — omit the fields.
- `HOMEBREW_EDITABLE_FIELDS` — omits the fields, so the edit diff loop wouldn't propagate them even if the input did.
- `createHomebrew` spread — omits the fields.
- `persistCreateHomebrew` / `persistEditHomebrew` — omit the fields.

The reducer's `attune` action is correct: it rejects rows whose `def.requiresAttunement !== true`. Since homebrew rows land with `undefined`, they can't be attuned. Fixing the form alone would fix nothing; the payload contract has to widen end-to-end.

**Fix.** Widen the payload contract end-to-end, gate the new form fields behind `category === 'magic'`, require rarity when the gate is open (user-approved 2026-07-06):

- Rarity + requiresAttunement + attunementPrereq surface only when `category === 'magic'` in the form (gated via `useWatch` on `category`); rarity is REQUIRED for magic items via cross-field `.superRefine` on the form schema; nested prereq input surfaces only when `requiresAttunement === true`.
- Wire the three fields through Zod (`packages/shared/src/schemas/action.ts`) → reducer types (`packages/rules/src/reducer/types.ts`) → reducer body (`packages/rules/src/reducer/index.ts`: `HOMEBREW_EDITABLE_FIELDS` + `createHomebrew` spread) → server persistor (`apps/server/src/sync/persistor.ts`). The existing generic `editHomebrew` diff loop picks up the new fields for free once the constant widens.
- Persistor uses the existing `toDbRarity` helper for the hyphen↔underscore Prisma enum swap (`apps/server/src/db/mappers.ts:78`).
- **No Prisma migration** — the DB columns landed with R2.1 (`apps/server/prisma/schema.prisma:300-302`).

7 new tests in `HomebrewForm.test.tsx` cover: fields hidden by default, magic reveals them, prereq nested behind checkbox, magic-without-rarity rejected, full-payload round-trip, requiresAttunement-off omits prereq, non-magic omits all three, edit-mode uncheck clears the flag. `action.test.ts` fixture extended.

**Related.**

- OUTLINE §3.8 (magic items) + §4 line 289-291 (rarity + attunement fields).
- `apps/web/src/components/settings/EncumbranceRuleField.tsx` — the checkbox + label pattern reused for the `requiresAttunement` control.
- `packages/rules/src/reducer/index.ts` `attuneOrUnattune` — the reducer arm that rejects `def.requiresAttunement !== true`.

---

### BUG-011 — Encumbrance is per-character but is a party-wide house rule; DM's setting doesn't propagate

- **Filed:** 2026-07-06
- **Fixed:** 2026-07-06 (commit `e55a4e2`)
- **Severity:** high (broken UX in multi-member parties — the DM cannot enforce a party-wide encumbrance rule; each player sees their own default).
- **Status:** fixed
- **Affected slice:** R1.1 amendment — inverts the "per-character encumbrance rule" design decision documented in `docs/OUTLINE.md §3.3` and `docs/roadmap.md` R1.1 Notes.

**Symptom.** In a 2+-member party the DM opens the global `/settings` screen and flips Encumbrance from "off" to "PHB" (+ enforce). Only the DM's own CapacityBar reflects the change; every other player's CapacityBar keeps their own (default `off`) rule and their acquires/transfers are never rejected.

**Reproduction.**
1. Server mode, 2+-member party with a dedicated DM and at least one non-DM player.
2. Sign in as DM. Open `/settings`. Flip Encumbrance to "PHB" + Enforce.
3. Sign in as a non-DM player (or observe via a second browser). Go to their Inventory tab.
4. Observe: their CapacityBar still shows "off" (bar hidden) and they can still acquire items past `STR × 15 lb` without rejection.

**Root cause.** `encumbranceRule` and `enforceEncumbrance` lived on `Character` in the Zod schema, Prisma schema, and reducer. `apps/web/src/screens/Settings.tsx` picked `getOwnCharacter(appState)` and edited ONLY that character's row. The `set-encumbrance` action was per-character (`payload.characterId`); dispatching it once flipped exactly one character. The CapacityBar read `character.encumbranceRule` per-character.

Two problems compounded:
1. Wrong UI scope — the field rendered on the global (account-scoped) `/settings` screen, but the underlying data was per-character-in-a-party.
2. Wrong data scope — a party-wide house rule ("in this campaign we enforce carrying capacity") had no natural home; forcing it to per-character meant each player's rule could drift.

**Fix.** Moved both fields from `Character` onto `Party`. Reworked `set-encumbrance` to be party-scoped (`payload.partyId`). DM-only edit permission preserved (already the case in `packages/shared/src/guards/map.ts:setEncumbranceGuard`). Moved the UI from `/settings` into `/party/settings`; non-DMs see a read-only summary. `CapacityBar` now reads the rule + enforce flag from `s.appState.party` while continuing to read STR + size from the per-character row.

Docs (source of truth) updated in the same slice: `docs/OUTLINE.md §3.3, §3.6, §4`, `docs/MVP.md`, `docs/USER_FLOWS.md`, `docs/roadmap.md` R1.1 Notes, `CLAUDE.md` "Data model rules". New Prisma migration `20260706120000_bug011_encumbrance_to_party` adds columns to `Party`, drops from `Character`.

**No legacy-data debt.** Old Dexie blobs + old Postgres rows fail the new Zod parse — RH5.2 corruption-recovery handles the local case; a fresh migration handles the server. Consistent with CLAUDE.md.

**Related.**
- `docs/OUTLINE.md §3.3 + §3.6` — encumbrance display + enforcement invariants (updated).
- `docs/roadmap.md` R1.1 Notes — updated with amendment.
- `packages/shared/src/schemas/party.ts` — new fields.
- `packages/rules/src/reducer/index.ts:setEncumbrance` + `checkHardMode` — re-pointed at `s.party`.

---

### BUG-010 — History screen shows the current user's `displayName` but other players' `character.name`

- **Filed:** 2026-07-04
- **Fixed:** 2026-07-04
- **Severity:** low (cosmetic inconsistency; no data corruption).
- **Status:** fixed
- **Affected slice:** R5.3.a — `apps/web/src/lib/resolveActorLabel.ts`.

**Symptom.** On the Party History screen the current user's rows render with their **login display name** (`Alice`) while other players' rows render with their **character name** (`Baelor the Wise`). Two identity systems on the same table.

**Root cause.** `resolveActorLabel` was written to prefer `state.user.displayName` for the current user and fall back to the character name for other party members — inconsistent. The character name is the identity that's known for EVERY party member (via `state.characters[].ownerUserId`), so a character-first order gives a uniform label.

**Fix.** Flipped the resolution order in `resolveActorLabel`:

1. Character name (uniform for every party member with a character).
2. `state.user.displayName` (only when the current user has no character yet — fresh party join / DM-only bootstrap).
3. Short-uuid prefix (unknown-actor fallback for banker-authored entries with no character bound, other-user actors with no character, etc.).

Tests in `apps/web/src/lib/resolveActorLabel.test.ts` were updated to assert the new order.

---

### BUG-009 — History screen duplicates entries when a filter is toggled

- **Filed:** 2026-07-04
- **Fixed:** 2026-07-04
- **Severity:** high (visible bad state; users see the same row twice; feels like data corruption).
- **Status:** fixed
- **Affected slice:** R5.3.a — `apps/web/src/store/index.ts::appendServerLogEntries`.

**Symptom.** In server mode, on the Party History screen, toggling any action-type checkbox on and off causes duplicate rows to appear for entries that were dispatched during the session. The duplicates disappear on a hard refresh (they never persisted to Dexie in a bad shape — the underlying `state.log` in memory carried duplicates).

**Root cause.** Two writers push into `state.log` via `appendServerLogEntries`:

1. `sync/queue.ts:214` — after a successful `POST /sync/actions`, appends the server's `applied[]` echo.
2. `sync/applyBroadcast.ts:112` — after a WebSocket `applied` broadcast, appends the server's echoed entries (already deduped locally before the append).

The WebSocket broadcast almost always beats the HTTP response (a single WS push vs one round-trip). When it does, the broadcast handler's dedupe against `store.log` sees no match and appends. Then the HTTP response returns and `queue.ts` blindly appends the SAME entries a second time. Two copies of every entry in `state.log`. The React memoized filter pipeline correctly re-filters both, so the user sees the row twice.

The reason "toggle a filter" was the reliable trigger: `applyFilters` is a `useMemo` — it only re-runs when its deps change. Simply having duplicates in `state.log` isn't enough for the visible symptom to show up until a filter change forces a re-derive. Once it did, both duplicates satisfied the same predicates and both rendered.

**Fix.** Deduped at the funnel — `appendServerLogEntries` is now idempotent by `entry.id`:

```ts
appendServerLogEntries: (applied) => {
  if (applied.length === 0) return;
  set((draft) => {
    const seen = new Set(draft.log.map((e) => e.id));
    for (const entry of applied) {
      if (seen.has(entry.id)) continue;
      draft.log.push(entry);
      seen.add(entry.id);
    }
  });
},
```

Single-writer path stays fully-additive; both writers converge to the same log. `apps/web/src/store/log-authority.test.ts` gains a `BUG-009 — appendServerLogEntries is idempotent by entry.id` case asserting: single push adds one row; double push of the same id adds zero more rows; mixed batch of (already-seen + novel) adds only the novel one.

**Bonus hygiene** — `HistoryScreen.applyFilters` was calling `.sort()` on the filtered array. `.filter()` returns a new array so the mutation is self-contained, but the mutated result then becomes the `useMemo` return value — a subtle rendering-bug hazard if any downstream memo capture happens. Swapped to `[...filtered].sort(...)` so the sort operates on a fresh copy.

---

### BUG-008 — Equipped/attuned items stack; split copies flags; server desyncs

- **Filed:** 2026-07-04
- **Fixed:** 2026-07-04 (branch: `feat/r5-live-sync-history`)
- **Severity:** high (three related client-server divergences; each yields user-visible bad state and a 500 on some follow-up dispatches. Symptom class: "the UI shows one thing, the server sees another, and the next action fails.")
- **Status:** fixed
- **Affected slice:** cross-cutting — reducer `acquire` / `split` / `equip` / `attune` arms; server persistor `equip` / `attune` arms; client dispatch site for equip/attune buttons; shared action schemas for `equip` + `attune`. Design pre-dated R2.1 (`attune`) and R1.2 (`equip`); surfaced together during R5.1 manual testing when live server-authoritative sync amplified the divergence.

**Symptoms.** All observed 2026-07-04 during server-mode testing:

1. **Acquire onto an equipped row stacks quantity.** With a single Longsword equipped, clicking `+` (a fresh `acquire { quantity: 1 }` against the auto-stack key `(definitionId, notes ?? "")`) rolls the new copy into the existing equipped row, yielding "quantity 2, equipped: true" — nonsense per OUTLINE §3.4 ("you can't equip two of a kind").
2. **Split copies `equipped` / `attuned` from source; server clears them.** Splitting an equipped stack surfaces the new row with `equipped: true` in the client optimistic state, but the server-side `persistSplit` (`apps/server/src/sync/persistor.ts`) hard-codes `equipped: false, attuned: false` on the new row. Clicking "Unequip" on the split-off row then fires a 500: the server sees a row that's already `equipped: false` and the reducer no-op guard rejects.
3. **Equip on a stack keeps the stack.** With 3 Longswords in Inventory, clicking Equip flips `equipped: true` on the whole stack (`quantity: 3, equipped: true`) — same "you can't equip two of a kind" violation.

**Root cause.** Three defects in the same invariant family:

- `packages/rules/src/reducer/index.ts::acquire` — auto-stack predicate at line ~721 matched only on `(ownerId, definitionId, notes)`, ignoring the `equipped` / `attuned` flags on the candidate row.
- `packages/rules/src/reducer/index.ts::split` — new-row builder at line ~1759 spread `{ ...source, id, quantity }`, carrying `equipped` / `attuned` from the source. Server-side `persistSplit` correctly hard-codes both to `false`, but the client optimistic state disagreed.
- `packages/rules/src/reducer/index.ts::equipOrUnequip` — flag flip at line ~2314 mutated the source row in place regardless of `quantity`. No auto-split path existed; the reducer accepted `equip` on a stacked row without complaint. Same defect on `attune` (`attuneOrUnattune`, line ~2411).

**Fix.** All three surfaces, in one slice, enforcing the invariant "an equipped or attuned row always has quantity=1":

1. **`acquire`** — extended the auto-stack predicate to require `existing.equipped === false && existing.attuned === false`. Fresh acquires onto an equipped/attuned row now land as a new row (quantity 1), preserving the invariant.
2. **`split`** — new-row builder now always sets `equipped: false, attuned: false`, aligning with the server persistor.
3. **`equip` / `attune` auto-split.** When the source row has `quantity > 1`, the reducer auto-splits off a fresh `quantity: 1` row (using a new optional `newItemInstanceId` on the action payload) and flips the flag on the NEW row. The old row keeps its remaining quantity and stays unequipped/unattuned. The log emits `split` + `equip` (or `attune`) as two entries; dispatch site (`apps/web/src/components/stash/StashItemsTable.tsx`) routes through `dispatchMintingAction` so the UUID is minted unconditionally. Server persistors (`persistEquip` / `persistAttune`) mirror the same split-then-flip logic.

**Wire schema change (backwards-compat additive).** `equipAction` and `attuneAction` gain an optional `newItemInstanceId` field. Existing clients not passing it work fine for the `quantity: 1` case; the reducer only requires the field when the auto-split path is entered.

**Tests.** `packages/rules/src/reducer/bug-008.test.ts` — 9 new reducer tests covering all three defect vectors + happy paths + the required-field guard. Rules suite 144 → 153. Full test-suite growth 1449 → 1458.

**Not addressed:** existing DB rows written under the pre-fix regime may have `equipped: true, quantity > 1` or `attuned: true, quantity > 1`. No back-fill migration ships with this slice — the schema-level CHECK is deferred. Users hitting this in dev data can either: (a) `pnpm --filter @app/server db:reset` for a clean slate, or (b) manually adjust the row via `pnpm --filter @app/server db:studio`. If the corruption is seen in real (non-dev) data later, add a follow-up migration.

**Fix commit.** [pending — same commit as this entry].

---

### BUG-007 — Server-mode self-echo double-applies dispatched actions (quantity doubles, consume removes, split rejected)

- **Filed:** 2026-07-04
- **Fixed:** 2026-07-04 (branch: `feat/r5-live-sync-history`; R5.1 followup — sits alongside BUG-006)
- **Severity:** high (user-visible data desync — every dispatched action in server mode has its state mutation applied TWICE on the acting client. Not just cosmetic: subsequent actions read the wrong optimistic state and either fail server-side validation or produce further wrong writes. Server-authoritative state stays correct, so `pullState` restores sanity — but a fresh visit / manual refresh is the only workaround.)
- **Status:** fixed
- **Affected slice:** R5.1.b (broadcast reconciliation). Present since 2026-07-03 when RH2.6's log-authority split retired client-side log-entry emission in server mode; the pre-existing dedupe was designed around client-emitted log ids as its self-echo sentinel and stopped working the moment client-emit stopped.

**Symptoms.** All three observed by the user 2026-07-04 in server mode after starting fresh:

1. **Acquire shows quantity 2 in the UI when 1 was selected.** Optimistic dispatch adds quantity 1 → server broadcasts back → `applyBroadcast` re-runs the reducer against the already-mutated state → quantity becomes 2.
2. **Pressing "-" on the item removes it from the inventory.** Same defect on `consume`: dispatch drops quantity by 1 (2 → 1 in the doubled state) → broadcast re-runs → 1 → 0 → row removed.
3. **Split rejected as "qty 1 must be less than source quantity 1".** UI thinks source is 2 (doubled), submits `split qty: 1`, server sees the actual quantity 1 and rejects with the reducer's split invariant.

All three are the same defect from three angles.

**Root cause.** `apps/web/src/sync/applyBroadcast.ts` (pre-fix) filtered `applied[]` by log-entry id against `store.log`:

```
const seenIds = new Set(store.log.map((e) => e.id));
const novel = applied.filter((e) => !seenIds.has(e.id));
```

This design assumed the acting client had ALREADY appended the entry (with the server-canonical id) via its HTTP-response path before the broadcast arrived. In the pre-RH2.6 world the client emitted its OWN log entries (with client-minted ids that didn't match the server's) and the dedupe was actually a fingerprint-match. Post-RH2.6 (2026-07-03) the client stopped emitting log entries in server mode entirely — `appendServerLogEntries` only runs from the HTTP-response path. Two consequences:

1. In the pre-RH2.6 world, the log entry was already in `store.log` before the broadcast handler ran (client-emit was synchronous during dispatch), so the dedupe blocked the reducer re-run.
2. Post-RH2.6, `state.log` is empty until the HTTP-response path resolves. The socket broadcast reliably beats the HTTP round-trip (one push vs one round-trip), so `seenIds` never contains the incoming entry and the reducer re-run always fires.

The reducer re-run applies the action to the ALREADY-mutated state, doubling every mutation.

**Fix.** In `applyBroadcast`, detect self-echo by `actorUserId`. When every novel entry's `actorUserId` matches the store's current `state.appState.user.id`, this broadcast is the server confirming an action THIS client just dispatched. Skip the reducer re-run (state already optimistically applied); still append the log entries via `appendServerLogEntries` so RH2.6 log-authority is preserved.

```ts
const selfUserId = store.appState?.user.id ?? null;
const isSelfEcho =
  selfUserId !== null && novel.every((e) => e.actorUserId === selfUserId);

if (!isSelfEcho) {
  const result = reduce(store.appState, reducerAction, broadcastReducerCtx);
  useStore.setState({ appState: result.state });
}

store.appendServerLogEntries(novel);
```

Peer broadcasts (different `actorUserId`) still re-run the reducer as before — those are events the local reducer hasn't seen yet.

**Multi-tab edge case (not fixed here).** If the same user has two tabs open, tab B sees a broadcast from tab A's dispatch with a matching `actorUserId` and short-circuits — but tab B never optimistically ran the reducer. Tab B will miss the mutation until it re-hydrates on next `pullState` (route change / reconnect). Trade-off: acceptable for the common single-tab case; multi-tab drift is a known R5.x constraint. A future fix could tag dispatches with a client-nonce broadcast back verbatim so tab B distinguishes tab A's dispatch from its own; deferred until multi-tab shows up as a real user need.

**Tests.** `apps/web/src/sync/socket.test.ts` gains 4 new tests (14 total, was 10):
- Self-echo does not double-apply an acquire (quantity stays 1).
- Self-echo still appends the server log entry (RH2.6 log-authority preserved).
- Peer broadcast (different `actorUserId`) still re-runs the reducer.
- End-to-end reproduction: dispatch → self-echo → final state matches server.

Two existing tests updated: the pre-BUG-007 "peer broadcast" tests used `base.userId` as `actorUserId` (accidentally exercising self-echo path); both now use a distinct `peerUserId` to correctly exercise the reducer-re-run branch.

**Fix commit.** [pending — same commit as this entry].

---

### BUG-006 — Socket.IO connects on the login screen before the user is authenticated; two red console errors greet every fresh visitor

- **Filed:** 2026-07-04
- **Fixed:** 2026-07-04 (branch: `feat/r5-live-sync-history`; R5.1 followup)
- **Severity:** low (cosmetic — the server correctly rejects the unauthenticated upgrade per SECURITY §6; no data leak, no broken functionality. But two red-flagged console errors on every fresh /login visit is noise that trains users to ignore the console, and it wastes one round-trip per boot before the socket gives up.)
- **Status:** fixed
- **Affected slice:** R5.1.b (client socket consumer). Present since 2026-07-03 when the boot-time `connectSocket()` landed.

**Symptom.** Server mode, first visit to the app (no session cookie). Two red errors appear in the browser console before the user has done anything:

```
WebSocket connection to 'ws://localhost:8080/socket.io/?EIO=4&transport=websocket&sid=...' failed: WebSocket is closed before the connection is established.
[socket] connect_error: unauthenticated
```

Once the user signs in, the socket connects cleanly (any subsequent broadcasts work). But the initial-visit console pollution is confusing — a new user might think something is broken.

**Root cause.** `apps/web/src/main.tsx:84-87` unconditionally called `connectSocket()` + `socket.connect()` at boot in server mode, regardless of session status. The server's Socket.IO middleware (`apps/server/src/realtime/io.ts::io.use()`) reads the session cookie via `getSession()`; when the user has none, it invokes `next(new Error('unauthenticated'))`, which surfaces client-side as a `connect_error`. The underlying WS handshake also gets torn down mid-upgrade, producing the raw browser-level "closed before connection established" warning.

**Fix.** Auth-gate the connect. `apps/web/src/sync/socket.ts` gains `syncSocketWithSession(status)` — a small state-machine helper:

- `'authenticated'` / `'needsDisplayName'` → build (once) + connect. `needsDisplayName` still holds a valid session cookie that `io.use()` accepts.
- Any other status (`'loading'`, `'anonymous'`) → `resetSocket()` (tear down the module singleton so the next auth transition rebuilds cleanly).

> **⚠️ Correction (2026-07-09, BUG-014).** The claim above — that `io.use()` ACCEPTS a `needsDisplayName` cookie — is **wrong**. The server rejects it (`io.ts:132`). Connecting during `needsDisplayName` caused a reconnect loop + uncaught TypeError. See BUG-014: the fix removes `needsDisplayName` from the connect path.

`main.tsx` boots by calling `syncSocketWithSession(useSession.getState().status)` once and subscribing to `useSession` for transition-triggered re-syncs. On sign-in the session flips `anonymous` → `authenticated` and the helper connects; on sign-out it flips back and the helper tears down.

**Tests.** `apps/web/src/sync/socket.test.ts` gains 6 new tests: anonymous / loading → no build; authenticated / needsDisplayName → build + connect; authenticated → anonymous → tear-down; idempotent re-authenticate.

**Fix commit.** [pending — same commit as this entry].

---

### BUG-004 — Server persistor mints a different UUID than the reducer for new item rows; Item Detail history is empty right after `acquire` / `split`

- **Filed:** 2026-07-01
- **Fixed:** 2026-07-03 (branch: `refactor/rh2-determinism-invariants`; RH1 + RH2.6)
- **Severity:** medium (item history is a display feature — the log entries exist and are correct, just not linkable to the freshly-created row until a subsequent mutation. No data corruption. Later actions on the same row still resolve because they read the DB id from post-refresh state.)
- **Status:** fixed
- **Affected slice:** cross-cutting — surfaced during R4.3 manual testing. Underlying defect predated R3.5 (server-authoritative sync).

**Symptom.** Server mode. User acquires a mundane item from the Catalog Browser (or an equivalent flow that dispatches `acquire` with `source: 'catalog-add'`). The item appears in the target stash as expected. User navigates to `/item/:id` for the newly-created row. The History section renders "No log entries for this item yet." Later, when the user transfers or otherwise mutates the same row, the transfer entry surfaces normally on the Item Detail history.

**Reproduction.**
1. Server mode, any party (solo works fine — solo-bypass has no effect on this defect).
2. From the Catalog Browser (or any UI dispatching `acquire`), add an item to a stash.
3. Navigate to that item's Detail page.
4. History section is empty.
5. Move the item to another stash (dispatch `transfer`).
6. History now shows the `transfer` entry — but the earlier `acquire` is still missing.

**Root cause analysis.**

The `POST /sync/actions` handler in `apps/server/src/sync/routes.ts:296-338` ran the reducer and the persistor sequentially against the same `ReducerContext`:

```
for (let i = 0; i < actions.length; i++) {
  const reduced = reduce(state, action, ctx);   // step 1
  await applyDelta(tx, action, actor, ctx);     // step 2
  for (const slice of reduced.logEntries) {
    const entry = buildLogEntryServer(slice, actor, ctx);
    await appendTransactionLog(tx, entry);
  }
}
```

Both the reducer (`packages/rules/src/reducer/index.ts::acquire`) and the persistor (`apps/server/src/sync/persistor.ts::persistAcquire`) called `ctx.newId()` when a new row was minted:

- Reducer, line ~675: `resolvedItemId = ctx.newId()`. The log slice's `payload.itemInstanceId` = `resolvedItemId` (UUID_A).
- Persistor, line ~262-264: `tx.itemInstance.create({ data: { id: ctx.newId(), ... } })` (UUID_B).

Two calls to `ctx.newId()` → two different UUIDs. The `TransactionLog` row referenced UUID_A; the `ItemInstance` row used UUID_B. When the client re-pulled state via `/sync/state`, it got:
- `items: [{id: UUID_B, ...}]`
- `log: [{type: 'acquire', payload: {itemInstanceId: UUID_A, ...}}]`

The Item Detail page routed to `/item/UUID_B`. `ItemHistory` filtered `log.filter(e => e.payload.itemInstanceId === UUID_B)` → **0 matches**. History rendered empty.

Later, when the user transferred the item, the transfer flow read UUID_B from local state (the post-refresh state carried the DB's id) and passed it as the action's `payload.itemInstanceId`. The reducer's `transfer` arm didn't mint any new item id (it re-used `payload.itemInstanceId` verbatim in the log slice), so the transfer log entry correctly referenced UUID_B. Same for the persistor. Hence transfer entries surfaced correctly.

**Affected action types (pre-fix).** Any persistor that minted a new entity id via `ctx.newId()` after the reducer already did the same:
- `acquire` — new-row branch (auto-stack branch was unaffected because it updated an existing row).
- `split` — always minted a new item row (partial-split target).
- Potentially `create-stash`, `create-homebrew` — same shape.

**Why R4.3 didn't surface this earlier.** R4.3.c widened `ownsOrShares` for DM cross-character acquire/consume/transfer. The R4.3.c integration tests were guard tests only. The BUG-004 code path (server persistor minting IDs post-reduce) had been latent since R3.5 — this was the first time someone manually inspected an Item Detail history right after an acquire and noticed the mismatch.

**Fix (2026-07-03 — RH1 + RH2.6):**

The bug had two independent axes; both needed to close.

**Axis 1 — Entity ID divergence (RH1, shipped earlier).** The client now mints every entity id (as UUID v7) client-side and sends them in the action payload via `new<EntityName>Id` fields. The server's persistor consumes these ids verbatim (`newItemInstanceId`, `newStashId`, etc.) instead of calling `ctx.newId()`. The `ItemInstance` id and the `TransactionLog.payload.itemInstanceId` are now the same value by construction — they come from the same client-minted `newItemInstanceId`.

**Axis 2 — TransactionLog authority split (RH2.6, this slice).** The client-side reducer's `logEntries` output is now discarded at the store boundary in server mode; `state.log` grows only from `POST /sync/actions`'s `applied[]` response. The server-emitted log entry has server-canonical `id`, `timestamp`, and `actorRole` — and its payload's entity ids come from the action payload the client already minted (axis 1). No divergence axis exists anymore.

Together, the fix is structural: in server mode, entity ids come from the client, `TransactionLog` contents come from the server, and the two agree on entity ids by construction. `ItemHistory` filtering by `payload.itemInstanceId === UUID_X` now works because both `ItemInstance.id` and `TransactionLog.payload.itemInstanceId` are UUID_X.

**Verification.** `apps/web/src/store/log-authority.test.ts` test 3 exercises the full server-mode round trip: dispatch `acquire`, flush the queue, assert the `applied[]` entry echoed back into `state.log` carries the client-minted `itemInstanceId` intact and a server-canonical `id`. Mutation-checked by dropping the `appendServerLogEntries` call — test correctly fails with an empty `state.log`. See `docs/roadmap.md` § RH2.6 for full context.

**Lessons.**
- Dual-authority ID minting is a compound defect: BUG-002 was one manifestation (upsert vs create), BUG-004 another (id divergence in a same-transaction handoff). The single structural fix is retiring the client's id-minting authority in server mode — accomplished via RH1 (client mints upstream, server validates) + RH2.6 (server owns log emission).
- Item Detail's per-item history is a canary for id-consistency defects. When id divergence appears, this is the display that goes empty first — the party-wide log doesn't care about id linkage, only the per-item filter does.
- Half-measures accumulate cost. RH2.1b's placeholder-then-patch approach (client emits with `PENDING` timestamp, queue patches post-flush) fixed one field at a time. RH2.6's authority split removes the client-side emission entirely — the drift risk was structural, not per-field.

---

### BUG-003 — Sync-queue rollback restored post-mutation state, not pre-mutation state

- **Filed:** 2026-07-01
- **Fixed:** 2026-07-01 (feature/r4-parties)
- **Severity:** high (in server mode with any R4.2.c/d-style guard rejection, the UI diverged from server truth after a rejected action; no client-side workaround)
- **Status:** fixed
- **Affected slice:** cross-cutting — surfaced by R4.2.c (`banker_required_for_claim` on Party Stash / Recovered Loot moves), but the defect predated it: the snapshot-capture ordering had been wrong since R3.5 shipped the sync queue.

**Symptom.** In server mode, a non-Banker player attempted to move an item out of the Party Stash. The item visibly moved to their Inventory. The server correctly rejected the batch with `422 { rejected: { code: 'banker_required_for_claim' } }` and the "Action rejected" toast appeared. But the item stayed in the player's Inventory — no visual rollback. Reproduced every time (user report, 2026-07-01).

**Reproduction.**

1. Server mode, two-member party, Banker appointed on user B.
2. User A (non-Banker) opens Party Stash and moves an item to their Inventory.
3. Client reducer applies optimistically → item shows in Inventory locally.
4. Sync queue POSTs `/sync/actions` after 200 ms debounce.
5. Server's `checkGuard` rejects with `banker_required_for_claim` (per R4.2.c).
6. Client receives 422, `BatchRejectedError` fires, toast shows.
7. Queue's `restoreSnapshot(preBatchSnapshot)` runs — but the snapshot it held was the POST-mutation state, so restoring it was a no-op.

**Root cause.**

`apps/web/src/store/index.ts:dispatch` sequence pre-fix:

```
dispatch(action):
  1. reduce(prev.appState, action) → next state
  2. set(draft => { draft.appState = next.state; draft.log.push(...) })   // ← MUTATION LANDED HERE
  3. saver.save(current)                                                   // schedule Dexie write
  4. if (serverMode) enqueue(action)                                       // ← queue captured snapshot HERE
```

`apps/web/src/sync/queue.ts:enqueue` pre-fix:

```ts
if (queue.length === 0) {
  preBatchSnapshot = deps.getSnapshot();  // called AFTER step 2 already mutated
}
```

`getSnapshot()` read from `useStore.getState()`, which was already mutated by `set()` in step 2. The snapshot the queue held for rollback IS the mutated state; on 422 the queue called `restoreSnapshot(snapshot)` and the store was set to itself — no visible change.

This defect was latent since R3.5 (sync queue landed) because until R4.2.c, no guard rejection was reachable by an action the client-side reducer would apply optimistically. All prior 422 causes (structural invariants like negative currency, missing entities) also throw in the client-side `reduce()` and short-circuit dispatch before the queue is called. R4.2.c introduced the first pure-permission rejection (`banker_required_for_claim`) that the client-side reducer permits but the server refuses — which surfaced the bug.

**Postmortem (fixed 2026-07-01).** Three-touch fix:

1. **`apps/web/src/sync/queue.ts`** — added `captureRollbackSnapshot()` export. Callers invoke it BEFORE mutating the store; the queue stores the resulting snapshot for later 422-rollback. Idempotent (subsequent calls within the same debounce window are no-ops). The `enqueue()` path keeps a fallback capture for callers that forget, so pre-existing tests that don't call the helper aren't broken.
2. **`apps/web/src/store/index.ts:dispatch`** — first statement (server mode only) calls `captureRollbackSnapshot()`. Runs BEFORE `reduce()` and the `set()` that applies the mutation.
3. **`apps/web/src/sync/queue.test.ts`** — new RED test that captured the pre-mutation snapshot, mutated the "store" (via a mutable fake), then enqueued the action. On 422 response the test asserted the queue restored the PRE snapshot, not the mutated one.

**Decisions captured:**

- **Named helper over augmented `enqueue` signature.** Considered `enqueue(action, preSnapshot?)` but rejected it — the queue's ownership of the debounce window is a queue-internal concern; forcing callers to thread the snapshot through the enqueue signature leaks that responsibility upward. `captureRollbackSnapshot()` is a separate step in the dispatcher's contract, which reads more naturally.
- **Fallback path preserved.** `enqueue()` still captures a snapshot when `preBatchSnapshot === null` at first-in-batch time. This preserves the old behaviour for tests + any caller that dispatches without the store wrapper. The fallback restores the post-mutation state — same as the old bug — but no production path uses it: the store's `dispatch` is the only real caller and it now calls `captureRollbackSnapshot()` first.

**Lessons.**

- **Optimistic UI + server-authoritative rejection = mandatory rollback contract.** The rollback path existed and was wired end-to-end; only the snapshot timing was wrong. A single R3.5-era test that simulated 422 + asserted state restoration would have caught this — `apps/web/src/sync/queue.test.ts` had zero 422 tests until now. Worth adding a 401 / 409 rollback assertion at the same time (existing tests confirm the code paths but not the state effect).
- **Cross-slice latent bugs are un-catchable by per-slice tests.** R3.5 shipped the queue's rollback machinery. R4.2.c shipped the first rejection code that reaches it. Neither slice's tests exercise BOTH ends of the pipe. Worth a checklist item for future features that introduce new rejection codes: "add an end-to-end optimistic-rollback test in the web workspace that simulates the 422 for this code and asserts state restoration."
- **Named separately.** Not `resetSnapshot` — that would confuse with `resetQueue`. Not `snapshotForRollback` — that reads as a getter. `captureRollbackSnapshot()` reads as an imperative side-effecting step, which is what it is.

### BUG-002 — `POST /parties/join` 500s with P2002 when a previously-left user tries to rejoin

- **Filed:** 2026-06-30
- **Fixed:** 2026-06-30 (feature/r4-parties)
- **Severity:** high (blocked the entire rejoin flow end-to-end whenever the user had any historical membership in the target party; no client-side workaround)
- **Status:** fixed
- **Affected slice:** R4.1.e (`POST /parties/join`) + R4.1.c/d departure cascades

**Symptom.** `POST /parties/join` returned:

```json
{
  "statusCode": 500,
  "code": "P2002",
  "error": "Internal Server Error",
  "message": "\nInvalid `prisma.partyMembership.create()` invocation:\n\n\nUnique constraint failed on the fields: (`userId`, `partyId`, `role`)"
}
```

**Reproduction.**

1. User A creates a 2+-member party (or DM invites + user B joins).
2. User B leaves via `POST /parties/:partyId/leave` (or DM kicks them via `/kick`). Their `PartyMembership` row gets `leftAt: <timestamp>` (soft-delete) — the row stays.
3. User B redeems the same invite code (or a regenerated one for the same party) via `POST /parties/join`.
4. Route's `already_member` check (filtered by `leftAt: null`) returns clean; route proceeds to `persistJoinParty`.
5. `persistJoinParty` called `tx.partyMembership.create()` with `(userId: B, partyId: P, role: 'player')` → collided with the soft-deleted row → P2002.

**Root cause analysis.**

`PartyMembership` PK is the composite `(userId, partyId, role)` (OUTLINE §4). The R4.1.c/d departure cascades use **soft delete** — `leftAt` flips to a timestamp, the row stays for audit history. Three pieces of code participate in the rejoin path; only the route's `already_member` check was `leftAt`-aware, the other two were not:

1. `apps/server/src/parties/routes.ts:74` — `already_member` check: `findFirst({ where: { userId, partyId, leftAt: null } })`. Correctly filters on `leftAt: null`. Lets the soft-deleted row pass.
2. `apps/server/src/sync/persistor.ts:1116` (`persistJoinParty`) — `tx.partyMembership.create({ data: { userId, partyId, role: 'player', ... } })`. NOT `leftAt`-aware; collided with the existing row.
3. `packages/rules/src/reducer/index.ts:3264` (`joinParty` reducer arm) — checked for `m.leftAt === null` existence and appended a new row. Same defect as #2 but in pure-state: appending a duplicate `(userId, partyId, role)` tuple instead of re-activating the existing soft-deleted row. The bug didn't surface in MVP party-of-one (only one membership exists), but it was structurally wrong and would have corrupted local-mode state for rejoin flows.

The conceptual error: "rejoin" is **a state transition on the existing row**, not a create. The model is intentionally `(userId, partyId, role)` PK + audit-preserving soft delete; a fresh create would either (a) break the PK uniqueness invariant (server case — this bug), or (b) double the row (reducer case — silent corruption).

**Postmortem (fixed 2026-06-30).** Two-touch fix:

1. **Persistor** (`apps/server/src/sync/persistor.ts:persistJoinParty`) — switched `tx.partyMembership.create(...)` to `tx.partyMembership.upsert({ where: { userId_partyId_role: ... }, create: ..., update: { leftAt: null, joinedAt: now, characterId: null } })`. Single atomic statement; matches the composite-PK + soft-delete contract.
2. **Reducer** (`packages/rules/src/reducer/index.ts:joinParty`) — extended to detect a soft-deleted row (`leftAt !== null`) for the same `(userId, partyId, role='player')` tuple and reactivate it in place. The pure-state mutation now mirrors the persistor's upsert semantics: optimistic UI on the client and authoritative replay on the server arrive at the same shape.

**Decisions captured:**

- `joinedAt` is updated to NOW on rejoin (current-tenure semantics). The first-join timestamp is preserved in the historical `join-party` log entry.
- `characterId` is reset to `null` on rejoin. The user's original character was cascaded to Recovered Loot on leave (BUG-001 path), so the FK target no longer exists; the user creates a new character via the existing post-join CTA.

**Lessons.**

- Soft delete + composite PK = upsert, never create. Every code path that writes a row with a `(userId, partyId, role)`-shaped composite PK must consider the soft-deleted-row case. Worth a brief audit when R4.3 lands `dm-transfer` (which may add/remove DM rows).
- Two-id-minting authorities (client reducer + server persistor) need the same defect fixed in both places. RH1 will retire the dual-authority for ID minting, but the **logic-duplication risk** persists for any state-transition rule; the only structural fix is keeping the reducer the single source of truth and letting the server replay it (which is what we already do — both fixes here are in shared code paths, not in two different implementations).
- The route's `already_member` guard correctly checked `leftAt: null`, so the entry point was right; the bug was in the downstream write. A read-only "is this active?" check + a downstream "create" that doesn't know about soft delete is a classic asymmetry — easy to miss in review.

**Related code changed.**

- `apps/server/src/sync/persistor.ts` — `persistJoinParty` uses `upsert`.
- `packages/rules/src/reducer/index.ts` — `joinParty` reactivates soft-deleted rows in place.
- `apps/web/src/store/reducer.test.ts` — two new regression tests (rejoin reactivation + still-active-rejection).
- `apps/server/src/parties/routes.test.ts` — two new integration regression tests (full leave → rejoin round-trip + 409 already_member still works).

---

### BUG-001 — `kick-player` / `leave-party` fail with `Character_inventoryStashId_fkey` RESTRICT violation

- **Filed:** 2026-06-30
- **Fixed:** 2026-06-30 (feature/r4-parties)
- **Severity:** blocker (both kick + leave actions were unusable in server mode whenever the affected player had a character)
- **Status:** fixed
- **Affected slice:** R4.1.c / R4.1.d / R4.1.e (kick-player + leave-party flows)

**Symptom.** Both `POST /parties/:partyId/kick { kickedUserId }` AND `POST /parties/:partyId/leave` return:

```json
{
  "statusCode": 500,
  "error": "Internal Server Error",
  "message": "update or delete on table \"Stash\" violates RESTRICT setting of foreign key constraint \"Character_inventoryStashId_fkey\" on table \"Character\""
}
```

The kick path was reported first (2026-06-30, server logs); the leave path was reproduced shortly after with the same error. Both routes call into the same persistor helper.

**Reproduction.**

1. User A creates a multi-member party (any way: invite + join, or directly via `POST /sync/actions`).
2. User B joins; user B creates their character via the PartySettings CTA so they own a character with an Inventory stash.
3. User A (DM) clicks Kick on user B in `/party/settings`.
4. Server returns 500.

**Root cause analysis.**

The cascade in `apps/server/src/sync/persistor.ts:cascadeCharacterToRecoveredLootDb` (lines ~907–973) performs these steps in order:

1. Move every `ItemInstance` from the kicked user's stashes → Recovered Loot stash.
2. Aggregate currency → roll into Recovered Loot's `CurrencyHolding`.
3. **Delete the kicked user's stashes** (`tx.stash.deleteMany`).
4. Clear `PartyMembership.characterId` for the kicked user's player row.
5. Delete the `Character` row.

Step 3 fails because the FK `Character.inventoryStashId → Stash.id` is `ON DELETE RESTRICT` AND there's still a Character row pointing at the about-to-be-deleted Inventory stash (the character itself is dropped only in step 5).

The author's intent (per the comment on persistor.ts:970–972) was that the FK being `DEFERRABLE INITIALLY DEFERRED` would let the in-transaction order Stash-delete → Character-delete succeed because the check happens at COMMIT, by which time the Character is gone too. **That intent is correct for `DEFERRABLE`, but does NOT save us from `ON DELETE RESTRICT`** — RESTRICT rejects at the row-write level regardless of whether the check is immediate or deferred.

The init migration's "tail" block (`apps/server/prisma/migrations/20260626100818_init/migration.sql:280–285`) drops + re-adds the FK with `DEFERRABLE INITIALLY DEFERRED` but ALSO drops the `ON DELETE RESTRICT` clause:

```sql
ALTER TABLE "Character" DROP CONSTRAINT "Character_inventoryStashId_fkey";
ALTER TABLE "Character"
  ADD CONSTRAINT "Character_inventoryStashId_fkey"
  FOREIGN KEY ("inventoryStashId") REFERENCES "Stash"("id")
  DEFERRABLE INITIALLY DEFERRED;
```

This block is what's supposed to keep the constraint in the "no-RESTRICT + deferrable" state the persistor needs. But Prisma's known DSL gap (issue #8807, called out in `apps/server/prisma/schema.prisma` and `apps/server/README.md`) means every `prisma migrate dev` run that touches `Character` OR `Stash` re-emits the constraint WITH `ON DELETE RESTRICT` (because that's what the Prisma DSL implies for a non-cascaded relation) and WITHOUT `DEFERRABLE` — silently undoing the tail. Some later migration must have done that.

The defensive test `apps/server/src/db/schema-invariants.test.ts` checks `condeferrable` + `condeferred` in `pg_constraint` — but it does NOT check `confdeltype` (the `ON DELETE` action). That's how the RESTRICT regression slipped through CI: the deferrable flags survived migrations because the tail block re-applied them, but the `RESTRICT` got re-introduced and the test had no signal to fire on.

**Fix sketch (in increasing order of structural-soundness):**

1. **Tactical:** Reorder steps in `cascadeCharacterToRecoveredLootDb` to drop the Character row before the owned-stash rows. The character has FKs to all its stashes (`inventoryStashId` to Inventory + cascade-on-delete to others via `ownedStashes` relation), so dropping the character first means the `ON DELETE RESTRICT` on `inventoryStashId` is the one being CHECKED, and at that point the FK target (the Inventory stash) still exists. The stash deletion that follows is now unblocked because the row referencing it is gone.
2. **Migration:** Add a new migration tail that DROPs and re-ADDs the `Character_inventoryStashId_fkey` constraint without `ON DELETE RESTRICT` (use the default `NO ACTION`, which composes correctly with `DEFERRABLE INITIALLY DEFERRED`). Mirrors the existing R3.1/R3.2/R3.5 migration-tail pattern documented in `apps/server/prisma/schema.prisma`.
3. **CI hardening:** Extend `schema-invariants.test.ts` to also assert `confdeltype = 'a'` (NO ACTION) on `Character_inventoryStashId_fkey`. Without this assertion, the same regression will happen the next time someone runs `prisma migrate dev` against a touched table.

Recommended: **all three.** (1) unblocks the current deployed instance, (2) prevents the same SQL state from recurring, (3) catches future drift.

**Open questions before fixing.**

- ~~Does `leave-party` have the same bug?~~ **Confirmed yes 2026-06-30.** Same 500 error from `POST /parties/:partyId/leave` for a player whose character has an Inventory stash. Both routes call `cascadeCharacterToRecoveredLootDb` in `apps/server/src/sync/persistor.ts`, so a single fix to that helper resolves both surface paths.
- Are there OTHER `ON DELETE RESTRICT` constraints that should be `NO ACTION` or `CASCADE`? Worth a one-time audit while we're here.
- Did the R4.1.b `delete-character` integration tests in `apps/web/src/store/reducer.test.ts` cover the persistor path? They run client-side against an in-memory reducer (no Prisma), so they wouldn't catch this. A server-side integration test would have.

**Repro tests to write before the fix lands.** Two new integration tests in `apps/server/src/parties/routes.test.ts`:

1. **Kick path:** party with DM + 1 player who has a character + Inventory items → `POST /parties/:partyId/kick { kickedUserId }` → expect 200 (currently 500).
2. **Leave path:** party with DM + 1 player who has a character + Inventory items → player calls `POST /parties/:partyId/leave` → expect 200 (currently 500).

Both become regression tests once the fix lands.

**Postmortem (fixed 2026-06-30).** All three fix-sketch pieces landed together:

1. **Persistor reorder** (`apps/server/src/sync/persistor.ts:cascadeCharacterToRecoveredLootDb`) — delete the `Character` row BEFORE the owned `Stash` rows. The `Character.inventoryStashId → Stash.id` FK is checked at row-write time on the referencing row; once the `Character` is gone, the `Stash` delete is unblocked regardless of the FK's `ON DELETE` action. This fix alone unblocked the deployed instance.
2. **Migration tail** (`apps/server/prisma/migrations/20260630181911_bug001_character_inventory_fk_no_action/migration.sql`) — DROP + re-ADD the FK without `ON DELETE RESTRICT` (default `NO ACTION` composes correctly with `DEFERRABLE INITIALLY DEFERRED`). Defense-in-depth: any future caller doing the deletes in a different order is also safe.
3. **CI hardening** (`apps/server/src/db/schema-invariants.test.ts`) — extended the existing invariant assertion to also check `confdeltype = 'a'` (NO ACTION). The original test only checked `condeferrable` + `condeferred`, which is why the R3.2-introduced regression slipped through. Same `pg_constraint`-catalog read pattern, no extra cost.

**Lessons.**

- `DEFERRABLE INITIALLY DEFERRED` only moves the FK check to COMMIT — it does NOT change `ON DELETE` semantics. RESTRICT rejects at row-write time regardless of deferral.
- `prisma#8807` is broader than "DEFERRABLE drift": Prisma's DSL re-emits non-cascaded relations as `ON DELETE RESTRICT` by default on every `migrate dev` against a touched table. The R3.2 migration tail re-added DEFERRABLE but *kept* RESTRICT, which is what introduced this regression. The `schema.prisma` drift-warning comment was updated to call out the `confdeltype` axis alongside `condeferrable`.
- Defensive DB-invariant tests are cheap; missing axes are expensive. The existing `schema-invariants.test.ts` had the right shape but was missing the `confdeltype` check, so the regression slipped through. Adding the assertion took 6 lines and one cast (`confdeltype::text` because `pg_constraint.confdeltype` is `"char"`, not `text`).

**Related code changed.**

- `apps/server/src/sync/persistor.ts` — cascade reorder + new comment block explaining the load-bearing order.
- `apps/server/prisma/schema.prisma` — drift-warning comment updated to mention `ON DELETE` axis alongside DEFERRABLE.
- `apps/server/prisma/migrations/20260630181911_bug001_character_inventory_fk_no_action/migration.sql` — new migration.
- `apps/server/src/db/schema-invariants.test.ts` — extended invariant assertion.
- `apps/server/src/parties/routes.test.ts` — two new regression integration tests (kick + leave with a character).

---

## Audits

### AUDIT-001 — `ON DELETE RESTRICT` FK sweep (2026-06-30, follow-up to BUG-001)

One of BUG-001's open questions was: "Are there OTHER `ON DELETE RESTRICT` constraints that should be `NO ACTION` or `CASCADE`?" Answer: **no — all remaining RESTRICTs are intentional.**

Query (`pg_constraint` where `confdeltype = 'r'`) returned four FKs at the time of the sweep:

| Constraint                          | Column                                | References                | Verdict     | Why                                                                                                            |
| ----------------------------------- | ------------------------------------- | ------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------- |
| `Character_ownerUserId_fkey`        | `Character.ownerUserId`               | `User.id`                 | keep        | Users are never hard-deleted (soft-leave via `PartyMembership.leftAt`). RESTRICT protects against future code paths that would silently orphan a Character. |
| `Party_ownerUserId_fkey`            | `Party.ownerUserId`                   | `User.id`                 | keep        | Same as above for Party. DM-leave archives the party (R4.1.e); it never deletes the User row.                  |
| `TransactionLog_actorUserId_fkey`   | `TransactionLog.actorUserId`          | `User.id`                 | keep        | The log is an immutable audit trail (OUTLINE §8). An actor row must remain referentially valid forever.        |
| `ItemInstance_definitionId_fkey`    | `ItemInstance.definitionId`           | `ItemDefinition.id`       | keep        | Schema explicitly sets `onDelete: Restrict` (prisma/schema.prisma). PHB/DMG seed content must not vanish while items reference it. |

BUG-001 was unique because the cascade deleted both the referencing AND the referenced row in the same transaction, putting RESTRICT in an order-dependent collision. None of these four FKs have that property — the referenced row (User / ItemDefinition) is never deleted in normal flows.

**Result.** No migration needed. The four RESTRICTs above are correct defenses against future "delete a User who still owns data" code paths. If we ever add a real user-deletion flow (GDPR right-to-erasure, for example), revisit each: it'll need an explicit cascade plan in code, NOT a relaxed FK.