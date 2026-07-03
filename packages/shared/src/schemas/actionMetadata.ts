import { z } from 'zod';

import { actionSchema, type Action } from './action';

/**
 * RH2.4 — schema-metadata registry for per-action-type concerns.
 *
 * Replaces the pattern of module-level `Set<Action['type']>` constants
 * scattered across consumers. Instead, each Action variant carries
 * metadata registered against the Zod schema; consumers read
 * `getActionMetadata(type)` at runtime.
 *
 * **Why a registry over inline schema fields:** Zod v4 provides a
 * first-class typed-registry API (`z.registry<Meta, Schema>()`) that
 * (a) doesn't pollute the action payload's parse output with metadata
 * fields, (b) lives in its own module so `action.ts` stays focused on
 * wire validation, (c) has WeakMap-backed lookup semantics so no memory
 * cost is paid for actions that never query the registry.
 *
 * **Why the `Record<Action['type'], ActionMetadata>` too:** the Record's
 * TypeScript signature forces every action-type literal to be present at
 * compile time — a new variant added to the discriminatedUnion + missing
 * from `metadataByType` fails `tsc` immediately. The `z.registry` is
 * populated FROM the Record at module load, keeping the two indexes in
 * lockstep by construction.
 *
 * **Adding a new metadata field:**
 *   1. Add the key + docstring to `ActionMetadata`.
 *   2. Every entry in `metadataByType` compile-error-forces you to
 *      populate the new field.
 *   3. No consumer code changes until a consumer starts reading the
 *      new field.
 *
 * **Adding a new Action variant:**
 *   1. Add the variant Zod schema in `action.ts`.
 *   2. Add it to `actionSchema`'s discriminatedUnion options.
 *   3. TypeScript now demands a corresponding key in `metadataByType`
 *      — the compile error names the missing type.
 *   4. `actionMetadata.test.ts` runtime-verifies the registry is
 *      populated for every option (defence in depth for cases where a
 *      variant is added to the schema but the discriminatedUnion list
 *      is stale — TypeScript can't always catch that).
 */

export interface ActionMetadata {
  /**
   * R5.1 preparation. `true` means: when this action's `applied[]`
   * slices come back from `POST /sync/actions`, the server should
   * broadcast them over the party's websocket channel to other
   * connected clients on the same party. `false` for server-boot-only
   * actions (`seed-catalog`) that no per-party user dispatch produces
   * — those slices belong to the initial state, not to a session
   * of user activity.
   *
   * The R5.1 slice will consume this via `getActionMetadata(type)`
   * inside the websocket-broadcast decision path instead of
   * maintaining a separate `BROADCAST_ACTION_TYPES: Set<...>` in
   * `apps/server/src/sync/`.
   */
  broadcastOnApplied: boolean;
}

/**
 * Compile-time-exhaustive metadata index keyed by action-type literal.
 * TypeScript demands every `Action['type']` value be present. If a new
 * variant is added to `actionSchema` and not to this record, `tsc`
 * fails with the missing key name.
 *
 * Ordering mirrors the `actionSchema` discriminatedUnion for
 * reviewability — keep them aligned when adding variants.
 */
const metadataByType: Record<Action['type'], ActionMetadata> = {
  // Bootstrap + joiner-flow actions
  'create-character': { broadcastOnApplied: true },
  'join-party': { broadcastOnApplied: true },
  'leave-party': { broadcastOnApplied: true },
  'delete-character': { broadcastOnApplied: true },
  'kick-player': { broadcastOnApplied: true },
  'edit-character': { broadcastOnApplied: true },
  'rename-character': { broadcastOnApplied: true },

  // Party-scope actions
  'rename-party': { broadcastOnApplied: true },
  'set-encumbrance': { broadcastOnApplied: true },
  'appoint-banker': { broadcastOnApplied: true },
  'revoke-banker': { broadcastOnApplied: true },

  // Game-session actions (RH3.1)
  'start-game-session': { broadcastOnApplied: true },
  'end-game-session': { broadcastOnApplied: true },

  // Item / stash mutation actions
  acquire: { broadcastOnApplied: true },
  consume: { broadcastOnApplied: true },
  'edit-item-instance': { broadcastOnApplied: true },
  transfer: { broadcastOnApplied: true },
  split: { broadcastOnApplied: true },
  'create-stash': { broadcastOnApplied: true },
  'rename-stash': { broadcastOnApplied: true },
  'delete-stash': { broadcastOnApplied: true },

  // Currency actions
  'currency-change': { broadcastOnApplied: true },
  'currency-transfer': { broadcastOnApplied: true },
  'dm-transfer': { broadcastOnApplied: true },
  'split-evenly': { broadcastOnApplied: true },

  // Equip / attune / charges
  equip: { broadcastOnApplied: true },
  unequip: { broadcastOnApplied: true },
  attune: { broadcastOnApplied: true },
  unattune: { broadcastOnApplied: true },
  'use-charge': { broadcastOnApplied: true },
  recharge: { broadcastOnApplied: true },
  identify: { broadcastOnApplied: true },

  // Homebrew
  'create-homebrew': { broadcastOnApplied: true },
  'edit-homebrew': { broadcastOnApplied: true },
  'delete-homebrew': { broadcastOnApplied: true },

  // System actions (not user-dispatched per party)
  'seed-catalog': { broadcastOnApplied: false },
};

/**
 * WeakMap-backed schema→metadata registry. Populated from
 * `metadataByType` at module load. Consumers that hold a variant
 * schema reference (e.g. JSON-schema generation, dev-tooling)
 * can look up metadata directly; most callers should prefer the
 * type-literal-keyed `getActionMetadata(type)` below.
 */
export const actionMetadataRegistry = z.registry<ActionMetadata>();

// Populate the Zod registry from the compile-time-exhaustive Record.
// `actionSchema.options` gives the variant schemas in the exact order
// they were declared in the discriminatedUnion; we key each variant by
// its `type` literal so the two indexes cannot drift.
for (const variant of actionSchema.options) {
  // The discriminant of `actionSchema` is `type`; every variant is a
  // `z.object({ type: z.literal(...), payload: ... })`. Zod v4 exposes
  // the literal value via `variant.shape.type.value`.
  const literal = variant.shape.type.value;
  actionMetadataRegistry.add(variant, metadataByType[literal]);
}

/**
 * Runtime lookup by `Action['type']` literal. O(1). Throws if the
 * type isn't in the registry — which the compile-time `Record`
 * exhaustiveness guarantees can never happen for a well-typed caller.
 * The throw is defence-in-depth against untyped call sites (e.g. a
 * value coming off the wire before Zod parse).
 */
export function getActionMetadata(type: Action['type']): ActionMetadata {
  const meta = metadataByType[type];
  if (meta === undefined) {
    throw new Error(`getActionMetadata: no metadata registered for action type '${type}'`);
  }
  return meta;
}
