import type { AppState, TransactionLogEntry } from '@app/shared';

import { buildStashLabels, shortStashId } from './stashLabels';

/**
 * R5.3 — human-readable per-log-entry summary shared between
 * `ItemHistory.tsx` (per-item view on ItemDetail) and
 * `HistoryScreen.tsx` (party-wide timeline). Extracted from the
 * inline `summarize()` in ItemHistory and extended to cover every
 * log-entry variant so the party History view has a single string
 * per row.
 *
 * The returned string is the "what happened" bit; callers render
 * the timestamp + actor role + actor name separately.
 *
 * `viewingItemInstanceId` is optional — when set, the `split`
 * summary phrases the entry from the perspective of the row being
 * viewed (source vs new). When absent (HistoryScreen), the summary
 * mentions both sides.
 */
export function summarizeLogEntry(
  entry: TransactionLogEntry,
  state: AppState,
  viewingItemInstanceId?: string,
): string {
  const stashLabels = buildStashLabels(state.stashes, state.characters, state.log);
  const stashLabel = (id: string): string => stashLabels.get(id) ?? shortStashId(id);

  const characterName = (id: string): string =>
    state.characters.find((c) => c.id === id)?.name ?? id.slice(0, 8);

  const sessionNumber = (id: string): string | null => {
    const gs = state.gameSessions.find((g) => g.id === id);
    return gs !== undefined ? String(gs.number) : null;
  };

  const containerLabel = (id: string): string => {
    const row = state.items.find((i) => i.id === id);
    if (row === undefined) return 'container';
    const def = state.catalog.find((d) => d.id === row.definitionId);
    const baseName = row.customName ?? def?.name ?? 'container';
    const suffix = row.notes !== undefined ? ` (${row.notes})` : '';
    return `${baseName}${suffix}`;
  };

  const itemName = (id: string): string => {
    const row = state.items.find((i) => i.id === id);
    if (row === undefined) return `item ${id.slice(0, 8)}`;
    const def = state.catalog.find((d) => d.id === row.definitionId);
    return row.customName ?? def?.name ?? `item ${id.slice(0, 8)}`;
  };

  switch (entry.type) {
    case 'acquire': {
      const item = itemName(entry.payload.itemInstanceId);
      return `Acquired ${item} \u00d7${String(entry.payload.quantity)} into ${stashLabel(entry.payload.stashId)} (source: ${entry.payload.source})`;
    }
    case 'consume': {
      const item = itemName(entry.payload.itemInstanceId);
      return entry.payload.removed
        ? `Removed ${item} (consumed last ${String(entry.payload.quantity)})`
        : `Consumed ${item} \u00d7${String(entry.payload.quantity)}`;
    }
    case 'edit-item-instance':
      return `Edited ${itemName(entry.payload.itemInstanceId)} \u2014 ${entry.payload.changedFields.join(' + ')}`;
    case 'transfer': {
      const item = itemName(entry.payload.itemInstanceId);
      const sameStash = entry.payload.fromStashId === entry.payload.toStashId;
      const toLabel = stashLabel(entry.payload.toStashId);
      if (sameStash && typeof entry.payload.toContainerInstanceId === 'string') {
        return `Packed ${item} \u00d7${String(entry.payload.quantity)} into ${containerLabel(entry.payload.toContainerInstanceId)} (in ${toLabel})`;
      }
      if (sameStash && entry.payload.toContainerInstanceId === null) {
        return `Took ${item} \u00d7${String(entry.payload.quantity)} out of container (in ${toLabel})`;
      }
      return `Transferred ${item} \u00d7${String(entry.payload.quantity)} from ${stashLabel(entry.payload.fromStashId)} to ${toLabel}`;
    }
    case 'split': {
      const qty = String(entry.payload.quantity);
      const isSource = viewingItemInstanceId === entry.payload.sourceInstanceId;
      const isNew = viewingItemInstanceId === entry.payload.newInstanceId;
      if (isSource) return `Split \u00d7${qty} into a new row`;
      if (isNew) return `Split off from another stack (\u00d7${qty})`;
      const item = itemName(entry.payload.sourceInstanceId);
      return `Split ${item} \u00d7${qty} into a new row (in ${stashLabel(entry.payload.stashId)})`;
    }
    case 'equip':
      return `Equipped ${itemName(entry.payload.itemInstanceId)} on ${characterName(entry.payload.characterId)}`;
    case 'unequip':
      return `Unequipped ${itemName(entry.payload.itemInstanceId)} on ${characterName(entry.payload.characterId)}`;
    case 'attune':
      return `Attuned ${itemName(entry.payload.itemInstanceId)} to ${characterName(entry.payload.characterId)}${entry.payload.overrideCap === true ? ' (DM cap override)' : ''}`;
    case 'unattune':
      return `Unattuned ${itemName(entry.payload.itemInstanceId)} from ${characterName(entry.payload.characterId)}`;
    case 'use-charge':
      return `Used \u00d7${String(entry.payload.amount)} charge${entry.payload.amount === 1 ? '' : 's'} on ${itemName(entry.payload.itemInstanceId)}`;
    case 'recharge': {
      const delta = entry.payload.to - entry.payload.from;
      const triggerLabel =
        entry.payload.trigger === 'manual' ? 'manual' : entry.payload.trigger.replace('-', ' ');
      return `Recharged ${itemName(entry.payload.itemInstanceId)} +${String(delta)} (${String(entry.payload.from)} \u2192 ${String(entry.payload.to)}, ${triggerLabel})`;
    }
    case 'identify': {
      const { previousIdentified, newIdentified, previousHint, newHint } = entry.payload;
      const item = itemName(entry.payload.itemInstanceId);
      if (previousIdentified !== newIdentified) {
        const base = newIdentified ? `Identified ${item}` : `Marked ${item} unidentified`;
        if (previousHint !== newHint) {
          if (newHint !== undefined && newHint.length > 0) return `${base} (hint: "${newHint}")`;
          return `${base} (hint cleared)`;
        }
        return base;
      }
      if (newHint === undefined) return `Cleared unidentified hint on ${item}`;
      if (previousHint === undefined) return `Set unidentified hint on ${item} to "${newHint}"`;
      return `Updated unidentified hint on ${item} to "${newHint}"`;
    }
    case 'create-character':
      return entry.payload.dmOnly === true
        ? 'Created party (DM only)'
        : `Created character ${entry.payload.name ?? '?'}`;
    case 'delete-character':
      return `Deleted character ${entry.payload.name} (${String(entry.payload.itemCount)} items to Recovered Loot)`;
    case 'rename-character':
      return `Renamed character "${entry.payload.oldName}" \u2192 "${entry.payload.newName}"`;
    case 'edit-character':
      return `Edited ${characterName(entry.payload.characterId)} \u2014 ${entry.payload.changedFields.join(' + ')}`;
    case 'set-encumbrance':
      return `Party encumbrance: ${entry.payload.oldRule}\u2192${entry.payload.newRule}${entry.payload.oldEnforce !== entry.payload.newEnforce ? `, enforce=${String(entry.payload.newEnforce)}` : ''}`;
    case 'create-stash':
      return `Created stash "${entry.payload.name}" (${entry.payload.scope})`;
    case 'rename-stash':
      return `Renamed stash "${entry.payload.oldName}" \u2192 "${entry.payload.newName}"`;
    case 'delete-stash':
      return `Deleted stash "${entry.payload.name}" (${String(entry.payload.itemCount)} items to Recovered Loot)`;
    case 'currency-change': {
      const { cp, sp, ep, gp, pp } = entry.payload.delta;
      const parts: string[] = [];
      if (pp !== 0) parts.push(`${pp > 0 ? '+' : ''}${String(pp)}pp`);
      if (gp !== 0) parts.push(`${gp > 0 ? '+' : ''}${String(gp)}gp`);
      if (ep !== 0) parts.push(`${ep > 0 ? '+' : ''}${String(ep)}ep`);
      if (sp !== 0) parts.push(`${sp > 0 ? '+' : ''}${String(sp)}sp`);
      if (cp !== 0) parts.push(`${cp > 0 ? '+' : ''}${String(cp)}cp`);
      const delta = parts.length > 0 ? parts.join(' ') : 'no change';
      const reason = entry.payload.reason !== undefined ? ` (${entry.payload.reason})` : '';
      return `Currency ${delta} on ${stashLabel(entry.payload.stashId)}${reason}`;
    }
    case 'currency-transfer': {
      const { cp, sp, ep, gp, pp } = entry.payload.delta;
      const parts: string[] = [];
      if (pp > 0) parts.push(`${String(pp)}pp`);
      if (gp > 0) parts.push(`${String(gp)}gp`);
      if (ep > 0) parts.push(`${String(ep)}ep`);
      if (sp > 0) parts.push(`${String(sp)}sp`);
      if (cp > 0) parts.push(`${String(cp)}cp`);
      const amount = parts.length > 0 ? parts.join(' ') : 'nothing';
      return `Transferred ${amount} from ${stashLabel(entry.payload.fromStashId)} to ${stashLabel(entry.payload.toStashId)}`;
    }
    case 'create-homebrew':
      return `Created homebrew item "${entry.payload.name}"`;
    case 'edit-homebrew':
      return `Edited homebrew \u2014 ${entry.payload.changedFields.join(' + ')}`;
    case 'delete-homebrew':
      return `Deleted homebrew item "${entry.payload.name}"`;
    case 'rename-party':
      return `Renamed party "${entry.payload.oldName}" \u2192 "${entry.payload.newName}"`;
    case 'seed-catalog':
      return `Catalog seeded (v${String(entry.payload.seedVersion)}: +${String(entry.payload.addedDefinitionIds.length)}, ~${String(entry.payload.updatedDefinitionIds.length)})`;
    case 'leave-party':
      return 'Left party';
    case 'join-party':
      return 'Joined party';
    case 'kick-player':
      return `Kicked player`;
    case 'appoint-banker':
      return `Appointed banker`;
    case 'revoke-banker':
      return `Revoked banker (${entry.payload.reason})`;
    case 'dm-transfer':
      return `DM role transferred`;
    case 'split-evenly':
      return `Split currency evenly among ${String(entry.payload.recipientCharacterIds.length)} recipient${entry.payload.recipientCharacterIds.length === 1 ? '' : 's'}`;
    case 'start-game-session': {
      const label = sessionNumber(entry.payload.gameSessionId) ?? String(entry.payload.number);
      return `Started Session ${label} (${entry.payload.date})`;
    }
    case 'end-game-session': {
      const label = sessionNumber(entry.payload.gameSessionId) ?? String(entry.payload.number);
      return `Ended Session ${label}`;
    }
    case 'edit-game-session-notes': {
      const label = sessionNumber(entry.payload.gameSessionId) ?? String(entry.payload.number);
      return `Updated Session ${label} notes`;
    }
  }
}
