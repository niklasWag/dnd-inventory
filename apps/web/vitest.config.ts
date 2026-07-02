import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, './package.json'), 'utf8')) as {
  version: string;
};

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // 2026-07-01 flake postmortem — component tests that click into a
    // dialog on top of a large catalog (CatalogBrowser: ~350 PHB+DMG
    // rows with one Duplicate button per row) occasionally exceed the
    // 5-s Vitest default when parallel workers compete for CPU. The
    // tests are structurally fine (12/12 pass in isolation, 5 runs in a
    // row); timing headroom is the fix. 15 s is well clear of the
    // ~1-2 s these tests take standalone. Server suite uses 30 s for
    // real-DB tests; matching upward here to `15_000` keeps the two
    // configs in the same order of magnitude.
    testTimeout: 15_000,
  },
});
