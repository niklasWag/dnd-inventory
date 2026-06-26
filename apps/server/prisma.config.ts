// Prisma 7 mandatory config — replaces the previous schema-side `url = env(...)`.
// `dotenv/config` loads `.env` for local dev; production / Docker / CI sets
// DATABASE_URL via real env vars.
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
});
