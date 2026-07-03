/**
 * R3.4.a — `GET /sync/state?partyId=...` state assembler.
 *
 * Reads every row needed to materialize the user's AppState for the
 * requested party and returns the Zod-validated `AppState` shape. All
 * queries run against the same Prisma client / transaction client so
 * the read is a consistent snapshot.
 *
 * Eight queries (in parallel where independent):
 *   - User                (the actor row)
 *   - Party               (the party row)
 *   - PartyMembership[]   (all active members of the party)
 *   - Character[]         (characters in the party)
 *   - Stash[]             (character-scope stashes whose owner is in the
 *                          party + party-scope + recovered-loot for the
 *                          party)
 *   - ItemDefinition[]    (PHB+DMG catalog + homebrew scoped to this party)
 *   - ItemInstance[]      (items in any stash in the party)
 *   - CurrencyHolding[]   (currency rows for stashes in the party)
 *   - TransactionLog[]    (audit trail for the party)
 *
 * The assembled object is parsed through `appStateSchema` per CLAUDE.md
 * "trust at the boundary" — any drift between the DB shape and the Zod
 * schema surfaces as a parse error here rather than downstream.
 *
 * Throws `StateLoaderError` if the user has no membership in the party
 * (the route handler converts that into a 403); throws a plain Error if
 * the underlying Prisma queries fail.
 */
import type { AppState } from '@app/shared';
import { appStateSchema } from '@app/shared';

import type { Prisma, PrismaClient } from '../../prisma/generated/prisma/client.js';
import {
  fromPrismaCharacter,
  fromPrismaCurrencyHolding,
  fromPrismaGameSession,
  fromPrismaItemDefinition,
  fromPrismaItemInstance,
  fromPrismaParty,
  fromPrismaPartyMembership,
  fromPrismaStash,
  fromPrismaTransactionLog,
} from '../db/mappers.js';

export class StateLoaderError extends Error {
  constructor(public code: 'party_not_found' | 'user_not_found' | 'not_a_member') {
    super(code);
  }
}

type Tx = PrismaClient | Prisma.TransactionClient;

export async function loadAppStateForUser(
  tx: Tx,
  userId: string,
  partyId: string,
): Promise<AppState> {
  // First confirm the user exists + has an active membership in the
  // party. Cheap query and the failure case is the common one for
  // unauthorized requests, so we short-circuit before assembling.
  const [userRow, partyRow, membershipRows] = await Promise.all([
    tx.user.findUnique({ where: { id: userId } }),
    tx.party.findUnique({ where: { id: partyId } }),
    tx.partyMembership.findMany({ where: { partyId, leftAt: null } }),
  ]);

  if (userRow === null) throw new StateLoaderError('user_not_found');
  if (partyRow === null) throw new StateLoaderError('party_not_found');
  if (!membershipRows.some((m) => m.userId === userId)) {
    throw new StateLoaderError('not_a_member');
  }

  return assembleAppState(tx, userRow, partyRow, membershipRows);
}

/**
 * R3.4.b — admin-scoped state loader for the nightly snapshot job. Skips
 * the per-user membership check; anchors the AppState's `user` field to
 * the party's owner row. Tested in `snapshots/writer.test.ts`.
 *
 * Throws `StateLoaderError('party_not_found')` for unknown partyIds
 * and `StateLoaderError('user_not_found')` if the party's owner row
 * has been deleted (which would be a referential-integrity failure
 * since `Party.ownerUserId` is a FK — the catch is defensive).
 */
export async function loadAppStateForParty(tx: Tx, partyId: string): Promise<AppState> {
  const partyRow = await tx.party.findUnique({ where: { id: partyId } });
  if (partyRow === null) throw new StateLoaderError('party_not_found');

  const [ownerRow, membershipRows] = await Promise.all([
    tx.user.findUnique({ where: { id: partyRow.ownerUserId } }),
    tx.partyMembership.findMany({ where: { partyId, leftAt: null } }),
  ]);
  if (ownerRow === null) throw new StateLoaderError('user_not_found');

  return assembleAppState(tx, ownerRow, partyRow, membershipRows);
}

interface UserRowSubset {
  id: string;
  displayName: string;
  createdAt: Date;
  discordId: string | null;
  email: string | null;
  emailVerified: Date | null;
  avatarUrl: string | null;
  needsDisplayName: boolean;
}

interface PartyRowSubset {
  id: string;
  ownerUserId: string;
}

interface MembershipRowSubset {
  userId: string;
  partyId: string;
}

/**
 * Internal assembler shared by `loadAppStateForUser` (per-user pull) and
 * `loadAppStateForParty` (admin snapshot reader). Both surfaces fan out
 * the same 8 reads and pass the resulting rows through the same Zod
 * boundary validator; only the entry-condition checks differ.
 */
async function assembleAppState(
  tx: Tx,
  userRow: UserRowSubset,
  partyRow: PartyRowSubset & Parameters<typeof fromPrismaParty>[0],
  membershipRows: (MembershipRowSubset & Parameters<typeof fromPrismaPartyMembership>[0])[],
): Promise<AppState> {
  const partyId = partyRow.id;

  // Find character ids in the party so we can scope stash + item reads.
  const characterRows = await tx.character.findMany({ where: { partyId } });
  const characterIds = characterRows.map((c) => c.id);

  // Stashes scoped to the party (character-owned + party-owned +
  // recovered-loot scope all tagged with partyId via the M3 / R3.1
  // schema invariants).
  const stashRows = await tx.stash.findMany({
    where: {
      OR: [{ partyId }, { ownerCharacterId: { in: characterIds } }],
    },
  });
  const stashIds = stashRows.map((s) => s.id);

  // The remaining four reads can fan out in parallel.
  const [itemDefRows, itemInstanceRows, currencyRows, txLogRows, gameSessionRows] =
    await Promise.all([
      // Catalog: PHB + DMG (system rows) + homebrew scoped to this party.
      tx.itemDefinition.findMany({
        where: {
          OR: [{ source: { in: ['PHB', 'DMG'] } }, { partyId }],
        },
      }),
      tx.itemInstance.findMany({ where: { ownerId: { in: stashIds } } }),
      tx.currencyHolding.findMany({ where: { stashId: { in: stashIds } } }),
      tx.transactionLog.findMany({
        where: { partyId },
        orderBy: { timestamp: 'asc' },
      }),
      // RH3.1 — GameSession rows scoped to this party, ordered by number
      // for deterministic hydration (a fresh session picker in R5.2 will
      // want the sequence to match the log's per-session tagging).
      tx.gameSession.findMany({
        where: { partyId },
        orderBy: { number: 'asc' },
      }),
    ]);

  // Translate user row through the existing auth-shape mapper used by
  // the Auth.js routes — keeps a single source of truth for the user
  // shape across auth + sync surfaces. The `discordId` is intentionally
  // synthesized to satisfy the userSchema refine() invariant per
  // SECURITY §1.2 / OUTLINE §4 (at least one of discordId or
  // emailVerified must be present).
  const seedVersionRow = await tx.metadata.findUnique({ where: { key: 'seedVersion' } });
  const seedVersion =
    typeof seedVersionRow?.value === 'number' && Number.isInteger(seedVersionRow.value)
      ? seedVersionRow.value
      : 0;

  const state: AppState = appStateSchema.parse({
    version: 1,
    seedVersion,
    user: {
      id: userRow.id,
      displayName: userRow.displayName,
      createdAt: userRow.createdAt.toISOString(),
      // R3.2 / R3.3 — optional fields surface only when present so the
      // userSchema's exactOptionalPropertyTypes-tight optionals stay
      // clean. The `.refine` requires at least one of discordId or
      // emailVerified — checked at the schema layer.
      ...(userRow.discordId !== null ? { discordId: userRow.discordId } : {}),
      ...(userRow.email !== null ? { email: userRow.email } : {}),
      ...(userRow.emailVerified !== null
        ? { emailVerified: userRow.emailVerified.toISOString() }
        : {}),
      ...(userRow.avatarUrl !== null ? { avatarUrl: userRow.avatarUrl } : {}),
      ...(userRow.needsDisplayName ? { needsDisplayName: true } : {}),
    },
    party: fromPrismaParty(partyRow),
    memberships: membershipRows.map(fromPrismaPartyMembership),
    characters: characterRows.map(fromPrismaCharacter),
    gameSessions: gameSessionRows.map(fromPrismaGameSession),
    stashes: stashRows.map(fromPrismaStash),
    catalog: itemDefRows.map(fromPrismaItemDefinition),
    items: itemInstanceRows.map(fromPrismaItemInstance),
    currencies: currencyRows.map(fromPrismaCurrencyHolding),
    log: txLogRows.map(fromPrismaTransactionLog),
  });

  return state;
}
