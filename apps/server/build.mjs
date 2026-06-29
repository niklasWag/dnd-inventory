// Production build: bundle src/index.ts (+ transitive TS, incl. the Prisma 7
// generated client at prisma/generated/prisma/) into a single dist/index.js
// that Node can run directly.
//
// Why bundling rather than `tsc`:
//   - The Prisma 7 generated client emits ESM with extensionless relative
//     imports (`from "./enums"`). Node's pure-ESM resolver rejects those;
//     esbuild's bundler resolves them internally.
//   - One file matches the README / roadmap intent of `node dist/index.js`.
//
// Runtime deps (everything in `dependencies`) stay external — they live in
// node_modules at runtime. Workspace packages (`@app/*`) are bundled.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(await readFile(resolve(here, 'package.json'), 'utf8'));

const external = [
  // Runtime deps: live in node_modules, never bundled.
  ...Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith('@app/')),
  // Node built-ins.
  'node:*',
];

await build({
  entryPoints: [resolve(here, 'src/index.ts')],
  outfile: resolve(here, 'dist/index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // ESM in Node needs a banner that polyfills CJS-style globals if any
  // transitive dep reaches for them. Cheap insurance.
  banner: {
    js: [
      "import { createRequire as __createRequire } from 'node:module';",
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
  external,
  sourcemap: 'linked',
  logLevel: 'info',
});
