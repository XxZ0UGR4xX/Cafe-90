# 🍔 RETROBURGER ERP

ERP + POS + KDS + CRM + Inventario + Compras + Delivery para cadenas de hamburgueserías, con identidad visual de los años 90.
Multi-sucursal y multi-tenant (SaaS). Arquitectura completa en [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); estado real por módulo en [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md).

## Pruebas reales con Docker (sin instalar nada más)

```bash
./scripts/demo.sh up        # migra, carga datos de demostración y levanta API + admin/POS + sitio del cliente
# Admin/POS/KDS http://localhost:8080 · Cliente http://localhost:8081 · API http://localhost:3000/docs
```
Guía de recorridos, usuarios y qué es simulado: [`docs/UAT.md`](docs/UAT.md). Hallazgos de la auditoría y riesgos residuales: [`docs/AUDIT.md`](docs/AUDIT.md).

## Inicio rápido (desarrollo)

Requisitos: Node 22, pnpm 10, PostgreSQL 16.

```bash
pnpm install
cp .env.example .env                 # ajusta contraseñas locales
sudo ./scripts/setup-local-db.sh     # roles retroburger_owner / retroburger_app + bases dev y test
pnpm --filter @retroburger/shared build
pnpm db:migrate                      # migraciones SQL (forward-only)
pnpm db:seed                         # tenant RETROBURGER + 3 sucursales + 21 días de historial
pnpm dev:api                         # http://localhost:3000   (Swagger: /docs)
pnpm dev:web                         # http://localhost:5173   (admin/POS/KDS, PWA)
pnpm --filter @retroburger/web-public dev   # http://localhost:5174 (sitio público + QR de mesa)
```

Credenciales de demostración (SOLO desarrollo; el seed las imprime y se pueden cambiar con `SEED_*`):

| Rol | Usuario | Contraseña / PIN |
|---|---|---|
| Dueño (SUPER_ADMIN) | `admin@retroburger.test` | `Retro90!Burger` |
| Gerente / Cajero / Mesero / Cocinero / Almacén | `gerente-centro@…`, `cajero-centro@…`, `mesero1-centro@…`, `cocinero-centro@…`, `almacen-centro@…` (también `-norte`, `-sur`) | `Retro90!Staff` · PIN `1990` · código PIN = parte antes de `@` |
| Repartidor | `repartidor-centro@retroburger.test` | `Retro90!Staff` |

Restaurante (campo "Restaurante" al iniciar sesión): `retroburger`.

## Estructura

```
apps/api         NestJS 11 + Fastify · módulos de dominio (identity, tenancy, catalog, inventory, purchasing, sales, kitchen, cash, floor, crm, loyalty, promotions, reservations, delivery, printing, sync, reports, public, jobs, audit, notifications, realtime)
apps/web-admin   React + Vite PWA · POS táctil, KDS, mesas, inventario, compras, caja, CRM, reportes, configuración
apps/web-public  Sitio del cliente: menú, pedido para recoger/domicilio, reservas, puntos, QR de mesa
packages/shared  Contratos compartidos: permisos/RBAC, estados, dinero, esquemas zod
packages/ui      Design system Retro* (tokens + componentes + gráficas) y selector de producto
db/migrations    SQL versionado (RLS forzada por tenant, tablas append-only)
e2e              Playwright (flujos reales contra la app)
docs             Arquitectura, estado de implementación, pruebas
```

## Pruebas

```bash
pnpm test           # shared + ui + web-admin + api (integración con PostgreSQL real)
pnpm typecheck
cd e2e && npx playwright test   # requiere API + webs en marcha (ver docs/TESTING.md)
```

## Seguridad en breve
Argon2id · JWT corto + refresh rotativo con detección de reuso (cookie HttpOnly/SameSite=Strict) · RBAC con alcance por sucursal y fallo cerrado · RLS PostgreSQL por tenant · autorización de supervisor por PIN · auditoría inmutable · validación zod en toda entrada · rate limiting · CORS explícito · secretos sólo por variables de entorno. Detalle y pendientes en `docs/IMPLEMENTATION_STATUS.md`.
