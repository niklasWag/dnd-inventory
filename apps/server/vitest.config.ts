import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // DB-touching tests need real I/O; longer timeout than the web suite's 5s default.
    testTimeout: 30_000,
    // Don't run tests in parallel against the single test DB.
    fileParallelism: false,
    setupFiles: ['./src/test/setup.ts'],
  },
});
