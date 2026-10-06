# Estado de implementación vs. arquitectura

Leyenda: ✅ implementado y probado · 🟡 parcial / base lista · ⏳ pendiente.

## Decisiones que difieren de la propuesta original (ADR)
| Tema | Propuesto | Implementado | Motivo |
|---|---|---|---|
| Backend | NestJS + Fastify | NestJS 11 + Fastify 5 | (alineado; se subió de versión por compatibilidad de plugins) |
| Acceso a datos | Drizzle | `pg` con SQL parametrizado en repositorios/servicios | control directo de RLS/transacciones/bloqueos; menos capas. Migrar a un query builder tipado es posible sin cambiar contratos |
| Sitio público | Next.js (SSR) | **Vite SPA** (`apps/web-public`) | acelerar entrega; **pendiente** SSR/SEO (migración a Next.js recomendada antes de producción comercial) |
| Storybook | sí | no; los componentes se prueban con Vitest y el uso real en las apps | pendiente |
| Redis/BullMQ | cache, pub/sub, colas | no se usa aún: jobs en proceso (`JobsService`), WebSocket en memoria, rate-limit en memoria | suficiente para 1 instancia; **requerido** para escalar horizontalmente |
| Descuento de inventario | al enviar a cocina | al enviar a cocina (D13 recomendada) | configurable en un solo punto |

## Módulos
| Módulo | Estado | Notas |
|---|---|---|
| Multi-tenant (RLS), sucursales | ✅ | RLS forzada + prueba automática sobre todas las tablas |
| Auth (login, refresh, PIN) / RBAC / auditoría | ✅ | **2FA TOTP** (RFC 6238, sin dependencias): reto en login, enrolamiento con QR, 10 códigos de recuperación de un solo uso, anti-replay, secreto cifrado AES-256-GCM, bloqueo por intentos, reinicio por administrador. Obligatorio para ADMIN/SUPER_ADMIN con `MFA_ENFORCE=true`; el PIN rápido nunca evita el 2FA. Jerarquía de privilegios al administrar usuarios (un gerente no edita a un ADMIN ni a otra sucursal) |
| Catálogo, variantes, modificadores, combos, recetas, costos | ✅ | |
| Inventario (kardex, lotes FEFO, mermas, ajustes, conteo físico, transferencias, alertas) | ✅ | conciliación kardex↔saldo probada; falta job de conciliación nocturna |
| Compras (proveedores, cotización, OC, aprobación, recepción parcial, factura con cotejo) | ✅ | cuentas por pagar básico |
| POS / pedidos / pagos mixtos / propinas / descuentos / división / cancelación / devolución | ✅ | autorización de supervisor por PIN |
| Mesas y reservaciones | ✅ | mapa en cuadrícula (no arrastrable); anti-empalme por constraint |
| KDS (estaciones, SLA por color, tiempo real) | ✅ | WebSocket por sala de sucursal |
| Caja (turnos, conteo ciego, retiros/gastos, corte) | ✅ | |
| CRM, lealtad (ledger inmutable), promociones (2×1, %, fijo, happy hour, cupón, cumpleaños, puntos dobles) | ✅ | umbrales de segmentos fijos en código |
| Delivery + repartidor | ✅ | sin geolocalización/ruteo |
| Offline POS (caché, outbox persistente, sync idempotente, bandeja de excepciones) | ✅ | cobro con tarjeta/QR offline sólo registra referencia; sin LAN edge |
| Reportes (14), dashboards por rol, analítica | ✅ | consultas directas (sin tablas resumen); 🟡 optimizar con resúmenes/réplica a escala |
| Impresión | 🟡 | cola + formato de texto 42/32 col. listo; **falta agente local ESC/POS** |
| Notificaciones | 🟡 | in-app + tiempo real; sin email/SMS/push |
| Público/QR | ✅ | pago en línea no integrado (pago al recibir) |
| Pasarela de pagos (tarjeta en línea) | ⏳ | interfaz por definir; hoy se registra método y referencia |
| Modo arcade, sonidos, PWA | ✅ | |
| Observabilidad (logs JSON, requestId) | ✅ | 🟡 sin OpenTelemetry/Sentry |
| Facturación CFDI 4.0 (México) | 🟡 | Flujo completo: perfil fiscal, factura por ticket, autofactura pública con código del ticket, factura global, cancelación con motivo SAT, XML. **Proveedor SIMULADO** (sin validez fiscal): falta conectar un PAC real — ver `docs/FISCAL.md` |
| CI/CD, Docker | 🟡 | workflow y compose básicos incluidos; sin despliegue |

## Seguridad pendiente antes de producción
**Activar `MFA_ENFORCE=true` y definir `MFA_ENCRYPTION_KEY` (obligatoria en producción)**; rotación de la clave MFA (hoy no hay re-cifrado), Redis para rate-limit/sesiones distribuidas, rotación de secretos, CSP/headers del frontend servidos por el proxy, escaneo de dependencias en CI, backups cifrados y prueba de restauración, pentest.
