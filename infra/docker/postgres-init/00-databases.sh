#!/usr/bin/env bash
# Creates the secondary test DB on first-init of the Postgres volume.
# Idempotent via Docker's `docker-entrypoint-initdb.d` contract (scripts
# only run when the volume is empty).
set -euo pipefail
# --dbname is required: without it psql defaults to a DB named after the
# user, which the postgres:18-alpine image no longer auto-creates.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  CREATE DATABASE dnd_inv_test;
  GRANT ALL PRIVILEGES ON DATABASE dnd_inv_test TO "$POSTGRES_USER";
EOSQL
