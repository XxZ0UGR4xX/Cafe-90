# Pruebas

| Capa | Herramienta | Qué cubre | Comando |
|---|---|---|---|
| Unit (shared) | Vitest | permisos por rol, estados, dinero (split sin perder centavos) | `pnpm --filter @retroburger/shared test` |
| Unit (api) | Vitest | cálculo de totales/impuestos/descuentos, reglas de promociones, rangos de fechas, formato de tickets | `pnpm --filter @retroburger/api test` |
| Integración / API / BD (api) | Vitest + `app.inject` + PostgreSQL real | auth (lockout, refresh rotativo/reuso), RBAC y alcance por sucursal, **aislamiento multi-tenant (RLS) en todas las tablas**, auditoría inmutable, venta completa mesa→cocina→cobro→corte, modificadores/combos, cancelaciones/devoluciones con supervisor, idempotencia, **concurrencia de stock**, offline/sync, inventario/kardex/transferencias/conteos, compras, promociones, lealtad, reservaciones, delivery, reportes/dashboards, QR/público, impresión, WebSocket | `pnpm --filter @retroburger/api test` |
| Componentes (ui, web-admin) | Vitest + Testing Library | Retro*, outbox offline persistente, estimación local | `pnpm --filter @retroburger/ui test` |
| E2E | Playwright (Chromium) | login, dashboard, POS completo con modificadores, KDS, caja, tablet, sitio público y QR | `pnpm --filter @retroburger/e2e e2e` |

Las pruebas de API usan la base `retroburger_test` (creada por `scripts/setup-local-db.sh`); migran automáticamente al iniciar.
Para E2E: levantar API (`pnpm dev:api`), `pnpm dev:web`, `pnpm --filter @retroburger/web-public dev`, tener el seed cargado y ejecutar `npx playwright test` en `e2e/` (usa el Chromium preinstalado: `CHROMIUM_PATH`).

## 2FA
`apps/api/test/mfa.test.ts` cubre: vectores RFC 6238, ventana ±1 y anti-replay, cifrado AES-GCM, flujo login→reto→sesión, códigos de recuperación de un solo uso, bloqueo tras 5 fallos (la contraseña correcta no reinicia el contador), PIN que no evita el 2FA, secreto ausente de auditoría, enrolamiento obligatorio con `MFA_ENFORCE`, reinicio por administrador y jerarquía de privilegios. E2E de navegador: `e2e/tests/mfa.spec.ts` (crea un usuario descartable; no altera la cuenta demo).
