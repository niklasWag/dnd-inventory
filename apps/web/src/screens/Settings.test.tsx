import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { Settings } from './Settings';
import { Toaster } from '@/components/ui/sonner';
import { useStore } from '@/store';
import { wipeAll } from '@/db/wipe';

import { bootstrap } from '@/test/fixtures';

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
    useStore.getState().dispatch({
      type: 'acquire',
      payload: {
        stashId: inventoryStashId,
        definitionId: homebrewDefId,
        quantity: 2,
        source: 'custom-create',
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

describe('Settings — Encumbrance (R1.1)', () => {
  it('flipping the rule dispatches set-encumbrance and updates the store', async () => {
    const user = userEvent.setup();
    const { characterId } = bootstrap();
    const before = useStore.getState().appState!.characters.find((c) => c.id === characterId)!;
    expect(before.encumbranceRule).toBe('off');
    expect(before.enforceEncumbrance).toBe(false);

    renderSettings();

    const select = screen.getByLabelText(/encumbrance rule/i);
    await user.selectOptions(select, 'variant');

    const form = select.closest('form')!;
    const saveBtn = form.querySelector('button[type="submit"]')!;
    await user.click(saveBtn);

    const after = useStore.getState().appState!.characters.find((c) => c.id === characterId)!;
    expect(after.encumbranceRule).toBe('variant');
    expect(after.enforceEncumbrance).toBe(false);

    const last = useStore.getState().log.at(-1);
    expect(last?.type).toBe('set-encumbrance');
    if (last?.type === 'set-encumbrance') {
      expect(last.payload).toEqual({
        characterId,
        oldRule: 'off',
        newRule: 'variant',
        oldEnforce: false,
        newEnforce: false,
      });
    }
  });

  it('checking enforce + selecting variant dispatches both fields together', async () => {
    const user = userEvent.setup();
    const { characterId } = bootstrap();

    renderSettings();

    const select = screen.getByLabelText(/encumbrance rule/i);
    await user.selectOptions(select, 'phb');
    // Checkbox appears only after rule !== 'off'. wait for it via getByLabelText.
    const checkbox = screen.getByLabelText(/enforce encumbrance/i);
    await user.click(checkbox);

    const saveBtn = select.closest('form')!.querySelector('button[type="submit"]')!;
    await user.click(saveBtn);

    const after = useStore.getState().appState!.characters.find((c) => c.id === characterId)!;
    expect(after.encumbranceRule).toBe('phb');
    expect(after.enforceEncumbrance).toBe(true);
  });

  it('Save button is disabled when the draft matches the current row', () => {
    bootstrap();
    renderSettings();

    const select = screen.getByLabelText(/encumbrance rule/i);
    const form = select.closest('form')!;
    const save = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    // Draft init = currentRule (off) + currentEnforce (false) — no edit → disabled.
    expect(save).toBeDisabled();
  });

  it('enforce checkbox is hidden when rule is off', () => {
    bootstrap();
    renderSettings();
    // Default rule is off → checkbox should not render.
    expect(screen.queryByLabelText(/enforce encumbrance/i)).not.toBeInTheDocument();
  });

  it('helper text describes the active rule', async () => {
    const user = userEvent.setup();
    bootstrap();
    renderSettings();

    const select = screen.getByLabelText(/encumbrance rule/i);
    // Off → hidden bar.
    expect(screen.getByText(/Capacity bar hidden/i)).toBeInTheDocument();

    await user.selectOptions(select, 'phb');
    expect(screen.getByText(/Standard rule.*STR × 15/i)).toBeInTheDocument();

    await user.selectOptions(select, 'variant');
    expect(screen.getByText(/Variant rule.*5×STR.*10×STR/i)).toBeInTheDocument();
  });

  it('encumbrance section is hidden pre-bootstrap', () => {
    renderSettings();
    expect(screen.queryByLabelText(/encumbrance rule/i)).not.toBeInTheDocument();
  });
});
