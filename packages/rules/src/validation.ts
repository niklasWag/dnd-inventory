/**
 * Equip-time validation (OUTLINE §6 — `validation.ts`).
 *
 * Detects slot conflicts between an item the user is about to equip and
 * the set already equipped. R1.2 ships only the "two-handed weapon vs.
 * shield" conflict (PHB 2024 weapon properties). R2.x widens with
 * armor-on-armor and other slot-overlap rules once `ItemDefinition`
 * gains the `properties` shape.
 *
 * The rule is pure — no entity coupling. The caller passes a
 * `properties` lookup keyed by `definitionId` so the rule works against
 * whatever shape the catalog has at any given milestone. Unknown ids
 * resolve to the empty record (no properties → no conflicts).
 */

export interface EquipProperties {
  twoHanded?: boolean;
  shield?: boolean;
}

export interface ValidationIssue {
  code: string;
  message: string;
}

/**
 * Check whether equipping `itemDefinitionId` conflicts with the
 * currently equipped set. Returns one issue per conflict; an empty
 * array means "safe to equip".
 *
 * Conflict checks:
 *   - `two-handed-shield-conflict`: equipping a two-handed weapon while
 *     a shield is already equipped, OR equipping a shield while a
 *     two-handed weapon is already equipped. (PHB 2024 p. 213: a
 *     two-handed weapon occupies both hands; a shield occupies one.)
 */
export function validateEquip(
  itemDefinitionId: string,
  currentlyEquippedDefinitionIds: ReadonlyArray<string>,
  properties: ReadonlyMap<string, EquipProperties>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const incoming = properties.get(itemDefinitionId) ?? {};

  const equipped = currentlyEquippedDefinitionIds.map((id) => properties.get(id) ?? {});
  const hasShieldEquipped = equipped.some((p) => p.shield === true);
  const hasTwoHandedEquipped = equipped.some((p) => p.twoHanded === true);

  if (incoming.twoHanded === true && hasShieldEquipped) {
    issues.push({
      code: 'two-handed-shield-conflict',
      message: 'A two-handed weapon cannot be wielded while a shield is equipped.',
    });
  }
  if (incoming.shield === true && hasTwoHandedEquipped) {
    issues.push({
      code: 'two-handed-shield-conflict',
      message: 'A shield cannot be equipped while a two-handed weapon is wielded.',
    });
  }

  return issues;
}
