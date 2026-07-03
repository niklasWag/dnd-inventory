import { z } from 'zod';

import { actionSchema } from './action';
import { transactionLogEntrySchema } from './transactionLog';

/**
 * R5.1 — Server → client WebSocket message: `applied`.
 *
 * Emitted by `broadcastApplied()` in `apps/server/src/realtime/io.ts`
 * after `POST /sync/actions` commits and one of its dispatched actions
 * has `getActionMetadata(type).broadcastOnApplied === true`.
 *
 * Carries BOTH:
 *   - `action` — the source Action, so receiving clients can re-run their
 *     local reducer for state mutation (RH2 determinism guarantees the
 *     same input produces the same state on every client).
 *   - `applied` — the server's canonical log entries (RH2.6 log-authority).
 *     Clients append these verbatim via `appendServerLogEntries()`;
 *     the reducer's local `logEntries` output is discarded.
 *
 * Zod-parsed on the client at receipt (SECURITY: "Zod at every boundary").
 * `.strict()` per RH0.1 — reject unknown keys so an inflight-protocol
 * mistake is loud, not silent.
 */
export const appliedBroadcastSchema = z
  .object({
    partyId: z.string().min(1),
    action: actionSchema,
    applied: z.array(transactionLogEntrySchema),
  })
  .strict();

export type AppliedBroadcast = z.infer<typeof appliedBroadcastSchema>;
