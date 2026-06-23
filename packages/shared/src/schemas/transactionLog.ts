import { z } from 'zod';

/**
 * TransactionLog — MVP captures a strict SUBSET of the OUTLINE §4 full
 * union. Every action that mutates state appends one entry; the discriminant
 * `type` maps 1:1 to reducer actions (CLAUDE.md store invariant).
 *
 * Adding a new mutation in a later milestone means BOTH adding a reducer
 * case AND extending this union with the new variant.
 *
 * `actorRole` is derived at write time: in MVP everything is `"player"`
 * for player-driven actions and `"dm"` for DM-only ones; in MVP there is
 * only one user wearing both hats, so reducer cases that are conceptually
 * DM-driven log as `"dm"` for forward-compat (e.g. `create-character`
 * provisions the party).
 *
 * `sessionId` is `null` until R5 (`Session` entity).
 */

const baseLogFields = {
  id: z.string().min(1),
  partyId: z.string().min(1),
  sessionId: z.null(),
  timestamp: z.string().datetime(),
  actorUserId: z.string().min(1),
  actorRole: z.enum(['dm', 'player']),
};

const createCharacterEntry = z.object({
  ...baseLogFields,
  type: z.literal('create-character'),
  payload: z.object({
    characterId: z.string().min(1),
    userId: z.string().min(1),
    partyId: z.string().min(1),
    name: z.string().min(1),
    inventoryStashId: z.string().min(1),
    partyStashId: z.string().min(1),
    recoveredLootStashId: z.string().min(1),
  }),
});

/**
 * `acquire` — an item lands in a stash. Auto-stack is reducer-internal:
 * if the row existed already, `itemInstanceId` is the existing row's id;
 * if it was just created, it's the new id. The payload mirrors OUTLINE §4
 * (`source` covers the full enum so future milestones — shops, hoards,
 * duplicate-to-edit — extend the reducer without touching the schema).
 */
const acquireEntry = z.object({
  ...baseLogFields,
  type: z.literal('acquire'),
  payload: z.object({
    stashId: z.string().min(1),
    itemInstanceId: z.string().min(1),
    definitionId: z.string().min(1),
    quantity: z.number().int().positive(),
    source: z.enum(['hoard', 'purchase', 'custom-create', 'duplicate']),
  }),
});

/**
 * `consume` — an item row's quantity goes down. `removed` is the reducer-
 * derived flag that telegraphs "this take dropped the row to 0 and it was
 * removed from the stash" — useful for log readers / future undo so they
 * don't need to replay the whole AppState to know the row is gone.
 */
const consumeEntry = z.object({
  ...baseLogFields,
  type: z.literal('consume'),
  payload: z.object({
    stashId: z.string().min(1),
    itemInstanceId: z.string().min(1),
    quantity: z.number().int().positive(),
    removed: z.boolean(),
  }),
});

/**
 * `seed-catalog` — bulk catalog upsert from the bundled PHB seed (MVP §9).
 * Fires on first launch (everything in `addedDefinitionIds`) and on any
 * subsequent boot where the persisted `seedVersion` is behind the bundle
 * (`updatedDefinitionIds` picks up changed PHB rows; homebrew is left alone).
 *
 * One entry per boot keeps the log compact — we'd rather record "the
 * catalog moved to version N" than spam a `create-homebrew`-shaped row
 * for every PHB item.
 */
const seedCatalogEntry = z.object({
  ...baseLogFields,
  type: z.literal('seed-catalog'),
  payload: z.object({
    seedVersion: z.number().int().nonnegative(),
    addedDefinitionIds: z.array(z.string().min(1)),
    updatedDefinitionIds: z.array(z.string().min(1)),
  }),
});

// MVP TxType subset (MVP §6). Each post-M1 milestone adds a variant here
// AND a reducer case in apps/web/src/store/reducer.ts.
export const transactionLogEntrySchema = z.discriminatedUnion('type', [
  createCharacterEntry,
  acquireEntry,
  consumeEntry,
  seedCatalogEntry,
]);

export type TransactionLogEntry = z.infer<typeof transactionLogEntrySchema>;

/**
 * Allowed action `type` values. The reducer's input shape mirrors these
 * but without the derived log-only fields (id, timestamp, actorUserId,
 * actorRole, partyId, sessionId) — those are filled in by the store
 * middleware.
 */
export type TxType = TransactionLogEntry['type'];
