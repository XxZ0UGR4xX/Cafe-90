#!/usr/bin/env bash
# Reinicia el esquema de una BD LOCAL (¡destructivo!). Uso: scripts/reset-db.sh retroburger_test
set -euo pipefail
db=${1:?base de datos}
case "$db" in retroburger|retroburger_test) ;; *) echo "solo bases locales retroburger*"; exit 1;; esac
su postgres -c "psql -d $db -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public AUTHORIZATION retroburger_owner; GRANT USAGE ON SCHEMA public TO retroburger_app;'"
su postgres -c "psql -d $db -c 'CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS btree_gist;'"
