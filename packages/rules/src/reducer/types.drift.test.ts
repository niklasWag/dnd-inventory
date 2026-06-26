import { describe, it } from 'vitest';
import type { Action as SchemaAction } from '@app/shared';

import type { Action as ReducerAction } from './types';

/**
 * R3.4.a — drift catcher between the reducer's TS source-of-truth
 * `Action` discriminator set and the Zod schema's discriminator set.
 *
 * The reducer's TS type uses `field?: string` (absent OR string) for
 * most optionals; Zod's `z.string().optional()` infers `field?: string | undefined`.
 * Under `exactOptionalPropertyTypes: true` those are NOT structurally
 * identical, so a naive equality check would always fail. The set of
 * `type` discriminators IS the load-bearing invariant: if the schema
 * accepts a `type` value the reducer can't switch on (or vice versa),
 * the sync route silently drops or rejects work.
 *
 * The two `AssertEqual` constants below evaluate to `true` iff the
 * discriminator sets are structurally identical. A new variant added
 * to one but not the other becomes a compile error here — long before
 * the runtime check could surface it.
 *
 * No runtime assertions; the compile-time check IS the test.
 */
type AssertEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

type SchemaTypes = SchemaAction['type'];
type ReducerTypes = ReducerAction['type'];

const _schemaCoversReducer: AssertEqual<SchemaTypes, ReducerTypes> = true;
const _reducerCoversSchema: AssertEqual<ReducerTypes, SchemaTypes> = true;
void _schemaCoversReducer;
void _reducerCoversSchema;

describe('Action discriminator drift (Zod schema ↔ reducer TS type)', () => {
  it('compiles iff @app/shared and @app/rules expose the same set of action `type` discriminators', () => {
    // Compile-time only; the AssertEqual constants above are the test.
  });
});
