import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { readFileSync } from 'node:fs';

// Read package.json at config-load time so the build can stamp the
// app version into the bundle as a `__APP_VERSION__` global. The
// Settings screen + the M7 export envelope both pull from this one
// constant so they can never drift.
const pkg = JSON.parse(readFileSync(path.resolve(__dirname, './package.json'), 'utf8')) as {
  version: string;
};

/**
 * Vite 5+ `server` and `preview` enforce a host allow-list to defeat
 * DNS-rebinding attacks. When the container is reverse-proxied under
 * a public domain (Traefik / nginx / Caddy → `vite preview`), the
 * proxy forwards `Host: <public-domain>` and Vite responds with:
 *
 *   Blocked request. This host ("dnd.example.com") is not allowed.
 *   To allow this host, add "dnd.example.com" to "preview.allowedHosts"
 *   in vite.config.js.
 *
 * Populate `VITE_ALLOWED_HOSTS` with a comma-separated list of
 * hostnames the container will be reached under. Two convenience
 * shortcuts:
 *   - unset / empty → default `['localhost']` (dev + local docker).
 *   - `*` alone     → allow ANY host (production-behind-Traefik
 *     shortcut; safe when the reverse proxy is the only ingress and
 *     Fastify's CORS + `WEB_ORIGIN` already gate the API).
 *
 * The setting is applied to BOTH `preview` (production `vite preview`
 * in the docker image) and `server` (the local `vite dev` used when
 * someone points `--host 0.0.0.0` at a public hostname during dev).
 */
const rawAllowedHosts = (process.env.VITE_ALLOWED_HOSTS ?? '').trim();
const allowedHosts: true | string[] =
  rawAllowedHosts === '*'
    ? true
    : rawAllowedHosts === ''
      ? ['localhost']
      : rawAllowedHosts
          .split(',')
          .map((h) => h.trim())
          .filter((h) => h.length > 0);

// https://vitejs.dev/config/
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
  server: {
    port: 5173,
    strictPort: false,
    allowedHosts,
  },
  preview: {
    port: 5173,
    strictPort: false,
    allowedHosts,
  },
});
