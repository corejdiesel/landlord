#!/usr/bin/env bash
# One-time local database setup. Safe to re-run.
#
# Creates:
#   letsorted         the application role. NOT a superuser, and not granted
#                     BYPASSRLS, so the RLS test suite proves something real.
#   letsorted_bypass  a role that bypasses RLS, used ONLY by the ledger tamper
#                     tests to simulate an attacker with direct database access.
#                     The application never connects as this role.
#
# Requires superuser access (run as root, or set PSQL_SUPER).
set -euo pipefail

PSQL_SUPER=${PSQL_SUPER:-"su postgres -c"}

run() { eval "$PSQL_SUPER \"psql -v ON_ERROR_STOP=1 $1\""; }

echo "==> roles"
run "-c \\\"DO \\\\\\\$\\\\\\\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='letsorted') THEN
    CREATE ROLE letsorted LOGIN PASSWORD 'letsorted' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='letsorted_bypass') THEN
    CREATE ROLE letsorted_bypass LOGIN PASSWORD 'bypass' BYPASSRLS NOSUPERUSER;
  END IF;
END \\\\\\\$\\\\\\\$;\\\""

echo "==> databases"
for db in letsorted letsorted_test; do
  run "-tAc \\\"SELECT 1 FROM pg_database WHERE datname='$db'\\\"" | grep -q 1 \
    || run "-c \\\"CREATE DATABASE $db OWNER letsorted\\\""
done

echo "==> the bypass role needs owner rights to disable triggers in tamper tests"
run "-c \\\"GRANT letsorted TO letsorted_bypass\\\""

echo "Done. Now run: pnpm db:migrate"
