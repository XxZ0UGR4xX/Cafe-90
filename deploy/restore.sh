#!/usr/bin/env bash
# Restaura un respaldo en una base NUEVA (nunca sobre la de producción sin decidirlo a conciencia).
#   deploy/restore.sh respaldo.dump  postgres://postgres:…@host:5432/postgres  retroburger_restaurada  [owner_role] [app_role]
# La URL admin debe ser de un superusuario (la restauración crea extensiones y objetos del dueño). Si el archivo termina en .age: AGE_IDENTITY=/ruta/clave.txt
set -euo pipefail
FILE="${1:?archivo}"; ADMIN_URL="${2:?url admin (base postgres)}"; DB="${3:?nombre de la base nueva}"; OWNER="${4:-retroburger_owner}"; APP="${5:-retroburger_app}"
[[ "$DB" =~ ^[a-z0-9_]+$ ]] || { echo "nombre de base inválido"; exit 1; }
SRC="$FILE"; SRC_TMP=""
if [[ "$FILE" == *.age ]]; then SRC="$(mktemp)"; SRC_TMP="$SRC"; age -d -i "${AGE_IDENTITY:?define AGE_IDENTITY}" -o "$SRC" "$FILE"; fi
if [ -f "$FILE.sha256" ]; then ( cd "$(dirname "$FILE")" && sha256sum -c "$(basename "$FILE").sha256" ); fi
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$DB\" OWNER \"$OWNER\""
psql "${ADMIN_URL%/*}/$DB" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS btree_gist;"
# Las extensiones ya se crearon arriba (como superusuario); sus COMMENT/definiciones se omiten porque el dueño no puede tocarlas
LIST="$(mktemp)"; trap 'rm -f "$LIST" "${SRC_TMP:-}"' EXIT
pg_restore --list "$SRC" | grep -v ' EXTENSION ' > "$LIST"
pg_restore --dbname="${ADMIN_URL%/*}/$DB" --no-owner --role="$OWNER" --exit-on-error --use-list="$LIST" "$SRC"
# Los permisos del rol de la aplicación no viajan en el respaldo (--no-privileges): se reaplican igual que en las migraciones
psql "${ADMIN_URL%/*}/$DB" -v ON_ERROR_STOP=1 <<SQL
GRANT USAGE ON SCHEMA public TO "$APP";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "$APP";
REVOKE ALL ON schema_migrations FROM "$APP";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "$APP";
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO "$APP";
SQL
echo "OK base restaurada: $DB"
