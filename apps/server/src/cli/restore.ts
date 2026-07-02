#!/usr/bin/env node
/**
 * R3.4.b — snapshot restore CLI.
 *
 *   pnpm --filter @app/server restore <path-to-snapshot.json>
 *
 * Reads the snapshot file, verifies its SHA-256 against the sidecar
 * `<file>.sha256`, parses through `exportEnvelopeSchema`, and writes
 * the resulting AppState rows into the database. Existing party rows
 * are wiped first (Party + Character + Stash + ItemInstance +
 * CurrencyHolding + TransactionLog + PartyMembership for that
 * partyId; homebrew ItemDefinitions scoped to the party).
 *
 * Operator-only — NOT exposed over HTTP. SECURITY §8: snapshots are
 * opt-in restored. The checksum verification is HARD — a mismatch
 * exits non-zero without touching the DB.
 *
 * Usage with a non-default DATABASE_URL: the script reads the same
 * `dotenv` boot path as the server (via `loadEnv`), so set DB env vars
 * in the environment or `.env` before invoking.
 */
import 'dotenv/config';

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { PrismaPg } from '@prisma/adapter-pg';

import { exportEnvelopeSchema, type ExportEnvelope } from '@app/shared';

import { PrismaClient } from '../../prisma/generated/prisma/client.js';
import { loadEnv } from '../config/env.js';
import { toDbActorRole, toDbMembershipRole, toDbStashScope } from '../db/mappers.js';

interface CliOpts {
  snapshotPath: string;
}

function parseArgv(argv: string[]): CliOpts {
  const args = argv.slice(2);
  if (args.length !== 1) {
    throw new Error('Usage: restore <path-to-snapshot.json>');
  }
  return { snapshotPath: args[0]! };
}

async function readEnvelope(path: string): Promise<ExportEnvelope> {
  const json = await readFile(path, 'utf8');
  const actual = createHash('sha256').update(json, 'utf8').digest('hex');

  const sidecarPath = `${path}.sha256`;
  const sidecar = await readFile(sidecarPath, 'utf8');
  // sha256sum format: `<digest>  <filename>` (two spaces). Extract the
  // digest with a tolerant regex (whitespace) so hand-edited files
  // don't trip on tab/space confusion.
  const expected = sidecar.split(/\s+/, 1)[0];
  if (expected === undefined || expected.length === 0) {
    throw new Error(`restore: sidecar ${sidecarPath} contains no digest`);
  }
  if (expected !== actual) {
    throw new Error(
      `restore: SHA-256 mismatch.\n  expected (sidecar): ${expected}\n  actual   (file):    ${actual}`,
    );
  }

  const envelope: unknown = JSON.parse(json);
  return exportEnvelopeSchema.parse(envelope);
}

async function applyRestore(prisma: PrismaClient, envelope: ExportEnvelope): Promise<void> {
  const { appState } = envelope.payload;
  if (appState === null) {
    throw new Error('restore: envelope contains a null appState (pre-character-creation snapshot)');
  }
  const partyId = appState.party.id;

  await prisma.$transaction(
    async (tx) => {
      // Wipe everything scoped to this party. FK cascades handle
      // Stash → ItemInstance / CurrencyHolding via onDelete: Cascade
      // from the init migration. PartyMembership cascades from Party.
      // TransactionLog cascades from Party.
      //
      // The DEFERRABLE FK on Character.inventoryStashId means we can
      // delete Character + Stash in either order inside a single
      // transaction.
      await tx.itemDefinition.deleteMany({ where: { partyId, source: 'homebrew' } });
      await tx.party.deleteMany({ where: { id: partyId } });

      // Order matters going IN (matches applyBootstrapDelta):
      //   Party → Character (FK to Stash deferred) → Stash → memberships → currency → items → log.
      await tx.party.create({
        data: {
          id: appState.party.id,
          name: appState.party.name,
          ownerUserId: appState.party.ownerUserId,
          inviteCode: appState.party.inviteCode,
          recoveredLootStashId: appState.party.recoveredLootStashId,
          bankerUserId: appState.party.bankerUserId,
          createdAt: new Date(appState.party.createdAt),
        },
      });

      // Restore homebrew catalog rows scoped to this party.
      const homebrewRows = appState.catalog.filter((d) => d.source === 'homebrew');
      for (const def of homebrewRows) {
        await tx.itemDefinition.create({
          data: {
            id: def.id,
            name: def.name,
            source: def.source,
            category: def.category,
            tags: def.tags ?? [],
            ...(def.weight !== undefined ? { weight: def.weight } : {}),
            ...(def.flatWeight !== undefined ? { flatWeight: def.flatWeight } : {}),
            ...(def.cost !== undefined
              ? { costAmount: def.cost.amount, costCurrency: def.cost.currency }
              : {}),
            ...(def.description !== undefined ? { description: def.description } : {}),
            ...(def.duplicatedFromId !== undefined
              ? { duplicatedFromId: def.duplicatedFromId }
              : {}),
            ...(def.createdBy !== undefined ? { createdBy: def.createdBy } : {}),
            ...(def.partyId !== undefined ? { partyId: def.partyId } : {}),
          },
        });
      }

      for (const ch of appState.characters) {
        await tx.character.create({
          data: {
            id: ch.id,
            partyId: ch.partyId,
            ownerUserId: ch.ownerUserId,
            name: ch.name,
            species: ch.species,
            size: ch.size,
            class: ch.class,
            level: ch.level,
            strScore: ch.abilityScores.STR,
            maxAttunement: ch.maxAttunement,
            encumbranceRule: ch.encumbranceRule,
            enforceEncumbrance: ch.enforceEncumbrance,
            inventoryStashId: ch.inventoryStashId,
          },
        });
      }

      await tx.stash.createMany({
        data: appState.stashes.map((s) => ({
          id: s.id,
          name: s.name,
          isCarried: s.isCarried,
          createdAt: new Date(s.createdAt),
          scope: toDbStashScope(s.scope),
          ownerCharacterId: s.ownerCharacterId,
          partyId: s.partyId,
        })),
      });

      await tx.partyMembership.createMany({
        data: appState.memberships.map((m) => ({
          userId: m.userId,
          partyId: m.partyId,
          role: toDbMembershipRole(m.role),
          characterId: m.characterId,
          joinedAt: new Date(m.joinedAt),
          leftAt: m.leftAt === null ? null : new Date(m.leftAt),
        })),
      });

      await tx.currencyHolding.createMany({
        data: appState.currencies.map((c) => ({
          id: c.id,
          stashId: c.stashId,
          cp: c.cp,
          sp: c.sp,
          ep: c.ep,
          gp: c.gp,
          pp: c.pp,
        })),
      });

      for (const item of appState.items) {
        await tx.itemInstance.create({
          data: {
            id: item.id,
            definitionId: item.definitionId,
            ownerType: item.ownerType,
            ownerId: item.ownerId,
            containerInstanceId: item.containerInstanceId,
            quantity: item.quantity,
            equipped: item.equipped,
            attuned: item.attuned,
            identified: item.identified,
            ...(item.hint !== undefined ? { hint: item.hint } : {}),
            currentCharges: item.currentCharges,
            ...(item.customName !== undefined ? { customName: item.customName } : {}),
            ...(item.notes !== undefined ? { notes: item.notes } : {}),
          },
        });
      }

      for (const entry of appState.log) {
        await tx.transactionLog.create({
          data: {
            id: entry.id,
            partyId: entry.partyId,
            sessionId: entry.sessionId,
            timestamp: new Date(entry.timestamp),
            actorUserId: entry.actorUserId,
            actorRole: toDbActorRole(entry.actorRole),
            type: entry.type,
            payload: entry.payload,
          },
        });
      }
    },
    { timeout: 60_000 },
  );
}

async function main(): Promise<void> {
  const opts = parseArgv(process.argv);
  const env = loadEnv();
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    const envelope = await readEnvelope(opts.snapshotPath);
    // eslint-disable-next-line no-console
    console.log(
      `restore: verified ${opts.snapshotPath} (party=${envelope.payload.appState?.party.id ?? 'null'}, exportedAt=${envelope.exportedAt})`,
    );
    await applyRestore(prisma, envelope);
    // eslint-disable-next-line no-console
    console.log(`restore: applied ${opts.snapshotPath}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
