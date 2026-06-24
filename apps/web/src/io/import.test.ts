import { describe, expect, it, beforeEach } from 'vitest';

import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';
import { bootstrap, bootstrapWithHomebrew } from '@/test/fixtures';

import { buildExportEnvelope, serializeExport, type ExportSnapshot } from './export';
import { importFromText } from './import';

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

function snapshotFromStore(): ExportSnapshot {
  const s = useStore.getState();
  return { appState: s.appState, log: s.log };
}

const FIXED_NOW = new Date('2026-06-24T15:30:00.000Z');

describe('importFromText (M7)', () => {
  it('rejects non-JSON input', () => {
    const r = importFromText('not json {');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not valid JSON/i);
  });

  it('rejects valid JSON that is not an envelope', () => {
    const r = importFromText('{"hello":"world"}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not a valid D&D Inventory export/i);
  });

  it('rejects schemaVersion 0 / 2', () => {
    const v0 = importFromText(
      JSON.stringify({
        schemaVersion: 0,
        exportedAt: '2026-06-24T00:00:00.000Z',
        appVersion: '0.0.0',
        seedVersion: 0,
        payload: { appState: null, log: [] },
      }),
    );
    expect(v0.ok).toBe(false);
    const v2 = importFromText(
      JSON.stringify({
        schemaVersion: 2,
        exportedAt: '2026-06-24T00:00:00.000Z',
        appVersion: '0.0.0',
        seedVersion: 0,
        payload: { appState: null, log: [] },
      }),
    );
    expect(v2.ok).toBe(false);
  });

  it('accepts an empty-state envelope', () => {
    const text = serializeExport(
      buildExportEnvelope({ appState: null, log: [] }, { now: FIXED_NOW }),
    );
    const r = importFromText(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.snapshot.appState).toBeNull();
      expect(r.snapshot.log).toEqual([]);
      expect(r.meta.characterName).toBeNull();
      expect(r.meta.itemRowCount).toBe(0);
    }
  });

  it('extracts meta for a populated export', () => {
    bootstrap({ name: 'Bara', species: 'Elf', class: 'Bard', level: 2, str: 10 });
    const text = serializeExport(
      buildExportEnvelope(snapshotFromStore(), { now: FIXED_NOW, appVersion: '0.0.0' }),
    );
    const r = importFromText(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.meta.characterName).toBe('Bara');
      expect(r.meta.logEntryCount).toBeGreaterThan(0);
      expect(r.meta.appVersion).toBe('0.0.0');
      expect(r.meta.exportedAt).toBe('2026-06-24T15:30:00.000Z');
    }
  });
});

/**
 * The MVP DoD round-trip test (per `docs/roadmap.md` line 699):
 * export → wipe-equivalent → import restores state including log,
 * bit-for-bit identical. We don't call `wipeAll()` between the two
 * halves because both halves operate on `ExportSnapshot` values, not
 * the store directly — what matters is the pure data round-trip.
 */
describe('round-trip identity (MVP DoD)', () => {
  it('export → JSON → import returns the same snapshot for a rich state', () => {
    // Build a non-trivial state: bootstrap + homebrew + an acquire to
    // confirm the log contains diverse TxTypes.
    const { homebrewDefId, inventoryStashId } = bootstrapWithHomebrew();
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: homebrewDefId,
        quantity: 3,
        source: 'custom-create',
      },
    });
    useStore.getState().dispatch({
      type: 'currency-change',
      payload: {
        stashId: inventoryStashId,
        delta: { cp: 0, sp: 0, ep: 0, gp: 17, pp: 0 },
        reason: 'deposit',
      },
    });

    const before = snapshotFromStore();
    const text = serializeExport(
      buildExportEnvelope(before, { now: FIXED_NOW, appVersion: '0.0.0' }),
    );

    const r = importFromText(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Bit-for-bit identity on appState + log.
    expect(r.snapshot.appState).toEqual(before.appState);
    expect(r.snapshot.log).toEqual(before.log);

    // Also: the snapshot's log entry ids and timestamps are preserved
    // — exporting must NOT mint new ids on the way out.
    expect(r.snapshot.log.map((e) => e.id)).toEqual(before.log.map((e) => e.id));
    expect(r.snapshot.log.map((e) => e.timestamp)).toEqual(
      before.log.map((e) => e.timestamp),
    );
  });
});
