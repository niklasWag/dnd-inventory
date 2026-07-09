/**
 * R8.2 — DB + filesystem integration tests for GET /admin/health.
 *
 * Session-authenticated per-user scope: caller sees only active
 * memberships on non-archived parties. Snapshot age is derived from
 * mtimes of `.json` files under `<SNAPSHOT_DIR>/<partyId>/`.
 */
import { mkdir, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../prisma/generated/prisma/client.js';
import { sessionCookieName } from '../auth/config.js';
import { createSessionForUser } from '../auth/session.js';
import type { Env } from '../config/env.js';
import { buildServer } from '../server.js';

import type { AdminHealthBody } from './admin-health.js';

const TEST_DB_URL =
  process.env['DATABASE_URL_TEST'] ?? 'postgresql://dnd:dnd@localhost:5434/dnd_inv_test';

let prisma: PrismaClient;
let snapshotDir: string;

function envFor(dir: string): Env {
  return {
    NODE_ENV: 'test',
    PORT: 0,
    HOST: '127.0.0.1',
    LOG_LEVEL: 'silent',
    DATABASE_URL: TEST_DB_URL,
    WEB_ORIGIN: 'http://localhost:5173',
    AUTH_SECRET: 'test-secret-padding-to-meet-32-char-min-XXXXXX',
    SESSION_COOKIE_INSECURE: false,
    SNAPSHOTS_ENABLED: false,
    SNAPSHOT_DIR: dir,
    SNAPSHOT_RETENTION_DAYS: 30,
    EMAIL_ATTEMPT_SWEEP_ENABLED: false,
    EMAIL_ATTEMPT_SWEEP_RETENTION_HOURS: 24,
    PENDING_LINK_SWEEP_ENABLED: false,
    E2E_TEST_MODE: false,
  };
}

beforeAll(() => {
  const adapter = new PrismaPg({ connectionString: TEST_DB_URL });
  prisma = new PrismaClient({ adapter });
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "TransactionLog", "CurrencyHolding", "ItemInstance", "Stash", "Character", "PartyMembership", "Party", "Session", "Account", "User" CASCADE',
  );
  snapshotDir = join(tmpdir(), `r82-admin-${Math.random().toString(36).slice(2)}`);
});

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await rm(snapshotDir, { recursive: true, force: true });
});

async function seedUser(id: string): Promise<{ userId: string; token: string }> {
  await prisma.user.create({
    data: {
      id,
      displayName: `User ${id}`,
      discordId: `discord-${id}`,
      needsDisplayName: false,
    },
  });
  const { sessionToken } = await createSessionForUser(prisma, id);
  return { userId: id, token: sessionToken };
}

async function seedParty(opts: {
  partyId: string;
  ownerUserId: string;
  archivedAt?: Date | null;
}): Promise<void> {
  await prisma.party.create({
    data: {
      id: opts.partyId,
      name: `Party ${opts.partyId}`,
      ownerUserId: opts.ownerUserId,
      inviteCode: `invite-${opts.partyId}`,
      recoveredLootStashId: `stash-recovered-${opts.partyId}`,
      encumbranceRule: 'off',
      enforceEncumbrance: false,
      archivedAt: opts.archivedAt ?? null,
      priceModifier: 1.0,
      baseCurrency: 'gp',
    },
  });
  await prisma.partyMembership.create({
    data: {
      userId: opts.ownerUserId,
      partyId: opts.partyId,
      role: 'dm',
      characterId: null,
    },
  });
}

async function writeSnapshotFile(partyId: string, mtime: Date): Promise<void> {
  const dir = join(snapshotDir, partyId);
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${mtime.toISOString().replace(/:/g, '-')}.json`);
  await writeFile(file, '{}', 'utf8');
  await utimes(file, mtime, mtime);
}

describe('GET /admin/health (R8.2)', () => {
  it('returns 401 without a session cookie', async () => {
    const app = await buildServer({ env: envFor(snapshotDir), prisma });
    try {
      const res = await app.inject({ method: 'GET', url: '/admin/health' });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'unauthenticated' });
    } finally {
      await app.close();
    }
  });

  it('returns empty snapshotAges for a user with no memberships', async () => {
    const { token } = await seedUser('u-empty');
    const env = envFor(snapshotDir);
    const app = await buildServer({ env, prisma });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/health',
        headers: { cookie: `${sessionCookieName(env)}=${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<AdminHealthBody>()).toEqual({ snapshotAges: {} });
    } finally {
      await app.close();
    }
  });

  it('returns null for a party with no snapshot on disk', async () => {
    const { token, userId } = await seedUser('u-fresh');
    await seedParty({ partyId: 'p-fresh', ownerUserId: userId });
    const env = envFor(snapshotDir);
    const app = await buildServer({ env, prisma });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/health',
        headers: { cookie: `${sessionCookieName(env)}=${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<AdminHealthBody>()).toEqual({ snapshotAges: { 'p-fresh': null } });
    } finally {
      await app.close();
    }
  });

  it('returns hours-since-newest-snapshot for a party with a snapshot on disk', async () => {
    const { token, userId } = await seedUser('u-snap');
    await seedParty({ partyId: 'p-snap', ownerUserId: userId });
    // Newest snapshot mtime: 2 hours ago.
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await writeSnapshotFile('p-snap', twoHoursAgo);
    // Older snapshot in the same dir — should NOT win.
    const tenHoursAgo = new Date(Date.now() - 10 * 60 * 60 * 1000);
    await writeSnapshotFile('p-snap', tenHoursAgo);

    const env = envFor(snapshotDir);
    const app = await buildServer({ env, prisma });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/health',
        headers: { cookie: `${sessionCookieName(env)}=${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<AdminHealthBody>();
      // Allow small slack — the age is computed at request time, not
      // at snapshot-write time. 2h ± 30s = ~2.008h max.
      expect(body.snapshotAges['p-snap']).toBeGreaterThan(1.9);
      expect(body.snapshotAges['p-snap']).toBeLessThan(2.1);
    } finally {
      await app.close();
    }
  });

  it('does not leak parties the caller is not a member of', async () => {
    const { userId: aliceId, token: aliceToken } = await seedUser('u-alice');
    const { userId: bobId } = await seedUser('u-bob');
    await seedParty({ partyId: 'p-alice', ownerUserId: aliceId });
    await seedParty({ partyId: 'p-bob', ownerUserId: bobId });
    await writeSnapshotFile('p-alice', new Date(Date.now() - 1 * 60 * 60 * 1000));
    await writeSnapshotFile('p-bob', new Date(Date.now() - 1 * 60 * 60 * 1000));

    const env = envFor(snapshotDir);
    const app = await buildServer({ env, prisma });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/health',
        headers: { cookie: `${sessionCookieName(env)}=${aliceToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<AdminHealthBody>();
      expect(Object.keys(body.snapshotAges)).toEqual(['p-alice']);
    } finally {
      await app.close();
    }
  });

  it('excludes archived parties', async () => {
    const { userId, token } = await seedUser('u-arch');
    await seedParty({ partyId: 'p-active', ownerUserId: userId });
    await seedParty({
      partyId: 'p-archived',
      ownerUserId: userId,
      archivedAt: new Date(),
    });

    const env = envFor(snapshotDir);
    const app = await buildServer({ env, prisma });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/health',
        headers: { cookie: `${sessionCookieName(env)}=${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json<AdminHealthBody>();
      expect(Object.keys(body.snapshotAges)).toEqual(['p-active']);
    } finally {
      await app.close();
    }
  });

  it('excludes parties the caller has left (leftAt != null)', async () => {
    const { userId, token } = await seedUser('u-left');
    await seedParty({ partyId: 'p-left', ownerUserId: userId });
    // Mark the membership as departed. `leftAt` set → row soft-deleted.
    await prisma.partyMembership.updateMany({
      where: { userId, partyId: 'p-left' },
      data: { leftAt: new Date() },
    });

    const env = envFor(snapshotDir);
    const app = await buildServer({ env, prisma });
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/admin/health',
        headers: { cookie: `${sessionCookieName(env)}=${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<AdminHealthBody>()).toEqual({ snapshotAges: {} });
    } finally {
      await app.close();
    }
  });
});
