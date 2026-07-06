import { z } from 'zod';

/**
 * R6.2 — Shop entity + stock entries (OUTLINE §3.9, §4).
 *
 * Definition-level stock: a shop is a static catalog of `(itemDefinitionId,
 * priceOverride?, quantity)` rows. Purchase creates a fresh `ItemInstance`
 * in the buyer's stash; sale consumes an ItemInstance from the seller's
 * stash and increments (or inserts) the shop's stock row. Shops do NOT
 * hold ItemInstances directly — `ItemInstance.ownerType` stays locked to
 * `'stash'` in v1.
 *
 * Shops also have no `CurrencyHolding` (per OUTLINE §3.9 amendment
 * 2026-06-24) — the shop side of a transaction is bookkeeping-free.
 *
 * `isOpen` gates player visibility: when `false`, only the DM sees the
 * shop and can transact. When `true`, any active party member can
 * navigate to the shop detail route and dispatch `purchase` / `sale`.
 * DM writes on the Shop entity + stock array are always DM-only (per
 * user directive 2026-07-06).
 *
 * `priceOverride` is stored in integer CP. When set on a stock row it
 * completely replaces the base price during `purchase` (bypasses both
 * `Party.priceModifier` and `Shop.priceModifier`) — the "fixed override"
 * reading of §3.9 line 172. `sale` always uses the scaled base price ×
 * `sellToMerchantRate`, ignoring `priceOverride`.
 *
 * `quantity === -1` means "unlimited stock" (never decrements on
 * purchase; never increments on sale). Any other value must be
 * non-negative — enforced by `refine`.
 */

export const shopStockEntrySchema = z
  .object({
    id: z.string().min(1),
    itemDefinitionId: z.string().min(1),
    priceOverride: z.number().int().nonnegative().optional(),
    quantity: z.number().int(),
  })
  .strict()
  .refine((e) => e.quantity === -1 || e.quantity >= 0, {
    message: 'stock.quantity must be -1 (unlimited) or >= 0',
    path: ['quantity'],
  });

export type ShopStockEntry = z.infer<typeof shopStockEntrySchema>;

export const shopSchema = z
  .object({
    id: z.string().min(1),
    partyId: z.string().min(1),
    name: z.string().min(1),
    priceModifier: z.number().positive(),
    sellToMerchantRate: z.number().positive(),
    isOpen: z.boolean(),
    stock: z.array(shopStockEntrySchema),
    createdAt: z.string().datetime(),
  })
  .strict();

export type Shop = z.infer<typeof shopSchema>;
