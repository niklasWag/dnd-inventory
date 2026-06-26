/**
 * R3.4.a — the action union and AppState alias moved to `@app/rules` so
 * the server-side sync routes can validate incoming actions against the
 * same source-of-truth shape. This file is the stable internal path for
 * web-store consumers (`HomebrewForm`, `StashItemsTable`, fixtures).
 */
export type {
  Action,
  AppState,
  HomebrewDefinitionInput,
  HomebrewDefinitionPatch,
  TransactionLogEntry,
  TxType,
} from '@app/rules';
