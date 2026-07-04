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

### BUG-005 — Optimistic success toast flashes before the server rejection toast on guarded actions

- **Filed:** 2026-07-01
- **Severity:** medium (cosmetic + UX-confusing — no data corruption; the final state is correct because the queue rolls back via BUG-003's snapshot pattern, and the rejection toast is the last one shown. But a user who blinks may think their action succeeded before seeing the rejection.)
- **Status:** open
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

---

## Recently fixed

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