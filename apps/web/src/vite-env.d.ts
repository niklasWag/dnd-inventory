/// <reference types="vite/client" />

/**
 * Build-time env vars exposed to the web app via Vite.
 *
 * `VITE_SERVER_URL` selects between local-only mode (unset/empty) and
 * server mode (a fully-qualified origin, e.g. `https://app.example.com`
 * or `http://localhost:3000`). See `apps/web/src/lib/serverMode.ts`.
 */
interface ImportMetaEnv {
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
