# Rendimiento y concurrencia

Mediciones **reales pero de un entorno pequeño** (4 vCPU compartidas entre la API, PostgreSQL y el generador de carga; base de demostración con ~1,800 pedidos). Sirven para dimensionar y para detectar regresiones, no como garantía de producción.

## Qué se prueba
- **Estrés de correctitud** (`apps/api/test/stress.test.ts`, en CI): 120 flujos simultáneos que mezclan crear → enviar a cocina → cobrar (efectivo/tarjeta/QR, propinas) → cancelar → devolver, con productos que comparten insumos en distinto orden. Exige **cero 5xx**, folios únicos, kardex = saldo, sin existencias negativas, pagadas = total exacto, caja = pagos − devoluciones. Esta prueba **encontró un deadlock real** (la reversa de una cancelación bloqueaba insumos en otro orden que una venta concurrente) que ya está corregido, y por eso las transacciones de nivel superior ahora **se reintentan solas** ante deadlock/serialización (`DbService.tx`, hasta 4 intentos con espera aleatoria; probado con un deadlock real en `db-retry.test.ts`).
- **Carga** (`scripts/loadtest.mjs`, manual contra una API en marcha): usuarios virtuales que repiten crear+enviar → cobrar → consultar mesas/pedidos. Variables: `VUS`, `DURATION_S`, `API_URL`, `EMAIL`…  Requiere `RATE_LIMIT_AUTH_MAX` alto en la API de prueba (un solo token = un solo cubo de límite).

## Resultados (cajero único, sucursal CENTRO, stock abundante)
| Usuarios virtuales | Ventas/s | crear+enviar p50 / p95 / p99 | cobrar p95 | mesas p95 |
|---|---|---|---|---|
| 1 | 10.5 | 49 / 69 / 89 ms | 33 ms | 11 ms |
| 5 | 17.8 | 190 / 587 / 804 ms | 31 ms | 9 ms |
| 20 | 16.4 | 671 / 3985 / 6060 ms | 32 ms | 10 ms |

**Lectura:** el techo (~17 ventas/s por sucursal) viene de las filas calientes de inventario (cada hamburguesa toca los mismos insumos y el bloqueo dura lo que la transacción); más usuarios sólo alargan la cola. Una sucursal con mucho movimiento hace 1–2 pedidos/s en hora pico: hay >8× de holgura. Las sucursales distintas bloquean filas distintas y escalan en paralelo. Lecturas (mesas, listas) se mantienen en ~10 ms incluso saturado el flujo de ventas.

## Límites de peticiones (anti-abuso)
- Sin sesión: `RATE_LIMIT_MAX` (300/min) **por IP**. Con sesión: `RATE_LIMIT_AUTH_MAX` (1200/min) **por token**, no por IP — un restaurante entero sale por una IP pública y limitar por IP bloquearía a sus tablets entre sí. Login y sitio público tienen límites propios más estrictos. Al excederlos la API responde `429 RATE_LIMITED` (reintentable), nunca 500 (la prueba de carga lo destapó: el filtro de errores convertía el 429 de Fastify en 500).

## Cómo mejorar si hiciera falta (en este orden)
1. Tomar los bloqueos de inventario al final de la transacción de envío (hoy al principio) → menos tiempo de retención.
2. Descontar inventario por lotes (varias órdenes por transacción) sólo si una sucursal supera ~10 pedidos/s sostenidos.
3. Réplica de lectura/tablas resumen para reportes (hoy consultan las tablas operativas).
