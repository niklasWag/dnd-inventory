/**
 * R3.4.b — integration tests for GET /sync/export.
 *
 * Mirrors the gates in /sync/state (401 / 409 / 403 / 404) and adds
 * envelope-shape assertions for the happy path.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaPg } from '@prisma/adapter-pg';
import { exportEnvelopeSchema, type ExportEnvelope } from '@app/shared';

import { PrismaClient } from '../../prisma/generated/prisma/client.js';
import type { Env } from '../config/env.js';
import { sessionCookieName } from '../auth/config.js';
import { createSessionForUser } from '../auth/session.js';
import { buildServer } from '../server.js';

const TEST_DB_URL =
  process.env['DATABASE_URL_TEST'] ?? 'postgresql://dnd:dnd@localhost:5433/dnd_inv_test';

const env: Env = {
  NODE_ENV: 'test',
  PORT: 0,
  HOST: '127.0.0.1',
  LOG_LEVEL: 'silent',
  DATABASE_URL: TEST_DB_URL,
  WEB_ORIGIN: 'http://localhost:5173',
  AUTH_SECRET: 'test-secret-padding-to-meet-32-char-min-XXXXXX',
  SNAPSHOTS_ENABLED: false,
  SNAPSHOT_DIR: './snapshots',
  SNAPSHOT_RETENTION_DAYS: 30,
};

let prisma: PrismaClient;

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
});

async function seedUserWithSession(): Promise<{ userId: string; token: string }> {
  const userId = `u-${Math.random().toString(36).slice(2, 10)}`;
  await prisma.user.create({
    data: { id: userId, displayName: 'Test User', discordId: `discord-${userId}` },
  });
  const { sessionToken } = await createSessionForUser(prisma, userId);
  return { userId, token: sessionToken };
}

function cookieHeader(token: string): string {
  return `${sessionCookieName(env)}=${token}`;
}

describe('GET /sync/export — auth + envelope (R3.4.b)', () => {
  it('returns 401 without a session cookie', async () => {
    const app = await buildServer({ env, prisma });
    try {
      const res = await app.inject({ method: 'GET', url: '/sync/export?partyId=anything' });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('returns 409 when needsDisplayName is true', async () => {
    const userId = `u-${Math.random().toString(36).slice(2, 10)}`;
    await prisma.user.create({
      data: {
        id: userId,
        displayName: 'X',
        discordId: `discord-${userId}`,
        needsDisplayName: true,
      },
    });
    const { sessionToken } = await createSessionForUser(prisma, userId);
    const app = await buildServer({ env, prisma });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/sync/export?partyId=anything',
        headers: { cookie: cookieHeader(sessionToken) },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'display_name_required' });
    } finally {
      await app.close();
    }
  });

  it('returns 404 party_not_found for unknown partyId', async () => {
    const { token } = await seedUserWithSession();
    const app = await buildServer({ env, prisma });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/sync/export?partyId=no-such-party',
        headers: { cookie: cookieHeader(token) },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'party_not_found' });
    } finally {
      await app.close();
    }
  });

  it('returns an exportEnvelope-shaped JSON for a real party', async () => {
    const { token } = await seedUserWithSession();
    const app = await buildServer({ env, prisma });
    try {
      // Bootstrap a party.
      const createRes = await app.inject({
        method: 'POST',
        url: '/sync/actions',
        headers: { cookie: cookieHeader(token) },
        payload: {
          partyId: 'will-be-minted',
          actions: [
            {
              type: 'create-character',
              payload: {
                name: 'Alice',
                species: 'Human',
                size: 'medium',
                class: 'Wizard',
                level: 3,
                str: 8,
              },
            },
          ],
        },
      });
      expect(createRes.statusCode).toBe(200);

      const party = await prisma.party.findFirstOrThrow();
      const exportRes = await app.inject({
        method: 'GET',
        url: `/sync/export?partyId=${party.id}`,
        headers: { cookie: cookieHeader(token) },
      });
      expect(exportRes.statusCode).toBe(200);
      const envelope = exportEnvelopeSchema.parse(exportRes.json<ExportEnvelope>());
      expect(envelope.schemaVersion).toBe(1);
      expect(envelope.payload.appState).not.toBeNull();
      expect(envelope.payload.appState!.party.id).toBe(party.id);
      expect(envelope.payload.appState!.characters[0]!.name).toBe('Alice');
      expect(envelope.payload.log).toHaveLength(1);
      expect(envelope.payload.log[0]!.type).toBe('create-character');
    } finally {
      await app.close();
    }
  });
});
