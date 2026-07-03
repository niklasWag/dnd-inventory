import { describe, expect, it } from 'vitest';

import { actionSchema, type Action } from './action';
import { actionMetadataRegistry, getActionMetadata } from './actionMetadata';

/**
 * RH2.4 — guardrails for the schema-metadata registry.
 *
 * Two independent guards:
 *
 *   (a) **Runtime exhaustiveness.** Iterate `actionSchema.options` and
 *       assert every variant has a registered metadata entry. This
 *       catches "action variant added to the discriminatedUnion but
 *       forgotten in `metadataByType`" — the Record's compile-time
 *       exhaustiveness catches the common case, but this test defends
 *       against an unusual case where a variant is added but the module
 *       load reordering / import cycle prevents the compile-time check
 *       from firing.
 *
 *   (b) **Compile-time type drift.** Mirrors the pattern in
 *       `packages/rules/src/reducer/types.drift.test.ts`. Asserts the
 *       set of keys in `metadataByType` is structurally identical to
 *       `Action['type']`. If the two diverge, the file fails to
 *       compile — long before any runtime iteration.
 *
 * Together (a) and (b) make forgetting a metadata entry for a new
 * action variant impossible to ship.
 */

// ---- (b) Compile-time type drift ------------------------------------

type AssertEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type RegisteredActionTypes = Parameters<typeof getActionMetadata>[0];
type SchemaActionTypes = Action['type'];

const _registeredCoversSchema: AssertEqual<RegisteredActionTypes, SchemaActionTypes> = true;
const _schemaCoversRegistered: AssertEqual<SchemaActionTypes, RegisteredActionTypes> = true;
void _registeredCoversSchema;
void _schemaCoversRegistered;

// ---- (a) Runtime exhaustiveness -------------------------------------

describe('RH2.4 — actionMetadata registry', () => {
  it('has metadata for every actionSchema discriminatedUnion option', () => {
    const missing: string[] = [];
    for (const variant of actionSchema.options) {
      const literal = variant.shape.type.value;
      if (actionMetadataRegistry.get(variant) === undefined) {
        missing.push(String(literal));
      }
    }
    expect(missing, `missing metadata for action types: ${missing.join(', ')}`).toEqual([]);
  });

  it('getActionMetadata returns the same object as the WeakMap-backed registry lookup', () => {
    // The two indexes (the Record and the z.registry) are populated in
    // lockstep at module load. This test asserts they stay in agreement
    // for every variant — a discrepancy would indicate the population
    // loop dropped a variant or double-registered one.
    for (const variant of actionSchema.options) {
      const literal = variant.shape.type.value;
      const viaTypeLookup = getActionMetadata(literal);
      const viaRegistry = actionMetadataRegistry.get(variant);
      expect(viaRegistry).toEqual(viaTypeLookup);
    }
  });

  it('seed-catalog is broadcastOnApplied=false (server-boot-only)', () => {
    // The one explicit non-broadcast variant. Serves as a smoke test
    // that non-default metadata values propagate correctly through
    // the registry.
    expect(getActionMetadata('seed-catalog').broadcastOnApplied).toBe(false);
  });

  it('user-dispatched variants default to broadcastOnApplied=true', () => {
    // Spot-check a few representative variants across categories.
    // If a future maintainer flips one of these to false the change
    // will surface in code review here rather than as a mysterious
    // R5.1 broadcast gap.
    expect(getActionMetadata('acquire').broadcastOnApplied).toBe(true);
    expect(getActionMetadata('transfer').broadcastOnApplied).toBe(true);
    expect(getActionMetadata('create-character').broadcastOnApplied).toBe(true);
    expect(getActionMetadata('delete-stash').broadcastOnApplied).toBe(true);
  });
});
