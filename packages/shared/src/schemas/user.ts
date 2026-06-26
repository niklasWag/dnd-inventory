import { z } from 'zod';

/**
 * User — the local account.
 *
 * MVP / R3.1: a single local user keyed by a UUID `id`, with just
 * `displayName` + `createdAt`. R3.2 expands the schema to carry the OAuth
 * identity columns: `discordId`, `email`, `emailVerified`, `avatarUrl`.
 *
 * **R3.2 deviation from OUTLINE §4 wording.** The OUTLINE says "post-R3 the
 * id becomes the Discord snowflake (`discordId`)." In practice, co-locating
 * the Auth.js Prisma adapter (which generates its own cuid for new rows)
 * with the existing R3.1 schema (which had caller-provided UUIDs) forces a
 * split: `id` stays a stable opaque internal key, and `discordId` is a
 * separate `String? UNIQUE` column carrying the Discord snowflake. This
 * decouples our internal identity from any one OAuth provider — when R3.3
 * lands email-OTP-only accounts, those rows have `discordId: undefined`
 * but the same `id` shape. OUTLINE §4 amended in lockstep.
 *
 * **SECURITY §1.2 invariant.** Every User must have at least one of
 * `discordId` or `emailVerified` set — enforced at the DB level via the
 * `User_auth_present_check` CHECK constraint in
 * `apps/server/prisma/migrations/<ts>_r32_auth/migration.sql`, and at the
 * Zod boundary via the `.refine()` below.
 */
export const userSchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    // R3.2 — Discord snowflake; absent on email-only accounts.
    discordId: z.string().min(1).optional(),
    // R3.2 — set by R3.3's email OTP flow; UNIQUE per SECURITY §1.2.
    email: z.string().email().optional(),
    // R3.2 — ISO timestamp set on first successful OTP verification
    // (R3.3). Per OUTLINE §4 line 231, this is the "has the user proven
    // ownership of `email`?" flag in DateTime-as-truthy form. Absent ⇒
    // unverified or no email at all.
    emailVerified: z.string().datetime().optional(),
    // R3.2 — Discord CDN URL (or absent). Resynced from Discord profile
    // on every successful Discord login per
    // `apps/server/src/auth/config.ts events.signIn`.
    avatarUrl: z.string().url().optional(),
    // R3.3 — gates hub access for email-only signups. Set true on first
    // OTP verify for a new email (no Discord profile to source a name
    // from). The §8.1 guard layer (R3.4) returns 409 `display_name_required`
    // on every protected route except POST /auth/email/set-display-name
    // until the user supplies a name and this flips false. Optional in
    // the Zod boundary because the column has a Prisma `@default(false)`
    // and most users (Discord, local-MVP) leave it unset.
    needsDisplayName: z.boolean().optional(),
    createdAt: z.string().datetime(),
  })
  .refine((u) => u.discordId !== undefined || u.emailVerified !== undefined, {
    message: 'User must have at least one of discordId or emailVerified',
  });

export type User = z.infer<typeof userSchema>;
