# Imagen estática (nginx) de una web. Se usa para web-admin y web-public:
#   docker build -f apps/web-admin/Dockerfile --build-arg APP=web-admin  --build-arg VITE_API_URL=https://api.ejemplo.com -t retroburger-admin  .
#   docker build -f apps/web-admin/Dockerfile --build-arg APP=web-public --build-arg VITE_API_URL=https://api.ejemplo.com --build-arg VITE_TENANT=mi-restaurante -t retroburger-public .
FROM node:22-slim AS build
ARG APP=web-admin
ARG VITE_API_URL
ARG VITE_TENANT=retroburger
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true VITE_API_URL=$VITE_API_URL VITE_TENANT=$VITE_TENANT
RUN command -v pnpm >/dev/null || npm install -g pnpm@10.28.0 --no-fund --no-audit
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY apps/api/package.json apps/api/
COPY apps/web-admin/package.json apps/web-admin/
COPY apps/web-public/package.json apps/web-public/
COPY apps/print-agent/package.json apps/print-agent/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile --filter "@retroburger/${APP}..."
COPY packages packages
COPY apps/${APP} apps/${APP}
RUN pnpm --filter @retroburger/shared build && pnpm --filter "@retroburger/${APP}" build

FROM nginx:1.27-alpine AS runtime
ARG APP=web-admin
COPY apps/web-admin/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY apps/web-admin/security.inc.template /etc/nginx/templates/security.inc.template
COPY --from=build /repo/apps/${APP}/dist /usr/share/nginx/html
# Scripts de arranque propios de cada web (el público genera robots.txt y sitemap.xml con su origen real)
COPY apps/${APP}/docker-entrypoint.d/ /docker-entrypoint.d/
# Valores por defecto (se sobrescriben al ejecutar): orígenes de la API para la política CSP
ENV API_ORIGIN="" API_WS_ORIGIN="" PUBLIC_ORIGIN="" ROBOTS_TAG="noindex, nofollow"
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/healthz || exit 1
