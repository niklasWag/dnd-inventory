import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { CapacityBar } from './CapacityBar';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';

import { bootstrap, bootstrapWithHomebrew } from '@/test/fixtures';

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

/** Renders the capacity bar (it reads the store directly). */
function renderBar(characterId: string): void {
  render(<CapacityBar characterId={characterId} />);
}

/** Bootstrap with STR 10 (capacity 150; variant: 5×STR=50, 10×STR=100). */
function bootstrapStr10(): ReturnType<typeof bootstrap> {
  return bootstrap({
    name: 'Bara',
    species: 'Human',
    size: 'medium',
    class: 'Wizard',
    level: 1,
    str: 10,
  });
}

/**
 * Load N copies of a homebrew item with `weightLbsEach` into Inventory.
 * Returns the def id; tests usually don't need it.
 */
function loadInventoryWith(weightLbsEach: number, quantity: number): string {
  const { homebrewDefId, inventoryStashId } = bootstrapWithHomebrew({
    name: 'Test Block',
    category: 'gear',
    weight: weightLbsEach,
  });
  useStore.getState().dispatch({
    type: 'acquire',
    payload: {
      stashId: inventoryStashId,
      definitionId: homebrewDefId,
      quantity,
      source: 'custom-create',
    },
  });
  return homebrewDefId;
}

/** Patch the (sole) character to STR 10. */
function setStr10(): void {
  useStore.setState((s) => {
    if (s.appState === null) return s;
    return {
      ...s,
      appState: {
        ...s.appState,
        characters: s.appState.characters.map((c) => ({
          ...c,
          abilityScores: { STR: 10 },
        })),
      },
    };
  });
}

describe('CapacityBar (R1.1)', () => {
  it('renders nothing when encumbranceRule is off (default after bootstrap)', () => {
    const { characterId } = bootstrapStr10();
    const { container } = render(<CapacityBar characterId={characterId} />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when appState is null (pre-bootstrap)', () => {
    const { container } = render(<CapacityBar characterId="never-existed" />);
    expect(container.firstChild).toBeNull();
  });

  describe('phb rule', () => {
    it('renders "0 / 150 lb" for an empty inventory under STR 10', () => {
      const { characterId } = bootstrapStr10();
      useStore
        .getState()
        .dispatch({ type: 'set-encumbrance', payload: { characterId, rule: 'phb', enforce: false } });

      renderBar(characterId);

      expect(screen.getByText(/0 \/ 150 lb/)).toBeInTheDocument();
      expect(screen.getByText(/\(Medium · PHB\)/)).toBeInTheDocument();
    });

    it('stays unencumbered at exactly STR × 15 = 150 lb (strict > boundary)', () => {
      loadInventoryWith(150, 1);
      const characterId = useStore.getState().appState!.characters[0]!.id;
      setStr10();
      useStore
        .getState()
        .dispatch({ type: 'set-encumbrance', payload: { characterId, rule: 'phb', enforce: false } });

      renderBar(characterId);

      expect(screen.getByText(/150 \/ 150 lb/)).toBeInTheDocument();
      expect(screen.queryByText(/over capacity|encumbered/i)).not.toBeInTheDocument();
    });

    it('flips to over-capacity (heavily-encumbered) at 151 lb', () => {
      loadInventoryWith(151, 1);
      const characterId = useStore.getState().appState!.characters[0]!.id;
      setStr10();
      useStore
        .getState()
        .dispatch({ type: 'set-encumbrance', payload: { characterId, rule: 'phb', enforce: false } });

      renderBar(characterId);

      expect(screen.getByText(/151 \/ 150 lb \(over capacity\)/)).toBeInTheDocument();
    });

    it('never shows the intermediate "(encumbered)" label under phb', () => {
      loadInventoryWith(75, 1); // well within cap (75 ≤ 150)
      const characterId = useStore.getState().appState!.characters[0]!.id;
      setStr10();
      useStore
        .getState()
        .dispatch({ type: 'set-encumbrance', payload: { characterId, rule: 'phb', enforce: false } });

      renderBar(characterId);

      expect(screen.queryByText(/\(encumbered\)/)).not.toBeInTheDocument();
    });
  });

  describe('variant rule', () => {
    it('stays unencumbered at exactly 5×STR (boundary; strict >)', () => {
      loadInventoryWith(50, 1);
      const characterId = useStore.getState().appState!.characters[0]!.id;
      setStr10();
      useStore
        .getState()
        .dispatch({ type: 'set-encumbrance', payload: { characterId, rule: 'variant', enforce: false } });

      renderBar(characterId);

      expect(screen.getByText(/50 \/ 150 lb/)).toBeInTheDocument();
      expect(screen.queryByText(/encumbered/)).not.toBeInTheDocument();
      expect(screen.getByText(/\(Medium · Variant\)/)).toBeInTheDocument();
    });

    it('flips to encumbered at 5×STR + 1', () => {
      loadInventoryWith(51, 1);
      const characterId = useStore.getState().appState!.characters[0]!.id;
      setStr10();
      useStore
        .getState()
        .dispatch({ type: 'set-encumbrance', payload: { characterId, rule: 'variant', enforce: false } });

      renderBar(characterId);

      expect(screen.getByText(/51 \/ 150 lb \(encumbered\)/)).toBeInTheDocument();
    });

    it('flips to heavily-encumbered at 10×STR + 1', () => {
      loadInventoryWith(101, 1);
      const characterId = useStore.getState().appState!.characters[0]!.id;
      setStr10();
      useStore
        .getState()
        .dispatch({ type: 'set-encumbrance', payload: { characterId, rule: 'variant', enforce: false } });

      renderBar(characterId);

      expect(screen.getByText(/101 \/ 150 lb \(heavily encumbered\)/)).toBeInTheDocument();
    });
  });

  describe('enforce flag', () => {
    it('shows " · enforced" badge when enforceEncumbrance is true', () => {
      const { characterId } = bootstrapStr10();
      useStore
        .getState()
        .dispatch({ type: 'set-encumbrance', payload: { characterId, rule: 'variant', enforce: true } });

      renderBar(characterId);

      expect(screen.getByText(/· enforced/)).toBeInTheDocument();
    });

    it('omits the badge when enforce is false', () => {
      const { characterId } = bootstrapStr10();
      useStore
        .getState()
        .dispatch({ type: 'set-encumbrance', payload: { characterId, rule: 'variant', enforce: false } });

      renderBar(characterId);

      expect(screen.queryByText(/enforced/)).not.toBeInTheDocument();
    });
  });

  describe('size scaling (PHB 2024 p. 366)', () => {
    it('Small STR 10 under phb caps at 75 lb (× 0.5)', () => {
      // Bootstrap a Small character (e.g., Halfling).
      bootstrap({
        name: 'Pip',
        species: 'Halfling',
        size: 'small',
        class: 'Rogue',
        level: 1,
        str: 10,
      });
      const characterId = useStore.getState().appState!.characters[0]!.id;
      useStore
        .getState()
        .dispatch({ type: 'set-encumbrance', payload: { characterId, rule: 'phb', enforce: false } });

      renderBar(characterId);

      expect(screen.getByText(/0 \/ 75 lb/)).toBeInTheDocument();
      expect(screen.getByText(/\(Small · PHB\)/)).toBeInTheDocument();
    });

    it('Large STR 10 under variant doubles the thresholds to 100 / 200', () => {
      bootstrap({
        name: 'Goliath',
        species: 'Goliath',
        size: 'large',
        class: 'Barbarian',
        level: 1,
        str: 10,
      });
      const characterId = useStore.getState().appState!.characters[0]!.id;
      useStore
        .getState()
        .dispatch({ type: 'set-encumbrance', payload: { characterId, rule: 'variant', enforce: false } });

      // Cap = STR×15×2 = 300; encumbered > 100; heavily > 200.
      renderBar(characterId);
      expect(screen.getByText(/0 \/ 300 lb/)).toBeInTheDocument();
      expect(screen.getByText(/\(Large · Variant\)/)).toBeInTheDocument();
    });
  });
});
