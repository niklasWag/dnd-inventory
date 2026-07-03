import { z } from 'zod';

import { characterSchema } from './character';
import { currencyHoldingSchema } from './currencyHolding';
import { gameSessionSchema } from './gameSession';
import { itemDefinitionSchema } from './itemDefinition';
import { itemInstanceSchema } from './itemInstance';
import { partySchema } from './party';
import { partyMembershipSchema } from './partyMembership';
import { stashSchema } from './stash';
import { transactionLogEntrySchema } from './transactionLog';
import { userSchema } from './user';

/**
 * AppState — the single persisted blob (MVP §6 / OUTLINE §4).
 *
 * Cross-entity invariants are NOT enforced by Zod here; they're upheld
 * by the reducer (CLAUDE.md: every mutation goes through reduce →
 * validate → log → persist). Examples that live in the reducer, not
 * the schema:
 *   - exactly one Party (MVP)
 *   - exactly two memberships per (userId, partyId) — dm + player
 *   - exactly one isCarried stash per character, referenced by
 *     `Character.inventoryStashId`
 *   - one CurrencyHolding per stash
 *   - auto-stack key `(definitionId, notes ?? "")`
 *
 * Asserting these inside Zod would either be expensive on every parse or
 * require a post-parse refine that essentially re-implements the reducer
 * validators — keeping them in one place (the reducer) is simpler.
 */
export const appStateSchema = z
  .object({
    version: z.literal(1),
    seedVersion: z.number().int().nonnegative(),
    user: userSchema,
    party: partySchema,
    memberships: z.array(partyMembershipSchema),
    characters: z.array(characterSchema),
    gameSessions: z.array(gameSessionSchema),
    stashes: z.array(stashSchema),
    catalog: z.array(itemDefinitionSchema),
    items: z.array(itemInstanceSchema),
    currencies: z.array(currencyHoldingSchema),
    log: z.array(transactionLogEntrySchema),
  })
  .strict();

export type AppState = z.infer<typeof appStateSchema>;
