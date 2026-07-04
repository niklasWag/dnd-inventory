import Dexie, { type Table } from 'dexie';

import type { Action } from '@/store/types';

/**
 * The Dexie database for the D&D Inventory Manager.
 *
 * Per `docs/TECH_STACK.md` §2.4 the schema is one object store per `AppState`
 * entity. In M0 only the `meta` store is exercised — it holds the single
 * `AppState` envelope under the key `appState`. Entity-level stores are
 * declared up-front so M1+ can switch from "blob in meta" to "per-entity
 * indexed rows" via a Dexie `version().stores()` bump rather than a rewrite.
 *
 * Migration strategy: each schema change is an explicit `version().stores()`
 * call. Never edit an existing version's store definition — add a new one.
 */
export interface MetaRow {
  /** Always the literal string `appState` for the envelope row in M0. */
  key: string;
  /** The persisted AppState blob. Typed `unknown` until M1 introduces the Zod schema. */
  value: unknown;
}

/**
 * R5.1.c — Persisted outbox row.
 *
 * A batch of actions that failed to reach `POST /sync/actions` (network
 * error, server outage, etc.) is persisted here so a tab close doesn't
 * lose optimistic work. The queue drains rows on next successful connect
 * (`socket.on('connect')` → `drainOutbox()`) and removes them on 200
 * success or 422 rejection. See `apps/web/src/sync/outbox.ts`.
 */
export interface OutboxRow {
  /** Dexie auto-incrementing local id. Undefined before insert. */
  id?: number;
  /** Party the batch targets — every action in the row shares this. */
  partyId: string;
  /** The batch's action payload, exactly as it would be POSTed. */
  actions: Action[];
  /** ISO timestamp of first enqueue. Used for FIFO drain ordering. */
  createdAt: string;
  /** ISO timestamp of the last retry attempt, if any. */
  lastAttemptAt?: string;
  /** Number of times this row has been dispatched (0 = never yet). */
  attemptCount: number;
}

export class DndInvDb extends Dexie {
  meta!: Table<MetaRow, string>;
  outbox!: Table<OutboxRow, number>;

  constructor() {
    super('dnd-inv');
    // v1: single meta blob (M0). Entity stores declared but unused in M0;
    // they reserve names so M1+ migrations don't need to rename anything.
    this.version(1).stores({
      meta: 'key',
      users: 'id',
      parties: 'id',
      memberships: '[userId+partyId+role]',
      characters: 'id, partyId, ownerUserId',
      stashes: 'id, scope, ownerCharacterId, partyId',
      items: 'id, ownerId, definitionId',
      currencies: 'id, stashId',
      catalog: 'id, source, category',
      log: 'id, partyId, timestamp',
    });
    // v2: R5.1.c — add the `outbox` table for persisted retry batches.
    // Purely additive (Dexie handles this without a data migration).
    // Indexed by `partyId + createdAt` so `drainOutbox()` can query
    // "every row for the current party in FIFO order" cheaply.
    this.version(2).stores({
      meta: 'key',
      users: 'id',
      parties: 'id',
      memberships: '[userId+partyId+role]',
      characters: 'id, partyId, ownerUserId',
      stashes: 'id, scope, ownerCharacterId, partyId',
      items: 'id, ownerId, definitionId',
      currencies: 'id, stashId',
      catalog: 'id, source, category',
      log: 'id, partyId, timestamp',
      outbox: '++id, partyId, createdAt',
    });
  }
}

export const db = new DndInvDb();
