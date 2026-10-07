#!/bin/sh
# Se ejecuta UNA vez, al crear el volumen de PostgreSQL: roles (dueño y aplicación SIN BYPASSRLS), base y extensiones.
set -eu
psql -v ON_ERROR_STOP=1 -U postgres <<SQL
CREATE ROLE retroburger_owner LOGIN PASSWORD '${OWNER_PASSWORD}' CREATEDB;
CREATE ROLE retroburger_app LOGIN PASSWORD '${APP_PASSWORD}' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE retroburger_backup LOGIN PASSWORD '${BACKUP_PASSWORD}' BYPASSRLS;   -- sólo lectura: para pg_dump (la RLS forzada vacía el respaldo del dueño)
GRANT pg_read_all_data TO retroburger_backup;
CREATE DATABASE retroburger OWNER retroburger_owner;
SQL
psql -v ON_ERROR_STOP=1 -U postgres -d retroburger -c "CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS btree_gist;"
