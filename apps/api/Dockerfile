# Imagen de la API (contexto de build: raíz del repositorio).  docker build -f apps/api/Dockerfile -t retroburger-api .
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN command -v pnpm >/dev/null || npm install -g pnpm@10.28.0 --no-fund --no-audit
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY apps/api/package.json apps/api/
COPY apps/web-admin/package.json apps/web-admin/
COPY apps/web-public/package.json apps/web-public/
COPY apps/print-agent/package.json apps/print-agent/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile --filter @retroburger/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @retroburger/shared build && pnpm --filter @retroburger/api build \
 && pnpm --filter @retroburger/api deploy --prod --legacy /out

FROM node:22-slim AS runtime
ENV NODE_ENV=production PORT=3000 MIGRATIONS_DIR=/app/db/migrations
WORKDIR /app
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
COPY --chown=node:node db/migrations ./db/migrations
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
