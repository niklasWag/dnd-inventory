#!/usr/bin/env bash
# Creates the secondary test DB on first-init of the Postgres volume.
# Idempotent via Docker's `docker-entrypoint-initdb.d` contract (scripts
# only run when the volume is empty).
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
  CREATE DATABASE dnd_inv_test;
  GRANT ALL PRIVILEGES ON DATABASE dnd_inv_test TO "$POSTGRES_USER";
EOSQL
