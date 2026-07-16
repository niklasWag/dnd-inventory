/**
 * R3.4.a — server-side persistor.
 *
 * For each reducer action type, applies the corresponding DELTA WRITES
 * to the Prisma transaction client. Called from the `/sync/actions`
 * handler INSIDE a `$transaction` block; the matching `TransactionLog`
 * row is appended separately (see `log-builder.ts`).
 *
 * Why a per-action switch (rather than diffing `result.state`)? Most
 * actions touch a small, known set of rows. Naively diffing AppState
 * would require walking every array on every dispatch — wasteful for
 * the common case where a single row changes. The switch also makes
 * each action's DB footprint reviewable: anything stored in Postgres
 * for action X is the set of writes in the matching `persist*` helper.
 *
 * **CLAUDE.md / SECURITY §3.4 invariants re-checked here**:
 *   - currency math is integer CP only (the reducer enforced it; we
 *     defensively re-assert via the Zod schema parse on the way IN to
 *     this function, which is the boundary that matters)
 *   - stash invariants enforced by the migration's CHECK constraints
 *   - item ownership invariants enforced by FKs + CHECKs
 *
 * Each persist helper is named `persist<Action>`. They are intentionally
 * small; share helpers via private functions at the bottom of the file
 * if a pattern emerges (e.g. `applyItemDelta`).
 */
import type { Action, Actor, AppState } from '@app/shared';
import { wishlistEntrySchema, type WishlistEntry } from '@app/shared';
import { currency, pricing, type ReducerContext } from '@app/rules';

import type { Prisma } from '../../prisma/generated/prisma/client.js';
import {
  toDbMembershipRole,
  toDbRarity,
  toDbRechargeRule,
  toDbStashScope,
  toPrismaItemDefinition,
} from '../db/mappers.js';

/**
 * Apply one action's DELTA WRITES inside the running transaction.
 *
 * The action type's TS-narrowing carries through the switch so each
 * case's payload is fully typed. The `_actor` and `_ctx` parameters are
 * threaded for actions that need ctx for fresh IDs / timestamps when
 * the persist generates secondary rows (e.g. `create-character`
 * provisions a User + Party + memberships + character + 3 stashes +
 * 3 currencies; `create-stash` provisions a Stash + CurrencyHolding).
 */
export async function applyDelta(
  tx: Prisma.TransactionClient,
  action: Action,
  actor: Actor,
  ctx: ReducerContext,
): Promise<void> {
  switch (action.type) {
    case 'create-character':
      // Two valid shapes (R4.1.f):
      //
      //   - Bootstrap: routed by /sync/actions to applyBootstrapDelta
      //     directly (with the reducer's full result.state), NOT through
      //     this switch. If we reach this case for a bootstrap, the
      //     routes handler's `isBootstrap` check is wrong.
      //
      //   - Post-bootstrap: actor already in an existing party. Mints
      //     Character + Inventory Stash + CurrencyHolding, then either
      //     patches the existing role='player' membership's characterId
      //     or appends a new player row (DM-only DM case).
      return persistAddCharacterToExistingParty(tx, action.payload, actor, ctx);
    case 'acquire':
      return persistAcquire(tx, action.payload, ctx);
    case 'consume':
      return persistConsume(tx, action.payload);
    case 'seed-catalog':
      return persistSeedCatalog(tx, action.payload);
    case 'edit-item-instance':
      return persistEditItemInstance(tx, action.payload);
    case 'create-stash':
      return persistCreateStash(tx, action.payload, ctx);
    case 'rename-stash':
      return persistRenameStash(tx, action.payload);
    case 'delete-stash':
      return persistDeleteStash(tx, action.payload, ctx);
    case 'currency-change':
      return persistCurrencyChange(tx, action.payload);
    case 'transfer':
      return persistTransfer(tx, action.payload, ctx);
    case 'split':
      return persistSplit(tx, action.payload, ctx);
    case 'currency-transfer':
      return persistCurrencyTransfer(tx, action.payload);
    case 'create-homebrew':
      return persistCreateHomebrew(tx, action.payload, actor, ctx);
    case 'edit-homebrew':
      return persistEditHomebrew(tx, action.payload);
    case 'delete-homebrew':
      return persistDeleteHomebrew(tx, action.payload);
    case 'rename-character':
      return persistRenameCharacter(tx, action.payload);
    case 'rename-party':
      return persistRenameParty(tx, action.payload);
    case 'set-encumbrance':
      return persistSetEncumbrance(tx, action.payload);
    case 'update-party-economy':
      return persistUpdatePartyEconomy(tx, action.payload);
    case 'create-shop':
      return persistCreateShop(tx, action.payload, actor);
    case 'edit-shop':
      return persistEditShop(tx, action.payload);
    case 'delete-shop':
      return persistDeleteShop(tx, action.payload);
    case 'set-shop-open':
      return persistSetShopOpen(tx, action.payload);
    case 'edit-shop-stock':
      return persistEditShopStock(tx, action.payload);
    case 'purchase':
      return persistPurchase(tx, action.payload);
    case 'sale':
      return persistSale(tx, action.payload);
    case 'equip':
      return persistEquip(tx, action.payload);
    case 'unequip':
      return persistUnequip(tx, action.payload.itemInstanceId);
    case 'attune':
      return persistAttune(tx, action.payload);
    case 'unattune':
      return persistUnattune(tx, action.payload.itemInstanceId);
    case 'use-charge':
      return persistUseCharge(tx, action.payload);
    case 'recharge':
      return persistRecharge(tx, action.payload);
    case 'identify':
      return persistIdentify(tx, action.payload);
    case 'identify-batch':
      return persistIdentifyBatch(tx, action.payload, actor);
    case 'edit-character':
      return persistEditCharacter(tx, action.payload);
    case 'wishlist-add':
      return persistWishlistAdd(tx, action.payload);
    case 'wishlist-remove':
      return persistWishlistRemove(tx, action.payload);
    case 'delete-character':
      return persistDeleteCharacter(tx, action.payload);
    case 'leave-party':
      return persistLeaveParty(tx, actor, ctx);
    case 'kick-player':
      return persistKickPlayer(tx, action.payload, actor, ctx);
    case 'join-party':
      return persistJoinParty(tx, actor, ctx);
    case 'appoint-banker':
      return persistAppointBanker(tx, action.payload, actor);
    case 'revoke-banker':
      return persistRevokeBanker(tx, actor);
    case 'dm-transfer':
      return persistDmTransfer(tx, action.payload, actor, ctx);
    case 'split-evenly':
      return persistSplitEvenly(tx, action.payload, ctx);
    case 'start-game-session':
      return persistStartGameSession(tx, action.payload, actor, ctx);
    case 'end-game-session':
      return persistEndGameSession(tx, actor);
    case 'edit-game-session-notes':
      return persistEditGameSessionNotes(tx, action.payload);
  }
}

// -------------------- per-action persistors --------------------

/**
 * R3.4.a — bootstrap persistor. Writes the rows the reducer's
 * `create-character` result describes, using the SAME ids the reducer
 * minted (so the log entry's partyId / actorUserId references stay
 * consistent across the transaction).
 *
 * Diverges from the per-action switch because the reducer's bootstrap
 * shape includes a synthetic User row that conflicts with the existing
 * authenticated User. The User table is left alone here; everything
 * else (Party, memberships, character, stashes, currencies) is created.
 */
export async function applyBootstrapDelta(
  tx: Prisma.TransactionClient,
  resultState: NonNullable<AppState>,
  authenticatedUserId: string,
  _payload: Extract<Action, { type: 'create-character' }>['payload'],
): Promise<void> {
  const party = resultState.party;
  const characters = resultState.characters;
  const memberships = resultState.memberships;
  const stashes = resultState.stashes;
  const currencies = resultState.currencies;

  await tx.party.create({
    data: {
      id: party.id,
      name: party.name,
      // The reducer mints a synthetic ownerUserId equal to its synthetic
      // user.id. Override with the actual authenticated user (the session
      // user we resolved upstream) — that user already exists.
      ownerUserId: authenticatedUserId,
      inviteCode: party.inviteCode,
      recoveredLootStashId: party.recoveredLootStashId,
      bankerUserId: party.bankerUserId,
      encumbranceRule: party.encumbranceRule,
      enforceEncumbrance: party.enforceEncumbrance,
      createdAt: new Date(party.createdAt),
    },
  });

  // Creation order matters: Stash.ownerCharacterId → Character is NOT
  // deferrable, but Character.inventoryStashId → Stash IS (migration tail).
  // So create Character FIRST (referencing the not-yet-existing inventory
  // stash via the deferred FK) and Stashes AFTER (their ownerCharacterId
  // points at the now-existing Character).
  for (const ch of characters) {
    await tx.character.create({
      data: {
        id: ch.id,
        partyId: ch.partyId,
        ownerUserId: authenticatedUserId,
        name: ch.name,
        species: ch.species,
        size: ch.size,
        class: ch.class,
        level: ch.level,
        strScore: ch.abilityScores.STR,
        maxAttunement: ch.maxAttunement,
        inventoryStashId: ch.inventoryStashId,
      },
    });
  }

  await tx.stash.createMany({
    data: stashes.map((s) => ({
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
    data: memberships.map((m) => ({
      userId: authenticatedUserId,
      partyId: m.partyId,
      role: toDbMembershipRole(m.role),
      characterId: m.characterId,
      joinedAt: new Date(m.joinedAt),
      leftAt: m.leftAt === null ? null : new Date(m.leftAt),
    })),
  });

  await tx.currencyHolding.createMany({
    data: currencies.map((c) => ({
      id: c.id,
      stashId: c.stashId,
      cp: c.cp,
      sp: c.sp,
      ep: c.ep,
      gp: c.gp,
      pp: c.pp,
    })),
  });
}

async function persistAcquire(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'acquire' }>['payload'],
  _ctx: ReducerContext,
): Promise<void> {
  // Auto-stack: if a row exists with matching (stashId, definitionId,
  // notes ?? ''), bump its quantity; otherwise insert a new row.
  const existing = await tx.itemInstance.findFirst({
    where: {
      ownerId: payload.stashId,
      definitionId: payload.definitionId,
      // SQL: notes IS NOT DISTINCT FROM payload.notes ?? null. Prisma's
      // `equals` against `null` does match SQL `IS NULL`.
      notes: payload.notes ?? null,
    },
  });
  if (existing !== null) {
    await tx.itemInstance.update({
      where: { id: existing.id },
      data: { quantity: existing.quantity + payload.quantity },
    });
    return;
  }
  await tx.itemInstance.create({
    data: {
      id: payload.newItemInstanceId,
      definitionId: payload.definitionId,
      ownerType: 'stash',
      ownerId: payload.stashId,
      containerInstanceId: null,
      quantity: payload.quantity,
      equipped: false,
      attuned: false,
      identified: true, // R2.3 — mundane items default true; magic items get false via the reducer's intoInventory branch + DM identify.
      hint: null,
      currentCharges: null,
      customName: null,
      notes: payload.notes ?? null,
    },
  });
}

async function persistConsume(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'consume' }>['payload'],
): Promise<void> {
  const row = await tx.itemInstance.findUniqueOrThrow({ where: { id: payload.itemInstanceId } });
  const next = row.quantity - payload.quantity;
  if (next <= 0) {
    await tx.itemInstance.delete({ where: { id: row.id } });
  } else {
    await tx.itemInstance.update({ where: { id: row.id }, data: { quantity: next } });
  }
}

async function persistSeedCatalog(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'seed-catalog' }>['payload'],
): Promise<void> {
  // Upsert each ItemDefinition; update the Metadata seedVersion row.
  for (const entry of payload.entries) {
    const data = toPrismaItemDefinition(entry);
    await tx.itemDefinition.upsert({
      where: { id: entry.id },
      create: data,
      update: data,
    });
  }
  await tx.metadata.upsert({
    where: { key: 'seedVersion' },
    create: { key: 'seedVersion', value: payload.seedVersion },
    update: { value: payload.seedVersion },
  });
}

async function persistEditItemInstance(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'edit-item-instance' }>['payload'],
): Promise<void> {
  const data: Prisma.ItemInstanceUpdateInput = {};
  if (payload.patch.customName !== undefined) data.customName = payload.patch.customName;
  if (payload.patch.notes !== undefined) data.notes = payload.patch.notes;
  await tx.itemInstance.update({ where: { id: payload.itemInstanceId }, data });
}

async function persistCreateStash(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'create-stash' }>['payload'],
  ctx: ReducerContext,
): Promise<void> {
  const stashId = payload.newStashId;
  await tx.stash.create({
    data: {
      id: stashId,
      name: payload.name.trim(),
      isCarried: false,
      createdAt: new Date(ctx.now()),
      scope: toDbStashScope('character'),
      ownerCharacterId: payload.ownerCharacterId,
      partyId: null,
    },
  });
  await tx.currencyHolding.create({
    data: { id: payload.newCurrencyHoldingId, stashId, cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
  });
}

/**
 * R4.1.f — Persist a `create-character` dispatched against an EXISTING
 * party (post-bootstrap). The bootstrap variant (state was null) is
 * handled by `applyBootstrapDelta` upstream in the routes handler.
 *
 * Three use cases reach here:
 *   1. Joiner who just minted a `role='player'` membership row with
 *      `characterId: null` via `POST /parties/join`.
 *   2. DM-only DM who bootstrapped with `dmOnly: true` and now adds
 *      their own character.
 *   3. User recreating after `delete-character` cleared their
 *      `characterId` to null.
 *
 * All three land at the same end state: an active `role='player'` row
 * pointing at a real Character with its own Inventory stash + zero-
 * balance CurrencyHolding.
 *
 * Ids come from the action payload (client-canonical per RH1.2), which
 * the guard layer has already validated as UUID v7 upstream.
 */
async function persistAddCharacterToExistingParty(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'create-character' }>['payload'],
  actor: Actor,
  ctx: ReducerContext,
): Promise<void> {
  // Reject dmOnly defensively — the reducer + guard already do, but if a
  // future regression slips one through, refuse here too.
  if (payload.dmOnly === true) {
    throw new Error('persistAddCharacterToExistingParty: dmOnly is bootstrap-only');
  }

  const now = new Date(ctx.now());
  const characterId = payload.newCharacterId;
  const inventoryStashId = payload.newInventoryStashId;

  // Order matters because of the deferred Character.inventoryStashId FK:
  // the FK to Stash is `INITIALLY DEFERRED`, so within this transaction
  // we can write the Character before the Stash exists. Outside the
  // transaction Postgres validates the constraint at commit time.
  await tx.character.create({
    data: {
      id: characterId,
      partyId: actor.partyId,
      ownerUserId: actor.userId,
      name: payload.name,
      species: payload.species,
      size: payload.size,
      class: payload.class,
      level: payload.level,
      strScore: payload.str,
      maxAttunement: 3,
      inventoryStashId,
    },
  });

  await tx.stash.create({
    data: {
      id: inventoryStashId,
      name: 'Inventory',
      isCarried: true,
      createdAt: now,
      scope: toDbStashScope('character'),
      ownerCharacterId: characterId,
      partyId: null,
    },
  });

  await tx.currencyHolding.create({
    data: {
      id: payload.newCurrencyHoldingId,
      stashId: inventoryStashId,
      cp: 0,
      sp: 0,
      ep: 0,
      gp: 0,
      pp: 0,
    },
  });

  // Patch the existing role='player' row (joiner / post-delete case) or
  // append a new one (DM-only DM case).
  const existingPlayer = await tx.partyMembership.findUnique({
    where: {
      userId_partyId_role: {
        userId: actor.userId,
        partyId: actor.partyId,
        role: toDbMembershipRole('player'),
      },
    },
  });

  if (existingPlayer !== null && existingPlayer.leftAt === null) {
    if (existingPlayer.characterId !== null) {
      // Defense-in-depth — the reducer + guard reject this case.
      throw new Error(
        'persistAddCharacterToExistingParty: actor already has a character in this party',
      );
    }
    await tx.partyMembership.update({
      where: {
        userId_partyId_role: {
          userId: actor.userId,
          partyId: actor.partyId,
          role: toDbMembershipRole('player'),
        },
      },
      data: { characterId },
    });
  } else {
    await tx.partyMembership.create({
      data: {
        userId: actor.userId,
        partyId: actor.partyId,
        role: toDbMembershipRole('player'),
        characterId,
        joinedAt: now,
        leftAt: null,
      },
    });
  }
}

async function persistRenameStash(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'rename-stash' }>['payload'],
): Promise<void> {
  await tx.stash.update({ where: { id: payload.stashId }, data: { name: payload.newName.trim() } });
}

async function persistDeleteStash(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'delete-stash' }>['payload'],
  _ctx: ReducerContext,
): Promise<void> {
  // Cascade: move all items to recovered-loot, roll currency into recovered-
  // loot's holding, then delete the stash (which cascades to its currency
  // via the FK). The reducer emits per-item `transfer` slices + an
  // optional `currency-change` slice + the `delete-stash` slice; the
  // log-builder writes each. The DB cascade here moves the actual rows.
  //
  // Find the recovered-loot stash for this party.
  const stash = await tx.stash.findUniqueOrThrow({ where: { id: payload.stashId } });
  if (stash.scope !== 'character' || stash.isCarried) {
    // The reducer rejects this case but defense-in-depth.
    throw new Error('delete-stash: only character-scope, non-carried stashes can be deleted');
  }
  // Find the recovered-loot stash for the owning party (look up via
  // character's partyId).
  const owner = await tx.character.findUniqueOrThrow({
    where: { id: stash.ownerCharacterId! },
  });
  const recoveredLoot = await tx.stash.findFirstOrThrow({
    where: { partyId: owner.partyId, scope: toDbStashScope('recovered-loot') },
  });
  // Move items.
  await tx.itemInstance.updateMany({
    where: { ownerId: stash.id },
    data: { ownerId: recoveredLoot.id, containerInstanceId: null, equipped: false, attuned: false },
  });
  // Roll currency.
  const fromCurrency = await tx.currencyHolding.findUniqueOrThrow({ where: { stashId: stash.id } });
  const hasCurrency =
    fromCurrency.cp !== 0 ||
    fromCurrency.sp !== 0 ||
    fromCurrency.ep !== 0 ||
    fromCurrency.gp !== 0 ||
    fromCurrency.pp !== 0;
  if (hasCurrency) {
    await tx.currencyHolding.update({
      where: { stashId: recoveredLoot.id },
      data: {
        cp: { increment: fromCurrency.cp },
        sp: { increment: fromCurrency.sp },
        ep: { increment: fromCurrency.ep },
        gp: { increment: fromCurrency.gp },
        pp: { increment: fromCurrency.pp },
      },
    });
  }
  // Delete stash (currency cascades via FK).
  await tx.stash.delete({ where: { id: stash.id } });
}

async function persistCurrencyChange(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'currency-change' }>['payload'],
): Promise<void> {
  await tx.currencyHolding.update({
    where: { stashId: payload.stashId },
    data: {
      cp: { increment: payload.delta.cp },
      sp: { increment: payload.delta.sp },
      ep: { increment: payload.delta.ep },
      gp: { increment: payload.delta.gp },
      pp: { increment: payload.delta.pp },
    },
  });
}

async function persistTransfer(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'transfer' }>['payload'],
  _ctx: ReducerContext,
): Promise<void> {
  const source = await tx.itemInstance.findUniqueOrThrow({
    where: { id: payload.itemInstanceId },
  });
  const moveAll = payload.quantity >= source.quantity;

  if (moveAll) {
    // Full move: update the row's ownerId to the destination stash.
    // Auto-stack onto any existing row at the destination with matching
    // (definitionId, notes ?? '').
    const dest = await tx.itemInstance.findFirst({
      where: {
        ownerId: payload.toStashId,
        definitionId: source.definitionId,
        notes: source.notes,
        id: { not: source.id },
      },
    });
    if (dest !== null) {
      await tx.itemInstance.update({
        where: { id: dest.id },
        data: { quantity: dest.quantity + source.quantity },
      });
      await tx.itemInstance.delete({ where: { id: source.id } });
    } else {
      const data: Prisma.ItemInstanceUpdateInput = {
        stash: { connect: { id: payload.toStashId } },
        // Equip/attune cleared when leaving inventory per OUTLINE §3.4 R1.3.
        equipped: false,
        attuned: false,
      };
      if (payload.toContainerInstanceId !== undefined) {
        data.containerInstanceId = payload.toContainerInstanceId;
      }
      await tx.itemInstance.update({ where: { id: source.id }, data });
    }
  } else {
    // Partial: decrement source, add a new instance to destination.
    await tx.itemInstance.update({
      where: { id: source.id },
      data: { quantity: source.quantity - payload.quantity },
    });
    await tx.itemInstance.create({
      data: {
        id: payload.newItemInstanceId,
        definitionId: source.definitionId,
        ownerType: 'stash',
        ownerId: payload.toStashId,
        containerInstanceId:
          payload.toContainerInstanceId !== undefined ? payload.toContainerInstanceId : null,
        quantity: payload.quantity,
        equipped: false,
        attuned: false,
        identified: source.identified,
        hint: source.hint,
        currentCharges: source.currentCharges,
        customName: source.customName,
        notes: source.notes,
        ...(source.conditionOverrides !== null && source.conditionOverrides !== undefined
          ? { conditionOverrides: source.conditionOverrides }
          : {}),
      },
    });
  }
}

async function persistSplit(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'split' }>['payload'],
  _ctx: ReducerContext,
): Promise<void> {
  const source = await tx.itemInstance.findUniqueOrThrow({
    where: { id: payload.itemInstanceId },
  });
  await tx.itemInstance.update({
    where: { id: source.id },
    data: { quantity: source.quantity - payload.quantity },
  });
  await tx.itemInstance.create({
    data: {
      id: payload.newItemInstanceId,
      definitionId: source.definitionId,
      ownerType: source.ownerType,
      ownerId: source.ownerId,
      containerInstanceId: source.containerInstanceId,
      quantity: payload.quantity,
      equipped: false,
      attuned: false,
      identified: source.identified,
      hint: source.hint,
      currentCharges: source.currentCharges,
      customName: source.customName,
      notes: source.notes,
      ...(source.conditionOverrides !== null && source.conditionOverrides !== undefined
        ? { conditionOverrides: source.conditionOverrides }
        : {}),
    },
  });
}

async function persistCurrencyTransfer(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'currency-transfer' }>['payload'],
): Promise<void> {
  await tx.currencyHolding.update({
    where: { stashId: payload.fromStashId },
    data: {
      cp: { decrement: payload.delta.cp },
      sp: { decrement: payload.delta.sp },
      ep: { decrement: payload.delta.ep },
      gp: { decrement: payload.delta.gp },
      pp: { decrement: payload.delta.pp },
    },
  });
  await tx.currencyHolding.update({
    where: { stashId: payload.toStashId },
    data: {
      cp: { increment: payload.delta.cp },
      sp: { increment: payload.delta.sp },
      ep: { increment: payload.delta.ep },
      gp: { increment: payload.delta.gp },
      pp: { increment: payload.delta.pp },
    },
  });
}

async function persistCreateHomebrew(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'create-homebrew' }>['payload'],
  actor: Actor,
  _ctx: ReducerContext,
): Promise<void> {
  const data: Prisma.ItemDefinitionUncheckedCreateInput = {
    id: payload.newDefinitionId,
    name: payload.name,
    source: 'homebrew',
    category: payload.category,
    tags: payload.tags ?? [],
    createdBy: actor.userId,
    partyId: actor.partyId,
  };
  if (payload.weight !== undefined) data.weight = payload.weight;
  if (payload.cost !== undefined) {
    data.costAmount = payload.cost.amount;
    data.costCurrency = payload.cost.currency;
  }
  if (payload.description !== undefined) data.description = payload.description;
  // BUG-012 (2026-07-06) — magic-item metadata. `rarity` uses the
  // shared kebab-case enum on the wire (`very-rare`); the Prisma
  // column stores the underscore form (`very_rare`), so route through
  // `toDbRarity` for the enum swap.
  if (payload.rarity !== undefined) data.rarity = toDbRarity(payload.rarity);
  if (payload.requiresAttunement !== undefined) {
    data.requiresAttunement = payload.requiresAttunement;
  }
  if (payload.attunementPrereq !== undefined) {
    data.attunementPrereq = payload.attunementPrereq;
  }
  if (payload.duplicatedFromId !== undefined) data.duplicatedFromId = payload.duplicatedFromId;
  await tx.itemDefinition.create({ data });
}

async function persistEditHomebrew(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'edit-homebrew' }>['payload'],
): Promise<void> {
  const data: Prisma.ItemDefinitionUpdateInput = {};
  if (payload.patch.name !== undefined) data.name = payload.patch.name;
  if (payload.patch.category !== undefined) data.category = payload.patch.category;
  if (payload.patch.weight !== undefined) data.weight = payload.patch.weight;
  if (payload.patch.cost !== undefined) {
    data.costAmount = payload.patch.cost.amount;
    data.costCurrency = payload.patch.cost.currency;
  }
  if (payload.patch.description !== undefined) data.description = payload.patch.description;
  if (payload.patch.tags !== undefined) data.tags = payload.patch.tags;
  // BUG-012 — magic-item metadata. Patch semantics: "key present" =
  // apply (including explicit `undefined` to clear). The reducer's
  // diff loop only sends keys that changed, so the presence check
  // via `in` distinguishes "clear" from "no touch".
  if ('rarity' in payload.patch) {
    data.rarity = payload.patch.rarity === undefined ? null : toDbRarity(payload.patch.rarity);
  }
  if ('requiresAttunement' in payload.patch) {
    data.requiresAttunement =
      payload.patch.requiresAttunement === undefined ? null : payload.patch.requiresAttunement;
  }
  if ('attunementPrereq' in payload.patch) {
    data.attunementPrereq =
      payload.patch.attunementPrereq === undefined ? null : payload.patch.attunementPrereq;
  }
  await tx.itemDefinition.update({ where: { id: payload.definitionId }, data });
}

async function persistDeleteHomebrew(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'delete-homebrew' }>['payload'],
): Promise<void> {
  // Reducer guard: no ItemInstance may reference this definition. The
  // Prisma FK is onDelete: Restrict so a violation here would surface
  // as a P2003 — defense-in-depth.
  await tx.itemDefinition.delete({ where: { id: payload.definitionId } });
}

async function persistRenameCharacter(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'rename-character' }>['payload'],
): Promise<void> {
  await tx.character.update({
    where: { id: payload.characterId },
    data: { name: payload.newName.trim() },
  });
}

async function persistRenameParty(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'rename-party' }>['payload'],
): Promise<void> {
  await tx.party.update({ where: { id: payload.partyId }, data: { name: payload.newName.trim() } });
}

async function persistSetEncumbrance(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'set-encumbrance' }>['payload'],
): Promise<void> {
  await tx.party.update({
    where: { id: payload.partyId },
    data: { encumbranceRule: payload.rule, enforceEncumbrance: payload.enforce },
  });
}

/**
 * R6.1 — `update-party-economy` persistor (OUTLINE §3.5). Writes both
 * `priceModifier` and `baseCurrency` in one UPDATE — matches the
 * atomic-preset-switch semantics of the reducer + guard.
 */
async function persistUpdatePartyEconomy(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'update-party-economy' }>['payload'],
): Promise<void> {
  await tx.party.update({
    where: { id: payload.partyId },
    data: { priceModifier: payload.priceModifier, baseCurrency: payload.baseCurrency },
  });
}

// ---------------------------------------------------------------------------
// R6.2 — Shop persistors
// ---------------------------------------------------------------------------

async function persistCreateShop(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'create-shop' }>['payload'],
  actor: Actor,
): Promise<void> {
  await tx.shop.create({
    data: {
      id: payload.newShopId,
      partyId: actor.partyId,
      name: payload.name,
    },
  });
}

async function persistEditShop(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'edit-shop' }>['payload'],
): Promise<void> {
  await tx.shop.update({
    where: { id: payload.shopId },
    data: {
      ...(payload.patch.name !== undefined ? { name: payload.patch.name } : {}),
      ...(payload.patch.priceModifier !== undefined
        ? { priceModifier: payload.patch.priceModifier }
        : {}),
      ...(payload.patch.sellToMerchantRate !== undefined
        ? { sellToMerchantRate: payload.patch.sellToMerchantRate }
        : {}),
    },
  });
}

async function persistDeleteShop(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'delete-shop' }>['payload'],
): Promise<void> {
  // Cascade delete removes stock rows via the FK constraint.
  await tx.shop.delete({ where: { id: payload.shopId } });
}

async function persistSetShopOpen(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'set-shop-open' }>['payload'],
): Promise<void> {
  await tx.shop.update({
    where: { id: payload.shopId },
    data: { isOpen: payload.isOpen },
  });
}

async function persistEditShopStock(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'edit-shop-stock' }>['payload'],
): Promise<void> {
  const op = payload.operation;
  if (op.kind === 'add') {
    await tx.shopStockEntry.create({
      data: {
        id: op.newStockEntryId,
        shopId: payload.shopId,
        itemDefinitionId: op.itemDefinitionId,
        priceOverride: op.priceOverride ?? null,
        quantity: op.quantity,
      },
    });
    return;
  }
  if (op.kind === 'update') {
    await tx.shopStockEntry.update({
      where: { id: op.stockEntryId },
      data: {
        ...(op.priceOverride !== undefined ? { priceOverride: op.priceOverride } : {}),
        ...(op.quantity !== undefined ? { quantity: op.quantity } : {}),
      },
    });
    return;
  }
  // op.kind === 'remove'
  await tx.shopStockEntry.delete({ where: { id: op.stockEntryId } });
}

/**
 * `persistPurchase` — redo the reducer's calc against fresh DB rows.
 * Debits the target stash's currency, upserts an item instance
 * (auto-stack merge or insert with the client-minted id), and
 * decrements finite shop stock.
 *
 * Race protection: the stock decrement uses a conditional update that
 * rejects if the source row's quantity is below the requested amount
 * (implemented via `updateMany` with a `where` predicate — Prisma's
 * default `update` throws on `where: { id, quantity: >= q }` if no row
 * matches). Losing-side clients revert their optimistic UI on the
 * rejection toast.
 */
async function persistPurchase(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'purchase' }>['payload'],
): Promise<void> {
  const shop = await tx.shop.findUnique({ where: { id: payload.shopId } });
  if (shop === null) throw new Error(`persistPurchase: unknown shopId ${payload.shopId}`);
  const stockEntry = await tx.shopStockEntry.findUnique({
    where: { id: payload.stockEntryId },
  });
  if (stockEntry === null) {
    throw new Error(`persistPurchase: unknown stockEntryId ${payload.stockEntryId}`);
  }
  const def = await tx.itemDefinition.findUnique({
    where: { id: stockEntry.itemDefinitionId },
  });
  if (def === null) {
    throw new Error(`persistPurchase: unknown itemDefinition ${stockEntry.itemDefinitionId}`);
  }
  const targetStash = await tx.stash.findUnique({ where: { id: payload.targetStashId } });
  if (targetStash === null) {
    throw new Error(`persistPurchase: unknown targetStashId ${payload.targetStashId}`);
  }
  const party = await tx.party.findUnique({ where: { id: shop.partyId } });
  if (party === null) throw new Error(`persistPurchase: shop's party missing`);

  // Compute unit cost via pricing.ts (mirrors reducer).
  let unitCostCp: number;
  if (stockEntry.priceOverride !== null) {
    unitCostCp = stockEntry.priceOverride;
  } else {
    if (def.costAmount === null || def.costCurrency === null) {
      throw new Error(`persistPurchase: catalog row ${def.id} has no cost`);
    }
    const baseCp = currency.toCopper({ [def.costCurrency]: def.costAmount });
    unitCostCp = pricing.buyPrice(baseCp, def.source, {
      partyModifier: party.priceModifier,
      shopModifier: shop.priceModifier,
    });
  }
  const totalCostCp = unitCostCp * payload.quantity;

  // Debit currency.
  const currencyRow = await tx.currencyHolding.findFirst({
    where: { stashId: targetStash.id },
  });
  if (currencyRow === null) {
    throw new Error(`persistPurchase: no CurrencyHolding for stash ${targetStash.id}`);
  }
  const balanceCp = currency.toCopper(currencyRow);
  if (balanceCp < totalCostCp) {
    throw new Error('persistPurchase: insufficient funds');
  }
  const nextCoins = currency.fromCopper(balanceCp - totalCostCp);
  await tx.currencyHolding.update({
    where: { id: currencyRow.id },
    data: nextCoins,
  });

  // Auto-stack: upsert item instance in the target stash.
  const existing = await tx.itemInstance.findFirst({
    where: {
      ownerId: targetStash.id,
      definitionId: def.id,
      notes: null,
      containerInstanceId: null,
    },
  });
  if (existing !== null) {
    await tx.itemInstance.update({
      where: { id: existing.id },
      data: { quantity: existing.quantity + payload.quantity },
    });
  } else {
    await tx.itemInstance.create({
      data: {
        id: payload.newItemInstanceId,
        definitionId: def.id,
        ownerType: 'stash',
        ownerId: targetStash.id,
        containerInstanceId: null,
        quantity: payload.quantity,
        equipped: false,
        attuned: false,
        identified: true,
        currentCharges: null,
      },
    });
  }

  // Decrement finite stock (race-safe: require quantity >= payload.quantity).
  if (stockEntry.quantity !== -1) {
    const updated = await tx.shopStockEntry.updateMany({
      where: { id: stockEntry.id, quantity: { gte: payload.quantity } },
      data: { quantity: { decrement: payload.quantity } },
    });
    if (updated.count === 0) {
      throw new Error('persistPurchase: stock decrement failed (race with another buyer)');
    }
  }
}

/**
 * `persistSale` — redo the reducer's calc, consume the item, credit
 * currency, increment (or insert) the shop's stock row. When the item
 * quantity drops to zero, delete the row. When no stock entry exists
 * for the definitionId, insert a new one with the client-minted id.
 */
async function persistSale(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'sale' }>['payload'],
): Promise<void> {
  const shop = await tx.shop.findUnique({ where: { id: payload.shopId } });
  if (shop === null) throw new Error(`persistSale: unknown shopId ${payload.shopId}`);
  const item = await tx.itemInstance.findUnique({ where: { id: payload.itemInstanceId } });
  if (item === null)
    throw new Error(`persistSale: unknown itemInstanceId ${payload.itemInstanceId}`);
  if (item.quantity < payload.quantity) {
    throw new Error('persistSale: insufficient item quantity');
  }
  const def = await tx.itemDefinition.findUnique({ where: { id: item.definitionId } });
  if (def === null) throw new Error(`persistSale: unknown itemDefinition ${item.definitionId}`);
  if (def.costAmount === null || def.costCurrency === null) {
    throw new Error(`persistSale: catalog row ${def.id} has no cost`);
  }
  const party = await tx.party.findUnique({ where: { id: shop.partyId } });
  if (party === null) throw new Error(`persistSale: shop's party missing`);

  const baseCp = currency.toCopper({ [def.costCurrency]: def.costAmount });
  const scaled = pricing.buyPrice(baseCp, def.source, {
    partyModifier: party.priceModifier,
    shopModifier: shop.priceModifier,
  });
  const unitCreditCp = Math.floor(scaled * shop.sellToMerchantRate + 0.5);
  const totalCreditCp = unitCreditCp * payload.quantity;

  // Credit seller's stash currency.
  const currencyRow = await tx.currencyHolding.findFirst({
    where: { stashId: item.ownerId },
  });
  if (currencyRow === null) {
    throw new Error(`persistSale: no CurrencyHolding for stash ${item.ownerId}`);
  }
  const newBalance = currency.toCopper(currencyRow) + totalCreditCp;
  await tx.currencyHolding.update({
    where: { id: currencyRow.id },
    data: currency.fromCopper(newBalance),
  });

  // Consume item.
  if (item.quantity === payload.quantity) {
    await tx.itemInstance.delete({ where: { id: item.id } });
  } else {
    await tx.itemInstance.update({
      where: { id: item.id },
      data: { quantity: item.quantity - payload.quantity },
    });
  }

  // Stock: increment existing row for this def, else insert a new one.
  const existingStock = await tx.shopStockEntry.findFirst({
    where: { shopId: shop.id, itemDefinitionId: item.definitionId },
  });
  if (existingStock !== null) {
    if (existingStock.quantity !== -1) {
      await tx.shopStockEntry.update({
        where: { id: existingStock.id },
        data: { quantity: existingStock.quantity + payload.quantity },
      });
    }
  } else {
    await tx.shopStockEntry.create({
      data: {
        id: payload.newStockEntryId,
        shopId: shop.id,
        itemDefinitionId: item.definitionId,
        priceOverride: null,
        quantity: payload.quantity,
      },
    });
  }
}

/**
 * BUG-008 — `equip` persistor with auto-split. When the source row has
 * quantity > 1, splits off a fresh quantity-1 row (using
 * `newItemInstanceId` from the action payload) and equips THAT.
 * When quantity is already 1 (no split needed), degrades to the plain
 * flag flip on the source row. Mirrors the reducer arm's behavior so
 * client + server converge on the same rows.
 */
async function persistEquip(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'equip' }>['payload'],
): Promise<void> {
  const source = await tx.itemInstance.findUniqueOrThrow({
    where: { id: payload.itemInstanceId },
  });
  if (source.quantity <= 1) {
    await tx.itemInstance.update({
      where: { id: source.id },
      data: { equipped: true },
    });
    return;
  }
  if (payload.newItemInstanceId === undefined) {
    throw new Error(
      `equip: source row has quantity ${String(source.quantity)}; payload must include newItemInstanceId for the auto-split path.`,
    );
  }
  await tx.itemInstance.update({
    where: { id: source.id },
    data: { quantity: source.quantity - 1 },
  });
  await tx.itemInstance.create({
    data: {
      id: payload.newItemInstanceId,
      definitionId: source.definitionId,
      ownerType: source.ownerType,
      ownerId: source.ownerId,
      containerInstanceId: source.containerInstanceId,
      quantity: 1,
      equipped: true,
      attuned: false,
      identified: source.identified,
      hint: source.hint,
      currentCharges: source.currentCharges,
      customName: source.customName,
      notes: source.notes,
      ...(source.conditionOverrides !== null && source.conditionOverrides !== undefined
        ? { conditionOverrides: source.conditionOverrides }
        : {}),
    },
  });
}

/**
 * BUG-008 — `attune` persistor with auto-split. Mirrors `persistEquip`.
 */
async function persistAttune(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'attune' }>['payload'],
): Promise<void> {
  const source = await tx.itemInstance.findUniqueOrThrow({
    where: { id: payload.itemInstanceId },
  });
  if (source.quantity <= 1) {
    await tx.itemInstance.update({
      where: { id: source.id },
      data: { attuned: true },
    });
    return;
  }
  if (payload.newItemInstanceId === undefined) {
    throw new Error(
      `attune: source row has quantity ${String(source.quantity)}; payload must include newItemInstanceId for the auto-split path.`,
    );
  }
  await tx.itemInstance.update({
    where: { id: source.id },
    data: { quantity: source.quantity - 1 },
  });
  await tx.itemInstance.create({
    data: {
      id: payload.newItemInstanceId,
      definitionId: source.definitionId,
      ownerType: source.ownerType,
      ownerId: source.ownerId,
      containerInstanceId: source.containerInstanceId,
      quantity: 1,
      equipped: false,
      attuned: true,
      identified: source.identified,
      hint: source.hint,
      currentCharges: source.currentCharges,
      customName: source.customName,
      notes: source.notes,
      ...(source.conditionOverrides !== null && source.conditionOverrides !== undefined
        ? { conditionOverrides: source.conditionOverrides }
        : {}),
    },
  });
}

/**
 * BUG-008 completion — `unequip` with re-stack. Flips `equipped: false`
 * and attempts to merge the row back into a matching mundane stack in
 * the same location. Symmetric to the reducer's
 * `applyFlagFlipWithRestack` helper.
 *
 * Merge only fires when both flags are false AND `currentCharges` is
 * null — mirrors the reducer's guard so client + server converge.
 */
async function persistUnequip(tx: Prisma.TransactionClient, itemInstanceId: string): Promise<void> {
  const source = await tx.itemInstance.findUniqueOrThrow({ where: { id: itemInstanceId } });
  const patched = { ...source, equipped: false };
  await restackOrPatch(tx, patched);
}

/**
 * BUG-008 completion — `unattune` with re-stack. Mirrors `persistUnequip`.
 */
async function persistUnattune(
  tx: Prisma.TransactionClient,
  itemInstanceId: string,
): Promise<void> {
  const source = await tx.itemInstance.findUniqueOrThrow({ where: { id: itemInstanceId } });
  const patched = { ...source, attuned: false };
  await restackOrPatch(tx, patched);
}

/**
 * BUG-008 completion — shared helper for the unequip/unattune persistors.
 * Given a row with the flag already patched (in memory), either:
 *   - Merge into a matching mundane stack (delete source, bump target),
 *     OR
 *   - Persist the patched row (simple update on the source's id).
 */
async function restackOrPatch(
  tx: Prisma.TransactionClient,
  patched: {
    id: string;
    ownerId: string;
    definitionId: string;
    notes: string | null;
    containerInstanceId: string | null;
    equipped: boolean;
    attuned: boolean;
    currentCharges: number | null;
    quantity: number;
  },
): Promise<void> {
  const nowMundane =
    patched.equipped === false && patched.attuned === false && patched.currentCharges === null;
  if (!nowMundane) {
    await tx.itemInstance.update({
      where: { id: patched.id },
      data: { equipped: patched.equipped, attuned: patched.attuned },
    });
    return;
  }
  const target = await tx.itemInstance.findFirst({
    where: {
      id: { not: patched.id },
      ownerId: patched.ownerId,
      definitionId: patched.definitionId,
      notes: patched.notes,
      containerInstanceId: patched.containerInstanceId,
      equipped: false,
      attuned: false,
      currentCharges: null,
    },
  });
  if (target === null) {
    // No merge target — persist the flag flip on the source.
    await tx.itemInstance.update({
      where: { id: patched.id },
      data: { equipped: patched.equipped, attuned: patched.attuned },
    });
    return;
  }
  // Merge: delete source, bump target quantity.
  await tx.itemInstance.delete({ where: { id: patched.id } });
  await tx.itemInstance.update({
    where: { id: target.id },
    data: { quantity: target.quantity + patched.quantity },
  });
}

async function persistUseCharge(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'use-charge' }>['payload'],
): Promise<void> {
  const amount = payload.amount ?? 1;
  const row = await tx.itemInstance.findUniqueOrThrow({ where: { id: payload.itemInstanceId } });
  if (row.currentCharges === null) {
    throw new Error('use-charge: row has no currentCharges; reducer should have rejected.');
  }
  const next = row.currentCharges - amount;
  if (next < 0) throw new Error('use-charge: would go below 0.');
  await tx.itemInstance.update({
    where: { id: row.id },
    data: { currentCharges: next },
  });
}

async function persistRecharge(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'recharge' }>['payload'],
): Promise<void> {
  if (payload.mode === 'batch') {
    // Find all Inventory items for the character whose def's rechargeRule
    // matches `trigger`, and full-recharge or partial-recharge each.
    const character = await tx.character.findUniqueOrThrow({
      where: { id: payload.characterId },
    });
    const inventoryItems = await tx.itemInstance.findMany({
      where: { ownerId: character.inventoryStashId },
      include: { definition: true },
    });
    for (const row of inventoryItems) {
      if (
        row.definition.chargesMax === null ||
        row.definition.chargesRechargeRule === null ||
        row.currentCharges === null
      ) {
        continue;
      }
      // Translate underscore back to kebab for trigger compare.
      const defTrigger = row.definition.chargesRechargeRule.replace('_', '-') as
        | 'dawn'
        | 'dusk'
        | 'long-rest'
        | 'short-rest'
        | 'custom'
        | 'none';
      if (defTrigger !== payload.trigger) continue;
      const amount = payload.amounts?.[row.id];
      const max = row.definition.chargesMax;
      const next = amount === undefined ? max : Math.min(row.currentCharges + amount, max);
      await tx.itemInstance.update({
        where: { id: row.id },
        data: { currentCharges: next },
      });
    }
    return;
  }
  // single / manual
  const row = await tx.itemInstance.findUniqueOrThrow({
    where: { id: payload.itemInstanceId },
    include: { definition: true },
  });
  if (row.definition.chargesMax === null || row.currentCharges === null) {
    throw new Error('recharge: row has no charges block.');
  }
  const max = row.definition.chargesMax;
  const amount = payload.amount;
  const next = amount === undefined ? max : Math.min(row.currentCharges + amount, max);
  await tx.itemInstance.update({
    where: { id: row.id },
    data: { currentCharges: next },
  });
}

async function persistIdentify(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'identify' }>['payload'],
): Promise<void> {
  const data: Prisma.ItemInstanceUpdateInput = { identified: payload.identified };
  if (Object.prototype.hasOwnProperty.call(payload, 'hint')) {
    // Distinguish "key absent" (don't touch) from "key present"
    // (set, including undefined = clear).
    data.hint = payload.hint ?? null;
  }
  await tx.itemInstance.update({ where: { id: payload.itemInstanceId }, data });
}

/**
 * R6.4 — batch-identify. Flips `identified` on every party ItemInstance
 * with matching `definitionId` whose current value differs from the
 * payload target. Uses `updateMany` predicate-filtered so concurrent
 * dispatches can't double-flip: rows already in the target state are
 * silently skipped by the predicate. `partyId` is derived from
 * `actor.partyId` (SECURITY §2.1) so the update is party-scoped via the
 * stash → party join.
 */
async function persistIdentifyBatch(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'identify-batch' }>['payload'],
  actor: Actor,
): Promise<void> {
  // Fetch every stash id in the actor's party so the ItemInstance
  // filter is party-scoped. This mirrors the reducer's iteration over
  // `state.items` (which is already party-scoped in AppState).
  const stashRows = await tx.stash.findMany({
    where: { partyId: actor.partyId },
    select: { id: true },
  });
  const stashIds = stashRows.map((s) => s.id);
  if (stashIds.length === 0) return;

  const data: Prisma.ItemInstanceUpdateManyMutationInput = {
    identified: payload.identified,
  };
  if (Object.prototype.hasOwnProperty.call(payload, 'hint')) {
    data.hint = payload.hint ?? null;
  }
  await tx.itemInstance.updateMany({
    where: {
      definitionId: payload.definitionId,
      identified: { not: payload.identified },
      ownerId: { in: stashIds },
    },
    data,
  });
}

async function persistEditCharacter(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'edit-character' }>['payload'],
): Promise<void> {
  const data: Prisma.CharacterUpdateInput = {};
  if (payload.patch.species !== undefined) data.species = payload.patch.species;
  if (payload.patch.class !== undefined) data.class = payload.patch.class;
  if (payload.patch.level !== undefined) data.level = payload.patch.level;
  if (payload.patch.str !== undefined) data.strScore = payload.patch.str;
  if (payload.patch.maxAttunement !== undefined) data.maxAttunement = payload.patch.maxAttunement;
  await tx.character.update({ where: { id: payload.characterId }, data });
}

/**
 * R10.5 — parse the `Character.wishlist` Json column into typed entries.
 * The column is `unknown` on read; validate through `wishlistEntrySchema`
 * at the boundary (SECURITY §3.4 — trust nothing crossing a boundary).
 */
function parseWishlist(raw: unknown): WishlistEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((e) => wishlistEntrySchema.parse(e));
}

async function persistWishlistAdd(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'wishlist-add' }>['payload'],
): Promise<void> {
  const character = await tx.character.findUniqueOrThrow({
    where: { id: payload.characterId },
    select: { wishlist: true },
  });
  const current = parseWishlist(character.wishlist);
  if (current.some((e) => e.id === payload.entry.id)) {
    // Reducer already rejected this; defensive parity.
    throw new Error(`wishlist-add: duplicate entry id ${payload.entry.id}`);
  }
  const next = [...current, payload.entry];
  await tx.character.update({
    where: { id: payload.characterId },
    data: { wishlist: next },
  });
}

async function persistWishlistRemove(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'wishlist-remove' }>['payload'],
): Promise<void> {
  const character = await tx.character.findUniqueOrThrow({
    where: { id: payload.characterId },
    select: { wishlist: true },
  });
  const current = parseWishlist(character.wishlist);
  const next = current.filter((e) => e.id !== payload.entryId);
  if (next.length === current.length) {
    throw new Error(`wishlist-remove: entry ${payload.entryId} not in wishlist`);
  }
  await tx.character.update({
    where: { id: payload.characterId },
    data: { wishlist: next },
  });
}

/**
 * R4.1.b — `delete-character` cascade in the DB.
 *
 * Mirrors the reducer's cascade ordering (see `deleteCharacter` in
 * `@app/rules/reducer`):
 *   1. Re-point every `ItemInstance` whose owner stash belongs to the
 *      character into the party's Recovered Loot stash; clear equip /
 *      attune flags and the container parent (the item is no longer in
 *      any Inventory).
 *   2. Roll the aggregated currency across the character's stashes into
 *      Recovered Loot's `CurrencyHolding`.
 *   3. Drop the character's stash rows (the CurrencyHolding rows
 *      cascade via FK).
 *   4. Clear `PartyMembership.characterId` on the owning user's player
 *      row (slot reserved for a fresh character per roadmap R4.1).
 *   5. Drop the Character row.
 *
 * The matching log slices are appended by the log-builder; this
 * persistor only writes the entity deltas.
 */
async function persistDeleteCharacter(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'delete-character' }>['payload'],
): Promise<void> {
  await cascadeCharacterToRecoveredLootDb(tx, payload.characterId);
}

/**
 * R4.1.b/c — shared DB cascade used by `persistDeleteCharacter` and
 * `persistLeaveParty`. Mirrors the reducer's
 * `cascadeCharacterToRecoveredLoot` in `@app/rules/reducer`:
 *   1. Re-point every `ItemInstance` whose owner stash belongs to the
 *      character into the party's Recovered Loot stash; clear equip /
 *      attune flags and the container parent (the item is no longer in
 *      any Inventory).
 *   2. Roll the aggregated currency across the character's stashes into
 *      Recovered Loot's `CurrencyHolding`.
 *   3. Drop the character's stash rows (the CurrencyHolding rows
 *      cascade via FK).
 *   4. Clear `PartyMembership.characterId` on the owning user's player
 *      row.
 *   5. Drop the Character row.
 *
 * The matching log slices are appended by the log-builder; this
 * persistor only writes the entity deltas.
 */
async function cascadeCharacterToRecoveredLootDb(
  tx: Prisma.TransactionClient,
  characterId: string,
): Promise<void> {
  const character = await tx.character.findUniqueOrThrow({
    where: { id: characterId },
  });
  const recoveredLoot = await tx.stash.findFirstOrThrow({
    where: { partyId: character.partyId, scope: toDbStashScope('recovered-loot') },
  });

  // Collect every stash this character owns.
  const ownedStashes = await tx.stash.findMany({
    where: { ownerCharacterId: character.id, scope: toDbStashScope('character') },
    select: { id: true },
  });
  const ownedStashIds = ownedStashes.map((s) => s.id);

  // 1. Move items.
  if (ownedStashIds.length > 0) {
    await tx.itemInstance.updateMany({
      where: { ownerId: { in: ownedStashIds } },
      data: {
        ownerId: recoveredLoot.id,
        containerInstanceId: null,
        equipped: false,
        attuned: false,
      },
    });

    // 2. Roll currency: aggregate first, then one update on Recovered Loot.
    const aggregate = await tx.currencyHolding.aggregate({
      where: { stashId: { in: ownedStashIds } },
      _sum: { cp: true, sp: true, ep: true, gp: true, pp: true },
    });
    const cp = aggregate._sum.cp ?? 0;
    const sp = aggregate._sum.sp ?? 0;
    const ep = aggregate._sum.ep ?? 0;
    const gp = aggregate._sum.gp ?? 0;
    const pp = aggregate._sum.pp ?? 0;
    if (cp !== 0 || sp !== 0 || ep !== 0 || gp !== 0 || pp !== 0) {
      await tx.currencyHolding.update({
        where: { stashId: recoveredLoot.id },
        data: {
          cp: { increment: cp },
          sp: { increment: sp },
          ep: { increment: ep },
          gp: { increment: gp },
          pp: { increment: pp },
        },
      });
    }
  }

  // 3. Clear PartyMembership.characterId on the owning user's player row.
  //    Must happen BEFORE dropping the Character row because the membership's
  //    `characterId` FK to Character is ON DELETE NO ACTION (no cascade).
  await tx.partyMembership.updateMany({
    where: { characterId: character.id, role: 'player' },
    data: { characterId: null },
  });

  // 4. Drop the Character row BEFORE the owned stashes — order is load-bearing.
  //    `Character.inventoryStashId → Stash.id` is `ON DELETE RESTRICT`, so
  //    deleting the Inventory stash WHILE the Character still references it
  //    raises a runtime FK violation regardless of `DEFERRABLE INITIALLY
  //    DEFERRED` (deferral only delays the check; RESTRICT rejects either
  //    way). Dropping the Character first removes the reference, then the
  //    Stash delete becomes a free row removal. BUG-001 fix (2026-06-30).
  await tx.character.delete({ where: { id: character.id } });

  // 5. Drop owned stashes (CurrencyHolding cascades via FK).
  if (ownedStashIds.length > 0) {
    await tx.stash.deleteMany({ where: { id: { in: ownedStashIds } } });
  }
}

/**
 * R4.1.c — `leave-party`. Mirrors the reducer's `leaveParty` in
 * `@app/rules/reducer`. Reduces in two DB phases inside the same
 * `$transaction`:
 *
 *   1. If the leaver has a player membership with `characterId !==
 *      null`, run `cascadeCharacterToRecoveredLootDb` (items + currency
 *      → Recovered Loot; drop character + stashes + holdings + clear
 *      that player row's characterId — though that last write is
 *      redundant with step 2 since the whole row gets soft-deleted).
 *   2. Soft-delete every active `PartyMembership` row for the leaver in
 *      this party. The `(userId, partyId, role)` composite PK means up
 *      to two rows (dm + player) flip together.
 *   3. Banker auto-clear stub (carryforward for R4.2). Today
 *      `Party.bankerUserId` is always NULL so the conditional never
 *      fires; R4.2 widens both the column and the conditional.
 *
 * Reducer guards (sole-member / sole-DM rejection) have already run
 * client-side; the server's `checkGuard` re-runs the same guards on
 * every push. Defense-in-depth: we still fetch the post-cascade member
 * count here and refuse to leave a party with zero remaining active
 * members, surfacing as a 500 rather than silently archiving (the
 * archive flow lives on a separate server route per the R4.1.e plan).
 */
async function persistLeaveParty(
  tx: Prisma.TransactionClient,
  actor: Actor,
  ctx: ReducerContext,
): Promise<void> {
  const actorUserId = actor.userId;
  const partyId = actor.partyId;

  // Resolve the leaver's character (if any) via their active player row.
  const playerRow = await tx.partyMembership.findFirst({
    where: { userId: actorUserId, partyId, role: 'player', leftAt: null },
    select: { characterId: true },
  });
  if (playerRow !== null && playerRow.characterId !== null) {
    await cascadeCharacterToRecoveredLootDb(tx, playerRow.characterId);
  }

  // Soft-delete every active membership row for the leaver in this party.
  const now = new Date(ctx.now());
  await tx.partyMembership.updateMany({
    where: { userId: actorUserId, partyId, leftAt: null },
    data: { leftAt: now },
  });

  // Banker auto-clear stub. R4.2 widens `Party.bankerUserId`.
  // Today this is a no-op except in tests that manually seed a non-null
  // banker (none ship in R4.1).
  await tx.party.updateMany({
    where: { id: partyId, bankerUserId: actorUserId },
    data: { bankerUserId: null },
  });

  // Defense-in-depth: if the cascade drained the party of all active
  // members, surface as a 500 rather than persist a zombie party. The
  // sole-member archive flow runs on a separate route (R4.1.e) — clients
  // should never land here.
  const remainingActive = await tx.partyMembership.count({
    where: { partyId, leftAt: null },
  });
  if (remainingActive === 0) {
    throw new Error('leave-party: server cascade emptied the party; use archive flow instead');
  }
}

/**
 * R4.1.d — `kick-player`. Mirrors `persistLeaveParty` parameterised on
 * `kickedUserId`. Self-kick and kicking a DM are rejected by the
 * reducer + the §8.1 guard layer before this runs, but we re-check
 * defensively at the DB boundary.
 *
 * Steps:
 *   1. If the kicked user has an active player row with a non-null
 *      `characterId`, cascade their character to Recovered Loot.
 *   2. Soft-delete every active membership row for the kicked user.
 *   3. Banker auto-clear stub (R4.2 widens).
 */
async function persistKickPlayer(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'kick-player' }>['payload'],
  actor: Actor,
  ctx: ReducerContext,
): Promise<void> {
  const partyId = actor.partyId;
  const kickedUserId = payload.kickedUserId;

  if (kickedUserId === actor.userId) {
    throw new Error('kick-player: actor cannot kick themselves');
  }

  // Resolve the kicked user's character (if any) via their active player row.
  const playerRow = await tx.partyMembership.findFirst({
    where: { userId: kickedUserId, partyId, role: 'player', leftAt: null },
    select: { characterId: true },
  });
  if (playerRow !== null && playerRow.characterId !== null) {
    await cascadeCharacterToRecoveredLootDb(tx, playerRow.characterId);
  }

  // Soft-delete every active membership row for the kicked user.
  const now = new Date(ctx.now());
  await tx.partyMembership.updateMany({
    where: { userId: kickedUserId, partyId, leftAt: null },
    data: { leftAt: now },
  });

  // Banker auto-clear stub. R4.2 widens `Party.bankerUserId`.
  await tx.party.updateMany({
    where: { id: partyId, bankerUserId: kickedUserId },
    data: { bankerUserId: null },
  });
}

/**
 * R4.1.e — `join-party`. Creates a new `role='player'` PartyMembership
 * row for the actor in `actor.partyId`. The invite-code redemption +
 * `already_member` check happen in the `POST /parties/join` route
 * before this persistor runs.
 */
async function persistJoinParty(
  tx: Prisma.TransactionClient,
  actor: Actor,
  ctx: ReducerContext,
): Promise<void> {
  const now = new Date(ctx.now());
  // BUG-002: PartyMembership PK is the composite (userId, partyId, role)
  // and the R4.1.c/d departure cascades soft-delete (leftAt: <timestamp>;
  // row preserved for audit). A plain `create` against the same tuple
  // raises P2002. Use `upsert` so a previously-left user's row is
  // reactivated atomically: `leftAt → null`, `joinedAt → now`,
  // `characterId → null` (their prior character was cascaded to
  // Recovered Loot on leave per BUG-001's path). The route's
  // `already_member` check (filtered by `leftAt: null`) catches the
  // double-active-join case before we get here, so the `update` branch
  // only ever fires against soft-deleted rows.
  await tx.partyMembership.upsert({
    where: {
      userId_partyId_role: {
        userId: actor.userId,
        partyId: actor.partyId,
        role: 'player',
      },
    },
    create: {
      userId: actor.userId,
      partyId: actor.partyId,
      role: 'player',
      characterId: null,
      joinedAt: now,
      leftAt: null,
    },
    update: {
      leftAt: null,
      joinedAt: now,
      characterId: null,
    },
  });
}

/**
 * R4.2.a — `appoint-banker`. Single `Party.update` setting
 * `bankerUserId`. The guard layer (`@app/shared/guards/map.ts`) already
 * vetted the §3.14 invariants (DM actor, target is an active player,
 * memberCount ≥ 2, no prior Banker, not self-appoint). At the DB layer
 * we only need to atomically write the column.
 */
async function persistAppointBanker(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'appoint-banker' }>['payload'],
  actor: Actor,
): Promise<void> {
  await tx.party.update({
    where: { id: actor.partyId },
    data: { bankerUserId: payload.bankerUserId },
  });
}

/**
 * R4.2.a — `revoke-banker`. Clears `Party.bankerUserId`. Guard layer
 * ensures a Banker is currently set + actor is DM. The cascade emits
 * synthetic `revoke-banker` entries from `persistLeaveParty` /
 * `persistKickPlayer` directly (those already null the column inline),
 * so this function only fires on direct DM dispatches.
 */
async function persistRevokeBanker(tx: Prisma.TransactionClient, actor: Actor): Promise<void> {
  await tx.party.update({
    where: { id: actor.partyId },
    data: { bankerUserId: null },
  });
}

/**
 * R4.3.a — `dm-transfer`. DM hands the DM role to another active player
 * per OUTLINE §3.14 + §8.3. Guard layer (`dmTransferGuard`) already
 * vetted DM-only actor, no-self-transfer, target-is-active-player.
 *
 * Steps (in order):
 *   1. Soft-delete outgoing DM's active `role='dm'` row.
 *   2. Upsert incoming DM's `role='dm'` row per BUG-002 lesson:
 *      composite PK `(userId, partyId, role)` + soft-delete means a
 *      previous DM's row may already exist. `create` would collide
 *      with P2002; `upsert` reactivates in place.
 *   3. Auto-mint outgoing DM's `role='player'` row if missing
 *      (DM-only outgoing DM case per OUTLINE §3.14 amendment).
 *      Uses `upsert` for the same BUG-002 reason — the outgoing DM
 *      may have a soft-deleted `role='player'` row from a historical
 *      leave+rejoin.
 *   4. Update `Party.ownerUserId` and conditionally clear
 *      `Party.bankerUserId` when the incoming DM was the Banker
 *      (§4 invariant `bankerUserId != ownerUserId`).
 */
async function persistDmTransfer(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'dm-transfer' }>['payload'],
  actor: Actor,
  ctx: ReducerContext,
): Promise<void> {
  const partyId = actor.partyId;
  const oldDmUserId = actor.userId;
  const newDmUserId = payload.newDmUserId;
  const now = new Date(ctx.now());

  // Step 1: soft-delete outgoing DM's dm row.
  await tx.partyMembership.update({
    where: {
      userId_partyId_role: {
        userId: oldDmUserId,
        partyId,
        role: 'dm',
      },
    },
    data: { leftAt: now },
  });

  // Step 2: upsert incoming DM's dm row (BUG-002: composite PK +
  // soft-delete requires upsert, never create).
  await tx.partyMembership.upsert({
    where: {
      userId_partyId_role: {
        userId: newDmUserId,
        partyId,
        role: 'dm',
      },
    },
    create: {
      userId: newDmUserId,
      partyId,
      role: 'dm',
      characterId: null,
      joinedAt: now,
      leftAt: null,
    },
    update: {
      leftAt: null,
      joinedAt: now,
      characterId: null,
    },
  });

  // Step 3: auto-mint outgoing DM's player row if it doesn't exist
  // as active (DM-only outgoing DM case). Upsert again for BUG-002
  // shape — a historical soft-deleted player row (e.g., left + rejoined
  // before this transfer) must be reactivated in place, not re-created.
  // In the common case (party-creator with both dm+player rows), this
  // is a no-op because the row is already active and the update sets
  // `leftAt: null` (already null) and `joinedAt: now` (bumps the
  // current-tenure timestamp; matches reducer semantics).
  const existingPlayerRow = await tx.partyMembership.findUnique({
    where: {
      userId_partyId_role: {
        userId: oldDmUserId,
        partyId,
        role: 'player',
      },
    },
  });
  if (existingPlayerRow === null) {
    // No historical row — plain create is safe (composite PK is unique).
    await tx.partyMembership.create({
      data: {
        userId: oldDmUserId,
        partyId,
        role: 'player',
        characterId: null,
        joinedAt: now,
        leftAt: null,
      },
    });
  } else if (existingPlayerRow.leftAt !== null) {
    // Reactivate soft-deleted historical row (BUG-002 upsert shape).
    await tx.partyMembership.update({
      where: {
        userId_partyId_role: {
          userId: oldDmUserId,
          partyId,
          role: 'player',
        },
      },
      data: { leftAt: null, joinedAt: now, characterId: null },
    });
  }
  // else: row is active — leave in place. The bootstrap party-creator
  // case falls here (both dm + player rows minted at bootstrap; player
  // row is untouched by this transfer).

  // Step 4: swap party ownership + conditional Banker auto-clear.
  const party = await tx.party.findUniqueOrThrow({
    where: { id: partyId },
    select: { bankerUserId: true },
  });
  const bankerCascade = party.bankerUserId === newDmUserId;
  await tx.party.update({
    where: { id: partyId },
    data: {
      ownerUserId: newDmUserId,
      ...(bankerCascade ? { bankerUserId: null } : {}),
    },
  });
}

/**
 * R4.2.d — persist a Banker `split-evenly` distribution. Server re-runs
 * the shared `splitEvenly` helper against the current pool balance
 * (same math the reducer just ran client-side), then debits the pool
 * by N × share and credits each recipient Inventory by share. Every
 * update is inside the enclosing `tx` so a partial failure rolls back
 * the whole distribution.
 *
 * The log entries (1 terminal + N transfer) are already built by the
 * reducer via `buildLogEntry`; this persistor only touches the
 * CurrencyHolding rows.
 */
async function persistSplitEvenly(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'split-evenly' }>['payload'],
  _ctx: ReducerContext,
): Promise<void> {
  const { fromStashId, recipientCharacterIds } = payload;
  const n = recipientCharacterIds.length;
  const pool = await tx.currencyHolding.findUniqueOrThrow({
    where: { stashId: fromStashId },
  });
  const { share, remainder } = currency.splitEvenly(
    { cp: pool.cp, sp: pool.sp, ep: pool.ep, gp: pool.gp, pp: pool.pp },
    n,
  );

  // Set pool directly to the computed remainder (structural equality
  // per splitEvenly's contract: N × share + remainder === pool).
  await tx.currencyHolding.update({
    where: { stashId: fromStashId },
    data: {
      cp: remainder.cp,
      sp: remainder.sp,
      ep: remainder.ep,
      gp: remainder.gp,
      pp: remainder.pp,
    },
  });

  const characters = await tx.character.findMany({
    where: { id: { in: recipientCharacterIds } },
    select: { id: true, inventoryStashId: true },
  });
  const invByCharId = new Map(characters.map((c) => [c.id, c.inventoryStashId]));

  for (const charId of recipientCharacterIds) {
    const invStashId = invByCharId.get(charId);
    if (invStashId === undefined) {
      throw new Error(`split-evenly: character ${charId} not found in DB`);
    }
    await tx.currencyHolding.update({
      where: { stashId: invStashId },
      data: {
        cp: { increment: share.cp },
        sp: { increment: share.sp },
        ep: { increment: share.ep },
        gp: { increment: share.gp },
        pp: { increment: share.pp },
      },
    });
  }
}

// Silence unused-import lint for translators that future actions will use.
void toDbRechargeRule;

// -------------------- RH3.1 GameSession persistors --------------------

/**
 * RH3.1 — persist `start-game-session`. Mints a fresh GameSession row
 * with `isCurrent: true` and a per-party monotone `number`. When the
 * caller opts into `endCurrentFirst`, demotes any prior current row
 * within the same transaction — the partial UNIQUE index on
 * `(partyId) WHERE isCurrent = true` would otherwise reject the
 * insert.
 *
 * `number` is computed from the DB (`MAX(number) + 1`) rather than
 * threaded from the reducer — keeps the persistor authoritative and
 * avoids desync when parallel batches would ever try to mint numbers
 * (out of scope in v1 but the pattern is cheap).
 *
 * `date` defaults to `ctx.now()`'s calendar-date portion when the
 * client omits it (mirrors the reducer's default).
 */
async function persistStartGameSession(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'start-game-session' }>['payload'],
  actor: Actor,
  ctx: ReducerContext,
): Promise<void> {
  if (payload.endCurrentFirst === true) {
    await tx.gameSession.updateMany({
      where: { partyId: actor.partyId, isCurrent: true },
      data: { isCurrent: false },
    });
  }

  const now = new Date(ctx.now());
  const dateStr = payload.date ?? ctx.now().slice(0, 10);
  const agg = await tx.gameSession.aggregate({
    where: { partyId: actor.partyId },
    _max: { number: true },
  });
  const nextNumber = (agg._max.number ?? 0) + 1;

  await tx.gameSession.create({
    data: {
      id: payload.newGameSessionId,
      partyId: actor.partyId,
      number: nextNumber,
      date: new Date(`${dateStr}T00:00:00.000Z`),
      notes: payload.notes ?? null,
      isCurrent: true,
      createdAt: now,
    },
  });
}

/**
 * RH3.1 — persist `end-game-session`. Flips `isCurrent: false` on the
 * party's current session. No-op if no row matches (the reducer
 * rejects `no_current_session` first; this is defense-in-depth).
 */
async function persistEndGameSession(tx: Prisma.TransactionClient, actor: Actor): Promise<void> {
  await tx.gameSession.updateMany({
    where: { partyId: actor.partyId, isCurrent: true },
    data: { isCurrent: false },
  });
}

/**
 * R5.2 — persist `edit-game-session-notes`. Updates the notes column
 * on the target `GameSession`. Empty-string `notes` is normalized to
 * `NULL` in the DB (matches `persistStartGameSession`'s
 * `notes: payload.notes ?? null` convention — the schema column is
 * nullable, and NULL represents "no notes").
 *
 * The reducer rejects unknown ids + no-ops, so an update landing here
 * should always find a matching row; if it doesn't, Prisma surfaces
 * the mismatch via `RecordNotFound` which propagates back to the
 * client as a 500 (matches the RH2.3 "should never happen"
 * defence-in-depth pattern).
 */
async function persistEditGameSessionNotes(
  tx: Prisma.TransactionClient,
  payload: Extract<Action, { type: 'edit-game-session-notes' }>['payload'],
): Promise<void> {
  await tx.gameSession.update({
    where: { id: payload.gameSessionId },
    data: { notes: payload.notes.length === 0 ? null : payload.notes },
  });
}
