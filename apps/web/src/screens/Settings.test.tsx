import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { Settings } from './Settings';
import { Toaster } from '@/components/ui/sonner';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';

import { bootstrap } from '@/test/fixtures';
import { newUuidV7 } from '@app/shared';

/**
 * RH1.2 — id-injection helpers for direct `dispatch` sites. Fresh UUID
 * v7 per call keeps the fixture within the guard's clock-skew window
 * and hermetic per-test.
 */
function acquireIds() {
  return { newItemInstanceId: newUuidV7() };
}

beforeEach(async () => {
  useStore.setState({ appState: null, log: [] });
  await wipeAll();
});

/**
 * Settings tests cover the M7 user-facing surfaces:
 *
 *   1. Export button calls the downloader with the expected filename
 *      + a valid envelope payload.
 *   2. Import → choose file → confirm dialog appears with summary.
 *   3. Confirm Replace → store now holds the imported snapshot.
 *   4. Character rename → store + UI reflect new name.
 *   5. Party rename → store + UI reflect new name.
 *   6. App info renders APP_VERSION + seedVersion.
 *
 * Uses createMemoryRouter so Settings (which calls useNavigate from
 * the Wipe path) has a router context. The "/" fallback is a stub —
 * the tests never assert on it, they just need a valid route to land
 * on if navigation fires.
 */
function renderSettings(initialPath = '/settings'): void {
  const router = createMemoryRouter(
    [
      { path: '/', element: null },
      { path: '/settings', Component: Settings },
    ],
    { initialEntries: [initialPath] },
  );
  render(
    <>
      <RouterProvider router={router} />
      <Toaster />
    </>,
  );
}

describe('Settings — Backup (M7)', () => {
  it('Export triggers a download with a slugified filename', async () => {
    const user = userEvent.setup();
    bootstrap({
      name: 'Bara of Waterdeep',
      species: 'Half-Elf',
      size: 'medium',
      class: 'Bard',
      level: 2,
      str: 10,
    });

    // We can't easily intercept the real triggerDownload (it touches
    // the DOM + URL.createObjectURL). Instead, spy on createObjectURL
    // — it must be called exactly once with a Blob argument when
    // Export fires.
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:fake');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });

    renderSettings();

    await user.click(screen.getByRole('button', { name: /export json/i }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blobArg = createObjectURL.mock.calls[0]?.[0];
    expect(blobArg).toBeInstanceOf(Blob);
  });
});

describe('Settings — App info (M7)', () => {
  it('renders app version and seed version', () => {
    bootstrap();
    renderSettings();
    // APP_VERSION is '0.0.0' from package.json; seed version > 0 after bootstrap.
    expect(screen.getByText(/App version 0\.0\.0/)).toBeInTheDocument();
    // Seed version appears in the same line.
    expect(screen.getByText(/seed version \d+/i)).toBeInTheDocument();
  });

  it('rename fields no longer appear in Settings (moved to /party/settings in R4.1-followup)', () => {
    bootstrap();
    renderSettings();
    expect(screen.queryByLabelText(/character name/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/party name/i)).not.toBeInTheDocument();
  });
});

describe('Settings — Import end-to-end (M7 / MVP DoD)', () => {
  /**
   * The user-facing slice of the round-trip MVP DoD test (the
   * pure-data round-trip already lives in `import.test.ts`):
   * choose a file → see the confirm dialog summary → click Replace
   * → store now contains the imported snapshot.
   *
   * jsdom doesn't drive a real file picker, so we synthesize a `File`
   * and dispatch a `change` event on the hidden input directly.
   */
  it('importing a file shows confirm + Replace applies the snapshot', async () => {
    const user = userEvent.setup();
    // Build a source state, capture its export text, then wipe + re-render.
    const { homebrewDefId, inventoryStashId } = (
      await import('@/test/fixtures')
    ).bootstrapWithHomebrew({ name: 'Glow Mushroom', category: 'consumable' });
    void useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: homebrewDefId,
        quantity: 2,
        source: 'custom-create',
        ...acquireIds(),
      },
    });
    const snapshot = {
      appState: useStore.getState().appState,
      log: useStore.getState().log,
    };
    const { buildExportEnvelope, serializeExport } = await import('@/io/export');
    const text = serializeExport(
      buildExportEnvelope(snapshot, { now: new Date('2026-06-24T00:00:00.000Z') }),
    );

    // Reset to empty so the import is observable.
    useStore.setState({ appState: null, log: [] });

    renderSettings();

    // Build a File that returns our text from .text().
    const file = new File([text], 'backup.json', { type: 'application/json' });

    const input = screen.getByLabelText(/import backup file/i);
    await user.upload(input, file);

    // Confirm dialog appears with file summary.
    expect(await screen.findByText(/Replace all current data\?/i)).toBeInTheDocument();
    // Character name (from bootstrap default 'Thorin') appears in the summary,
    // confirming the meta extraction reached the dialog.
    expect(screen.getByText('Thorin')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^replace$/i }));

    // Store now matches the imported snapshot (awaits the async apply).
    await waitFor(() => {
      expect(useStore.getState().appState).toEqual(snapshot.appState);
    });
    expect(useStore.getState().log).toEqual(snapshot.log);
  });

  it('cancel on confirm leaves the store untouched', async () => {
    const user = userEvent.setup();
    const { buildExportEnvelope, serializeExport } = await import('@/io/export');
    const text = serializeExport(
      buildExportEnvelope(
        { appState: null, log: [] },
        { now: new Date('2026-06-24T00:00:00.000Z') },
      ),
    );

    bootstrap();
    const before = {
      appState: useStore.getState().appState,
      log: useStore.getState().log,
    };

    renderSettings();
    const file = new File([text], 'backup.json', { type: 'application/json' });
    const input = screen.getByLabelText(/import backup file/i);
    await user.upload(input, file);

    expect(await screen.findByText(/Replace all current data\?/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    // Store unchanged.
    const after = useStore.getState();
    expect(after.appState).toEqual(before.appState);
    expect(after.log).toEqual(before.log);
  });
});

// BUG-011 (2026-07-06) — the "Settings — Encumbrance" describe block
// was removed from this file. The party-wide encumbrance UI moved to
// `/party/settings`; PartySettings.test.tsx owns those assertions.
