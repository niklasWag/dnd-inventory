import { z } from 'zod';

/**
 * `GameSession` — the D&D-gameplay session entity (OUTLINE §3.12 + §4).
 *
 * **Naming.** Called `GameSession` in code — the OUTLINE §4 gameplay copy
 * uses "Session" in prose, but the Prisma `model Session` slot is already
 * occupied by Auth.js's per-browser session
 * (`apps/server/prisma/schema.prisma` line 417). See OUTLINE §4 naming
 * note for the disambiguation.
 *
 * **Invariants** (enforced across layers, NOT on the row schema alone —
 * cross-entity uniqueness is a table-level concern):
 *   - At most one `GameSession` per party has `isCurrent: true`. Enforced
 *     by a partial UNIQUE index in Postgres
 *     (`GameSession_isCurrent_uniq WHERE isCurrent = TRUE`) and by the
 *     reducer's `start-game-session` guard (rejects when a session is
 *     already current unless the caller opts into `endCurrentFirst`).
 *   - `number` is a per-party monotone sequence starting at 1. The
 *     reducer computes it as `max(existing) + 1`; no gap-filling on
 *     end/delete. Historical sessions keep their number after being
 *     ended — the number identifies the campaign session, not the
 *     currently-active row.
 *
 * **Data-model note.** `date` is a calendar date (ISO `YYYY-MM-DD`),
 * not a full timestamp — matches OUTLINE §4's "session date" wording
 * and mirrors how humans think about game sessions ("Session 12 was
 * on March 5th"). Full timestamps live on `createdAt`.
 */
export const gameSessionSchema = z
  .object({
    id: z.string().min(1),
    partyId: z.string().min(1),
    number: z.number().int().positive(),
    date: z.iso.date(),
    notes: z.string().optional(),
    isCurrent: z.boolean(),
    createdAt: z.string().datetime(),
  })
  .strict();

export type GameSession = z.infer<typeof gameSessionSchema>;
