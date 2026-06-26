import { describe, it, expect } from 'vitest';

import type { ItemDefinition } from '@app/shared';

import {
  fromAuthJsUser,
  fromDbActorRole,
  fromDbMembershipRole,
  fromDbRarity,
  fromDbRechargeRule,
  fromDbStashScope,
  fromPrismaItemDefinition,
  toAuthJsUser,
  toDbActorRole,
  toDbMembershipRole,
  toDbRarity,
  toDbRechargeRule,
  toDbStashScope,
  toPrismaItemDefinition,
  type ItemDefinitionRow,
  type UserRow,
} from './mappers.js';

describe('mappers: enum round-trip (Zod kebab-case ↔ Prisma underscore)', () => {
  it('Rarity — every value survives a round trip', () => {
    const values = ['common', 'uncommon', 'rare', 'very-rare', 'legendary', 'artifact'] as const;
    for (const v of values) {
      expect(fromDbRarity(toDbRarity(v))).toBe(v);
    }
  });

  it('ChargesRechargeRule — every value survives a round trip', () => {
    const values = ['dawn', 'dusk', 'long-rest', 'short-rest', 'custom', 'none'] as const;
    for (const v of values) {
      expect(fromDbRechargeRule(toDbRechargeRule(v))).toBe(v);
    }
  });

  it('StashScope — every value survives a round trip', () => {
    const values = ['character', 'party', 'recovered-loot'] as const;
    for (const v of values) {
      expect(fromDbStashScope(toDbStashScope(v))).toBe(v);
    }
  });
});

describe('mappers: R3.2 actorRole / MembershipRole', () => {
  it('actorRole — every value (dm/player/banker) survives a round trip', () => {
    const values = ['dm', 'player', 'banker'] as const;
    for (const v of values) {
      expect(fromDbActorRole(toDbActorRole(v))).toBe(v);
    }
  });

  it('MembershipRole — dm and player survive a round trip', () => {
    expect(fromDbMembershipRole(toDbMembershipRole('dm'))).toBe('dm');
    expect(fromDbMembershipRole(toDbMembershipRole('player'))).toBe('player');
  });

  it('fromDbMembershipRole throws if banker appears in a PartyMembership.role read', () => {
    // Simulates a R3.4 §2.2 guard-layer regression where a banker row leaked
    // into the PartyMembership table despite the guard refusing the write.
    // `'banker'` is a valid `$Enums.MembershipRole` value but the function
    // throws at runtime — a defense against the R3.4 §2.2 guard layer
    // ever letting a banker row leak into PartyMembership.role.
    expect(() => fromDbMembershipRole('banker')).toThrow(/denormalized/);
  });
});

describe('mappers: R3.2 User (Auth.js adapter compatibility)', () => {
  const fixed = new Date('2026-06-26T12:00:00.000Z');

  it('toAuthJsUser renames displayName→name and avatarUrl→image', () => {
    const row: UserRow = {
      id: 'u1',
      displayName: 'GandalfTheGrey',
      discordId: '123456789012345678',
      email: null,
      emailVerified: null,
      avatarUrl: 'https://cdn.discordapp.com/avatars/123/abc.png',
      needsDisplayName: false,
      createdAt: fixed,
    };
    const out = toAuthJsUser(row);
    expect(out).toEqual({
      id: 'u1',
      name: 'GandalfTheGrey',
      email: null,
      emailVerified: null,
      image: 'https://cdn.discordapp.com/avatars/123/abc.png',
      needsDisplayName: false,
    });
  });

  it('fromAuthJsUser inverts the rename and parses through userSchema', () => {
    const adapter = {
      id: 'u1',
      name: 'GandalfTheGrey',
      email: null,
      emailVerified: null,
      image: 'https://cdn.discordapp.com/avatars/123/abc.png',
      discordId: '123456789012345678',
      needsDisplayName: false,
    };
    const u = fromAuthJsUser(adapter);
    expect(u.id).toBe('u1');
    expect(u.displayName).toBe('GandalfTheGrey');
    expect(u.discordId).toBe('123456789012345678');
    expect(u.avatarUrl).toBe('https://cdn.discordapp.com/avatars/123/abc.png');
    expect(u.email).toBeUndefined();
    expect(u.emailVerified).toBeUndefined();
    // R3.3 — false-by-default omits the key from the Zod parsed shape.
    expect(u.needsDisplayName).toBeUndefined();
  });

  it('fromAuthJsUser rejects a user that violates the SECURITY §1.2 refine()', () => {
    // Neither discordId nor emailVerified present — must fail the refine().
    expect(() =>
      fromAuthJsUser({
        id: 'u1',
        name: 'Anon',
        email: null,
        emailVerified: null,
        image: null,
        needsDisplayName: false,
      }),
    ).toThrow();
  });

  it('fromAuthJsUser allows an email-verified user with no discordId', () => {
    const u = fromAuthJsUser({
      id: 'u2',
      name: 'EmailOnly',
      email: 'a@example.com',
      emailVerified: fixed,
      image: null,
      needsDisplayName: false,
    });
    expect(u.discordId).toBeUndefined();
    expect(u.email).toBe('a@example.com');
    expect(u.emailVerified).toBe(fixed.toISOString());
  });

  it('fromAuthJsUser surfaces needsDisplayName: true for first-login email signups (R3.3)', () => {
    // Email-only user whose first OTP verify just landed — displayName is
    // still empty in the DB, and the server has set needsDisplayName=true
    // so the §8.1 guard layer (R3.4) returns 409 until set-display-name
    // runs.
    const u = fromAuthJsUser({
      id: 'u3',
      // displayName at the row level may be '' for these rows, but the
      // Zod schema requires min(1). Auth.js's signin response builds the
      // session payload through fromAuthJsUser, so we feed it a sentinel
      // until the user has supplied a real name. The session route
      // surfaces `needsDisplayName: true` so the client can short-circuit
      // to the prompt screen.
      name: 'Pending',
      email: 'pending@example.com',
      emailVerified: fixed,
      image: null,
      needsDisplayName: true,
    });
    expect(u.needsDisplayName).toBe(true);
  });
});

describe('mappers: ItemDefinition (R3.1)', () => {
  it('flattens cost block to costAmount + costCurrency on write', () => {
    const def: ItemDefinition = {
      id: 'phb-2024:rope',
      name: 'Rope',
      source: 'PHB',
      category: 'gear',
      cost: { amount: 1, currency: 'gp' },
    };
    const row = toPrismaItemDefinition(def);
    expect(row.costAmount).toBe(1);
    expect(row.costCurrency).toBe('gp');
  });

  it('unflattens cost block on read', () => {
    const row: ItemDefinitionRow = {
      id: 'phb-2024:rope',
      name: 'Rope',
      source: 'PHB',
      category: 'gear',
      weight: null,
      flatWeight: null,
      costAmount: 1,
      costCurrency: 'gp',
      description: null,
      tags: [],
      rarity: null,
      requiresAttunement: null,
      attunementPrereq: null,
      chargesMax: null,
      chargesRechargeRule: null,
      chargesRechargeAmount: null,
      duplicatedFromId: null,
      createdBy: null,
      partyId: null,
    };
    const def = fromPrismaItemDefinition(row);
    expect(def.cost).toEqual({ amount: 1, currency: 'gp' });
  });

  it('flattens charges block to chargesMax / chargesRechargeRule / chargesRechargeAmount', () => {
    const def: ItemDefinition = {
      id: 'dmg-2024:wand-of-magic-missiles',
      name: 'Wand of Magic Missiles',
      source: 'DMG',
      category: 'magic',
      rarity: 'uncommon',
      charges: { max: 7, rechargeRule: 'dawn', rechargeAmount: '1d6+1' },
    };
    const row = toPrismaItemDefinition(def);
    expect(row.chargesMax).toBe(7);
    expect(row.chargesRechargeRule).toBe('dawn');
    expect(row.chargesRechargeAmount).toBe('1d6+1');
    expect(row.rarity).toBe('uncommon');
  });

  it('maps the hyphenated rarity through to the DB underscore form', () => {
    const def: ItemDefinition = {
      id: 'dmg-2024:cloak-of-protection',
      name: 'Cloak of Protection',
      source: 'DMG',
      category: 'magic',
      rarity: 'very-rare',
    };
    const row = toPrismaItemDefinition(def);
    expect(row.rarity).toBe('very_rare');
  });

  it('maps hyphenated rechargeRule to underscore form', () => {
    const def: ItemDefinition = {
      id: 'dmg-2024:staff-of-power',
      name: 'Staff of Power',
      source: 'DMG',
      category: 'magic',
      rarity: 'very-rare',
      charges: { max: 20, rechargeRule: 'long-rest' },
    };
    const row = toPrismaItemDefinition(def);
    expect(row.chargesRechargeRule).toBe('long_rest');
  });

  it('round-trips a minimal PHB row (no optional fields)', () => {
    const def: ItemDefinition = {
      id: 'phb-2024:torch',
      name: 'Torch',
      source: 'PHB',
      category: 'gear',
    };
    const row = toPrismaItemDefinition(def);
    // simulate DB nulls for fields not set
    const dbRow: ItemDefinitionRow = {
      ...row,
      weight: row.weight ?? null,
      flatWeight: row.flatWeight ?? null,
      costAmount: row.costAmount ?? null,
      costCurrency: row.costCurrency ?? null,
      description: row.description ?? null,
      tags: (row.tags as string[] | undefined) ?? [],
      rarity: row.rarity ?? null,
      requiresAttunement: row.requiresAttunement ?? null,
      attunementPrereq: row.attunementPrereq ?? null,
      chargesMax: row.chargesMax ?? null,
      chargesRechargeRule: row.chargesRechargeRule ?? null,
      chargesRechargeAmount: row.chargesRechargeAmount ?? null,
      duplicatedFromId: row.duplicatedFromId ?? null,
      createdBy: row.createdBy ?? null,
      partyId: row.partyId ?? null,
    };
    const back = fromPrismaItemDefinition(dbRow);
    expect(back).toEqual(def);
  });

  it('round-trips a maximal DMG row (all optional fields set)', () => {
    const def: ItemDefinition = {
      id: 'dmg-2024:wand-of-fireballs',
      name: 'Wand of Fireballs',
      source: 'DMG',
      category: 'magic',
      weight: 1,
      flatWeight: false,
      cost: { amount: 1000, currency: 'gp' },
      description: 'A short tapered baton.',
      tags: ['wand', 'evocation'],
      rarity: 'rare',
      requiresAttunement: true,
      attunementPrereq: 'by a spellcaster',
      charges: { max: 7, rechargeRule: 'dawn', rechargeAmount: '1d6+1' },
    };
    const row = toPrismaItemDefinition(def);
    // simulate DB null-fill for fields not set
    const dbRow: ItemDefinitionRow = {
      ...row,
      weight: row.weight ?? null,
      flatWeight: row.flatWeight ?? null,
      costAmount: row.costAmount ?? null,
      costCurrency: row.costCurrency ?? null,
      description: row.description ?? null,
      tags: (row.tags as string[] | undefined) ?? [],
      rarity: row.rarity ?? null,
      requiresAttunement: row.requiresAttunement ?? null,
      attunementPrereq: row.attunementPrereq ?? null,
      chargesMax: row.chargesMax ?? null,
      chargesRechargeRule: row.chargesRechargeRule ?? null,
      chargesRechargeAmount: row.chargesRechargeAmount ?? null,
      duplicatedFromId: row.duplicatedFromId ?? null,
      createdBy: row.createdBy ?? null,
      partyId: row.partyId ?? null,
    };
    const back = fromPrismaItemDefinition(dbRow);
    expect(back).toEqual(def);
  });

  it('does NOT emit undefined keys for absent optional fields (exactOptionalPropertyTypes)', () => {
    const def: ItemDefinition = {
      id: 'phb-2024:torch',
      name: 'Torch',
      source: 'PHB',
      category: 'gear',
    };
    const row = toPrismaItemDefinition(def);
    // None of the optional column keys should be present at all.
    expect('weight' in row).toBe(false);
    expect('flatWeight' in row).toBe(false);
    expect('costAmount' in row).toBe(false);
    expect('costCurrency' in row).toBe(false);
    expect('description' in row).toBe(false);
    expect('rarity' in row).toBe(false);
    expect('requiresAttunement' in row).toBe(false);
    expect('attunementPrereq' in row).toBe(false);
    expect('chargesMax' in row).toBe(false);
    expect('chargesRechargeRule' in row).toBe(false);
    expect('chargesRechargeAmount' in row).toBe(false);
    expect('duplicatedFromId' in row).toBe(false);
    expect('createdBy' in row).toBe(false);
    expect('partyId' in row).toBe(false);
  });
});
