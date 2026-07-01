/**
 * Health route — `GET /healthz`. Reports liveness + readiness:
 *   - `db: 'ok' | 'down'`        — `SELECT 1` against Postgres
 *   - `seedVersion: number|null` — current Metadata.seedVersion value
 *   - HTTP 200 when DB reachable AND seedVersion matches the bundled
 *     `SEED_VERSION`; 503 otherwise.
 *
 * R3.2 will add `/auth/*`; R3.4 will add `/sync`. This route stays
 * unauthenticated (used by the docker-compose healthcheck and by future
 * load balancers).
 */
import { SEED_VERSION } from '@app/seeds';
import type { FastifyInstance } from 'fastify';

interface HealthBody {
  status: 'ok' | 'degraded';
  db: 'ok' | 'down';
  seedVersion: number | null;
}

export function registerHealthRoute(app: FastifyInstance): void {
  app.get('/healthz', { logLevel: 'silent' }, async (_req, reply): Promise<HealthBody> => {
    let dbOk = false;
    try {
      await app.prisma.$queryRaw`SELECT 1`;
      dbOk = true;
    } catch (err) {
      app.log.error({ err }, 'healthz: db ping failed');
    }

    let seedVersion: number | null = null;
    if (dbOk) {
      const meta = await app.prisma.metadata.findUnique({ where: { key: 'seedVersion' } });
      if (typeof meta?.value === 'number' && Number.isInteger(meta.value)) {
        seedVersion = meta.value;
      }
    }

    const ok = dbOk && seedVersion === SEED_VERSION;
    reply.code(ok ? 200 : 503);
    return {
      status: ok ? 'ok' : 'degraded',
      db: dbOk ? 'ok' : 'down',
      seedVersion,
    };
  });
}
