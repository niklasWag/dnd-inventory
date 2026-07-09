# R8.4.d.i — Playwright E2E runner image.
#
# Pin: v1.61.1-noble (mcr.microsoft.com/playwright). Matches the
# `@playwright/test` version pinned in the root package.json — Playwright
# refuses to run when the CLI version disagrees with the library version,
# so bumps must land in both places.
#
# Ubuntu 24.04 (Noble Numbat) base — current LTS, supported through
# 2029. Jammy (22.04) is also available (`v1.61.1-jammy`) if a spec
# ever needs the older glibc, but Noble is the forward-leaning default.
#
# Build context is the repo root (`context: ..` in the compose file) so
# we can copy the workspace's `pnpm-lock.yaml` and manifest to satisfy
# `pnpm install --frozen-lockfile`. `.dockerignore` (next to this file)
# strips the app / package sources — the runner only needs `@playwright/
# test` from the root devDependencies plus the `e2e/` directory itself.
FROM mcr.microsoft.com/playwright:v1.61.1-noble

# Match the repo's packageManager field so `pnpm install` runs against
# the same lockfile format the workspace expects.
RUN npm i -g pnpm@11.8.0

WORKDIR /repo

# Root workspace manifests first — cache-friendly (source changes don't
# invalidate the install layer).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# `--filter-prod=false` includes devDependencies (`@playwright/test`
# lives there). `--frozen-lockfile` fails fast if the lockfile drifts.
RUN pnpm install --frozen-lockfile --filter-prod=false --ignore-scripts

# e2e sources.
COPY e2e/ ./e2e/

WORKDIR /repo/e2e
# Reporter list comes from `playwright.config.ts` (list + html). Passing
# `--reporter=...` on the CLI here would OVERRIDE the config, so leave
# it off — the HTML report bind-mount depends on the config's reporter
# array being the one that engages.
CMD ["pnpm", "exec", "playwright", "test"]
