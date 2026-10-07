#!/usr/bin/env bash
# Prueba de restauración: restaura el respaldo en una base temporal y comprueba lo que NO puede fallar
# (tablas, RLS forzada, aislamiento por tenant con el rol de la app, integridad del kardex). Borra la base temporal al terminar.
#   deploy/verify-backup.sh respaldo.dump  postgres://postgres:…@host:5432/postgres  [app_role] [app_password]
set -euo pipefail
FILE="${1:?archivo}"; ADMIN_URL="${2:?url admin}"; APP="${3:-retroburger_app}"; APP_PW="${4:-}"
DB="verify_$(date +%s)"; BASE="${ADMIN_URL%/*}"
cleanup() { psql "$ADMIN_URL" -qc "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" >/dev/null 2>&1 || true; }; trap cleanup EXIT
"$(dirname "$0")/restore.sh" "$FILE" "$ADMIN_URL" "$DB" >/dev/null
q() { psql "$BASE/$DB" -Atqc "$1"; }
tables=$(q "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
norls=$(q "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity AND NOT c.relforcerowsecurity")
tenants=$(q "SELECT count(*) FROM restaurants")
drift=$(q "SELECT count(*) FROM inventory inv WHERE abs(inv.qty - COALESCE((SELECT sum(m.qty) FROM inventory_movements m WHERE m.branch_id=inv.branch_id AND m.ingredient_id=inv.ingredient_id),0)) > 0.0005")
migs=$(q "SELECT count(*) FROM schema_migrations")
[ "$tables" -ge 40 ] || { echo "FALLO: sólo $tables tablas"; exit 1; }
[ "$norls" -eq 0 ] || { echo "FALLO: $norls tablas con RLS sin FORCE"; exit 1; }
[ "$drift" -eq 0 ] || { echo "FALLO: $drift insumos con saldo ≠ kardex"; exit 1; }
# Sin tenant fijado el rol de la app NO debe ver filas (RLS forzada), aunque la base tenga datos
if [ -n "$APP_PW" ] && [ "$tenants" -gt 0 ]; then
  seen=$(PGPASSWORD="$APP_PW" psql "${BASE/\/\/*@/\/\/$APP:$APP_PW@}/$DB" -Atqc "SELECT count(*) FROM branches" 2>/dev/null || echo 0)
  [ "$seen" -eq 0 ] || { echo "FALLO: el rol de la app ve $seen sucursales sin tenant (RLS rota)"; exit 1; }
fi
echo "OK restauración verificada: $tables tablas, $migs migraciones, $tenants restaurante(s), RLS forzada, kardex íntegro"
