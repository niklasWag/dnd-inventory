/**
 * @app/rules — pure, deterministic rule modules (OUTLINE §6).
 *
 * MVP M0 ships type-signature-only stubs for capacity, attunement, charges,
 * weight, hoard, validation, pricing, and search. They throw at runtime so
 * accidental calls fail loudly. Implementations land per the post-MVP release
 * milestones tracked in docs/roadmap.md.
 *
 * currency.ts (MVP §8) ships its real implementation in MVP M4.
 * inventory.ts (MVP §8) ships in MVP M5.
 */

export * as capacity from './capacity';
export * as attunement from './attunement';
export * as charges from './charges';
export * as weight from './weight';
export * as hoard from './hoard';
export * as validation from './validation';
export * as pricing from './pricing';
// R6.5 — the search module exports its ranker at the top level as
// `searchCatalog` (not as a `search.*` namespace). Namespace-only
// re-exports of a generic function widen `T` to the constraint at the
// call site, erasing the caller's item type. The direct export keeps
// generic inference intact for `ItemDefinition` and future callers.
export { search as searchCatalog } from './search';
export type { Searchable, SearchResult } from './search';
export * as currency from './currency';
export * as inventory from './inventory';

// R3.4.a — reducer + action types moved out of apps/web/src/store/ so the
// server-side sync routes (apps/server/src/sync/) can import the same
// authoritative implementation. Web's existing import paths
// (apps/web/src/store/reducer, apps/web/src/store/types) are preserved
// via thin re-exports.
export { reduce, generateInviteCode } from './reducer';
export type { ReducerContext, ReducerResult, LogEntrySlice } from './reducer';
export type {
  Action,
  AppState,
  HomebrewDefinitionInput,
  HomebrewDefinitionPatch,
  TransactionLogEntry,
  TxType,
} from './reducer/types';
