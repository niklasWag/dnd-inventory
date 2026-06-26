import { z } from 'zod';

import { creatureSizeSchema, encumbranceRuleSchema } from './character';
import {
  currencyDenominationSchema,
  itemCategorySchema,
  itemDefinitionSchema,
} from './itemDefinition';

/**
 * Action — discriminated-union Zod schema mirroring the runtime
 * `Action` type exported from `@app/rules/reducer/types`. The TS type
 * is the reducer's source-of-truth for what the UI / server sync route
 * dispatches; the Zod schema is the wire-validation source-of-truth for
 * R3.4.a `POST /sync/actions`.
 *
 * The reducer's `Action` payloads are intentionally a SUBSET of the
 * corresponding `TransactionLogEntry` payloads — the reducer + middleware
 * mint the derived fields (ids, timestamps, derived `removed` flag, etc.)
 * during dispatch. This file mirrors that subset 1:1 with the TS type.
 *
 * **Drift detection.** When adding a new action variant: update BOTH
 * the TS type in `@app/rules/reducer/types` AND this Zod schema. The
 * `assertActionsAlign` cross-test in `action.test.ts` performs a
 * type-level compatibility check between the two so this never drifts.
 */

const currencyDeltaPayloadSchema = z.object({
  cp: z.number().int(),
  sp: z.number().int(),
  ep: z.number().int(),
  gp: z.number().int(),
  pp: z.number().int(),
});

const homebrewDefinitionInputSchema = z.object({
  name: z.string().min(1),
  category: itemCategorySchema,
  weight: z.number().nonnegative().optional(),
  cost: z
    .object({
      amount: z.number().int().nonnegative(),
      currency: currencyDenominationSchema,
    })
    .optional(),
  description: z.string().optional(),
  tags: z.array(z.string().min(1)).optional(),
});

export type HomebrewDefinitionInput = z.infer<typeof homebrewDefinitionInputSchema>;

/**
 * Patch shape for `edit-homebrew`. Each field optional AND may be
 * explicit `undefined` (= "clear this optional field") — distinct from
 * "key absent" (= "don't touch"). Under `exactOptionalPropertyTypes`
 * the TS type uses `T | undefined` on each member. The Zod runtime
 * doesn't have to encode that distinction; the reducer's diff loop
 * does the "absent vs explicit-undefined" branching.
 */
const homebrewDefinitionPatchSchema = z.object({
  name: z.string().min(1).optional(),
  category: itemCategorySchema.optional(),
  weight: z.number().nonnegative().optional(),
  cost: z
    .object({
      amount: z.number().int().nonnegative(),
      currency: currencyDenominationSchema,
    })
    .optional(),
  description: z.string().optional(),
  tags: z.array(z.string().min(1)).optional(),
});

export type HomebrewDefinitionPatch = z.infer<typeof homebrewDefinitionPatchSchema>;

// -------------------- 25 action variants --------------------

const createCharacterAction = z.object({
  type: z.literal('create-character'),
  payload: z.object({
    name: z.string().min(1),
    species: z.string().min(1),
    size: creatureSizeSchema,
    class: z.string().min(1),
    level: z.number().int().positive(),
    str: z.number().int().positive(),
  }),
});

const acquireAction = z.object({
  type: z.literal('acquire'),
  payload: z.object({
    stashId: z.string().min(1),
    definitionId: z.string().min(1),
    quantity: z.number().int().positive(),
    source: z.enum(['hoard', 'purchase', 'custom-create', 'duplicate', 'catalog-add']),
    notes: z.string().optional(),
  }),
});

const consumeAction = z.object({
  type: z.literal('consume'),
  payload: z.object({
    itemInstanceId: z.string().min(1),
    quantity: z.number().int().positive(),
  }),
});

const seedCatalogAction = z.object({
  type: z.literal('seed-catalog'),
  payload: z.object({
    seedVersion: z.number().int().nonnegative(),
    entries: z.array(itemDefinitionSchema),
  }),
});

const editItemInstanceAction = z.object({
  type: z.literal('edit-item-instance'),
  payload: z.object({
    itemInstanceId: z.string().min(1),
    patch: z.object({
      customName: z.string().optional(),
      notes: z.string().optional(),
    }),
  }),
});

const createStashAction = z.object({
  type: z.literal('create-stash'),
  payload: z.object({
    ownerCharacterId: z.string().min(1),
    name: z.string().min(1),
  }),
});

const renameStashAction = z.object({
  type: z.literal('rename-stash'),
  payload: z.object({
    stashId: z.string().min(1),
    newName: z.string().min(1),
  }),
});

const deleteStashAction = z.object({
  type: z.literal('delete-stash'),
  payload: z.object({
    stashId: z.string().min(1),
  }),
});

const currencyChangeAction = z.object({
  type: z.literal('currency-change'),
  payload: z.object({
    stashId: z.string().min(1),
    delta: currencyDeltaPayloadSchema,
    reason: z.enum(['deposit', 'withdraw', 'convert']),
  }),
});

const transferAction = z.object({
  type: z.literal('transfer'),
  payload: z.object({
    itemInstanceId: z.string().min(1),
    toStashId: z.string().min(1),
    quantity: z.number().int().positive(),
    // R1.5 — `toContainerInstanceId`:
    //   - absent / undefined: leave the moved row's containerInstanceId alone
    //   - null: take-out (clear containerInstanceId)
    //   - string: pack-into (set containerInstanceId)
    toContainerInstanceId: z.string().min(1).nullable().optional(),
  }),
});

const splitAction = z.object({
  type: z.literal('split'),
  payload: z.object({
    itemInstanceId: z.string().min(1),
    quantity: z.number().int().positive(),
  }),
});

const currencyTransferAction = z.object({
  type: z.literal('currency-transfer'),
  payload: z.object({
    fromStashId: z.string().min(1),
    toStashId: z.string().min(1),
    delta: currencyDeltaPayloadSchema,
  }),
});

const createHomebrewAction = z.object({
  type: z.literal('create-homebrew'),
  payload: homebrewDefinitionInputSchema.extend({
    duplicatedFromId: z.string().min(1).optional(),
  }),
});

const editHomebrewAction = z.object({
  type: z.literal('edit-homebrew'),
  payload: z.object({
    definitionId: z.string().min(1),
    patch: homebrewDefinitionPatchSchema,
  }),
});

const deleteHomebrewAction = z.object({
  type: z.literal('delete-homebrew'),
  payload: z.object({
    definitionId: z.string().min(1),
  }),
});

const renameCharacterAction = z.object({
  type: z.literal('rename-character'),
  payload: z.object({
    characterId: z.string().min(1),
    newName: z.string().min(1),
  }),
});

const renamePartyAction = z.object({
  type: z.literal('rename-party'),
  payload: z.object({
    partyId: z.string().min(1),
    newName: z.string().min(1),
  }),
});

const setEncumbranceAction = z.object({
  type: z.literal('set-encumbrance'),
  payload: z.object({
    characterId: z.string().min(1),
    rule: encumbranceRuleSchema,
    enforce: z.boolean(),
  }),
});

const equipAction = z.object({
  type: z.literal('equip'),
  payload: z.object({
    itemInstanceId: z.string().min(1),
    characterId: z.string().min(1),
    slot: z.string().optional(),
  }),
});

const unequipAction = z.object({
  type: z.literal('unequip'),
  payload: z.object({
    itemInstanceId: z.string().min(1),
    characterId: z.string().min(1),
    slot: z.string().optional(),
  }),
});

const attuneAction = z.object({
  type: z.literal('attune'),
  payload: z.object({
    itemInstanceId: z.string().min(1),
    characterId: z.string().min(1),
  }),
});

const unattuneAction = z.object({
  type: z.literal('unattune'),
  payload: z.object({
    itemInstanceId: z.string().min(1),
    characterId: z.string().min(1),
  }),
});

const useChargeAction = z.object({
  type: z.literal('use-charge'),
  payload: z.object({
    itemInstanceId: z.string().min(1),
    characterId: z.string().min(1),
    amount: z.number().int().positive().optional(),
  }),
});

const rechargeAction = z.object({
  type: z.literal('recharge'),
  payload: z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('single'),
      itemInstanceId: z.string().min(1),
      characterId: z.string().min(1),
      amount: z.number().int().positive().optional(),
    }),
    z.object({
      mode: z.literal('manual'),
      itemInstanceId: z.string().min(1),
      characterId: z.string().min(1),
      amount: z.number().int().positive().optional(),
    }),
    z.object({
      mode: z.literal('batch'),
      characterId: z.string().min(1),
      trigger: z.enum(['dawn', 'dusk', 'long-rest', 'short-rest']),
      amounts: z.record(z.string().min(1), z.number().int().positive()).optional(),
    }),
  ]),
});

const identifyAction = z.object({
  type: z.literal('identify'),
  payload: z.object({
    itemInstanceId: z.string().min(1),
    identified: z.boolean(),
    // R2.3 hint semantics: key absent vs explicit `undefined` vs string
    // is differentiated by the reducer; runtime Zod accepts any of the
    // three (`undefined` is encoded as absent at the wire boundary; the
    // server's diff loop treats it the same way as the web reducer).
    hint: z.string().optional(),
  }),
});

const editCharacterAction = z.object({
  type: z.literal('edit-character'),
  payload: z.object({
    characterId: z.string().min(1),
    patch: z.object({
      species: z.string().min(1).optional(),
      class: z.string().min(1).optional(),
      level: z.number().int().positive().optional(),
      str: z.number().int().positive().optional(),
      maxAttunement: z.number().int().nonnegative().optional(),
    }),
  }),
});

export const actionSchema = z.discriminatedUnion('type', [
  createCharacterAction,
  acquireAction,
  consumeAction,
  seedCatalogAction,
  editItemInstanceAction,
  createStashAction,
  renameStashAction,
  deleteStashAction,
  currencyChangeAction,
  transferAction,
  splitAction,
  currencyTransferAction,
  createHomebrewAction,
  editHomebrewAction,
  deleteHomebrewAction,
  renameCharacterAction,
  renamePartyAction,
  setEncumbranceAction,
  equipAction,
  unequipAction,
  attuneAction,
  unattuneAction,
  useChargeAction,
  rechargeAction,
  identifyAction,
  editCharacterAction,
]);

export type Action = z.infer<typeof actionSchema>;
