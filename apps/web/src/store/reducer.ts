/**
 * R3.4.a — the reducer + its `ReducerContext` injection seam moved to
 * `@app/rules` so the server-side sync routes can import the same
 * authoritative implementation. This file is the stable internal path
 * for the web store's middleware (`./index.ts`).
 *
 * Non-pure helpers used as the web's `ReducerContext` defaults live
 * here too (web injects `crypto.randomUUID` / `new Date().toISOString`
 * via the `webReducerCtx` constant in `./index.ts`).
 */
export {
  reduce,
  generateInviteCode,
  type LogEntrySlice,
  type ReducerContext,
  type ReducerResult,
} from '@app/rules';
