/**
 * R3.4.b — integration test for `runSnapshotTick` (writer + retention).
 *
 * Pattern follows `sync/routes.test.ts`: real Postgres test DB +
 * `app.inject()` to seed the DB via `/sync/actions create-character`,
 * then invoke the tick directly + assert filesystem state.
 */
import { createHash } from 'node:crypto';
import { readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaPg } from '@prisma/adapter-pg';
import { newUuidV7, exportEnvelopeSchema } from '@app/shared';

import { PrismaClient } from '../../prisma/generated/prisma/client.js';
import { sessionCookieName } from '../auth/config.js';
import { createSessionForUser } from '../auth/session.js';
import type { Env } from '../config/env.js';
import { buildServer } from '../server.js';

import { runSnapshotTick } from './scheduler.js';

/**
 * RH1.2 — id-injection helpers for direct action-payload fixtures.
 * Fresh UUID v7 per call keeps the server's guard clock-skew window
 * happy and every id unique across calls.
 */
function createCharacterIds() {
  return {
    newCharacterId: newUuidV7(),
    newInventoryStashId: newUuidV7(),
    newCurrencyHoldingId: newUuidV7(),
    newUserId: newUuidV7(),
    newPartyId: newUuidV7(),
    newPartyStashId: newUuidV7(),
    newRecoveredLootStashId: newUuidV7(),
    newPartyStashCurrencyId: newUuidV7(),
    newRecoveredLootCurrencyId: newUuidV7(),
  };
}

const TEST_DB_URL =
  process.env['DATABASE_URL_TEST'] ?? 'postgresql://dnd:dnd@localhost:5434/dnd_inv_test';

const env: Env = {
  NODE_ENV: 'test',
  PORT: 0,
  HOST: '127.0.0.1',
  LOG_LEVEL: 'silent',
  DATABASE_URL: TEST_DB_URL,
  WEB_ORIGIN: 'http://localhost:5173',
  AUTH_SECRET: 'test-secret-padding-to-meet-32-char-min-XXXXXX',
  SESSION_COOKIE_INSECURE: false,
  SNAPSHOTS_ENABLED: false, // we drive the tick directly
  SNAPSHOT_DIR: './snapshots',
  SNAPSHOT_RETENTION_DAYS: 30,
  EMAIL_ATTEMPT_SWEEP_ENABLED: false,
  EMAIL_ATTEMPT_SWEEP_RETENTION_HOURS: 24,
  PENDING_LINK_SWEEP_ENABLED: false,
};

let prisma: PrismaClient;
let snapshotDir: string;

beforeAll(() => {
  const adapter = new PrismaPg({ connectionString: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "TransactionLog", "CurrencyHolding", "ItemInstance", "Stash", "Character", "PartyMembership", "Party", "EmailAuthAttempt", "VerificationToken", "Session", "Account", "User" CASCADE',
  );
  await prisma.$executeRawUnsafe(`DELETE FROM "ItemDefinition" WHERE source = 'homebrew'`);
  snapshotDir = join(tmpdir(), `r34b-tick-${Math.random().toString(36).slice(2)}`);
});

afterEach(async () => {
  await rm(snapshotDir, { recursive: true, force: true });
});

async function bootstrapParty(): Promise<{ userId: string; partyId: string }> {
  const userId = `u-${Math.random().toString(36).slice(2, 10)}`;
  await prisma.user.create({
    data: {
      id: userId,
      displayName: 'Test User',
      discordId: `discord-${userId}`,
      needsDisplayName: false,
    },
  });
  const { sessionToken } = await createSessionForUser(prisma, userId);
  const app = await buildServer({ env, prisma });
  try {
    const ids = createCharacterIds();
    const res = await app.inject({
      method: 'POST',
      url: '/sync/actions',
      headers: { cookie: `${sessionCookieName(env)}=${sessionToken}` },
      payload: {
        partyId: ids.newPartyId,
        actions: [
          {
            type: 'create-character',
            payload: {
              name: 'Thorin',
              species: 'Dwarf',
              size: 'medium',
              class: 'Fighter',
              level: 1,
              str: 16,
              ...ids,
            },
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
  } finally {
    await app.close();
  }
  const party = await prisma.party.findFirstOrThrow({ where: { ownerUserId: userId } });
  return { userId, partyId: party.id };
}

describe('runSnapshotTick (R3.4.b)', () => {
  it('writes one snapshot file + sidecar per party with verifiable SHA-256', async () => {
    const { partyId } = await bootstrapParty();

    const result = await runSnapshotTick({
      prisma,
      snapshotDir,
      retentionDays: 30,
    });

    expect(result.writeErrors).toEqual([]);
    expect(result.writes).toHaveLength(1);
    const write = result.writes[0]!;
    expect(write.partyId).toBe(partyId);

    // File exists + matches its sidecar checksum.
    const json = await readFile(write.jsonPath, 'utf8');
    const actualSha = createHash('sha256').update(json, 'utf8').digest('hex');
    expect(actualSha).toBe(write.sha256);

    const sidecar = await readFile(write.sha256Path, 'utf8');
    expect(sidecar.split(/\s+/, 1)[0]).toBe(write.sha256);

    // Content parses through the envelope schema + carries the party.
    const envelope = exportEnvelopeSchema.parse(JSON.parse(json));
    expect(envelope.schemaVersion).toBe(1);
    expect(envelope.payload.appState).not.toBeNull();
    expect(envelope.payload.appState!.party.id).toBe(partyId);
    expect(envelope.payload.appState!.characters[0]!.name).toBe('Thorin');
  });

  it('iterates every party (writes N files for N parties)', async () => {
    await bootstrapParty();
    await bootstrapParty();
    await bootstrapParty();

    const result = await runSnapshotTick({
      prisma,
      snapshotDir,
      retentionDays: 30,
    });
    expect(result.writes).toHaveLength(3);
    expect(result.writeErrors).toEqual([]);
  });

  it('no parties → no writes, no errors', async () => {
    const result = await runSnapshotTick({
      prisma,
      snapshotDir,
      retentionDays: 30,
    });
    expect(result.writes).toEqual([]);
    expect(result.writeErrors).toEqual([]);
    // The snapshot dir was never created (no writes), and the retention
    // sweeper short-circuits on ENOENT.
    expect(result.retention.deleted).toEqual([]);
    expect(result.retention.errors).toEqual([]);
  });

  it('groups snapshots into per-party subdirectories', async () => {
    const { partyId } = await bootstrapParty();
    const result = await runSnapshotTick({ prisma, snapshotDir, retentionDays: 30 });

    const partyDir = join(snapshotDir, partyId);
    await expect(stat(partyDir)).resolves.toBeDefined();
    expect(result.writes[0]!.jsonPath.startsWith(partyDir)).toBe(true);
  });
});
