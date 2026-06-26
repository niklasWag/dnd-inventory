/**
 * R3.4.a — request/response shapes for the sync routes.
 *
 * `syncActionsRequestSchema` validates `POST /sync/actions` bodies. The
 * `actions` array caps at 100 entries per request — that bound + the
 * 30-second `$transaction` timeout in `routes.ts` is the defensive
 * pairing against DoS via huge batches.
 */
import { actionSchema } from '@app/shared';
import { z } from 'zod';

export const syncActionsRequestSchema = z.object({
  partyId: z.string().min(1),
  actions: z.array(actionSchema).min(1).max(100),
});

export type SyncActionsRequest = z.infer<typeof syncActionsRequestSchema>;

/**
 * Thrown inside the `$transaction` block when a guard rejects an
 * action; the route handler catches it and turns it into the 422
 * response. Using a custom error type (rather than a tagged
 * return-value) means a rejected action triggers Prisma's automatic
 * transaction rollback for free.
 */
export class BatchRejected extends Error {
  constructor(
    public index: number,
    public code: string,
    public override message: string,
  ) {
    super(message);
    this.name = 'BatchRejected';
  }
}
