# Estado de implementación vs. arquitectura

Leyenda: ✅ implementado y probado · 🟡 parcial / base lista · ⏳ pendiente.

## Decisiones que difieren de la propuesta original (ADR)
| Tema | Propuesto | Implementado | Motivo |
|---|---|---|---|
| Backend | NestJS + Fastify | NestJS 11 + Fastify 5 | (alineado; se subió de versión por compatibilidad de plugins) |
| Acceso a datos | Drizzle | `pg` con SQL parametrizado en repositorios/servicios | control directo de RLS/transacciones/bloqueos; menos capas. Migrar a un query builder tipado es posible sin cambiar contratos |
| Sitio público | Next.js (SSR) | **Vite SPA** (`apps/web-public`) | acelerar entrega; **pendiente** SSR/SEO (migración a Next.js recomendada antes de producción comercial) |
| Storybook | sí | no; los componentes se prueban con Vitest y el uso real en las apps | pendiente |
| Redis/BullMQ | cache, pub/sub, colas | **Redis opcional** (`REDIS_URL`): rate-limit y adaptador Socket.IO compartidos entre réplicas (fail-open). Jobs siguen en proceso pero idempotentes y seguros con varias réplicas; sin BullMQ ni caché | suficiente para varias réplicas de la API; BullMQ sólo hará falta si aparecen trabajos pesados |
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
| Mesas y reservaciones | ✅ | **plano editable con arrastrar y soltar** (ratón, táctil y flechas del teclado; ajuste a cuadrícula, no se encima con otra mesa —validado también en el servidor—, auditado) + vista de tarjetas; reservaciones con anti-empalme por constraint |
| KDS (estaciones, SLA por color, tiempo real) | ✅ | WebSocket por sala de sucursal |
| Caja (turnos, conteo ciego, retiros/gastos, corte) | ✅ | |
| CRM, lealtad (ledger inmutable), promociones (2×1, %, fijo, happy hour, cupón, cumpleaños, puntos dobles) | ✅ | umbrales de segmentos fijos en código |
| Delivery + repartidor | ✅ | sin geolocalización/ruteo |
| Offline POS (caché, outbox persistente, sync idempotente, bandeja de excepciones) | ✅ | cobro con tarjeta/QR offline sólo registra referencia; sin LAN edge |
| Reportes (14), dashboards por rol, analítica | ✅ | consultas directas (sin tablas resumen); 🟡 optimizar con resúmenes/réplica a escala |
| Impresión | ✅ | cola + formato 42/32 col. + **agente local ESC/POS** (`apps/print-agent`: CP858, corte, cajón, zumbador, red TCP 9100 o dispositivo, reintento con espera si la impresora está apagada); falta probar con hardware real |
| Notificaciones | 🟡 | in-app + tiempo real + **correo** (cola durable `email_outbox` con reintentos 1/5/15/60/180 min, SMTP vía `SMTP_URL` o modo registro; factura con XML adjunto al receptor, alertas críticas a destinatarios configurables, correo de prueba). **Sin SMS/push** |
| Público/QR | ✅ | pago en línea no integrado (pago al recibir) |
| Pasarela de pagos (tarjeta en línea) | ⏳ | interfaz por definir; hoy se registra método y referencia |
| Modo arcade, sonidos, PWA | ✅ | |
| Observabilidad (logs JSON, requestId, métricas) | 🟡 | logs JSON con requestId + **`/metrics` Prometheus** (token, sin ids en etiquetas) + 8 reglas de alerta validadas con promtool y perfil `monitoring` en el compose; sin trazas distribuidas (OpenTelemetry) ni Sentry |
| Facturación CFDI 4.0 (México) | 🟡 | Flujo completo: perfil fiscal, factura por ticket, autofactura pública con código del ticket, factura global, cancelación con motivo SAT, XML. **Proveedor SIMULADO** (sin validez fiscal): falta conectar un PAC real — ver `docs/FISCAL.md` |
| CI/CD, Docker, despliegue | 🟡 | **Imágenes de producción** (API no-root con healthcheck; webs en nginx con CSP) construidas y probadas; **stack completo** `deploy/docker-compose.prod.yml` (BD interna, migración previa, Caddy con TLS) levantado y verificado (login, 2FA obligatorio, webs); alta de restaurante sin demo (`provision`); **respaldo cifrado + restauración + verificación** probados (descubierto y resuelto: con RLS forzada el respaldo exige un rol BYPASSRLS); CI construye las imágenes; auditoría de dependencias semanal (0 vulnerabilidades tras subir fastify/react-router). Falta CD, prueba en servidor real y monitoreo — ver `docs/DEPLOY.md` |

## Seguridad pendiente antes de producción
**Activar `MFA_ENFORCE=true` y definir `MFA_ENCRYPTION_KEY` (obligatoria en producción)**; rotación de la clave MFA (hoy no hay re-cifrado), rotación de secretos, CSP/headers del frontend servidos por el proxy, gestión de secretos fuera de `.env`, escaneo de imágenes, monitoreo/alertas, pentest.
