#!/bin/sh
# robots.txt y sitemap.xml del sitio público, con el origen real (PUBLIC_ORIGIN, p. ej. https://app.tu-dominio.com). Corre al arrancar el contenedor.
set -eu
ORIGIN="${PUBLIC_ORIGIN:-}"
ROOT=/usr/share/nginx/html
if [ -z "$ORIGIN" ]; then
  # sin origen no hay sitemap válido (debe ser absoluto): sólo se protegen las rutas privadas
  printf 'User-agent: *\nDisallow: /pedido/\nDisallow: /m/\nDisallow: /factura\n' > "$ROOT/robots.txt"
  exit 0
fi
ORIGIN="${ORIGIN%/}"
printf 'User-agent: *\nDisallow: /pedido/\nDisallow: /m/\nDisallow: /factura\nSitemap: %s/sitemap.xml\n' "$ORIGIN" > "$ROOT/robots.txt"
{
  echo '<?xml version="1.0" encoding="UTF-8"?>'
  echo '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
  for p in "/" "/reservar" "/puntos"; do echo "  <url><loc>${ORIGIN}${p}</loc></url>"; done
  echo '</urlset>'
} > "$ROOT/sitemap.xml"
