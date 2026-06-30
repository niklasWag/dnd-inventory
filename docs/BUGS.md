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