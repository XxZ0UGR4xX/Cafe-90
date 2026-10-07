#!/usr/bin/env bash
# Respaldo lógico de PostgreSQL (pg_dump formato custom, comprimido), cifrado opcional con age y rotación.
#   DATABASE_BACKUP_URL=postgres://retroburger_backup:…@host:5432/retroburger BACKUP_DIR=/var/backups/retroburger \
#   [AGE_RECIPIENT=age1…] [KEEP_DAYS=14] deploy/backup.sh
# IMPORTANTE: la base usa RLS FORZADA, así que ni el dueño ve filas al exportar. El respaldo DEBE hacerse con un rol de respaldo con
# BYPASSRLS y sólo lectura (lo crea deploy/init-db.sh; en una base existente:
#   CREATE ROLE retroburger_backup LOGIN BYPASSRLS PASSWORD '…'; GRANT pg_read_all_data TO retroburger_backup;)
# Con Docker Compose:  docker compose --env-file deploy/.env.prod -f deploy/docker-compose.prod.yml exec -T db pg_dump -U postgres -Fc retroburger > respaldo.dump
set -euo pipefail
: "${DATABASE_BACKUP_URL:?define DATABASE_BACKUP_URL}"
DIR="${BACKUP_DIR:-./backups}"; KEEP="${KEEP_DAYS:-14}"
mkdir -p "$DIR"; umask 077
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"; OUT="$DIR/retroburger-$STAMP.dump"
# Un respaldo sin filas (RLS) sería "válido" pero vacío: se exige un rol que ignore RLS
[ "$(psql "$DATABASE_BACKUP_URL" -Atc "SELECT rolbypassrls OR rolsuper FROM pg_roles WHERE rolname = current_user")" = "t" ] || { echo "ERROR: el rol de respaldo debe tener BYPASSRLS (con RLS forzada el respaldo saldría vacío)"; exit 1; }
pg_dump --format=custom --compress=6 --no-owner --no-privileges --dbname="$DATABASE_BACKUP_URL" --file="$OUT.partial"
# Un respaldo que no se puede leer no es un respaldo: se valida el índice del archivo antes de aceptarlo
pg_restore --list "$OUT.partial" >/dev/null
mv "$OUT.partial" "$OUT"
if [ -n "${AGE_RECIPIENT:-}" ]; then
  age -r "$AGE_RECIPIENT" -o "$OUT.age" "$OUT" && rm -f "$OUT"; OUT="$OUT.age"
fi
( cd "$DIR" && sha256sum "$(basename "$OUT")" > "$(basename "$OUT").sha256" )
find "$DIR" -maxdepth 1 -name 'retroburger-*' -mtime +"$KEEP" -delete
echo "OK $(du -h "$OUT" | cut -f1) → $OUT"
