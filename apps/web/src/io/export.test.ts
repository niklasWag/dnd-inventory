import { describe, expect, it, beforeEach } from 'vitest';

import { exportEnvelopeSchema } from '@app/shared';

import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';
import { bootstrap, bootstrapWithHomebrew } from '@/test/fixtures';

import {
  buildExportEnvelope,
  buildExportFilename,
  exportToFile,
  serializeExport,
  type ExportSnapshot,
} from './export';

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

function snapshotFromStore(): ExportSnapshot {
  const s = useStore.getState();
  return { appState: s.appState, log: s.log };
}

const FIXED_NOW = new Date('2026-06-24T15:30:00.000Z');

describe('buildExportEnvelope (M7)', () => {
  it('wraps a fresh bootstrap snapshot in the v1 envelope', () => {
    bootstrap();
    const env = buildExportEnvelope(snapshotFromStore(), {
      now: FIXED_NOW,
      appVersion: '0.0.0',
    });
    expect(env.schemaVersion).toBe(1);
    expect(env.exportedAt).toBe('2026-06-24T15:30:00.000Z');
    expect(env.appVersion).toBe('0.0.0');
    expect(env.seedVersion).toBeGreaterThan(0); // bootstrap loaded PHB seed
    expect(env.payload.appState).not.toBeNull();
    expect(env.payload.log.length).toBeGreaterThan(0);
  });

  it('handles a pre-character (null appState) snapshot', () => {
    const env = buildExportEnvelope({ appState: null, log: [] }, {
      now: FIXED_NOW,
      appVersion: '0.0.0',
    });
    expect(env.payload.appState).toBeNull();
    expect(env.seedVersion).toBe(0);
  });

  it('output validates against exportEnvelopeSchema (zero re-validation diff)', () => {
    bootstrap();
    const env = buildExportEnvelope(snapshotFromStore(), {
      now: FIXED_NOW,
      appVersion: '0.0.0',
    });
    expect(() => exportEnvelopeSchema.parse(env)).not.toThrow();
  });
});

describe('buildExportFilename (M7)', () => {
  it('slugifies the first character name + appends ISO date', () => {
    bootstrap({ name: 'Bara of Waterdeep', species: 'Half-Elf', class: 'Rogue', level: 1, str: 12 });
    const filename = buildExportFilename(snapshotFromStore(), { now: FIXED_NOW });
    expect(filename).toBe('dnd-inv-bara-of-waterdeep-2026-06-24.json');
  });

  it('collapses non-alphanumerics and lowercases', () => {
    bootstrap({ name: "Thorin & 'Iron-Fist'!", species: 'Dwarf', class: 'Fighter', level: 1, str: 16 });
    const filename = buildExportFilename(snapshotFromStore(), { now: FIXED_NOW });
    expect(filename).toBe('dnd-inv-thorin-iron-fist-2026-06-24.json');
  });

  it('uses "empty" slug when no character exists yet', () => {
    const filename = buildExportFilename({ appState: null, log: [] }, { now: FIXED_NOW });
    expect(filename).toBe('dnd-inv-empty-2026-06-24.json');
  });

  it('caps the slug at 40 chars', () => {
    const long = 'a'.repeat(80);
    bootstrap({ name: long, species: 'Human', class: 'Wizard', level: 1, str: 8 });
    const filename = buildExportFilename(snapshotFromStore(), { now: FIXED_NOW });
    // 'dnd-inv-' + 40 'a's + '-YYYY-MM-DD.json'
    expect(filename).toBe(`dnd-inv-${'a'.repeat(40)}-2026-06-24.json`);
  });
});

describe('serializeExport (M7)', () => {
  it('produces pretty-printed JSON', () => {
    bootstrap();
    const env = buildExportEnvelope(snapshotFromStore(), { now: FIXED_NOW });
    const text = serializeExport(env);
    // 2-space indent — eye-checkable when a power user opens the file.
    expect(text).toContain('  "schemaVersion": 1');
    expect(text).toContain('  "payload": {');
  });

  it('JSON.parse(text) round-trips through exportEnvelopeSchema', () => {
    bootstrapWithHomebrew();
    const env = buildExportEnvelope(snapshotFromStore(), { now: FIXED_NOW });
    const text = serializeExport(env);
    const reparsed = exportEnvelopeSchema.parse(JSON.parse(text));
    expect(reparsed).toEqual(env);
  });
});

describe('exportToFile (M7) — composition', () => {
  it('invokes the injected downloader with filename + text', () => {
    bootstrap();
    let captured: { filename: string; text: string } | null = null;
    const filename = exportToFile(snapshotFromStore(), {
      now: FIXED_NOW,
      appVersion: '0.0.0',
      download: (f, t) => {
        captured = { filename: f, text: t };
      },
    });
    expect(captured).not.toBeNull();
    expect(captured!.filename).toBe(filename);
    expect(captured!.filename).toBe('dnd-inv-thorin-2026-06-24.json');
    // Sanity: the text round-trips through the envelope schema.
    expect(() => exportEnvelopeSchema.parse(JSON.parse(captured!.text))).not.toThrow();
  });
});
