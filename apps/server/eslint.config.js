// apps/server local ESLint flat config — extends the root config.
import rootConfig from '../../eslint.config.js';

export default [
  {
    ignores: [
      'dist/**',
      'eslint.config.js',
      'vitest.config.ts',
      'prisma.config.ts',
      'prisma/migrations/**',
      // esbuild build script — not part of the tsconfig project, so the
      // type-aware parser can't load it.
      'build.mjs',
      // Prisma 7 generates TS sources here; never hand-edited and not
      // part of our tsconfig project (the import path is relative to the
      // package, so type-aware linting tries to load it and fails).
      'prisma/generated/**',
    ],
  },
  ...rootConfig,
];
