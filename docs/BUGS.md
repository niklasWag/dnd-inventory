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

_(none currently open)_

---

## Recently fixed

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