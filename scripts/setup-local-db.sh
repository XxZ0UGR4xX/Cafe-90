#!/usr/bin/env bash
# Crea roles y bases de datos LOCALES de desarrollo/test (idempotente). Ejecutar como root/postgres.
# Contraseñas de desarrollo desde env (RB_OWNER_PW / RB_APP_PW); valores por defecto sólo para uso local.
set -euo pipefail
OWNER_PW=${RB_OWNER_PW:-owner_dev}
APP_PW=${RB_APP_PW:-app_dev}
psql_su() { su postgres -c "psql -v ON_ERROR_STOP=1 $*"; }

su postgres -c "psql -v ON_ERROR_STOP=1" <<SQL
DO \$\$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='retroburger_owner') THEN
    CREATE ROLE retroburger_owner LOGIN PASSWORD '$OWNER_PW' CREATEDB;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='retroburger_app') THEN
    CREATE ROLE retroburger_app LOGIN PASSWORD '$APP_PW' NOSUPERUSER NOBYPASSRLS;
  END IF;
END \$\$;
SQL

for db in retroburger retroburger_test; do
  exists=$(su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='$db'\"")
  [ -z "$exists" ] && su postgres -c "psql -c 'CREATE DATABASE $db OWNER retroburger_owner'"
  su postgres -c "psql -d $db -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS btree_gist;'"
done
echo "OK: roles retroburger_owner / retroburger_app y bases retroburger, retroburger_test"
