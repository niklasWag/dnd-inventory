/**
 * Vitest setup for `apps/server`. Loaded by `vitest.config.ts`.
 *
 * - Ensures `DATABASE_URL` points at the integration-test DB
 *   (`dnd_inv_test`) rather than the dev DB. The test DB is created by
 *   `infra/docker/postgres-init/00-databases.sh` on first-init of the
 *   Postgres volume.
 * - Pure unit tests (e.g. `mappers.test.ts`) don't touch the DB and run
 *   regardless of whether Postgres is reachable. DB-touching tests gate
 *   themselves on `process.env.DATABASE_URL_TEST` being set.
 */
import 'dotenv/config';

// Prefer the test DB; fall back to the explicit overload so the test DB
// is always used when the runner imports PrismaClient with the singleton.
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://dnd:dnd@localhost:5434/dnd_inv_test';
