import {
  transactionLogEntrySchema,
  type ItemDefinition,
  type TransactionLogEntry,
} from '@app/shared';
import { PHB_SEED_VERSION, loadPhbSeed } from '@app/seeds';

import { useStore } from '@/store';

/**
 * Shared test fixtures for the M3 milestone forward.
 *
 * Until M3 these helpers lived inline in four separate test files
 * (`reducer.test.ts`, `CharacterSheet.test.tsx`, `ItemDetail.test.tsx`,
 * `ItemHistory.test.tsx`). The M2.5 Notes flagged the duplication as an
 * M3 chore and M3 itself adds a 5th consumer (`StorageDetail.test.tsx`)
 * so extracting now keeps the diff tight.
 *
 * Conventions:
 *
 * - These helpers MUTATE the live store via `useStore.getState().dispatch(...)`.
 *   Tests still own their own `beforeEach(() => { useStore.setState({ appState: null, log: [] }); await wipeAll(); })`
 *   so each test starts from a clean slate.
 *
 * - The canonical `bootstrap()` shape returns every id a test might want.
 *   Callers destructure what they need — narrow return types add friction
 *   when test authors want to assert against a different id.
 */

export const VALID_CREATE_CHARACTER_PAYLOAD = {
  name: 'Thorin',
  species: 'Dwarf',
  class: 'Fighter',
  level: 3,
  str: 16,
} as const;

export interface CreateCharacterPayload {
  name: string;
  species: string;
  class: string;
  level: number;
  str: number;
}

export interface BootstrapResult {
  characterId: string;
  inventoryStashId: string;
  partyStashId: string;
  recoveredLootStashId: string;
  catalog: ItemDefinition[];
}

/**
 * Bring the store to the post-M2-bootstrap baseline — a fresh character
 * plus a seeded catalog. Every M2+ test starts here so each suite focuses
 * on its own action rather than the create-character setup.
 */
export function bootstrap(payload: CreateCharacterPayload = VALID_CREATE_CHARACTER_PAYLOAD): BootstrapResult {
  const { dispatch } = useStore.getState();
  dispatch({ type: 'create-character', payload });
  dispatch({
    type: 'seed-catalog',
    payload: { seedVersion: PHB_SEED_VERSION, entries: loadPhbSeed() },
  });
  const s = useStore.getState().appState;
  if (s === null) throw new Error('bootstrap: appState should be populated');
  return {
    characterId: s.characters[0]!.id,
    inventoryStashId: s.characters[0]!.inventoryStashId,
    partyStashId: s.stashes.find((st) => st.scope === 'party')!.id,
    recoveredLootStashId: s.party.recoveredLootStashId,
    catalog: s.catalog,
  };
}

export interface BootstrapWithItemResult extends BootstrapResult {
  itemInstanceId: string;
  torchDefId: string;
}

/**
 * Bootstrap the store with a Torch row in inventory. Returns the row id
 * + every stash id so each item-focused test starts from a clean baseline.
 *
 * `initial` lets the caller seed `customName` and/or `notes` on the row:
 * `notes` is acquire-supported; `customName` is patched directly into
 * state because `acquire` doesn't take it.
 */
export function bootstrapWithItem(
  initial: { customName?: string; notes?: string } = {},
): BootstrapWithItemResult {
  const base = bootstrap();
  const torch = base.catalog.find((d) => d.id === 'phb-2024:torch');
  if (torch === undefined) throw new Error('bootstrapWithItem: torch not found in catalog');

  useStore.getState().dispatch({
    type: 'acquire',
    payload: {
      stashId: base.inventoryStashId,
      definitionId: torch.id,
      quantity: 1,
      source: 'catalog-add',
      ...(initial.notes !== undefined ? { notes: initial.notes } : {}),
    },
  });

  // customName isn't an acquire field — patch it directly into state for
  // tests that need a pre-existing customName baseline.
  if (initial.customName !== undefined) {
    useStore.setState((s) => {
      if (s.appState === null) return s;
      return {
        ...s,
        appState: {
          ...s.appState,
          items: s.appState.items.map((i) => ({ ...i, customName: initial.customName })),
        },
      };
    });
  }

  const row = useStore.getState().appState!.items[0]!;
  return { ...base, itemInstanceId: row.id, torchDefId: torch.id };
}

/**
 * Build a minimal valid log entry with sensible fixture defaults.
 *
 * The candidate is constructed as `unknown` and parsed through
 * `transactionLogEntrySchema` so the returned value is provably a real
 * `TransactionLogEntry`. This keeps the helper inside the CLAUDE.md
 * "no `any`, validate at boundaries" rule.
 */
export function makeEntry<T extends TransactionLogEntry['type']>(
  type: T,
  payload: Extract<TransactionLogEntry, { type: T }>['payload'],
  overrides: Partial<Pick<TransactionLogEntry, 'id' | 'timestamp' | 'actorRole'>> = {},
): TransactionLogEntry {
  const candidate: unknown = {
    id: overrides.id ?? crypto.randomUUID(),
    partyId: 'party-fixture',
    sessionId: null,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    actorUserId: 'user-fixture',
    actorRole: overrides.actorRole ?? 'player',
    type,
    payload,
  };
  return transactionLogEntrySchema.parse(candidate);
}
