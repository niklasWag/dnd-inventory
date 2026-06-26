import { describe, expect, it, afterEach, vi } from 'vitest';

/**
 * `serverMode.ts` reads `import.meta.env.VITE_SERVER_URL` ONCE at module
 * load. Tests therefore use `vi.resetModules()` + `vi.stubEnv()` to force
 * re-evaluation under different values. The default test environment (set
 * by `test/setup.ts`) is local mode.
 */
describe('serverMode', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('treats unset VITE_SERVER_URL as local mode', async () => {
    vi.stubEnv('VITE_SERVER_URL', '');
    vi.resetModules();
    const mod = await import('./serverMode.js');
    expect(mod.SERVER_URL).toBeNull();
    expect(mod.isServerMode).toBe(false);
  });

  it('treats whitespace-only VITE_SERVER_URL as local mode', async () => {
    vi.stubEnv('VITE_SERVER_URL', '   ');
    vi.resetModules();
    const mod = await import('./serverMode.js');
    expect(mod.SERVER_URL).toBeNull();
    expect(mod.isServerMode).toBe(false);
  });

  it('captures a configured origin in server mode', async () => {
    vi.stubEnv('VITE_SERVER_URL', 'http://localhost:3000');
    vi.resetModules();
    const mod = await import('./serverMode.js');
    expect(mod.SERVER_URL).toBe('http://localhost:3000');
    expect(mod.isServerMode).toBe(true);
  });

  it('trims trailing slashes', async () => {
    vi.stubEnv('VITE_SERVER_URL', 'https://app.example.com///');
    vi.resetModules();
    const mod = await import('./serverMode.js');
    expect(mod.SERVER_URL).toBe('https://app.example.com');
    expect(mod.isServerMode).toBe(true);
  });
});
