/**
 * R8.1 — DB integration tests for `runPendingLinkSweep`.
 *
 * PendingDiscordLink has a FK to User with `onDelete: Cascade`, so we
 * seed a User row first.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../prisma/generated/prisma/client.js';

import { runPendingLinkSweep } from './pending-link-sweep.js';

const TEST_DB_URL =
  process.env['DATABASE_URL_TEST'] ?? 'postgresql://dnd:dnd@localhost:5434/dnd_inv_test';

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
    'TRUNCATE TABLE "PendingDiscordLink", "Session", "Account", "User" CASCADE',
  );
});

async function seedUser(id: string): Promise<void> {
  await prisma.user.create({
    data: {
      id,
      displayName: `User ${id}`,
      discordId: `discord-${id}`,
      needsDisplayName: false,
    },
  });
}

describe('runPendingLinkSweep (R8.1)', () => {
  it('deletes rows whose expires is in the past', async () => {
    await seedUser('u1');
    const now = new Date('2026-07-08T12:00:00Z');
    // Expired 1 minute ago.
    const expired = new Date(now.getTime() - 60 * 1000);
    await prisma.pendingDiscordLink.create({
      data: { token: 'stale-token', userId: 'u1', expires: expired },
    });

    const result = await runPendingLinkSweep({ prisma, now });
    expect(result.deleted).toBe(1);
    expect(await prisma.pendingDiscordLink.count()).toBe(0);
  });

  it('preserves rows whose expires is in the future', async () => {
    await seedUser('u2');
    const now = new Date('2026-07-08T12:00:00Z');
    // Expires in 5 minutes — still valid.
    const notYet = new Date(now.getTime() + 5 * 60 * 1000);
    await prisma.pendingDiscordLink.create({
      data: { token: 'fresh-token', userId: 'u2', expires: notYet },
    });

    const result = await runPendingLinkSweep({ prisma, now });
    expect(result.deleted).toBe(0);
    expect(await prisma.pendingDiscordLink.count()).toBe(1);
  });

  it('mixed batch — deletes expired, preserves unexpired', async () => {
    await seedUser('u3');
    const now = new Date('2026-07-08T12:00:00Z');
    await prisma.pendingDiscordLink.createMany({
      data: [
        { token: 't1', userId: 'u3', expires: new Date(now.getTime() - 60 * 1000) },
        { token: 't2', userId: 'u3', expires: new Date(now.getTime() - 60 * 60 * 1000) },
        { token: 't3', userId: 'u3', expires: new Date(now.getTime() + 60 * 1000) },
      ],
    });

    const result = await runPendingLinkSweep({ prisma, now });
    expect(result.deleted).toBe(2);
    expect(await prisma.pendingDiscordLink.count()).toBe(1);
    const remaining = await prisma.pendingDiscordLink.findFirstOrThrow();
    expect(remaining.token).toBe('t3');
  });

  it('no rows → 0 deleted, no error', async () => {
    const result = await runPendingLinkSweep({
      prisma,
      now: new Date('2026-07-08T12:00:00Z'),
    });
    expect(result.deleted).toBe(0);
  });
});
