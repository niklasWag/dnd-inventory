import { z } from 'zod';

/**
 * CurrencyHolding — exactly one row per stash (enforced at the AppState
 * level). All denominations are non-negative integers; the reducer
 * guards against pushing any one negative (OUTLINE §4 / MVP §6).
 */
export const currencyHoldingSchema = z
  .object({
    id: z.string().min(1),
    stashId: z.string().min(1),
    cp: z.number().int().nonnegative(),
    sp: z.number().int().nonnegative(),
    ep: z.number().int().nonnegative(),
    gp: z.number().int().nonnegative(),
    pp: z.number().int().nonnegative(),
  })
  .strict();

export type CurrencyHolding = z.infer<typeof currencyHoldingSchema>;
