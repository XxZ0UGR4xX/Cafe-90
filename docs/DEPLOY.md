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
La API es **una sola instancia**: el rate-limit, el WebSocket y los jobs viven en memoria (ver «Escalar»).

## Primer despliegue
1. Servidor con Docker + Compose v2, DNS de los tres nombres apuntando a él y puertos 80/443 abiertos.
2. `cp deploy/.env.prod.example deploy/.env.prod` y completa **todo** (secretos con `openssl rand -base64 48`). `MFA_ENFORCE=true` deja a ADMIN/SUPER_ADMIN sin acceso hasta que enrolen 2FA (lo hacen en su primer login).
3. `docker compose --env-file deploy/.env.prod -f deploy/docker-compose.prod.yml up -d --build`
   (la BD crea los roles `retroburger_owner`, `retroburger_app` —sin BYPASSRLS— y `retroburger_backup` la primera vez; `migrate` aplica el esquema y termina; la API arranca sólo si migró bien).
4. Crea el primer restaurante (sin datos de demostración):
   ```bash
   docker compose --env-file deploy/.env.prod -f deploy/docker-compose.prod.yml run --rm \
     -e PROVISION_SLUG=mi-restaurante -e PROVISION_NAME="Mi Restaurante" \
     -e PROVISION_ADMIN_EMAIL=dueno@tu-dominio.com -e PROVISION_ADMIN_PASSWORD='(≥12 caracteres)' \
     -e DATABASE_URL=postgres://retroburger_app:$DB_APP_PASSWORD@db:5432/retroburger api node dist/database/provision.js
   ```
   `PUBLIC_TENANT` del `.env.prod` debe ser ese slug. Entra en `https://admin.tu-dominio.com`, enrola el 2FA y **guarda los códigos de recuperación**.
5. Configura en la app: sucursales, impresoras, perfil fiscal, correo (Configuración → Integraciones → «Enviar prueba»).

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

## Escalar
Una instancia aguanta una operación de varias sucursales, pero para réplicas de API hace falta **Redis** (rate-limit compartido, pub/sub de Socket.IO, jobs con elección de líder) y, para reportes pesados, una réplica de lectura o tablas resumen. Hasta entonces: **no** pongas `replicas > 1`.

## Pendiente
Prueba en un servidor real con dominio y carga; despliegue automático (CD) y *rollback* automatizado; observabilidad (métricas/trazas); Redis; endurecimiento anterior.
