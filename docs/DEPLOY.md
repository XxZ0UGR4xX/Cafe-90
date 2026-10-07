# Despliegue a producción

Probado de punta a punta en este repositorio: las imágenes se construyen, el *stack* completo de `deploy/docker-compose.prod.yml` levanta (BD → migraciones → API → webs → proxy TLS), el login pasa por el proxy y el flujo de respaldo → restauración → verificación funciona. **No** se ha probado en un servidor/dominio real ni con carga: ver «Pendiente».

## Arquitectura (1 servidor)

```
Internet ─► Caddy :80/:443 (TLS automático)
              ├─ admin.tu-dominio.com ─► web-admin  (nginx, PWA + CSP estricta)
              ├─ app.tu-dominio.com   ─► web-public (nginx)
              └─ api.tu-dominio.com   ─► api (NestJS, usuario no-root, healthcheck /ready)
                                            └─► db (PostgreSQL 16, red interna: sin puertos publicados)
```
La API puede correr en **varias réplicas** (con Redis, ver «Escalar»); por defecto es una.

## Primer despliegue
1. Servidor con Docker + Compose v2, DNS de los tres nombres apuntando a él y puertos 80/443 abiertos.
2. `cp deploy/.env.prod.example deploy/.env.prod` y completa **todo** (secretos con `openssl rand -base64 48`). `MFA_ENFORCE=true` deja a ADMIN/SUPER_ADMIN sin acceso hasta que enrolen 2FA (lo hacen en su primer login).
3. `docker compose --env-file deploy/.env.prod -f deploy/docker-compose.prod.yml up -d --build`
   (la BD crea los roles `retroburger_owner`, `retroburger_app` —sin BYPASSRLS— y `retroburger_backup` la primera vez; `migrate` aplica el esquema y termina; la API arranca sólo si migró bien).
4. Crea el primer restaurante (sin datos de demostración). La contraseña **no** se pasa en la línea de comandos (quedaría en el historial del shell y en `docker inspect`): se lee sin eco y viaja por una variable exportada solo para ese comando.
   ```bash
   read -rs -p 'Contraseña del dueño (≥12 caracteres): ' PROVISION_ADMIN_PASSWORD; echo; export PROVISION_ADMIN_PASSWORD
   docker compose --env-file deploy/.env.prod -f deploy/docker-compose.prod.yml run --rm \
     -e PROVISION_ADMIN_PASSWORD \
     -e PROVISION_SLUG=mi-restaurante -e PROVISION_NAME="Mi Restaurante" -e PROVISION_ADMIN_EMAIL=dueno@tu-dominio.com \
     -e DATABASE_URL=postgres://retroburger_app:$DB_APP_PASSWORD@db:5432/retroburger api node dist/database/provision.js
   unset PROVISION_ADMIN_PASSWORD
   ```
   (`-e VAR` sin valor toma el de tu entorno.) Tras el primer ingreso cambia la contraseña desde la app.
   `PUBLIC_TENANT` del `.env.prod` debe ser ese slug. Entra en `https://admin.tu-dominio.com`, enrola el 2FA y **guarda los códigos de recuperación**.
5. Configura en la app: sucursales, impresoras, perfil fiscal, correo (Configuración → Integraciones → «Enviar prueba»).

### Variables de seguridad relevantes
- `COOKIE_SECURE=true`, `CORS_ORIGINS` sin `localhost` y un secreto JWT no trivial: la API **se niega a arrancar** en producción si no se cumplen.
- `TRUST_PROXY` (por defecto, redes privadas/loopback): de qué proxies se acepta `X-Forwarded-For`. Caddy sobrescribe la cabecera con la IP real; si pones otro balanceador/CDN delante, indica su CIDR. **No publiques el puerto de la API directamente.**
- El seed de demostración se niega a correr con `NODE_ENV=production` (`ALLOW_DEMO_SEED=true` lo fuerza: no lo uses).
- Agente de impresión: solo escribe en `/dev/…` y conecta a IP privadas por defecto; amplía con `AGENT_ALLOWED_PATHS`, `AGENT_ALLOWED_HOSTS` (lista separada por comas) o `AGENT_ALLOW_PUBLIC_HOSTS=1`.

## Actualizar y volver atrás
- Actualizar: `git pull && docker compose … up -d --build` (migra antes de arrancar la API; las migraciones son sólo hacia adelante y cada una se aplica en transacción).
- Antes de actualizar: **respaldo** (abajo). Volver atrás de código: `APP_VERSION=<anterior>` si conservas la imagen; las migraciones **no** se revierten: restaura el respaldo previo si una migración fue destructiva.

## Respaldos (obligatorio probarlos)
La base usa **RLS forzada**: ni el dueño puede exportar filas. Los respaldos deben hacerse con `retroburger_backup` (BYPASSRLS, sólo lectura); `deploy/backup.sh` se niega a correr con un rol que no lo sea (un respaldo sin filas parecería válido y estaría vacío).

```bash
# diario (cron/systemd timer), cifrado con age, rotación de 14 días y verificación de integridad del archivo
DATABASE_BACKUP_URL=postgres://retroburger_backup:…@127.0.0.1:5432/retroburger BACKUP_DIR=/var/backups/retroburger \
AGE_RECIPIENT=age1… KEEP_DAYS=14 deploy/backup.sh
# semanal: demostrar que se puede restaurar (base temporal, comprueba tablas, RLS forzada, aislamiento y kardex; se borra sola)
AGE_IDENTITY=/ruta/age.key deploy/verify-backup.sh /var/backups/retroburger/retroburger-….dump.age postgres://postgres:…@host:5432/postgres retroburger_app <clave_app>
# desastre: restaurar en una base nueva y apuntar la API a ella
AGE_IDENTITY=… deploy/restore.sh respaldo.dump.age postgres://postgres:…@host:5432/postgres retroburger_restaurada
```
Guarda la clave privada de age **fuera** del servidor y copia los respaldos a otro lugar (otro proveedor/región). Un respaldo que nunca se restauró no cuenta.

## Seguridad: lo que ya viene y lo que falta
Ya: usuario no-root, red de BD interna, TLS/HSTS, CSP + cabeceras en las webs, cookies `Secure`/`SameSite=Strict`, 2FA obligatorio para administradores, RLS forzada, sandbox fiscal prohibido en producción (la API no arranca), auditoría de dependencias semanal y en cada cambio de lockfile (`.github/workflows/security.yml`).
Pendiente antes de producción comercial: gestión de secretos (hoy en `.env.prod`: usar Docker/Swarm secrets o un gestor), rotación de `JWT_ACCESS_SECRET`/`MFA_ENCRYPTION_KEY`, WAF/rate-limit en el borde, escaneo de imágenes (Trivy) y firma, pentest, monitoreo/alertas (sólo hay logs JSON y `/ready`).

## Escalar (varias réplicas de la API)
Redis (incluido en el compose, opcional en desarrollo) comparte entre réplicas lo que antes vivía en memoria: **rate-limit** (login, público y global) y **WebSocket** (adaptador Socket.IO: un evento originado en la réplica A llega a los sockets de la B). Para subir réplicas: `API_REPLICAS=2` en `.env.prod` y `docker compose … up -d`; Caddy re-resuelve el DNS de Docker y reparte con *round robin* y chequeo `/ready`.
Verificado: 2 réplicas tras Caddy reciben tráfico por igual; 13 logins fallidos seguidos → 10 × 401 y luego 429 (límite compartido); prueba automática de evento entre instancias. Las tareas periódicas corren en cada réplica pero son idempotentes (llave de deduplicación, `job_runs`, reclamo `SKIP LOCKED` del correo).
Si Redis cae la API **sigue sirviendo** (fail-open: el límite por IP se relaja; el bloqueo por cuenta vive en PostgreSQL y el WebSocket queda por instancia) y `/ready` lo informa (`redis: down`). Para reportes pesados, siguiente paso: réplica de lectura o tablas resumen.

## Pendiente
Prueba en un servidor real con dominio y carga; despliegue automático (CD) y *rollback* automatizado; trazas distribuidas; endurecimiento anterior.

## Monitoreo
La API expone `GET /metrics` (formato Prometheus) **sólo si defines `METRICS_TOKEN`** (≥16 caracteres, Bearer). El proxy responde 404 a `/metrics` desde Internet; Prometheus lo consulta por la red interna.
```bash
printf '%s' "$METRICS_TOKEN" > deploy/prometheus/metrics_token      # el mismo valor del .env.prod
# en .env.prod: METRICS_TOKEN=…  y  METRICS_TOKEN_FILE=./prometheus/metrics_token
docker compose --env-file deploy/.env.prod -f deploy/docker-compose.prod.yml --profile monitoring up -d
```
Métricas: duración de peticiones por método/**plantilla** de ruta/estado (sin ids ni datos personales), pool de BD, proceso de Node, correos enviados/fallidos, facturas timbradas/con error, fallos de login y última ejecución de las tareas periódicas. Reglas de alerta en `deploy/prometheus/alerts.yml` (API caída, >2 % de 5xx, p95 > 1 s, pool saturado, correo/PAC fallando, ráfaga de logins fallidos, tareas detenidas); conéctalas a Alertmanager/Grafana Cloud o a tu canal de avisos.
