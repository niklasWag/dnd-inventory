/**
 * The single source of truth for the app's version string. Settings UI
 * displays it; M7 export envelope stamps it into the JSON wrapper. Vite
 * + vitest both `define` `__APP_VERSION__` from `package.json#version`
 * at build/test time (see vite.config.ts + vitest.config.ts).
 *
 * Re-export rather than inlining the global so callers don't depend on
 * a TypeScript-ambient symbol — they import a normal named export.
 */
export const APP_VERSION: string = __APP_VERSION__;
