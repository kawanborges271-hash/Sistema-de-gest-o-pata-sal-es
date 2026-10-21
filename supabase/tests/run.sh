#!/usr/bin/env bash
# Aplica as migrations num Postgres local (sem Supabase) e roda os testes SQL.
# Usa as variáveis padrão do psql: PGHOST, PGPORT, PGUSER.
#   PGHOST=localhost PGPORT=5432 PGUSER=postgres supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="salon_os_test"
psql -d postgres -qX -c "drop database if exists $DB" -c "create database $DB"
psql -d "$DB" -qX -v ON_ERROR_STOP=1 -f supabase/tests/00_supabase_stub.sql
for f in supabase/migrations/*.sql; do
  psql -d "$DB" -qX -v ON_ERROR_STOP=1 -f "$f" >/dev/null
done
for f in supabase/tests/[1-9]*.sql; do
  echo "== $f"
  psql -d "$DB" -qX -v ON_ERROR_STOP=1 -f "$f"
done
echo "OK: todos os testes passaram"
