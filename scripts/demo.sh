#!/usr/bin/env bash
# Entorno de PRUEBAS REALES con Docker: ./scripts/demo.sh up|down|reset|logs|status [--mail]
set -euo pipefail
cd "$(dirname "$0")/.."
F="deploy/docker-compose.demo.yml"
MAIL=0; for a in "$@"; do [ "$a" = "--mail" ] && MAIL=1; done
export SMTP_URL=""; PROFILE=()
if [ "$MAIL" = 1 ]; then export SMTP_URL="smtp://mailpit:1025"; PROFILE=(--profile mail); fi
C=(docker compose -f "$F" "${PROFILE[@]}")
case "${1:-up}" in
  up)
    "${C[@]}" up -d --build
    echo "Esperando a que el sistema esté listo (la primera vez carga datos de demostración, ~1-2 min)…"
    for i in $(seq 1 90); do curl -fs http://localhost:3000/ready >/dev/null 2>&1 && break; sleep 2; done
    curl -fs http://localhost:3000/ready >/dev/null || { echo "La API no respondió; revisa: ./scripts/demo.sh logs"; exit 1; }
    cat <<MSG

✅ RetroBurger listo
   Admin / POS / KDS : http://localhost:8080      (restaurante: retroburger)
   Sitio del cliente : http://localhost:8081
   API + Swagger     : http://localhost:3000/docs
   Dueño     : admin@retroburger.test / Retro90!Burger
   Personal  : cajero-centro@retroburger.test, mesero1-centro@…, cocinero-centro@…, gerente-centro@…, almacen-centro@… / Retro90!Staff  (PIN 1990)
   Guía de pruebas: docs/UAT.md
MSG
    [ "$MAIL" = 1 ] && echo "   Correos (Mailpit): http://localhost:8025"
    ;;
  down) "${C[@]}" down ;;
  reset) "${C[@]}" down -v; echo "Datos borrados. Vuelve a empezar con: ./scripts/demo.sh up" ;;
  logs) "${C[@]}" logs -f --tail=100 api ;;
  status) "${C[@]}" ps ;;
  *) echo "uso: $0 up|down|reset|logs|status [--mail]"; exit 1 ;;
esac
